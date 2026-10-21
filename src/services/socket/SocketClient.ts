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
  private buffer = '';

  // Fails fast (default 5s) instead of waiting ~1 minute for the OS timeout.
  connect(payload: SenderQRPayload, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const fail = (err: any) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          this.socket?.destroy();
        } catch (e) {
          // ignore
        }
        this.socket = null;
        reject(err);
      };

      timer = setTimeout(() => fail(new Error('Connection timed out')), timeoutMs);
      this.buffer = '';

      const socket = TcpSocket.createConnection(
        { port: payload.port, host: payload.ip },
        async () => {
          if (settled) return;
          const deviceName = await DeviceInfo.getDeviceName();
          this.send({ type: 'HANDSHAKE', deviceName, sessionId: payload.sessionId });
          settled = true;
          if (timer) clearTimeout(timer);
          resolve();
        }
      );
      this.socket = socket;

      socket.on('data', (data: any) => {
        // messages are newline-terminated JSON; TCP may split or merge chunks
        this.buffer += data.toString();
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            this.listeners.forEach((l) => l(msg));
          } catch (e) {
            // non-JSON = raw file chunk, handled by TransferEngine later
          }
        }
      });

      socket.on('error', (err: any) => {
        console.log('SOCKET CLIENT ERROR', payload.ip, err);
        fail(err);
      });

      socket.on('close', () => console.log('Socket closed'));
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