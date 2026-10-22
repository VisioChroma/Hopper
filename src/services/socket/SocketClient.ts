// src/services/socket/SocketClient.ts
import TcpSocket from 'react-native-tcp-socket';
import DeviceInfo from 'react-native-device-info';
import { Buffer } from 'buffer';
import { FrameParser } from './FrameParser';

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
  private rawListeners: ((chunk: Buffer) => void)[] = [];
  private closeListeners: (() => void)[] = [];

  // Control messages -> listeners. Raw file bytes (after a message with `rawBytes`) -> rawListeners.
  private parser = new FrameParser(
    (msg) => this.listeners.forEach((l) => l(msg)),
    (chunk) => this.rawListeners.forEach((l) => l(chunk)),
  );

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
      this.parser.reset();

      const socket = TcpSocket.createConnection(
        { port: payload.port, host: payload.ip },
        async () => {
          if (settled) return;
          const deviceName = await DeviceInfo.getDeviceName();
          this.send({ type: 'HANDSHAKE', deviceName, sessionId: payload.sessionId });
          settled = true;
          if (timer) clearTimeout(timer);
          resolve();
        },
      );
      this.socket = socket;

      socket.on('data', (data: any) => this.parser.push(data));

      socket.on('error', (err: any) => {
        console.log('SOCKET CLIENT ERROR', payload.ip, err);
        fail(err);
      });

      socket.on('close', () => {
        console.log('Socket closed');
        if (settled) this.closeListeners.forEach((l) => l());
      });
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

  // Raw file bytes that follow a control message carrying `rawBytes`.
  onRaw(listener: (chunk: Buffer) => void) {
    this.rawListeners.push(listener);
    return () => {
      this.rawListeners = this.rawListeners.filter((l) => l !== listener);
    };
  }

  onClose(listener: () => void) {
    this.closeListeners.push(listener);
    return () => {
      this.closeListeners = this.closeListeners.filter((l) => l !== listener);
    };
  }

  disconnect() {
    this.socket?.destroy();
    this.socket = null;
  }
}

export const SocketClient = new SocketClientClass();