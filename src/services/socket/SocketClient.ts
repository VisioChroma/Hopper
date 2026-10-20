// src/services/socket/SocketClient.ts
import TcpSocket from 'react-native-tcp-socket';
import DeviceInfo from 'react-native-device-info';

export type SenderQRPayload = {
  ssid: string;
  password: string;
  ip: string;
  port: number;
  sessionId: string;
  version: number;
};

class SocketClientClass {
  private socket: any = null;
  private listeners: ((msg: any) => void)[] = [];

  connect(payload: SenderQRPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = TcpSocket.createConnection(
        { port: payload.port, host: payload.ip },
        async () => {
          const deviceName = await DeviceInfo.getDeviceName();
          this.send({ type: 'HANDSHAKE', deviceName, sessionId: payload.sessionId });
          resolve();
        }
      );

      this.socket.on('data', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          this.listeners.forEach((l) => l(msg));
        } catch (e) {
          // non-JSON = raw file chunk, handled by TransferEngine later
        }
      });

      this.socket.on('error', (err: any) => {
        console.log('SOCKET CLIENT ERROR', err);
        reject(err);
      });

      this.socket.on('close', () => console.log('Socket closed'));
    });
  }

  send(message: object) {
    this.socket?.write(JSON.stringify(message) + '\n');
  }

  onMessage(listener: (msg: any) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  disconnect() {
    this.socket?.destroy();
    this.socket = null;
  }
}

export const SocketClient = new SocketClientClass();