/**
 * The content origin's front door: routing only.
 *
 * Requests whose Host is a content host (`<label>.content…`) go to the embedded type server (`rooms.ts`); the rest
 * go to the app. What a content host answers never sets a cookie (decision 6): `withoutCookies` drops any
 * `Set-Cookie` on the way out, and the request's own `Cookie` header is not passed on. Everything else (editor
 * assets and `support.js` with their cache headers, CORS for the app origin's Shell broker, the Referrer-Policy, the
 * redirect of a top-level visit to the Shell) is the type server's own behaviour in hosted mode.
 */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { HostRooms } from './rooms.ts';

const isSetCookie = (name: unknown): boolean => typeof name === 'string' && name.toLowerCase() === 'set-cookie';

/** `writeHead` headers without `Set-Cookie`, in any of the forms Node accepts (object, `[k, v]` pairs, flat list). */
function stripHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    if (headers.length > 0 && Array.isArray(headers[0])) return (headers as unknown[][]).filter((pair) => !isSetCookie(pair[0]));
    const out: unknown[] = [];
    for (let i = 0; i + 1 < headers.length; i += 2) if (!isSetCookie(headers[i])) out.push(headers[i], headers[i + 1]);
    return out;
  }
  if (headers && typeof headers === 'object') {
    const out: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(headers as OutgoingHttpHeaders)) if (!isSetCookie(name)) out[name] = value;
    return out;
  }
  return headers;
}

/** Makes `res` drop every `Set-Cookie`, however it is set. */
export function withoutCookies(res: ServerResponse): void {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) => (isSetCookie(name) ? res : setHeader(name, value))) as ServerResponse['setHeader'];
  const appendHeader = res.appendHeader.bind(res);
  res.appendHeader = ((name: string, value: string | readonly string[]) => (isSetCookie(name) ? res : appendHeader(name, value))) as ServerResponse['appendHeader'];
  const writeHead = res.writeHead.bind(res) as (status: number, ...rest: unknown[]) => ServerResponse;
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    res.removeHeader('set-cookie');
    const last = rest.length - 1;
    if (last >= 0 && typeof rest[last] !== 'string') rest[last] = stripHeaders(rest[last]);
    return writeHead(status, ...rest);
  }) as ServerResponse['writeHead'];
}

/**
 * A content-origin request, to the type server: no cookie in, none out, and with `originAgentCluster`
 * `Origin-Agent-Cluster: ?1` (the page asks for an agent cluster, and a process where the browser gives one, of its own
 * origin, not shared with the app origin when both are one site). The host passes `originAgentCluster` only for a
 * potentially trustworthy content origin (`isPotentiallyTrustworthyOrigin`): on plain http with a LAN name a browser
 * ignores the header and warns in the console.
 */
export function handleContent(rooms: Pick<HostRooms, 'handle'>, req: IncomingMessage, res: ServerResponse, originAgentCluster = true): void {
  delete req.headers.cookie;
  withoutCookies(res);
  if (originAgentCluster) res.setHeader('origin-agent-cluster', '?1');
  rooms.handle(req, res);
}

/** A content-origin WebSocket upgrade, to the type server (no cookie passed on). */
export function upgradeContent(rooms: Pick<HostRooms, 'upgrade'>, req: IncomingMessage, socket: Duplex, head: Buffer): void {
  delete req.headers.cookie;
  rooms.upgrade(req, socket, head);
}

/**
 * Node handlers that send content hosts to the rooms and everything else to the app's handlers. `originAgentCluster`
 * (default true): whether content answers carry `Origin-Agent-Cluster: ?1` (see {@link handleContent}).
 */
export function dispatchByHost(input: {
  rooms: Pick<HostRooms, 'handle' | 'upgrade' | 'isContentHost'>;
  app: (req: IncomingMessage, res: ServerResponse) => void;
  appUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  originAgentCluster?: boolean;
}): { request(req: IncomingMessage, res: ServerResponse): void; upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void } {
  const { rooms, app, appUpgrade, originAgentCluster = true } = input;
  return {
    request(req, res) {
      if (rooms.isContentHost(req.headers.host)) handleContent(rooms, req, res, originAgentCluster);
      else app(req, res);
    },
    upgrade(req, socket, head) {
      if (rooms.isContentHost(req.headers.host)) upgradeContent(rooms, req, socket, head);
      else if (appUpgrade) appUpgrade(req, socket, head);
      else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    },
  };
}
