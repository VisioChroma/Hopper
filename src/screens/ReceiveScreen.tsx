// src/screens/ReceiveScreen.tsx
// VisionCamera v5. We use <Camera/> + useBarcodeScannerOutput directly (instead of
// <CodeScanner/>) because <CodeScanner/> THROWS when no camera device exists.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketClient, SenderQRPayload } from '../services/socket/SocketClient';
import DeviceInfo from 'react-native-device-info';
import { isValidIPv4 } from '../services/hotspot/HotspotManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Receive'>;

const ORANGE = '#FF6B4A';
const DARK = '#1A1A1A';

// Fully automatic: the sender is the phone hosting the hotspot, which is always the
// gateway (x.x.x.1) of the network WE joined. So we derive it from our own Wi-Fi IP.
// Order: derived gateway -> IP from QR (if any) -> common hotspot defaults.
async function candidateIps(qrIp: string): Promise<string[]> {
  const list: string[] = [];
  try {
    const own = await DeviceInfo.getIpAddress();
    if (own && isValidIPv4(own) && own !== '0.0.0.0') {
      const parts = own.split('.');
      parts[3] = '1';
      list.push(parts.join('.'));
    }
  } catch (e) {
    // ignore
  }
  if (qrIp && isValidIPv4(qrIp)) list.push(qrIp);
  list.push('192.168.43.1', '192.168.137.1', '172.20.10.1');
  return Array.from(new Set(list));
}

export default function ReceiveScreen({ navigation }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const isFocused = useIsFocused();
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');
  const device = backDevice ?? frontDevice;

  const busy = useRef(false); // scanner fires ~30x/sec, guard with a ref
  const [connecting, setConnecting] = useState(false);
  const [manualIp, setManualIp] = useState('192.168.43.1');

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const connectWith = useCallback(
    async (payload: SenderQRPayload) => {
      if (busy.current) return;
      busy.current = true;
      setConnecting(true);

      const ips = await candidateIps(payload.ip);
      for (const ip of ips) {
        try {
          await SocketClient.connect({ ...payload, ip }, 4000);
          navigation.replace('ReceiverWaiting', { sessionId: payload.sessionId });
          return;
        } catch (err) {
          console.log('Could not connect to', ip);
        }
      }

      Alert.alert(
        'Connection Failed',
        `Tried: ${ips.join(', ')}\n\nMake sure this phone is connected to the sender's hotspot ` +
          `(Wi-Fi settings), and that the sender is still on the QR screen. Then scan again.`
      );
      busy.current = false;
      setConnecting(false);
    },
    [navigation]
  );

  const handleCode = useCallback(
    (value: string) => {
      if (busy.current) return;
      try {
        const payload: SenderQRPayload = JSON.parse(value);
        if (payload.version !== 1 || !payload.sessionId) {
          throw new Error('Invalid QR');
        }
        connectWith(payload);
      } catch {
        // not a Hopper QR - ignore and keep scanning
      }
    },
    [connectWith]
  );

  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats: ['qr-code'],
    onBarcodeScanned(barcodes) {
      const value = barcodes[0]?.rawValue;
      if (value) handleCode(value);
    },
    onError(error) {
      console.log('Barcode scanner error:', error);
    },
  });

  const connectManually = () => {
    const ip = manualIp.trim();
    if (!isValidIPv4(ip)) {
      Alert.alert('Invalid IP', 'Enter the sender IP, e.g. 192.168.43.1');
      return;
    }
    connectWith({ ssid: '', password: '', ip, port: 5050, sessionId: 'manual', version: 1 });
  };

  // ---- Fallback: no camera (emulator, or camera not found) ----
  if (!hasPermission || device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>
          {!hasPermission ? 'Camera permission needed' : 'No camera found'}
        </Text>
        <Text style={styles.text}>
          {!hasPermission
            ? 'Allow camera access to scan the sender\'s QR code.'
            : 'This device has no usable camera (emulators often have none). Connect manually instead.'}
        </Text>

        {!hasPermission && (
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Allow Camera</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.text, { marginTop: 28 }]}>Sender IP address</Text>
        <TextInput
          style={styles.input}
          value={manualIp}
          onChangeText={setManualIp}
          keyboardType="decimal-pad"
          placeholder="192.168.43.1"
          placeholderTextColor="#7a5a50"
        />
        <TouchableOpacity style={styles.button} onPress={connectManually} disabled={connecting}>
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Manually</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && !connecting}
        outputs={[barcodeOutput]}
      />
      <View style={styles.overlay} pointerEvents="none">
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: ORANGE,
  },
  title: { color: DARK, fontSize: 22, fontFamily: 'LuckiestGuy-Regular', marginBottom: 12 },
  text: { color: DARK, fontSize: 15, textAlign: 'center' },
  input: {
    width: '100%',
    marginTop: 10,
    backgroundColor: '#FF8F77',
    borderWidth: 2,
    borderColor: DARK,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: DARK,
  },
  button: {
    marginTop: 18,
    backgroundColor: DARK,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 30,
    minWidth: 180,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanBox: { width: 240, height: 240, borderWidth: 3, borderColor: '#fff', borderRadius: 16 },
  hint: { color: '#fff', fontSize: 16, marginTop: 20, textAlign: 'center', paddingHorizontal: 20 },
});