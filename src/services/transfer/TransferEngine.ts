// src/services/transfer/TransferEngine.ts
// Sender side. For each file:
//   {FILE_START ... rawBytes: size}\n  + <size raw bytes>  + {FILE_END}\n
// and finally {TRANSFER_COMPLETE}\n. The receiver answers {TRANSFER_RECEIVED}.
import * as RNFS from '@dr.pogodin/react-native-fs';
import { Buffer } from 'buffer';
import { SocketManager } from '../socket/SocketManager';
import type { PickedFile } from '../files/FileStore';

const CHUNK_SIZE = 128 * 1024; // bytes read + written per step
const WRITE_TIMEOUT_MS = 20000;
const ACK_TIMEOUT_MS = 60000;

export type SendProgress = {
  deviceId: string;
  deviceName: string;
  state: 'sending' | 'delivered' | 'sent' | 'error';
  fileIndex: number; // 1-based
  fileCount: number;
  fileName: string;
  overallSent: number;
  overallTotal: number;
  error?: string;
};

// The picker (import mode) returns a percent-encoded file:// uri to a local copy.
function toLocalPath(uri: string): string {
  if (uri.startsWith('content://')) {
    throw new Error('File is not stored locally. Remove it and pick it again.');
  }
  const raw = uri.startsWith('file://') ? uri.slice(7) : uri;
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Register BEFORE sending TRANSFER_COMPLETE so the ack can't be missed.
function waitForAck(deviceId: string): Promise<{ ok: boolean; error?: string } | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = SocketManager.onMessage((msg, id) => {
      if (id === deviceId && msg.type === 'TRANSFER_RECEIVED') {
        off();
        if (timer) clearTimeout(timer);
        resolve({ ok: msg.ok !== false, error: msg.error });
      }
    });
    timer = setTimeout(() => {
      off();
      resolve(null); // no ack in time
    }, ACK_TIMEOUT_MS);
  });
}

// Never rejects: failures are reported through onProgress with state 'error'.
export async function sendFiles(
  deviceId: string,
  files: PickedFile[],
  onProgress: (p: SendProgress) => void,
): Promise<void> {
  const deviceName =
    SocketManager.getDevices().find((d) => d.deviceId === deviceId)?.deviceName ?? 'Device';

  const progress: SendProgress = {
    deviceId,
    deviceName,
    state: 'sending',
    fileIndex: 0,
    fileCount: files.length,
    fileName: '',
    overallSent: 0,
    overallTotal: 0,
  };
  let lastEmit = 0;
  const emit = (patch: Partial<SendProgress>, force = false) => {
    Object.assign(progress, patch);
    const now = Date.now();
    if (force || now - lastEmit > 100) {
      lastEmit = now;
      onProgress({ ...progress });
    }
  };

  SocketManager.setDeviceStatus(deviceId, 'transferring');
  try {
    // Real sizes from disk (picker sizes can be null).
    const prepared: { file: PickedFile; path: string; size: number }[] = [];
    for (const file of files) {
      const path = toLocalPath(file.uri);
      const st = await RNFS.stat(path);
      prepared.push({ file, path, size: st.size });
    }
    const overallTotal = prepared.reduce((sum, p) => sum + p.size, 0);
    emit({ overallTotal }, true);

    const batchId = `${Date.now()}`;

    for (let i = 0; i < prepared.length; i++) {
      const { file, path, size } = prepared[i];
      emit({ fileIndex: i + 1, fileName: file.name }, true);

      SocketManager.setRaw(deviceId, true); // no PONG etc. may be written until the file body is out
      SocketManager.sendControl(deviceId, 'FILE_START', {
        id: `${batchId}-${i + 1}`,
        index: i + 1,
        total: prepared.length,
        name: file.name,
        mime: file.type,
        size,
        batchBytes: overallTotal,
        rawBytes: size, // the next `size` bytes on this connection are the file
      });

      // Read the next chunk from disk while the current one is being sent.
      let pos = 0;
      let next: Promise<string> | null =
        size > 0 ? RNFS.read(path, Math.min(CHUNK_SIZE, size), 0, 'base64') : null;
      try {
        while (pos < size && next) {
          const bytes = Buffer.from(await next, 'base64');
          if (bytes.length === 0) throw new Error(`Could not read ${file.name}`);
          const after = pos + bytes.length;
          next =
            after < size
              ? RNFS.read(path, Math.min(CHUNK_SIZE, size - after), after, 'base64')
              : null;

          await withTimeout(
            SocketManager.writeRaw(deviceId, bytes),
            WRITE_TIMEOUT_MS,
            'Sending stalled - is the other phone still connected?',
          );
          pos = after;
          emit({ overallSent: progress.overallSent + bytes.length });
        }
      } finally {
        next?.catch(() => {}); // avoid unhandled rejection if we bailed out early
        SocketManager.setRaw(deviceId, false);
      }

      if (pos !== size) throw new Error(`${file.name} changed while sending`);
      SocketManager.sendControl(deviceId, 'FILE_END', { id: `${batchId}-${i + 1}` });
    }

    const ack = waitForAck(deviceId);
    SocketManager.sendControl(deviceId, 'TRANSFER_COMPLETE', { count: prepared.length });
    const result = await ack;

    if (result && !result.ok) throw new Error(result.error ?? 'Receiver reported a failure');
    emit({ state: result ? 'delivered' : 'sent', overallSent: progress.overallTotal }, true);
  } catch (e: any) {
    emit({ state: 'error', error: e?.message ?? 'Transfer failed' }, true);
  } finally {
    SocketManager.setRaw(deviceId, false);
    SocketManager.setDeviceStatus(deviceId, 'connected');
  }
}