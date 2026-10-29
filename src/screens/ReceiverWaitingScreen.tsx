// src/screens/ReceiverWaitingScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { errorCodes, isErrorWithCode, saveDocuments } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { ConnectionStatus, SocketClient } from '../services/socket/SocketClient';
import { ReceiveEngine, ReceiveState, ReceivedFile } from '../services/transfer/ReceiveEngine';
import { formatSize } from '../services/files/FileStore';
import { GlowState } from '../services/session/GlowState';
import { useHandGesture } from '../hooks/useHandGesture';
import HandHint from '../components/HandHint';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiverWaiting'>;

const DARK = '#1A1A1A';

// file:// uri with every path segment percent-encoded (what the picker library expects)
const toFileUri = (path: string) => 'file://' + path.split('/').map(encodeURIComponent).join('/');

export default function ReceiverWaitingScreen({ navigation }: Props) {
  const [status, setStatus] = useState('Connected — waiting for sender...');
  const [grabbed, setGrabbed] = useState(false);
  // true from the moment YOU release (catch) until the transfer is over: drives the glow
  const [session, setSession] = useState(false);
  const [rx, setRx] = useState<ReceiveState>(ReceiveEngine.getState());
  // the link to the sender: connected / reconnecting (automatic) / lost (gave up)
  const [conn, setConn] = useState<ConnectionStatus>(SocketClient.getStatus());
  // What the screen SHOWS: a drop that heals within 2 s never flashes "Reconnecting…".
  const [shownConn, setShownConn] = useState<ConnectionStatus>(conn);
  const leaving = useRef(false); // true once the user chose to disconnect

  useEffect(() => {
    if (conn === 'connected') {
      setShownConn('connected');
      return;
    }
    const t = setTimeout(() => setShownConn(conn), 2000);
    return () => clearTimeout(t);
  }, [conn]);

  useEffect(() => {
    ReceiveEngine.start(); // idempotent: listens for incoming files
    setRx(ReceiveEngine.getState());
    const offEngine = ReceiveEngine.subscribe(setRx);
    const offConn = SocketClient.onStatus(setConn);

    const offMsg = SocketClient.onMessage((msg) => {
      if (msg.type === 'GRABBED') {
        ReceiveEngine.reset(); // dismiss a finished result card (no-op while receiving)
        setGrabbed(true); // wait for the release gesture - the glow starts then, not now
      } else if (msg.type === 'GRAB_CANCELLED') {
        setStatus('Connected — waiting for sender...');
        setGrabbed(false);
        setSession(false);
      }
    });
    return () => {
      offEngine();
      offConn();
      offMsg();
    };
  }, []);

  // The link dropped: there is nothing to release or receive until it is back.
  useEffect(() => {
    if (conn !== 'connected') {
      setSession(false);
      setGrabbed(false);
    }
  }, [conn]);

  // Release: closed fist -> open hand in front of the front camera (or the button as a fallback).
  const catchFiles = () => {
    SocketClient.send({ type: 'RELEASE_DETECTED' });
    setGrabbed(false);
    setSession(true); // release detected -> glow ON, and it stays on until the transfer is over
  };

  // The camera only runs after the sender grabbed and while nothing is being received.
  const { status: handStatus, label: handLabel, errorText } = useHandGesture({
    kind: 'release',
    enabled: grabbed && rx.phase === 'idle' && conn === 'connected',
    onGesture: catchFiles,
  });

  // Transfer finished or failed -> glow off.
  useEffect(() => {
    if (rx.phase === 'done' || rx.phase === 'error') setSession(false);
  }, [rx.phase]);

  // The edge glow lives at the app root (GlowBridge in App.tsx); this screen only says when it is on:
  // from the release gesture until the transfer is finished (or failed / cancelled / link lost).
  const glowOn = session && rx.phase !== 'done' && rx.phase !== 'error';
  useEffect(() => {
    GlowState.set('receive', glowOn);
  }, [glowOn]);
  useEffect(() => () => GlowState.set('receive', false), []);

  // ---- leaving: only when the user chooses to (button or back gesture, both ask first) ----
  const closeLink = useCallback(() => {
    leaving.current = true;
    SocketClient.disconnect(); // tells the sender (BYE) and stops all reconnecting
    ReceiveEngine.reset();
    GlowState.set('receive', false);
  }, []);

  const confirmDisconnect = useCallback((onConfirm: () => void) => {
    Alert.alert('Disconnect?', 'You will stop receiving from this sender. To connect again, scan its QR code.', [
      { text: 'Stay connected', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: onConfirm },
    ]);
  }, []);

  const onDisconnectPress = () =>
    confirmDisconnect(() => {
      closeLink();
      navigation.replace('Home');
    });

  // Back button / swipe also goes through the same question, so the link is never dropped by accident.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (leaving.current) return;
      e.preventDefault();
      confirmDisconnect(() => {
        closeLink();
        navigation.dispatch(e.data.action);
      });
    });
  }, [navigation, confirmDisconnect, closeLink]);

  // No on-screen hint text any more: only tell the user if the camera cannot be used (once).
  const warned = useRef(false);
  useEffect(() => {
    if ((handStatus === 'denied' || handStatus === 'unavailable') && !warned.current) {
      warned.current = true;
      Alert.alert(
        'Hand gestures unavailable',
        `${handStatus === 'denied' ? 'Camera permission is needed.' : errorText || 'The camera could not start.'}\n\nYou can still use the button.`,
      );
    }
  }, [handStatus, errorText]);

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

  const title =
    shownConn === 'connected'
      ? 'Connected ✅'
      : shownConn === 'reconnecting'
        ? 'Reconnecting…'
        : 'Connection lost';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      {shownConn === 'reconnecting' && (
        <View style={styles.connBox}>
          <ActivityIndicator color={DARK} />
          <Text style={styles.status}>Trying to get back to the sender — keep both phones on the hotspot.</Text>
        </View>
      )}

      {shownConn === 'lost' && (
        <View style={styles.connBox}>
          <Text style={styles.status}>Could not reach the sender any more.</Text>
          <TouchableOpacity style={styles.button} onPress={() => SocketClient.reconnectNow()} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Reconnect</Text>
          </TouchableOpacity>
        </View>
      )}

      {rx.phase === 'idle' && shownConn === 'connected' && (
        <>
          {!grabbed && !session && status ? <Text style={styles.status}>{status}</Text> : null}
          {grabbed && (
            <>
              <HandHint kind="release" status={handStatus} label={handLabel} />
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

      {/* The link stays up until this is pressed. */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.disconnectBtn} onPress={onDisconnectPress} activeOpacity={0.8}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FF6B4A',
    padding: 24,
    paddingBottom: 100,
  },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: DARK },
  status: { fontSize: 16, color: DARK, marginTop: 16, textAlign: 'center' },
  connBox: { alignItems: 'center', marginTop: 12 },
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
  footer: { position: 'absolute', left: 24, right: 24, bottom: 28, alignItems: 'center' },
  disconnectBtn: { borderWidth: 2, borderColor: DARK, borderRadius: 26, paddingVertical: 12, paddingHorizontal: 40 },
  disconnectText: { color: DARK, fontSize: 15, fontWeight: '700' },
});