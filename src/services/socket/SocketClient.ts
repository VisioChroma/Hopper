// src/services/socket/SocketClient.ts
// Receiver side: one TCP connection to the sender.
//
// Staying connected:
//  - TCP keep-alive + a PING every few seconds (the sender answers PONG). If nothing has been heard
//    for too long the link is treated as dead;
//  - when the link drops by itself (not because the user pressed Disconnect) the client keeps
//    retrying in the background and re-introduces itself with the SAME clientId, so the sender
//    recognises the device and swaps the sockets;
//  - the link only ends when the user calls disconnect() (a BYE is sent first), or after the
//    reconnect attempts have run out ('lost' - the screen offers a Reconnect button).
import { AppState } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import DeviceInfo from 'react-native-device-info';
import uuid from 'react-native-uuid';
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

export type ConnectionStatus = 'idle' | 'connected' | 'reconnecting' | 'lost';

const PING_EVERY_MS = 4000;
const DEAD_AFTER_MS = 25000; // no bytes at all for this long = dead link
const CONNECT_TIMEOUT_MS = 4000;
const MAX_RECONNECT_ATTEMPTS = 30; // roughly two minutes of trying

class SocketClientClass {
  private socket: any = null;
  private listeners: ((msg: any) => void)[] = [];
  private rawListeners: ((chunk: Buffer) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  private statusListeners: ((s: ConnectionStatus) => void)[] = [];

  // Stable for this app run: lets the sender recognise us after a reconnect.
  private clientId = uuid.v4() as string;
  private payload: SenderQRPayload | null = null; // set once a connection has succeeded
  private status: ConnectionStatus = 'idle';
  private intentional = false;
  private attempt = 0;
  private retrying = false; // a reconnect attempt is in flight: never start a second one
  private lastRx = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  // Control messages -> listeners. Raw file bytes (after a message with `rawBytes`) -> rawListeners.
  private parser = new FrameParser(
    (msg) => {
      if (msg.type === 'PONG' || msg.type === 'WELCOME') return; // link housekeeping only
      this.listeners.forEach((l) => l(msg));
    },
    (chunk) => this.rawListeners.forEach((l) => l(chunk)),
  );

  constructor() {
    // JS timers pause in the background: on return, give the link a fresh start and check it at once.
    AppState.addEventListener('change', (s) => {
      if (s === 'active' && this.socket) {
        this.lastRx = Date.now();
        this.send({ type: 'PING' });
      }
    });
  }

  // First connection (from the QR scan). Fails fast (default 5s) instead of waiting ~1 minute for the
  // OS timeout. Once it succeeds the client keeps the link alive by itself.
  async connect(payload: SenderQRPayload, timeoutMs = 5000): Promise<void> {
    this.clearReconnect();
    this.intentional = false;
    this.attempt = 0;
    await this.open(payload, timeoutMs);
    this.payload = payload;
    this.setStatus('connected');
    this.startHeartbeat();
  }

  // Opens ONE socket. Any older socket is closed silently first.
  private open(payload: SenderQRPayload, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.dropSocket();
      this.parser.reset();

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let socket: any = null;

      const fail = (err: any) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          socket?.destroy();
        } catch (e) {
          // ignore
        }
        if (this.socket === socket) this.socket = null;
        reject(err);
      };

      timer = setTimeout(() => fail(new Error('Connection timed out')), timeoutMs);

      socket = TcpSocket.createConnection({ port: payload.port, host: payload.ip }, async () => {
        if (settled) return;
        // the user pressed Disconnect while this attempt was still connecting: do not join after all
        if (this.intentional) {
          fail(new Error('cancelled'));
          return;
        }
        let deviceName = 'Phone';
        try {
          deviceName = await DeviceInfo.getDeviceName();
        } catch (e) {
          // keep the default name
        }
        if (settled) return;
        try {
          socket.setNoDelay?.(true);
          socket.setKeepAlive?.(true, 10000);
        } catch (e) {
          // not supported - the PING/PONG below still keeps the link honest
        }
        this.writeTo(socket, {
          type: 'HANDSHAKE',
          deviceName,
          clientId: this.clientId,
          sessionId: payload.sessionId,
        });
        settled = true;
        if (timer) clearTimeout(timer);
        this.lastRx = Date.now();
        resolve();
      });
      this.socket = socket;

