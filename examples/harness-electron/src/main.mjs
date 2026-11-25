/**
 * An Electron agent app on `@open-artifact/harness-kit`: a chat column on the left, the artifact's page on the right.
 *
 * Everything that is not Electron comes from `examples/harness-node` (the connection, the scripted agent, tools,
 * wake routing, cards, skill, origin allowlist, places), whose test runs it against a real daemon. What is here is the
 * window: the chat renderer (through `preload.cjs`) and the artifact pane (`pane.mjs`).
 *
 * The agent is scripted, as in the headless example: `make <title>` creates an artifact and shows it; anything else is
 * echoed with the page context it would have been sent with.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { ScriptedAgent } from '../../harness-node/agent.mjs';
import { OriginAllowlist } from '../../harness-node/allowlist.mjs';
import { followArtifacts } from '../../harness-node/artifacts.mjs';
import { callerOf, connectHarness } from '../../harness-node/harness.mjs';
import { PlaceMemory } from '../../harness-node/places.mjs';
import { installSkill } from '../../harness-node/skill.mjs';
import { registerTools } from '../../harness-node/tools.mjs';
import { describeWake, wakeHandler } from '../../harness-node/wakes.mjs';
import { spawnDaemonInUtilityProcess, stopDaemonUtilityProcess } from './daemon-spawn.mjs';
import { ArtifactPane } from './pane.mjs';

// The bundle sits in `out/`, beside `preload.cjs`; the renderer is in `../renderer`.
const here = import.meta.dirname;

// Electron fires `ready` only after the main module has finished evaluating, so a top-level `await app.whenReady()`
// would never return: the app starts from the `ready` callback instead.
app.whenReady().then(start, (error) => {
  console.error(error);
  app.exit(1);
});

async function start() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Open Artifact example',
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // The chat window shows only its own file: no navigation, no new windows.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadFile(join(here, '..', 'renderer', 'index.html'));

  const send = (channel, value) => {
    if (!window.isDestroyed()) window.webContents.send(channel, value);
  };
  const agent = new ScriptedAgent({ id: 'chat-1', workspace: join(app.getPath('documents'), 'Open Artifact example'), title: 'Example chat', print: (line) => send('chat:line', line) });
  const sessions = new Map([[agent.id, agent]]);
  const allowlist = new OriginAllowlist();
  const places = new PlaceMemory(join(app.getPath('userData'), 'places.json'));
  let pane = null;

  const oa = await connectHarness({
    name: 'electron-example',
    embed: { origins: [], mode: 'view', remote: 'ask' },
    // A remote type's page (on another computer) is shown only when the person says so.
    allowRemote: async ({ origin, type, title }) =>
      (await dialog.showMessageBox(window, { type: 'question', buttons: ['Show it', 'Cancel'], defaultId: 1, message: `Show "${title ?? type}" from ${origin}?`, detail: 'Its page comes from another computer.' })).response === 0,
    open: (request) => pane?.show(request) ?? false,
    wake: wakeHandler(sessions, {
      onWake(params, route) {
        send('chat:notice', describeWake(params));
        // The owner's words are a turn: run one. A notice waits for the person's next message.
        if (route === 'turn') void turn(params.text, { fromPage: true });
      },
    }),
    log: (line) => console.log(`[kit] ${line}`),
    // Two ways to start the daemon when none runs. By default the kit runs the runtime with this app's executable and
    // ELECTRON_RUN_AS_NODE=1. An app that turned its RunAsNode fuse off starts it in a utility process instead
    // (OA_EXAMPLE_DAEMON=utility here; a shipped app would pick one).
    ...(process.env.OA_EXAMPLE_DAEMON === 'utility' ? { daemon: { spawn: spawnDaemonInUtilityProcess } } : {}),
  });

  pane = new ArtifactPane({
    window,
    oa,
    allowlist,
    places,
    agentName: 'Example',
    chat: {
      focus: () => window.focus(),
      draft: (prompt) => send('chat:draft', prompt),
    },
  });
  await allowlist.follow(oa);

  await oa.attach({ ...callerOf(agent), title: agent.title, status: 'idle' });
  await registerTools(oa, agent);
  const skill = await installSkill(oa, join(app.getPath('userData'), 'skills'));
  send('chat:commands', skill.commands);
  const { cards } = followArtifacts(oa, { onCard: () => send('chat:cards', [...(cards.get(agent.id)?.values() ?? [])]) });

  /** One turn of the scripted agent. */
  async function turn(text, { fromPage = false } = {}) {
    await oa.status(callerOf(agent), 'running');
    try {
      if (!fromPage) {
        agent.add('user', text);
        // What the person selected on the page they are looking at goes with their message.
        if (pane.current && oa.features.includes('view.context')) {
          const block = oa.contextBlock(await oa.context(pane.current, callerOf(agent)));
          if (block) agent.add('notice', block);
        }
      }
      const make = /^make\s+(.+)/i.exec(text.trim());
      if (!make) {
        agent.add('assistant', 'This example has no model. Try "make <title>".');
        return;
      }
      const quick = await agent.runTool('Artifact', { action: 'quickstart' });
      if (!quick.create) return agent.add('assistant', 'No artifact type is installed.');
      const { open: _later, ...create } = quick.create;
      const made = await agent.runTool('Artifact', { ...create, title: make[1] });
      if (made.error) return agent.add('assistant', made.error.message);
      await oa.open(made.url, callerOf(agent));
      agent.add('assistant', `Made ${made.url}.`);
    } finally {
      await oa.status(callerOf(agent), 'idle');
    }
  }

  const fromChat = (event) => event.sender === window.webContents;
  ipcMain.handle('chat:send', (event, text) => (fromChat(event) && typeof text === 'string' ? turn(text) : undefined));
  ipcMain.handle('chat:open', (event, url) => (fromChat(event) && typeof url === 'string' ? oa.open(url, callerOf(agent)) : undefined));

  window.on('closed', () => app.quit());
  // Quitting waits for the daemon this app forked (if any) to stop by itself: a utility process is otherwise ended
  // with the app, before the daemon has removed `daemon.json` or its type servers have finished.
  let leaving = false;
  app.on('before-quit', (event) => {
    if (leaving) return;
    leaving = true;
    event.preventDefault();
    pane.close();
    void oa.detach(callerOf(agent)).catch(() => undefined);
    oa.close();
    void stopDaemonUtilityProcess().finally(() => app.quit());
  });
}
