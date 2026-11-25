/**
 * A browser's WebSocket to an artifact (the page's event socket), as a Workers `WebSocketPair` the type server is
 * handed through its `connect` seam: the platform does the handshake and keeps the connection alive, the server sends
 * and closes messages ({@link HostedSocket}), never frames.
 *
 * The room runs the server's checks first (`connect(req, socket)` resolves to 101 or the refusal's status) and makes
 * the pair only on 101, so a refused handshake costs no socket: {@link deferredSocket} holds what the server sends
 * while it attaches, and {@link DeferredSocket.accept} hands it to the pair's server end.
 */
import { Buffer } from 'node:buffer';
import type { HostedSocket } from '@open-artifact/type-server';

export type { HostedSocket };

/** The server end of a Workers `WebSocketPair`, as far as this uses it. */
export interface WorkersWebSocket {
  accept(): void;
  send(message: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (event: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: 'close' | 'error', listener: (event: unknown) => void): void;
}

/** What makes a pair (`() => Object.values(new WebSocketPair())`): `[client, server]`. */
export type WebSocketPairFactory = () => [unknown, WorkersWebSocket];

/** A `Response` the platform completes as a WebSocket handshake (Workers: `{ status: 101, webSocket: client }`). */
export type UpgradeResponseFactory = (client: unknown) => Response;

/** Wraps the (accepted) server end of a pair as a {@link HostedSocket}. */
export function hostedSocket(server: WorkersWebSocket): HostedSocket {
  let closed = false;
  const onClose: (() => void)[] = [];
  const finish = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of onClose) listener();
  };
  server.addEventListener('close', finish);
  server.addEventListener('error', finish);
  return {
    sendText: (text) => {
      if (closed) return;
      try {
        server.send(text);
      } catch {
        finish();
      }
    },
    close: (code = 1000, reason = '') => {
      if (closed) return;
      try {
        server.close(code, reason);
      } catch {
        // Already closing.
      } finally {
        finish();
      }
    },
    onMessage: (listener) => server.addEventListener('message', (event) => listener(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'))),
    onClose: (listener) => {
      if (closed) listener();
      else onClose.push(listener);
    },
  };
}

/** A {@link HostedSocket} the server may use before there is a connection; {@link accept} gives it one. */
export interface DeferredSocket {
  readonly socket: HostedSocket;
  /** Accepts the pair's server end and replays what was sent, closed or listened for so far. */
  accept(server: WorkersWebSocket): void;
  /** No connection will come (the handshake was refused): close listeners run, sends are dropped. */
  abandon(): void;
}

export function deferredSocket(): DeferredSocket {
  let live: HostedSocket | null = null;
  let abandoned = false;
  const sent: string[] = [];
  let closing: { code?: number; reason?: string } | null = null;
  const messageListeners: ((text: string) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  const socket: HostedSocket = {
    sendText: (text) => {
      if (live) live.sendText(text);
      else if (!abandoned && !closing) sent.push(text);
    },
    close: (code, reason) => {
      if (live) live.close(code, reason);
      else if (!abandoned) closing ??= { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) };
    },
    onMessage: (listener) => {
      if (live) live.onMessage(listener);
      else messageListeners.push(listener);
    },
    onClose: (listener) => {
      if (live) live.onClose(listener);
      else if (abandoned) listener();
      else closeListeners.push(listener);
    },
  };
  return {
    socket,
    accept(server) {
      if (live || abandoned) return;
      server.accept();
      live = hostedSocket(server);
      for (const listener of messageListeners.splice(0)) live.onMessage(listener);
      for (const listener of closeListeners.splice(0)) live.onClose(listener);
      for (const text of sent.splice(0)) live.sendText(text);
      if (closing) live.close(closing.code, closing.reason);
    },
    abandon() {
      if (live || abandoned) return;
      abandoned = true;
      sent.length = 0;
      for (const listener of closeListeners.splice(0)) listener();
    },
  };
}
