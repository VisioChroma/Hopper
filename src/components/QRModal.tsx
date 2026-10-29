// src/components/QRModal.tsx
// Sender: shows the connection QR again at any time (e.g. from the sharing screen), so another
// receiver can join - or a receiver can reconnect - without leaving the screen or restarting.
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { ConnectedDevice, SocketManager } from '../services/socket/SocketManager';
import { buildQRPayload } from '../services/qr/QRManager';
import { detectHotspotIp } from '../services/hotspot/HotspotManager';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const DARK = '#1A1A1A';

export default function QRModal({ visible, onClose }: Props) {
  const [devices, setDevices] = useState<ConnectedDevice[]>(SocketManager.getDevices());
  const [ip, setIp] = useState(SocketManager.hotspot.ip);

  useEffect(() => SocketManager.onDevicesChanged(setDevices), []);

  // Refresh the sender address each time the QR is opened (the hotspot may have changed).
  useEffect(() => {
    if (!visible) return;
    setDevices(SocketManager.getDevices());
    let cancelled = false;
    detectHotspotIp().then((found) => {
      if (cancelled || !found) return;
      setIp(found);
      SocketManager.setHotspot({ ...SocketManager.hotspot, ip: found });
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const value = buildQRPayload({ ...SocketManager.hotspot, ip }, SocketManager.sessionId, SocketManager.port);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Scan to connect</Text>

          <View style={styles.qrBox}>
            <QRCode value={value} size={220} color={DARK} backgroundColor="#FFFFFF" ecl="M" />
          </View>

          <Text style={styles.info}>
            Receivers join this phone's hotspot, tap Receive and scan this code.
          </Text>

          <Text style={styles.subheading}>Connected ({devices.length})</Text>
          <ScrollView style={styles.list}>
            {devices.length === 0 ? (
              <Text style={styles.empty}>No device connected yet.</Text>
            ) : (
              devices.map((d) => (
                <View key={d.deviceId} style={styles.deviceRow}>
                  <Text style={styles.deviceName} numberOfLines={1}>
                    📱 {d.deviceName}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, alignItems: 'center', maxHeight: '90%' },
  title: { fontSize: 20, fontFamily: 'LuckiestGuy-Regular', color: DARK },
  qrBox: { marginTop: 16, padding: 14, borderRadius: 18, borderWidth: 3, borderColor: DARK },
  info: { color: DARK, fontSize: 13, textAlign: 'center', marginTop: 14 },
  subheading: { marginTop: 16, fontSize: 15, fontWeight: '600', color: DARK },
  list: { width: '100%', marginTop: 8, maxHeight: 130 },
  empty: { color: '#777', textAlign: 'center', marginTop: 6 },
  deviceRow: { backgroundColor: DARK, padding: 10, borderRadius: 10, marginBottom: 6 },
  deviceName: { color: '#fff', fontSize: 14 },
  closeBtn: { marginTop: 16, backgroundColor: DARK, paddingVertical: 12, paddingHorizontal: 40, borderRadius: 26 },
  closeText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});