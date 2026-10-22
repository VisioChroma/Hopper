// src/screens/FilePickerScreen.tsx
// Sender: pick files -> Grab -> (receiver catches) -> files are streamed to that receiver.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { errorCodes, isErrorWithCode, keepLocalCopy, pick, types } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketManager } from '../services/socket/SocketManager';
import { FileStore, PickedFile, formatSize } from '../services/files/FileStore';
import { sendFiles, SendProgress } from '../services/transfer/TransferEngine';
import GrabSheet from '../components/GrabSheet';

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
  const active = useRef<Set<string>>(new Set());

  useEffect(() => FileStore.subscribe(setFiles), []);

  // A receiver caught the files -> close the sheet and stream the files to THAT receiver.
  useEffect(() => {
    return SocketManager.onMessage((msg, deviceId) => {
      if (msg.type !== 'RELEASE_DETECTED') return;
      setGrabbing(false);
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

  const grab = () => {
    setTransfers({}); // clear results of the previous round
    SocketManager.broadcastControl('GRABBED', {
      files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });
    setGrabbing(true);
  };

  const cancelGrab = () => {
    SocketManager.broadcastControl('GRAB_CANCELLED');
    setGrabbing(false);
  };

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