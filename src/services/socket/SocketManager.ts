// src/services/socket/SocketManager.ts
// Sender side: a TCP server that receivers connect to.
//
// Staying connected:
//  - every receiver has a STABLE id (the clientId it sends in its HANDSHAKE). If the same receiver
//    reconnects (Wi-Fi blip, app was paused ...) it takes over its old entry and the old half-dead
//    socket is closed, so nothing that refers to that device (pending grab, transfer list) breaks;
//  - receivers send PING every few seconds, we answer PONG; a device that has been silent for too long
//    is dropped, so a dead link never looks "connected";
//  - TCP keep-alive + no-delay are switched on for every socket.
import { AppState } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import uuid from 'react-native-uuid';
import { Buffer } from 'buffer';
import type { HotspotConfig } from '../hotspot/HotspotManager';

export type ConnectedDevice = {
  deviceId: string;
  deviceName: string;
  socket: any;
  sessionToken: string;
  status: 'connected' | 'grabbed_broadcast' | 'watching' | 'transferring';
  lastSeen: number;
  // true while the raw bytes of a file are being streamed to this device: nothing else may be
  // written to its socket then, or the file would be corrupted.
  inRaw?: boolean;
};

type DeviceListener = (devices: ConnectedDevice[]) => void;
type MessageListener = (msg: any, deviceId: string) => void;

type Conn = { id: string | null; buf: Buffer };

const HANDSHAKE_TIMEOUT_MS = 10000;
const WATCHDOG_EVERY_MS = 5000;
const SILENT_LIMIT_MS = 30000; // idle device with no PING for this long = dead link
const SILENT_LIMIT_BUSY_MS = 60000; // while a file is being sent the JS thread can be slower

class SocketManagerClass {
  private server: any = null;
  private devices: Map<string, ConnectedDevice> = new Map();
  private pending: Set<any> = new Set(); // sockets that have not completed the handshake yet
  private listeners: DeviceListener[] = [];
  private messageListeners: MessageListener[] = [];
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private appSub: { remove: () => void } | null = null;
  public sessionId: string = '';
  public port = 5050;
  // What the QR code contains. Set by the share screen; read again whenever the QR is shown.
  public hotspot: HotspotConfig = { ssid: '', password: '', ip: '' };

  setHotspot(hotspot: HotspotConfig) {
    this.hotspot = hotspot;
  }

  startServer(onDeviceConnected?: (device: ConnectedDevice) => void) {
    this.sessionId = uuid.v4() as string;

    const server = TcpSocket.createServer((socket: any) => {
      try {
        socket.setNoDelay?.(true);
        socket.setKeepAlive?.(true, 10000);
      } catch (e) {
        // not supported on this build - the app-level PING/PONG still keeps the link honest
      }

      const conn: Conn = { id: null, buf: Buffer.alloc(0) };
      this.pending.add(socket);
      const handshakeTimer = setTimeout(() => {
        if (!conn.id) {
          try {
            socket.destroy();
          } catch (e) {
            // ignore
          }
        }
      }, HANDSHAKE_TIMEOUT_MS);

      socket.on('data', (data: any) => this.handleIncoming(conn, socket, data, onDeviceConnected));

      socket.on('close', () => {
        clearTimeout(handshakeTimer);
        this.pending.delete(socket);
        if (conn.id) this.removeIfCurrent(conn.id, socket);
      });

      socket.on('error', (err: any) => {
        console.log('SOCKET ERROR', conn.id, err);
        this.pending.delete(socket);
        if (conn.id) this.removeIfCurrent(conn.id, socket);
      });
    });

    server.on('error', (err: any) => console.log('SERVER ERROR', err));
    server.listen({ port: this.port, host: '0.0.0.0' });
    this.server = server;

    this.startWatchdog();
    return this.sessionId;
  }

  // ---------------- incoming data ----------------

