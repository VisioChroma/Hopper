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

class SocketManagerClass {
  private server: any = null;
  private devices: Map<string, ConnectedDevice> = new Map();
  private listeners: DeviceListener[] = [];
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

  private handleIncoming(deviceId: string, rawData: any) {
    try {
      const message = JSON.parse(rawData.toString());
      if (message.type === 'HANDSHAKE' && message.deviceName) {
        const device = this.devices.get(deviceId);
        if (device) {
          device.deviceName = message.deviceName;
          this.notifyListeners();
        }
      }
      // RELEASE_DETECTED and other control messages handled here in Sprint C
    } catch (e) {
      // non-JSON = raw file chunk, handled by TransferEngine later
    }
  }

  broadcastControl(type: string, payload: object = {}) {
    const message = JSON.stringify({ type, ...payload }) + '\n';
    this.devices.forEach((device) => {
      device.socket.write(message);
    });
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
    this.server?.close();
    this.server = null;
  }
}

export const SocketManager = new SocketManagerClass();