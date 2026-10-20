// src/services/qr/QRManager.ts
import { SocketManager } from '../socket/SocketManager';
import { HotspotConfig } from '../hotspot/HotspotManager';

export function buildQRPayload(hotspot: HotspotConfig, sessionId: string, port: number) {
  return JSON.stringify({
    ssid: hotspot.ssid,
    password: hotspot.password,
    ip: hotspot.ip,
    port,
    sessionId,
    version: 1,
  });
}