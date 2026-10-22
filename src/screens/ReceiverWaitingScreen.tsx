// src/screens/ReceiverWaitingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketClient } from '../services/socket/SocketClient';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiverWaiting'>;

export default function ReceiverWaitingScreen({}: Props) {
  const [status, setStatus] = useState('Connected — waiting for sender...');
  const [grabbed, setGrabbed] = useState(false);

  useEffect(() => {
    const unsubscribe = SocketClient.onMessage((msg) => {
      if (msg.type === 'GRABBED') {
        const n = Array.isArray(msg.files) ? msg.files.length : 0;
        setStatus(`Sender grabbed ${n} ${n === 1 ? 'file' : 'files'} — get ready to catch!`);
        setGrabbed(true);
      } else if (msg.type === 'GRAB_CANCELLED') {
        setStatus('Connected — waiting for sender...');
        setGrabbed(false);
      }
    });
    return unsubscribe;
  }, []);

  // Temporary: the catch gesture will replace this button (same message, nothing else changes).
  const catchFiles = () => {
    SocketClient.send({ type: 'RELEASE_DETECTED' });
    setStatus('Caught! Waiting for the transfer...');
    setGrabbed(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected ✅</Text>
      <Text style={styles.status}>{status}</Text>

      {grabbed && (
        <TouchableOpacity style={styles.button} onPress={catchFiles} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Catch</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF6B4A', padding: 24 },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: '#1A1A1A' },
  status: { fontSize: 16, color: '#1A1A1A', marginTop: 16, textAlign: 'center' },
  button: { marginTop: 32, backgroundColor: '#1A1A1A', paddingVertical: 16, paddingHorizontal: 48, borderRadius: 30 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});