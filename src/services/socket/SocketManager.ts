// src/services/socket/SocketManager.ts
import TcpSocket from 'react-native-tcp-socket';
import uuid from 'react-native-uuid';

export type ConnectedDevice = {
  deviceId: string;
  deviceName: string;
  socket: any;
  sessionToken: string;
  status: 'connected' | 'grabbed_broadcast' | 'watching' | 'transferring';
};

type DeviceListener = (devices: ConnectedDevice[]) => void;
type MessageListener = (msg: any, deviceId: string) => void;

class SocketManagerClass {
  private server: any = null;
  private devices: Map<string, ConnectedDevice> = new Map();
  private listeners: DeviceListener[] = [];
  private messageListeners: MessageListener[] = [];
  private buffers: Map<string, string> = new Map(); // per-device partial line
  public sessionId: string = '';
  public port = 5050;

  startServer(onDeviceConnected?: (device: ConnectedDevice) => void) {
    this.sessionId = uuid.v4() as string;

    this.server = TcpSocket.createServer((socket: any) => {
      const deviceId = uuid.v4() as string;
      const sessionToken = uuid.v4() as string;

      const device: ConnectedDevice = {
        deviceId,
        deviceName: `Device ${this.devices.size + 1}`, // replaced with real name after handshake
        socket,
        sessionToken,
        status: 'connected',
      };

      socket.on('data', (data: any) => {
        this.handleIncoming(deviceId, data);
      });

      socket.on('close', () => {
        this.devices.delete(deviceId);
        this.buffers.delete(deviceId);
        this.notifyListeners();
      });

      socket.on('error', (err: any) => {
        console.log('SOCKET ERROR', deviceId, err);
        this.devices.delete(deviceId);
        this.notifyListeners();
      });

      this.devices.set(deviceId, device);
      this.notifyListeners();
      onDeviceConnected?.(device);
    }).listen({ port: this.port, host: '0.0.0.0' });

    return this.sessionId;
  }

  // Receivers only send small JSON control lines (newline-terminated); TCP may split or merge them.
  private handleIncoming(deviceId: string, rawData: any) {
    let buf = (this.buffers.get(deviceId) ?? '') + rawData.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        this.handleMessage(deviceId, JSON.parse(line));
      } catch (e) {
        console.log('Bad message from device', deviceId);
      }
    }
    this.buffers.set(deviceId, buf);
  }

  private handleMessage(deviceId: string, message: any) {
    if (message.type === 'HANDSHAKE' && message.deviceName) {
      const device = this.devices.get(deviceId);
      if (device) {
        device.deviceName = message.deviceName;
        this.notifyListeners();
      }
    }
    this.messageListeners.forEach((l) => l(message, deviceId));
  }

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
    this.devices.forEach((d) => d.socket.destroy());
    this.devices.clear();
    this.buffers.clear();
    this.server?.close();
    this.server = null;
  }
}

export const SocketManager = new SocketManagerClass();