      socket.on('data', (data: any) => {
        if (this.socket !== socket) return; // stale socket
        this.lastRx = Date.now();
        this.parser.push(data);
      });

      socket.on('error', (err: any) => {
        console.log('SOCKET CLIENT ERROR', payload.ip, err);
        if (!settled) fail(err);
        else this.onSocketGone(socket);
      });

      socket.on('close', () => {
        console.log('Socket closed');
        if (!settled) fail(new Error('Connection closed'));
        else this.onSocketGone(socket);
      });
    });
  }

  // The current socket died (closed, errored or went silent).
  private onSocketGone(socket: any) {
    if (this.socket !== socket) return; // an old socket we already replaced
    this.socket = null;
    this.stopHeartbeat();
    this.closeListeners.forEach((l) => l()); // e.g. ReceiveEngine fails a transfer in progress
    if (this.intentional || !this.payload) {
      this.setStatus('idle');
      return;
    }
    this.scheduleReconnect();
  }

  // ---------------- reconnecting ----------------

  private scheduleReconnect() {
    this.setStatus('reconnecting');
    this.clearReconnect();
    const delay = Math.min(1000 * (this.attempt + 1), 4000); // 1s, 2s, 3s, 4s, 4s ...
    this.reconnectTimer = setTimeout(() => this.tryReconnect(), delay);
  }

  private async tryReconnect() {
    const payload = this.payload;
    if (!payload || this.intentional || this.retrying) return;
    this.attempt++;
    if (this.attempt > MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('lost');
      return;
    }
    this.retrying = true;
    try {
      await this.open(payload, CONNECT_TIMEOUT_MS);
      if (this.intentional) return;
      this.attempt = 0;
      this.setStatus('connected');
      this.startHeartbeat();
    } catch (e) {
      if (!this.intentional && this.payload) this.scheduleReconnect();
    } finally {
      this.retrying = false;
    }
  }

  // Used by the "Reconnect" button after the automatic attempts ran out.
  reconnectNow() {
    if (!this.payload || this.status === 'connected' || this.retrying) return;
    this.intentional = false;
    this.attempt = 0;
    this.scheduleReconnect();
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // ---------------- heartbeat ----------------

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastRx = Date.now();
    this.heartbeat = setInterval(() => {
      const socket = this.socket;
      if (!socket) return;
      if (Date.now() - this.lastRx > DEAD_AFTER_MS) {
        console.log('Nothing heard from the sender, treating the link as dead');
        try {
          socket.destroy();
        } catch (e) {
          // ignore
        }
        this.onSocketGone(socket);
        return;
      }
      this.send({ type: 'PING' });
    }, PING_EVERY_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // ---------------- public API ----------------

  private writeTo(socket: any, message: object) {
    try {
      socket?.write(JSON.stringify(message) + '\n');
    } catch (e) {
      console.log('Could not write to the sender');
    }
  }

  send(message: object) {
    this.writeTo(this.socket, message);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  onStatus(listener: (s: ConnectionStatus) => void) {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
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

  // Fires every time the socket goes away (also while we are about to reconnect).
  onClose(listener: () => void) {
    this.closeListeners.push(listener);
    return () => {
      this.closeListeners = this.closeListeners.filter((l) => l !== listener);
    };
  }

  // Closes the current socket without triggering reconnect logic.
  private dropSocket() {
    const s = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    if (s) {
      try {
        s.destroy();
      } catch (e) {
        // ignore
      }
    }
  }

  // The user pressed Disconnect: tell the sender, then close for good (no reconnecting).
  disconnect() {
    this.intentional = true;
    this.payload = null;
    this.clearReconnect();
    this.stopHeartbeat();
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.write(JSON.stringify({ type: 'BYE' }) + '\n');
        s.end?.();
      } catch (e) {
        // ignore
      }
      setTimeout(() => {
        try {
          s.destroy();
        } catch (e) {
          // ignore
        }
      }, 500);
    }
    // A transfer that was still running must be marked as failed (ReceiveEngine listens here).
    this.closeListeners.forEach((l) => l());
    this.setStatus('idle');
  }
}

export const SocketClient = new SocketClientClass();