/**
 * The `snapshot` action's camera: headless Chrome over the DevTools protocol,
 * driven with Node's own WebSocket (nothing to install). It loads a page at a
 * given size, waits for it to draw, and returns a PNG.
 *
 * Chrome is `$OPEN_ARTIFACT_CHROME`, else the usual install places; `findChrome()`
 * answers `null` when there is none, and the action says so.
 *
 * Shared by the type server's `snapshot` action (`@open-artifact/type-server`
 * re-exports it) and frame-host's (frame/snapshot-action.ts). Node only: the
 * frame core and a hosted site never import it.
 */

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

/** Chromium browsers on Windows, each as its folder under a Program Files root (or under LOCALAPPDATA) and its program. */
const WINDOWS_BROWSERS = [
  ['Google\\Chrome\\Application', 'chrome.exe'],
  ['Microsoft\\Edge\\Application', 'msedge.exe'],
];

/**
 * Where those browsers install on Windows, in order of preference: Chrome before Edge, and for each, the machine-wide
 * install under both Program Files roots (64-bit, as Edge's own installer and every ARM64 Windows put it, and (x86)),
 * then the per-user one under LOCALAPPDATA (Chrome's installer when the user is no administrator). The roots come
 * from the environment, so Windows on another drive is found too; C:\ stands in only when a variable is unset.
 */
export function windowsCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [
    env.ProgramW6432,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    env.LOCALAPPDATA,
  ].filter((root): root is string => !!root);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const [folder, program] of WINDOWS_BROWSERS) {
    for (const root of roots) {
      const path = win32.join(root, folder, program);
      // Windows paths ignore case, and ProgramW6432 is ProgramFiles in a 64-bit process.
      if (seen.has(path.toLowerCase())) continue;
      seen.add(path.toLowerCase());
      paths.push(path);
    }
  }
  return paths;
}

export const CANDIDATES: readonly string[] = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  ...windowsCandidates(),
];

/** The Chrome to run: `$OPEN_ARTIFACT_CHROME` when set, else the first one found; `null` when there is none. */
export function findChrome(): string | null {
  const given = process.env.OPEN_ARTIFACT_CHROME;
  if (given) return existsSync(given) ? given : null;
  return CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/** What to photograph. */
export interface SnapshotRequest {
  url: string;
  width: number;
  height: number;
  /** An expression that is truthy once the page has drawn (default: loaded and something on screen). */
  ready?: string;
  /** Wait this long after `ready`, for frames and fonts, ms. Default 1500. */
  settleMs?: number;
  /** Give up after this long, ms. Default 45 s. */
  timeoutMs?: number;
  /**
   * The `prefers-color-scheme` the page is drawn with (`Emulation.setEmulatedMedia`, every frame of the page). Default:
   * none emulated, which headless Chrome draws as light.
   */
  scheme?: 'light' | 'dark';
}

const DEFAULT_READY =
  "document.readyState === 'complete' && !!document.body && (document.body.innerText.trim().length > 0 || document.querySelector('img,canvas,svg,iframe,video') !== null)";

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { message: string };
  params?: Record<string, unknown>;
}

/** Loads `request.url` in a fresh headless Chrome and returns the PNG of the viewport. */
export async function snapshotPage(chrome: string, request: SnapshotRequest): Promise<Buffer> {
  const profile = mkdtempSync(join(tmpdir(), 'open-artifact-snapshot-'));
  const stderr = join(profile, 'chrome-stderr.log');
  const fd = openSync(stderr, 'a');
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      // Keep this temporary profile independent of the macOS login keychain.
      ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
      `--window-size=${request.width},${request.height}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', fd] },
  );
  closeSync(fd);
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = (): void => {
    clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  const work = async (): Promise<Buffer> => {
    const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        let text = '';
        try {
          text = readFileSync(stderr, 'utf8');
        } catch {
          /* not written yet */
        }
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(text);
        if (found) {
          clearInterval(poll);
          resolveEndpoint(found[1]!);
        } else if (child.exitCode !== null || Date.now() - started > 20_000) {
          clearInterval(poll);
          reject(new Error(`Chrome did not start: ${text.slice(-300)}`));
        }
      }, 50);
    });
    const socket = new WebSocket(endpoint);
    ws = socket;
    await new Promise<void>((opened, failed) => {
      socket.addEventListener('open', () => opened(), { once: true });
      socket.addEventListener('error', () => failed(new Error('could not connect to Chrome')), { once: true });
    });
    let nextId = 1;
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; method: string }>();
    const listeners = new Set<(message: CdpMessage) => void>();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        if (!waiting) return;
        if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
        else waiting.resolve(message.result ?? {});
      } else {
        for (const listener of listeners) listener(message);
      }
    });
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> =>
      new Promise((resolveSend, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveSend, reject, method });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });

    const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: request.width, height: request.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (request.scheme) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: request.scheme }] }, sessionId);
    // A page that starts a download while it is photographed saves nothing on this computer.
    await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
    const loaded = new Promise<void>((done) => {
      const listener = (message: CdpMessage): void => {
        if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
          listeners.delete(listener);
          done();
        }
      };
      listeners.add(listener);
    });
    const navigated = (await send('Page.navigate', { url: request.url }, sessionId)) as { errorText?: string };
    if (navigated.errorText) throw new Error(`the page did not load: ${navigated.errorText}`);
    await Promise.race([loaded, sleep(15_000)]);
    const ready = request.ready ?? DEFAULT_READY;
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const out = (await send('Runtime.evaluate', { expression: `!!(${ready})`, returnByValue: true }, sessionId).catch(() => null)) as {
        result?: { value?: unknown };
      } | null;
      if (out?.result?.value === true) break;
      await sleep(150);
    }
    await sleep(request.settleMs ?? 1500);
    const shot = (await send('Page.captureScreenshot', { format: 'png' }, sessionId)) as { data: string };
    return Buffer.from(shot.data, 'base64');
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the page took too long to draw')), request.timeoutMs ?? 45_000);
      }),
    ]);
  } finally {
    cleanup();
  }
}
