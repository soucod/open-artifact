// A stand-in for a company's sign-in proxy (oauth2-proxy, an SSO gateway), for the host-plugin suites: it forwards
// every request (WebSockets too) to the site, and says who is asking the way the `header-auth` example expects
// (`x-forwarded-email`, `x-forwarded-user` and the shared secret in `x-proxy-secret`). Who that is comes from the
// `e2e_who` cookie, which `/__as/<email>` sets; what a client sends in the proxy's own headers is dropped first.
import http from 'node:http';
import net from 'node:net';

/** Starts the proxy on 127.0.0.1:`port`, in front of the site on 127.0.0.1:`target`. Resolves to the server. */
export function startSignInProxy(port, target, secret) {
  const whoOf = cookie => /(?:^|;\s*)e2e_who=([^;]+)/.exec(cookie ?? '')?.[1];
  const headersFor = req => {
    const headers = { ...req.headers };
    delete headers['x-forwarded-email'];
    delete headers['x-forwarded-user'];
    delete headers['x-proxy-secret'];
    const who = whoOf(req.headers.cookie);
    if (who) Object.assign(headers, { 'x-forwarded-email': decodeURIComponent(who), 'x-forwarded-user': decodeURIComponent(who).split('@')[0], 'x-proxy-secret': secret });
    return headers;
  };
  const server = http.createServer((req, res) => {
    const as = /^\/__as\/([^/?]+)/.exec(req.url);
    if (as) {
      // A new person at this browser. The site's session of the one before is left alone: the site asks header-auth
      // again on every request of a session it made, so the next request is the new person's.
      res.writeHead(302, { location: '/', 'set-cookie': [`e2e_who=${as[1]}; Path=/; HttpOnly; SameSite=Lax`] });
      res.end();
      return;
    }
    const upstream = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: headersFor(req) }, answer => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(target, '127.0.0.1', () => {
      const headers = headersFor(req);
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => `${k}: ${x}`) : [`${k}: ${v}`]))];
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
