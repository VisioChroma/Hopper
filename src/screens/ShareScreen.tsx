// src/screens/ShareScreen.tsx
// No manual IP / name entry: the receiver finds the sender automatically.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { detectHotspotIp, openHotspotSettings } from '../services/hotspot/HotspotManager';
import { SocketManager } from '../services/socket/SocketManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Share'>;

export default function ShareScreen({ navigation }: Props) {
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const ip = await detectHotspotIp(); // '' if unknown - receiver auto-detects
      SocketManager.stopServer(); // avoid a second server on the same port
      const sessionId = SocketManager.startServer();
      const hotspot = { ssid: '', password: '', ip };
      SocketManager.setHotspot(hotspot); // so the QR can be shown again later from the sharing screen
      navigation.replace('SenderWaiting', { hotspot, sessionId });
    } catch (err) {
      setStarting(false);
      Alert.alert('Could not start', 'Failed to start the sharing server. Try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Share Setup</Text>

      <View style={styles.card}>
        <Text style={styles.step}>1. Turn on your mobile hotspot</Text>
        <TouchableOpacity style={styles.outlineBtn} onPress={openHotspotSettings}>
          <Text style={styles.outlineText}>Open Hotspot Settings</Text>
        </TouchableOpacity>

        <Text style={styles.step}>2. Come back and tap Start Sharing</Text>
        <Text style={styles.hint}>
          Receivers join your hotspot, scan the QR code and connect automatically.
        </Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={start} activeOpacity={0.8} disabled={starting}>
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Start Sharing</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', padding: 24, alignItems: 'center' },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: '#1A1A1A', marginTop: 40 },
  card: { width: '100%', marginTop: 28 },
  step: { color: '#1A1A1A', fontSize: 15, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  outlineBtn: {
    borderWidth: 2,
    borderColor: '#1A1A1A',
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
  },
  outlineText: { color: '#1A1A1A', fontSize: 15, fontWeight: '600' },
  hint: { color: '#3a2a20', fontSize: 13 },
  button: {
    marginTop: 'auto',
    marginBottom: 30,
    backgroundColor: '#1A1A1A',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});