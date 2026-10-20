// src/screens/ReceiveScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketClient, SenderQRPayload } from '../services/socket/SocketClient';

type Props = NativeStackScreenProps<RootStackParamList, 'Receive'>;

export default function ReceiveScreen({ navigation }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [scanned, setScanned] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  const handleCode = useCallback(
    async (value: string) => {
      if (scanned) return;
      setScanned(true);
      setConnecting(true);

      try {
        const payload: SenderQRPayload = JSON.parse(value);
        if (payload.version !== 1 || !payload.sessionId) {
          throw new Error('Invalid QR code');
        }
        await SocketClient.connect(payload);
        navigation.replace('ReceiverWaiting', { sessionId: payload.sessionId });
      } catch (err) {
        Alert.alert('Connection Failed', 'Could not connect to sender. Try scanning again.');
        setScanned(false);
        setConnecting(false);
      }
    },
    [scanned, navigation]
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const value = codes[0]?.value;
      if (value) handleCode(value);
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission is required to scan the QR code.</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>No camera found on this device.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFillObject}
        device={device}
        isActive={!scanned}
        codeScanner={codeScanner}
      />
      <View style={styles.overlay}>
        <View style={styles.scanBox} />
        <Text style={styles.hint}>
          {connecting ? 'Connecting to sender...' : "Scan the sender's QR code"}
        </Text>
        {connecting && <ActivityIndicator size="large" color="#fff" style={{ marginTop: 12 }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#FF6B4A' },
  text: { color: '#1A1A1A', fontSize: 16, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanBox: { width: 240, height: 240, borderWidth: 3, borderColor: '#fff', borderRadius: 16 },
  hint: { color: '#fff', fontSize: 16, marginTop: 20, textAlign: 'center', paddingHorizontal: 20 },
});