/**
 * A small WebSocket server side (RFC 6455) on Node built-ins: text frames,
 * ping / pong and close. The Harness API (`/__harness`) runs on it.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 16 * 1024 * 1024;
const PING_MS = 25_000;

/** What a connection reports to its owner. */
export interface WebSocketHandlers {
  message?: (text: string) => void;
  close?: () => void;
}

/**
 * Accepts an upgrade. Returns the connection, or `null` after refusing it.
 * `protocol` is the subprotocol to answer with, when the client asked for it.
 */
export function acceptWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer, protocol?: string): WebSocketConnection | null {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string' || String(request.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  const asked = String(request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const lines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`];
  if (protocol && asked.includes(protocol)) lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
  socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  return new WebSocketConnection(socket, head);
}

/** One accepted WebSocket. */
export class WebSocketConnection {
  /** Set by the owner to receive messages and the close. */
  handlers: WebSocketHandlers = {};
  /** True once the socket is closing or closed. */
  closed = false;

  private readonly socket: Duplex;
  private buffer: Buffer;
  private fragments: Buffer[] = [];
  private readonly pinger: ReturnType<typeof setInterval>;

  constructor(socket: Duplex, head?: Buffer) {
    this.socket = socket;
    this.buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
    (socket as Socket).setNoDelay?.(true);
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.read();
    });
    const end = (): void => this.finish();
    socket.on('close', end);
    socket.on('end', end);
    socket.on('error', end);
    if (this.buffer.length) setImmediate(() => this.read());
    this.pinger = setInterval(() => this.frame(0x9, Buffer.alloc(0)), PING_MS);
    this.pinger.unref?.();
  }

  private read(): void {
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0]! & 0x80) !== 0;
      const op = b[0]! & 0x0f;
      const masked = (b[1]! & 0x80) !== 0;
      let length = b[1]! & 0x7f;
      let at = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        length = Number(b.readBigUInt64BE(2));
        at = 10;
      }
      if (length > MAX_FRAME) {
        this.close(1009);
        return;
      }
      const maskAt = at;
      if (masked) at += 4;
      if (b.length < at + length) return;
      let payload = b.subarray(at, at + length);
      if (masked) {
        const mask = b.subarray(maskAt, maskAt + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i & 3]!;
      }
      this.buffer = b.subarray(at + length);
      if (op === 0x8) {
        this.close(1000);
        return;
      }
      if (op === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          try {
            this.handlers.message?.(text);
          } catch {
            /* a handler's error is its own */
          }
        }
      }
    }
  }

  private frame(op: number, payload: Buffer): void {
    if (this.closed) return;
    const length = payload.length;
    let header: Buffer;
    if (length < 126) header = Buffer.from([0x80 | op, length]);
    else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.finish();
    }
  }

  /** Sends a text frame. */
  sendText(text: string): void {
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  /** Sends a close frame and ends the socket. */
  close(code = 1000): void {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.frame(0x8, payload);
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    try {
      this.socket.end();
    } catch {
      /* gone */
    }
    this.handlers.close?.();
  }
}