  // Receivers only send small JSON control lines (newline-terminated); TCP may split or merge them.
  private handleIncoming(
    conn: Conn,
    socket: any,
    rawData: any,
    onDeviceConnected?: (device: ConnectedDevice) => void,
  ) {
    conn.buf = Buffer.concat([conn.buf, Buffer.from(rawData)]);
    let idx: number;
    while ((idx = conn.buf.indexOf(0x0a)) >= 0) {
      const line = conn.buf.slice(0, idx).toString('utf8').trim();
      conn.buf = conn.buf.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.log('Bad message from device', conn.id);
        continue;
      }
      this.handleMessage(conn, socket, msg, onDeviceConnected);
    }
  }

  private handleMessage(
    conn: Conn,
    socket: any,
    message: any,
    onDeviceConnected?: (device: ConnectedDevice) => void,
  ) {
    if (message.type === 'HANDSHAKE') {
      this.onHandshake(conn, socket, message, onDeviceConnected);
      return;
    }
    if (!conn.id) return; // nothing is accepted before the handshake

    const device = this.devices.get(conn.id);
    if (!device || device.socket !== socket) return; // message from a socket that was replaced
    device.lastSeen = Date.now();

    if (message.type === 'PING') {
      // Never write in the middle of a file's raw bytes. (The receiver is getting file data then,
      // which proves the link is alive anyway.)
      if (!device.inRaw) this.safeWrite(socket, { type: 'PONG' });
      return;
    }
    if (message.type === 'BYE') {
      // the receiver pressed Disconnect
      this.dropDevice(conn.id);
      return;
    }
    this.messageListeners.forEach((l) => l(message, conn.id as string));
  }

  private onHandshake(
    conn: Conn,
    socket: any,
    message: any,
    onDeviceConnected?: (device: ConnectedDevice) => void,
  ) {
    const clientId = String(message.clientId || uuid.v4());
    const name = message.deviceName ? String(message.deviceName) : `Device ${this.devices.size + 1}`;
    conn.id = clientId;
    this.pending.delete(socket);

    let device = this.devices.get(clientId);
    if (device) {
      // Same receiver again (reconnect): take over its entry, close the old socket.
      const old = device.socket;
      device.socket = socket;
      device.deviceName = name;
      device.status = 'connected';
      device.inRaw = false;
      device.lastSeen = Date.now();
      if (old && old !== socket) {
        try {
          old.destroy();
        } catch (e) {
          // ignore
        }
      }
    } else {
      device = {
        deviceId: clientId,
        deviceName: name,
        socket,
        sessionToken: uuid.v4() as string,
        status: 'connected',
        lastSeen: Date.now(),
      };
      this.devices.set(clientId, device);
    }

    this.safeWrite(socket, { type: 'WELCOME', sessionId: this.sessionId });
    this.notifyListeners();
    onDeviceConnected?.(device);
    // Lets the sharing screen re-send an open grab to a receiver that just reconnected.
    this.messageListeners.forEach((l) => l({ type: 'DEVICE_JOINED' }, clientId));
  }

  // ---------------- keeping the link honest ----------------

  private startWatchdog() {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      const now = Date.now();
      this.devices.forEach((d) => {
        const limit = d.status === 'transferring' ? SILENT_LIMIT_BUSY_MS : SILENT_LIMIT_MS;
        if (now - d.lastSeen > limit) {
          console.log('Device silent for too long, dropping', d.deviceName);
          this.dropDevice(d.deviceId);
        }
      });
    }, WATCHDOG_EVERY_MS);

    // JS timers pause while the app is in the background: give everyone a fresh start on return.
    this.appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') this.devices.forEach((d) => (d.lastSeen = Date.now()));
    });
  }

  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.appSub?.remove();
    this.appSub = null;
  }

  private safeWrite(socket: any, message: object) {
    try {
      socket.write(JSON.stringify(message) + '\n');
    } catch (e) {
      console.log('Could not write to a device');
    }
  }

  private removeIfCurrent(id: string, socket: any) {
    const device = this.devices.get(id);
    if (device && device.socket === socket) {
      this.devices.delete(id);
      this.notifyListeners();
    }
  }

  private dropDevice(id: string) {
    const device = this.devices.get(id);
    if (!device) return;
    this.devices.delete(id);
    try {
      device.socket.destroy();
    } catch (e) {
      // ignore
    }
    this.notifyListeners();
  }

  // ---------------- messaging ----------------

  // Listen for control messages from receivers (RELEASE_DETECTED, TRANSFER_RECEIVED, ...).
  onMessage(listener: MessageListener) {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  broadcastControl(type: string, payload: object = {}) {
    const message = JSON.stringify({ type, ...payload }) + '\n';
    this.devices.forEach((device) => {
      try {
        device.socket.write(message);
      } catch (e) {
        console.log('Could not write to', device.deviceName);
      }
    });
  }

  // ---- used by TransferEngine ----

  sendControl(deviceId: string, type: string, payload: object = {}) {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Device disconnected');
    device.socket.write(JSON.stringify({ type, ...payload }) + '\n');
  }

  // Resolves when the bytes have been handed to the OS (gives natural back-pressure).
  writeRaw(deviceId: string, data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const device = this.devices.get(deviceId);
      if (!device) return reject(new Error('Device disconnected'));
      try {
        device.socket.write(data, undefined, (err?: Error) => (err ? reject(err) : resolve()));
      } catch (e) {
        reject(e);
      }
    });
  }

  // TransferEngine marks the window in which file bytes are on the wire.
  setRaw(deviceId: string, on: boolean) {
    const device = this.devices.get(deviceId);
    if (device) device.inRaw = on;
  }

  setDeviceStatus(deviceId: string, status: ConnectedDevice['status']) {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      this.notifyListeners();
    }
  }

  getDevices(): ConnectedDevice[] {
    return Array.from(this.devices.values());
  }

  onDevicesChanged(listener: DeviceListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    const list = this.getDevices();
    this.listeners.forEach((l) => l(list));
  }

  stopServer() {
    this.stopWatchdog();
    this.devices.forEach((d) => {
      try {
        d.socket.destroy();
      } catch (e) {
        // ignore
      }
    });
    this.pending.forEach((s) => {
      try {
        s.destroy();
      } catch (e) {
        // ignore
      }
    });
    this.devices.clear();
    this.pending.clear();
    try {
      this.server?.close();
    } catch (e) {
      // ignore
    }
    this.server = null;
    this.notifyListeners();
  }
}

export const SocketManager = new SocketManagerClass();