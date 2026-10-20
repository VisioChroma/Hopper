// src/screens/ShareScreen.tsx
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { startHotspot } from '../services/hotspot/HotspotManager';
import { SocketManager } from '../services/socket/SocketManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Share'>;

export default function ShareScreen({ navigation }: Props) {
  useEffect(() => {
    (async () => {
      const hotspot = await startHotspot();
      const sessionId = SocketManager.startServer();
      navigation.replace('SenderWaiting', { hotspot, sessionId });
    })();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1A1A1A" />
      <Text style={styles.text}>Setting up hotspot...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF6B4A' },
  text: { marginTop: 16, fontSize: 16, color: '#1A1A1A' },
});