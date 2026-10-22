// src/services/transfer/ReceiveEngine.ts
// Receiver side: turns FILE_START / raw bytes / FILE_END into files on disk.
// All disk work goes through ONE ordered promise chain so appends never overlap.
import * as RNFS from '@dr.pogodin/react-native-fs';
import { Buffer } from 'buffer';
import { SocketClient } from '../socket/SocketClient';

const FLUSH_BYTES = 512 * 1024; // write to disk in ~512 KB pieces

export type ReceivedFile = { name: string; size: number; path: string; mime: string | null };

export type ReceiveState = {
  phase: 'idle' | 'receiving' | 'done' | 'error';
  fileIndex: number;
  fileCount: number;
  fileName: string;
  overallReceived: number;
  overallTotal: number;
  files: ReceivedFile[];
  error?: string;
};

const INITIAL: ReceiveState = {
  phase: 'idle',
  fileIndex: 0,
  fileCount: 0,
  fileName: '',
  overallReceived: 0,
  overallTotal: 0,
  files: [],
};

type Current = {
  index: number;
  name: string;
  mime: string | null;
  size: number;
  received: number;
  path: string; // filled in by the first queued task
  pending: Buffer[];
  pendingBytes: number;
};

function sanitize(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.length ? cleaned : 'file';
}

class ReceiveEngineClass {
  private started = false;
  private state: ReceiveState = { ...INITIAL };
  private listeners: ((s: ReceiveState) => void)[] = [];
  private chain: Promise<void> = Promise.resolve();
  private failed = false;
  private cur: Current | null = null;
  private doneBytes = 0; // bytes of files already completed in this batch
  private lastEmit = 0;

  start() {
    if (this.started) return;
    this.started = true;
    SocketClient.onMessage(this.onMessage);
    SocketClient.onRaw(this.onRaw);
    SocketClient.onClose(() => {
      if (this.state.phase === 'receiving') this.fail(new Error('Connection to sender was lost'));
    });
  }

  getState() {
    return this.state;
  }

  subscribe(l: (s: ReceiveState) => void) {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  reset() {
    if (this.state.phase === 'receiving') return;
    this.state = { ...INITIAL };
    this.emit(true);
  }

  // Folder the files are saved in (app storage; no permission needed).
  get saveDir() {
    return `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/Hopper`;
  }

  // ---------------- message handling ----------------

  private onMessage = (msg: any) => {
    switch (msg.type) {
      case 'FILE_START':
        return this.onFileStart(msg);
      case 'FILE_END':
        return this.onFileEnd();
      case 'TRANSFER_COMPLETE':
        return this.onComplete();
    }
  };

  private onFileStart(msg: any) {
    if (msg.index === 1) {
      // new batch
      this.failed = false;
      this.doneBytes = 0;
      this.state = {
        ...INITIAL,
        phase: 'receiving',
        fileCount: msg.total ?? 1,
        overallTotal: msg.batchBytes ?? msg.size ?? 0,
      };
    }
    const rec: Current = {
      index: msg.index ?? 1,
      name: sanitize(String(msg.name ?? 'file')),
      mime: msg.mime ?? null,
      size: msg.size ?? 0,
      received: 0,
      path: '',
      pending: [],
      pendingBytes: 0,
    };
    this.cur = rec;
    this.state = { ...this.state, fileIndex: rec.index, fileName: rec.name };
    this.emit(true);

    // Decide the file name + create the empty file (queued, so appends come after it).
    this.enqueue(async () => {
      const dir = this.saveDir;
      if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
      rec.path = await this.uniquePath(dir, rec.name);
      await RNFS.writeFile(rec.path, '', 'utf8');
    });
  }

  private onRaw = (chunk: Buffer) => {
    const rec = this.cur;
    if (!rec || this.failed) return;
    rec.received += chunk.length;
    rec.pending.push(chunk);
    rec.pendingBytes += chunk.length;
    this.state = { ...this.state, overallReceived: this.doneBytes + rec.received };
    if (rec.pendingBytes >= FLUSH_BYTES) this.flush(rec);
    this.emit(false);
  };

  private onFileEnd() {
    const rec = this.cur;
    if (!rec) return;
    this.cur = null;
    this.flush(rec);

    if (rec.received !== rec.size) {
      return this.fail(new Error(`${rec.name}: expected ${rec.size} bytes, got ${rec.received}`));
    }
    this.doneBytes += rec.size;
    this.enqueue(async () => {
      this.state = {
        ...this.state,
        overallReceived: this.doneBytes,
        files: [...this.state.files, { name: rec.name, size: rec.size, path: rec.path, mime: rec.mime }],
      };
      this.emit(true);
    });
  }

  private onComplete() {
    this.enqueue(async () => {
      this.state = { ...this.state, phase: 'done' };
      this.emit(true);
      SocketClient.send({ type: 'TRANSFER_RECEIVED', ok: true, count: this.state.files.length });
    });
  }

  // ---------------- helpers ----------------

  private flush(rec: Current) {
    if (rec.pendingBytes === 0) return;
    const b64 = Buffer.concat(rec.pending).toString('base64');
    rec.pending = [];
    rec.pendingBytes = 0;
    this.enqueue(() => RNFS.appendFile(rec.path, b64, 'base64'));
  }

  private enqueue(task: () => Promise<void>) {
    this.chain = this.chain
      .then(() => (this.failed ? undefined : task()))
      .catch((e) => this.fail(e));
  }

  private async uniquePath(dir: string, name: string): Promise<string> {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = `${dir}/${name}`;
    let n = 1;
    while (await RNFS.exists(candidate)) {
      candidate = `${dir}/${base} (${n})${ext}`;
      n++;
    }
    return candidate;
  }

  private fail(err: any) {
    if (this.failed) return;
    this.failed = true;
    const message = err?.message ?? 'Transfer failed';
    this.state = { ...this.state, phase: 'error', error: message };
    this.emit(true);
    try {
      SocketClient.send({ type: 'TRANSFER_RECEIVED', ok: false, error: message });
    } catch (e) {
      // socket already gone
    }
  }

  private emit(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    this.listeners.forEach((l) => l(this.state));
  }
}

export const ReceiveEngine = new ReceiveEngineClass();