// src/screens/SenderWaitingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketManager, ConnectedDevice } from '../services/socket/SocketManager';
import { buildQRPayload } from '../services/qr/QRManager';

type Props = NativeStackScreenProps<RootStackParamList, 'SenderWaiting'>;

export default function SenderWaitingScreen({ route, navigation }: Props) {
  const { hotspot, sessionId } = route.params;
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);

  useEffect(() => {
    const unsubscribe = SocketManager.onDevicesChanged(setDevices);
    return unsubscribe;
  }, []);

  const qrValue = buildQRPayload(hotspot, sessionId, SocketManager.port);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Waiting for Receivers</Text>

      <View style={styles.qrBox}>
        <QRCode value={qrValue} size={200} />
      </View>

      <Text style={styles.subheading}>
        Connected ({devices.length})
      </Text>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.deviceId}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No devices yet — ask them to scan.</Text>
        }
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
  container: { flex: 1, backgroundColor: '#FF6B4A', padding: 24, alignItems: 'center' },
  title: { fontSize: 22, fontFamily: 'LuckiestGuy-Regular', color: '#1A1A1A', marginTop: 40 },
  qrBox: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginTop: 24 },
  subheading: { marginTop: 24, fontSize: 16, fontWeight: '600', color: '#1A1A1A' },
  list: { width: '100%', marginTop: 12, maxHeight: 200 },
  empty: { color: '#3a2a20', textAlign: 'center', marginTop: 20 },
  deviceRow: { backgroundColor: '#1A1A1A', padding: 12, borderRadius: 10, marginBottom: 8 },
  deviceName: { color: '#fff', fontSize: 15 },
  button: { marginTop: 'auto', marginBottom: 30, backgroundColor: '#1A1A1A', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 30 },
  buttonDisabled: { backgroundColor: '#5a4a40' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});