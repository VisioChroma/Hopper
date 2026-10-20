// src/screens/ReceiverWaitingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SocketClient } from '../services/socket/SocketClient';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiverWaiting'>;

export default function ReceiverWaitingScreen({}: Props) {
  const [status, setStatus] = useState('Connected — waiting for sender...');

  useEffect(() => {
    const unsubscribe = SocketClient.onMessage((msg) => {
      if (msg.type === 'GRABBED') {
        setStatus('Sender is ready — get ready to catch!');
        // Sprint C wires actual gesture watching here
      }
    });
    return unsubscribe;
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected ✅</Text>
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF6B4A', padding: 24 },
  title: { fontSize: 24, fontFamily: 'LuckiestGuy-Regular', color: '#1A1A1A' },
  status: { fontSize: 16, color: '#1A1A1A', marginTop: 16, textAlign: 'center' },
});