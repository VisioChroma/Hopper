// src/services/hotspot/HotspotManager.ts
// NOTE: startLocalOnlyHotspot() requires a native Android module.
// This stub returns placeholder credentials so we can build/test the
// rest of the pipeline now. Replaced with real native bridge in Sprint A.2.

export type HotspotConfig = {
  ssid: string;
  password: string;
  ip: string;
};

export async function startHotspot(): Promise<HotspotConfig> {
  console.warn(
    'HotspotManager: using STUB credentials. Connect both devices to the same manual hotspot for now.'
  );
  return {
    ssid: 'HOPPER_TEMP',
    password: 'temporary',
    ip: '192.168.43.1', // typical Android hotspot gateway IP
  };
}

export async function stopHotspot(): Promise<void> {
  console.warn('HotspotManager: stopHotspot stub called.');
}