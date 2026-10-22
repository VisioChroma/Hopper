// src/services/socket/FrameParser.ts
// Splits a TCP byte stream into:
//   - control messages: one JSON object per line ("...\n")
//   - raw bytes: if a control message has `rawBytes: N`, the NEXT N bytes after
//     that line are raw file data (not JSON). After N bytes we are back to lines.
// TCP may split or merge chunks anywhere, so this keeps a small leftover buffer.
import { Buffer } from 'buffer';

export class FrameParser {
  private pending: Buffer = Buffer.alloc(0);
  private rawRemaining = 0;

  constructor(
    private onMessage: (msg: any) => void,
    private onRaw: (chunk: Buffer) => void,
  ) {}

  reset() {
    this.pending = Buffer.alloc(0);
    this.rawRemaining = 0;
  }

  push(incoming: Buffer | string | Uint8Array) {
    const data = Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming as any);
    let buf = this.pending.length ? Buffer.concat([this.pending, data]) : data;

    while (buf.length > 0) {
      if (this.rawRemaining > 0) {
        const n = Math.min(this.rawRemaining, buf.length);
        const chunk = buf.slice(0, n);
        buf = buf.slice(n);
        this.rawRemaining -= n;
        this.onRaw(chunk);
        continue;
      }

      const nl = buf.indexOf(0x0a);
      if (nl < 0) break; // incomplete line, wait for more data

      const line = buf.slice(0, nl).toString('utf8').trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.log('FrameParser: bad JSON line ignored');
        continue;
      }
      if (typeof msg.rawBytes === 'number' && msg.rawBytes > 0) {
        this.rawRemaining = msg.rawBytes; // set BEFORE listeners run
      }
      this.onMessage(msg);
    }
    this.pending = buf;
  }
}