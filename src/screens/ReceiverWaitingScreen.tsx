// src/screens/ReceiverWaitingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { errorCodes, isErrorWithCode, saveDocuments } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketClient } from '../services/socket/SocketClient';
import { ReceiveEngine, ReceiveState, ReceivedFile } from '../services/transfer/ReceiveEngine';
import { formatSize } from '../services/files/FileStore';
import { useHandGesture, LABEL_TEXT } from '../hooks/useHandGesture';

// Show camera speed (fps / ms per frame) next to the hand status. Handy for comparing phones.
const SHOW_HAND_STATS = true;

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiverWaiting'>;

const DARK = '#1A1A1A';

// file:// uri with every path segment percent-encoded (what the picker library expects)
const toFileUri = (path: string) => 'file://' + path.split('/').map(encodeURIComponent).join('/');

export default function ReceiverWaitingScreen({}: Props) {
  const [status, setStatus] = useState('Connected — waiting for sender...');
  const [grabbed, setGrabbed] = useState(false);
  const [rx, setRx] = useState<ReceiveState>(ReceiveEngine.getState());

  useEffect(() => {
    ReceiveEngine.start(); // idempotent: listens for incoming files
    setRx(ReceiveEngine.getState());
    const offEngine = ReceiveEngine.subscribe(setRx);

    const offMsg = SocketClient.onMessage((msg) => {
      if (msg.type === 'GRABBED') {
        const n = Array.isArray(msg.files) ? msg.files.length : 0;
        setStatus(`Sender grabbed ${n} ${n === 1 ? 'file' : 'files'} — get ready to catch!`);
        setGrabbed(true);
      } else if (msg.type === 'GRAB_CANCELLED') {
        setStatus('Connected — waiting for sender...');
        setGrabbed(false);
      }
    });
    return () => {
      offEngine();
      offMsg();
    };
  }, []);

  // Release: closed fist -> open hand in front of the front camera (or the button as a fallback).
  const catchFiles = () => {
    SocketClient.send({ type: 'RELEASE_DETECTED' });
    setStatus('Released! Receiving files...');
    setGrabbed(false);
  };

  // The camera only runs after the sender grabbed and while nothing is being received.
  const { status: handStatus, label: handLabel, errorText, stats } = useHandGesture({
    kind: 'release',
    enabled: grabbed && rx.phase === 'idle',
    onGesture: catchFiles,
  });

  const saveCopy = async (f: ReceivedFile) => {
    try {
      await saveDocuments({
        sourceUris: [toFileUri(f.path)],
        fileName: f.name,
        mimeType: f.mime ?? undefined,
        copy: true,
      });
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('Could not save', 'Something went wrong while saving this file.');
    }
  };

  const pct =
    rx.overallTotal > 0 ? Math.min(100, Math.round((rx.overallReceived / rx.overallTotal) * 100)) : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected ✅</Text>

      {rx.phase === 'idle' && (
        <>
          <Text style={styles.status}>{status}</Text>
          {grabbed && (
            <>
              <Text style={styles.gestureHint}>
                {handStatus === 'denied'
                  ? 'Camera permission needed — allow it in Settings or tap Release'
                  : handStatus === 'unavailable'
                    ? `Hand recognition unavailable${errorText ? `: ${errorText}` : ''} — tap Release`
                    : handStatus === 'starting'
                      ? 'Starting camera...'
                      : 'Show your fist ✊ to the front camera, then open your hand ✋ to release'}
              </Text>
              {handStatus === 'ready' ? (
                <Text style={styles.gestureDebug}>
                  Seeing: {LABEL_TEXT[handLabel]}
                  {SHOW_HAND_STATS && stats ? `  ·  ${stats}` : ''}
                </Text>
              ) : null}
              <TouchableOpacity style={styles.button} onPress={catchFiles} activeOpacity={0.8}>
                <Text style={styles.buttonText}>Release</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {rx.phase === 'receiving' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Receiving {rx.fileIndex}/{rx.fileCount}
          </Text>
          <Text style={styles.cardName} numberOfLines={1}>
            {rx.fileName}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.cardMeta}>
            {pct}% · {formatSize(rx.overallReceived)} of {formatSize(rx.overallTotal)}
          </Text>
        </View>
      )}

      {rx.phase === 'done' && (
        <View style={styles.cardFull}>
          <Text style={styles.cardTitle}>
            Received {rx.files.length} {rx.files.length === 1 ? 'file' : 'files'} ✅
          </Text>
          <Text style={styles.cardMeta}>Saved in the Hopper folder in app storage</Text>
          <ScrollView style={styles.fileList}>
            {rx.files.map((f) => (
              <View key={f.path} style={styles.fileRow}>
                <View style={styles.fileText}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={styles.cardMeta}>{formatSize(f.size)}</Text>
                </View>
                <TouchableOpacity style={styles.saveBtn} onPress={() => saveCopy(f)}>
                  <Text style={styles.saveText}>Save…</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={() => { ReceiveEngine.reset(); setStatus('Connected — waiting for sender...'); }}>
            <Text style={styles.buttonText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {rx.phase === 'error' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transfer failed</Text>
          <Text style={styles.cardMeta}>{rx.error}</Text>
          <TouchableOpacity style={styles.button} onPress={() => { ReceiveEngine.reset(); setStatus('Connected — waiting for sender...'); }}>
            <Text style={styles.buttonText}>OK</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF6B4A', padding: 24 },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: DARK },
  status: { fontSize: 16, color: DARK, marginTop: 16, textAlign: 'center' },
  gestureHint: { fontSize: 14, color: DARK, marginTop: 12, textAlign: 'center', opacity: 0.8 },
  gestureDebug: { fontSize: 13, fontWeight: '600', color: DARK, marginTop: 8, textAlign: 'center' },
  button: { marginTop: 24, backgroundColor: DARK, paddingVertical: 16, paddingHorizontal: 48, borderRadius: 30, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  card: { width: '100%', marginTop: 24, backgroundColor: DARK, borderRadius: 16, padding: 16, alignItems: 'center' },
  cardFull: { width: '100%', flex: 1, marginTop: 24, alignItems: 'center' },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cardName: { color: '#fff', fontSize: 14, marginTop: 6 },
  cardMeta: { color: '#ddd', fontSize: 12, marginTop: 6, textAlign: 'center' },
  barTrack: { width: '100%', height: 8, backgroundColor: '#444', borderRadius: 4, marginTop: 14, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: '#FF6B4A', borderRadius: 4 },
  fileList: { width: '100%', marginTop: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: DARK, borderRadius: 12, padding: 12, marginBottom: 8 },
  fileText: { flex: 1, marginRight: 8 },
  saveBtn: { borderWidth: 1.5, borderColor: '#fff', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  saveText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});