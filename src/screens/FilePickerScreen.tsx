// src/screens/FilePickerScreen.tsx
// Sender: pick files -> Grab -> (receiver catches) -> files are streamed to that receiver.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { errorCodes, isErrorWithCode, keepLocalCopy, pick, types } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketManager } from '../services/socket/SocketManager';
import { FileStore, PickedFile, formatSize } from '../services/files/FileStore';
import { sendFiles, SendProgress } from '../services/transfer/TransferEngine';
import GrabSheet from '../components/GrabSheet';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { useHandGesture, LABEL_TEXT } from '../hooks/useHandGesture';

// Show camera speed (fps / ms per frame) next to the hand status. Handy for comparing phones.
const SHOW_HAND_STATS = true;

// Local path of a picked file (the picker copies files into app storage as file:// uris).
const toLocalPath = (uri: string) => {
  const raw = uri.startsWith('file://') ? uri.slice(7) : uri;
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
};

type Props = NativeStackScreenProps<RootStackParamList, 'FilePicker'>;

const DARK = '#1A1A1A';
const ORANGE = '#FF6B4A';

function TransferRow({ t }: { t: SendProgress }) {
  const pct = t.overallTotal > 0 ? Math.min(100, Math.round((t.overallSent / t.overallTotal) * 100)) : 0;
  let label: string;
  if (t.state === 'sending') label = `Sending ${t.fileIndex}/${t.fileCount} · ${t.fileName}`;
  else if (t.state === 'delivered') label = `Delivered ✅ ${t.fileCount} ${t.fileCount === 1 ? 'file' : 'files'}`;
  else if (t.state === 'sent') label = 'Sent ✅ (no confirmation from receiver)';
  else label = `Failed: ${t.error ?? 'unknown error'}`;

  return (
    <View style={styles.transferRow}>
      <View style={styles.transferHeader}>
        <Text style={styles.transferName} numberOfLines={1}>
          📱 {t.deviceName}
        </Text>
        {t.state === 'sending' && <Text style={styles.transferPct}>{pct}%</Text>}
      </View>
      <Text style={[styles.transferLabel, t.state === 'error' && styles.transferError]} numberOfLines={2}>
        {label}
      </Text>
      {t.state === 'sending' && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%` }]} />
        </View>
      )}
    </View>
  );
}

export default function FilePickerScreen({}: Props) {
  const [files, setFiles] = useState<PickedFile[]>(FileStore.get());
  const [grabbing, setGrabbing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [transfers, setTransfers] = useState<Record<string, SendProgress>>({});
  const [gestureOn, setGestureOn] = useState(true);
  // Receivers that were told GRABBED and have not released yet (multi-device).
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const active = useRef<Set<string>>(new Set());

  useEffect(() => FileStore.subscribe(setFiles), []);

  // A receiver that disconnects can no longer release.
  useEffect(() => {
    return SocketManager.onDevicesChanged((devs) => {
      const alive = new Set(devs.map((d) => d.deviceId));
      setPending((p) => (p.every((x) => alive.has(x.id)) ? p : p.filter((x) => alive.has(x.id))));
    });
  }, []);

  // A receiver caught the files -> close the sheet and stream the files to THAT receiver.
  useEffect(() => {
    return SocketManager.onMessage((msg, deviceId) => {
      if (msg.type !== 'RELEASE_DETECTED') return;
      setGrabbing(false);
      setPending((p) => p.filter((x) => x.id !== deviceId));
      if (active.current.has(deviceId)) return; // already sending to this device

      const snapshot = [...FileStore.get()]; // later edits to the list don't affect this send
      if (snapshot.length === 0) return;

      active.current.add(deviceId);
      sendFiles(deviceId, snapshot, (p) => setTransfers((prev) => ({ ...prev, [deviceId]: p }))).finally(
        () => active.current.delete(deviceId),
      );
    });
  }, []);

  const busy = Object.values(transfers).some((t) => t.state === 'sending');

  const choose = async () => {
    try {
      const picked = await pick({ allowMultiSelection: true, type: [types.allFiles] });

      // On Android the picker returns content:// uris. Copy each file into app storage
      // so TransferEngine can stream it from disk in chunks.
      setPreparing(true);
      const stamp = Date.now();
      const copies = await keepLocalCopy({
        files: picked.map((r, i) => ({
          uri: r.uri,
          fileName: `${stamp}_${i}_${r.name ?? 'file'}`,
        })) as any,
        destination: 'cachesDirectory',
      });

      const ready: PickedFile[] = [];
      let failed = 0;
      copies.forEach((c, i) => {
        const src = picked.find((p) => p.uri === c.sourceUri) ?? picked[i];
        if (c.status === 'success') {
          ready.push({
            uri: c.localUri,
            name: src.name ?? 'Unnamed file',
            size: src.size ?? null,
            type: src.type ?? null,
          });
        } else {
          failed++;
        }
      });

      FileStore.add(ready);
      if (failed > 0) {
        Alert.alert('Some files could not be added', `${failed} file(s) could not be copied.`);
      }
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('Could not open files', 'Something went wrong while picking files.');
    } finally {
      setPreparing(false);
    }
  };

  // Grab: check that every selected file can be read, tell the receivers, show the grab animation.
  // The bytes are sent later, when a receiver answers with RELEASE_DETECTED.
  const grabLock = useRef(false);
  const grab = async () => {
    if (grabLock.current) return;
    grabLock.current = true;
    try {
      const ready: { name: string; size: number | null; type: string | null }[] = [];
      for (const f of files) {
        try {
          const st = await RNFS.stat(toLocalPath(f.uri));
          ready.push({ name: f.name, size: Number(st.size), type: f.type });
        } catch (e) {
          Alert.alert('Cannot read file', `"${f.name}" is no longer available. Remove it and pick it again.`);
          return;
        }
      }
      setTransfers({}); // clear results of the previous round
      SocketManager.broadcastControl('GRABBED', { files: ready });
      setPending(SocketManager.getDevices().map((d) => ({ id: d.deviceId, name: d.deviceName })));
      setGrabbing(true);
    } finally {
      grabLock.current = false;
    }
  };

  // Stop waiting: tell the receivers that have not released yet that the grab is over.
  const cancelGrab = () => {
    pending.forEach((p) => {
      try {
        SocketManager.sendControl(p.id, 'GRAB_CANCELLED');
      } catch (e) {
        // receiver already gone
      }
    });
    setPending([]);
    setGrabbing(false);
  };

  // Open hand -> closed fist in front of the front camera = grab.
  // The camera only runs while there is something to grab and nothing is in progress.
  const canGrab = files.length > 0 && !grabbing && !busy && !preparing;
  const { status: handStatus, label: handLabel, errorText, stats } = useHandGesture({
    kind: 'grab',
    enabled: gestureOn && canGrab,
    onGesture: grab,
  });

  const transferList = Object.values(transfers);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick Files</Text>

      <TouchableOpacity style={styles.outlineBtn} onPress={choose} activeOpacity={0.8} disabled={busy || preparing}>
        <Text style={styles.outlineText}>
          {preparing ? 'Preparing files...' : files.length ? 'Add more files' : 'Browse files'}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={files}
        keyExtractor={(f) => f.uri}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Photos, videos, documents — anything on your phone.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.fileMeta}>{formatSize(item.size)}</Text>
            </View>
            <TouchableOpacity onPress={() => FileStore.remove(item.uri)} hitSlop={10} disabled={busy}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {transferList.length > 0 && (
        <View style={styles.transfers}>
          {transferList.map((t) => (
            <TransferRow key={t.deviceId} t={t} />
          ))}
        </View>
      )}

      {pending.length > 0 && !grabbing && (
        <View style={styles.pendingRow}>
          <View style={styles.gestureText}>
            <Text style={styles.gestureTitle}>Still waiting for release</Text>
            <Text style={styles.gestureHint} numberOfLines={2}>
              {pending.map((p) => p.name).join(', ')}
            </Text>
          </View>
          <TouchableOpacity onPress={cancelGrab} hitSlop={8}>
            <Text style={styles.pendingStop}>Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.gestureRow}>
        <View style={styles.gestureText}>
          <Text style={styles.gestureTitle}>Hand grab</Text>
          <Text style={styles.gestureHint}>
            {!gestureOn
              ? 'Off — use the button'
              : !canGrab
                ? 'Select files to enable'
                : handStatus === 'denied'
                  ? 'Camera permission needed — allow it in Settings or use the button'
                  : handStatus === 'unavailable'
                    ? `Hand recognition unavailable${errorText ? `: ${errorText}` : ''} — use the button`
                    : handStatus === 'starting'
                      ? 'Starting camera...'
                      : 'Show your open hand ✋ to the front camera, then close it into a fist ✊'}
          </Text>
          {gestureOn && canGrab && handStatus === 'ready' ? (
            <Text style={styles.gestureDebug}>
              Seeing: {LABEL_TEXT[handLabel]}
              {SHOW_HAND_STATS && stats ? `  ·  ${stats}` : ''}
            </Text>
          ) : null}
        </View>
        <Switch value={gestureOn} onValueChange={setGestureOn} trackColor={{ true: ORANGE, false: '#CCC' }} />
      </View>

      <TouchableOpacity
        style={[styles.button, (files.length === 0 || busy || preparing) && styles.buttonDisabled]}
        disabled={files.length === 0 || grabbing || busy || preparing}
        onPress={grab}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          {busy
            ? 'Sending...'
            : files.length === 0
              ? 'Select files to grab'
              : `Grab ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
        </Text>
      </TouchableOpacity>

      <GrabSheet visible={grabbing} fileCount={files.length} onCancel={cancelGrab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center' },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: DARK, marginTop: 40 },
  outlineBtn: {
    width: '100%',
    marginTop: 24,
    borderWidth: 2,
    borderColor: DARK,
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
  },
  outlineText: { color: DARK, fontSize: 15, fontWeight: '600' },
  list: { width: '100%', marginTop: 16 },
  empty: { color: '#777', textAlign: 'center', marginTop: 40, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F3F3',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowText: { flex: 1, marginRight: 12 },
  fileName: { color: DARK, fontSize: 15, fontWeight: '600' },
  fileMeta: { color: '#777', fontSize: 12, marginTop: 2 },
  remove: { color: '#999', fontSize: 16 },
  transfers: { width: '100%', marginTop: 8 },
  transferRow: { backgroundColor: DARK, borderRadius: 14, padding: 12, marginBottom: 8 },
  transferHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  transferName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  transferPct: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  transferLabel: { color: '#ddd', fontSize: 12, marginTop: 4 },
  transferError: { color: '#ff9b8a' },
  barTrack: { height: 6, backgroundColor: '#444', borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: ORANGE, borderRadius: 3 },
  gestureRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F3F3',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  pendingRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFE9E3',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  pendingStop: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  gestureText: { flex: 1, marginRight: 12 },
  gestureTitle: { color: DARK, fontSize: 14, fontWeight: '700' },
  gestureHint: { color: '#666', fontSize: 12, marginTop: 2 },
  gestureDebug: { color: ORANGE, fontSize: 12, fontWeight: '600', marginTop: 4 },
  button: {
    marginTop: 12,
    marginBottom: 30,
    backgroundColor: DARK,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#B5B5B5' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});