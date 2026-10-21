// src/screens/SenderWaitingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketManager, ConnectedDevice } from '../services/socket/SocketManager';
import { buildQRPayload } from '../services/qr/QRManager';

type Props = NativeStackScreenProps<RootStackParamList, 'SenderWaiting'>;

const ORANGE = '#fffefe';
const DARK = '#0e0e0e';

export default function SenderWaitingScreen({ route, navigation }: Props) {
  const { hotspot, sessionId } = route.params;
  const [devices, setDevices] = useState<ConnectedDevice[]>(SocketManager.getDevices());

  useEffect(() => {
    const unsubscribe = SocketManager.onDevicesChanged(setDevices);
    return unsubscribe;
  }, []);

  const qrValue = buildQRPayload(hotspot, sessionId, SocketManager.port);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Waiting for Receivers</Text>

      {/* Same orange background, dark modules, dark rounded frame */}
      <View style={styles.qrBox}>
        <QRCode
          value={qrValue}
          size={200}
          color={DARK}
          backgroundColor={ORANGE}
          ecl="M"
        />
      </View>

      <Text style={styles.info}>
        Receivers: join{hotspot.ssid ? ` "${hotspot.ssid}"` : ' this phone\'s hotspot'}, then tap
        Receive and scan.
      </Text>

      <Text style={styles.subheading}>Connected ({devices.length})</Text>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.deviceId}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No devices yet — ask them to scan.</Text>}
        renderItem={({ item }) => (
          <View style={styles.deviceRow}>
            <Text style={styles.deviceName}>📱 {item.deviceName}</Text>
          </View>
        )}
      />

      <TouchableOpacity
        style={[styles.button, devices.length === 0 && styles.buttonDisabled]}
        disabled={devices.length === 0}
        onPress={() => navigation.navigate('FilePicker')}
      >
        <Text style={styles.buttonText}>
          {devices.length === 0 ? 'Waiting for devices...' : 'Ready to Send'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ORANGE, padding: 24, alignItems: 'center' },
  title: { fontSize: 22, fontFamily: 'LuckiestGuy-Regular', color: DARK, marginTop: 40 },
  qrBox: {
    backgroundColor: ORANGE,
    padding: 16,
    borderRadius: 20,
    borderWidth: 4,
    borderColor: DARK,
    marginTop: 24,
  },
  info: { color: DARK, fontSize: 13, textAlign: 'center', marginTop: 16, paddingHorizontal: 12 },
  subheading: { marginTop: 20, fontSize: 16, fontWeight: '600', color: DARK },
  list: { width: '100%', marginTop: 12, maxHeight: 200 },
  empty: { color: '#3a2a20', textAlign: 'center', marginTop: 20 },
  deviceRow: { backgroundColor: DARK, padding: 12, borderRadius: 10, marginBottom: 8 },
  deviceName: { color: '#fff', fontSize: 15 },
  button: {
    marginTop: 'auto',
    marginBottom: 30,
    backgroundColor: DARK,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
  },
  buttonDisabled: { backgroundColor: '#010101' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});