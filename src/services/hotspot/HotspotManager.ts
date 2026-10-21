// src/services/hotspot/HotspotManager.ts
// Manual hotspot approach: the user turns on the phone's own hotspot.
// We only (a) open the settings screen and (b) work out the sender's IP.
import { Linking, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

export type HotspotConfig = {
  ssid: string; // optional label, shown to receivers (can be '')
  password: string; // not needed for manual flow (kept '' for QR compatibility)
  ip: string;
};

export function isValidIPv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// Tries to read our own IP. Returns '' when unknown - the receiver then works out
// the sender's address itself (it is the receiver's gateway), so nothing is typed by hand.
export async function detectHotspotIp(): Promise<string> {
  try {
    const ip = await DeviceInfo.getIpAddress();
    if (ip && isValidIPv4(ip) && ip !== '0.0.0.0' && !ip.startsWith('127.')) {
      return ip;
    }
  } catch (e) {
    // ignore
  }
  return '';
}

// Opens the Android network settings (hotspot toggle is one tap away).
export async function openHotspotSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.WIRELESS_SETTINGS');
    } else {
      await Linking.openSettings();
    }
  } catch (e) {
    await Linking.openSettings();
  }
}