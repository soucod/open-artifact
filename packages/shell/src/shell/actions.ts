/**
 * What the Shell's controls do: Library API calls and host messages, with
 * their results written to the store and failures shown as toasts.
 */

import { DOC_FRAGMENT, SLIDE_FRAGMENT, artifactIdOf, type FrameDeniedReason, type HostDestination, type ShareView, type ShareRequest, type ShellBoot } from '@open-artifact/protocol';
import { toast } from '@open-artifact/ui';
import { ApiError, answerOf, api, errorText, subscribeLibraryEvents } from '../lib/api.ts';
import { copyText, fileNameOf } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import {
  afterFrameDenied,
  appendSent,
  deliveryOf,
  designPageFragment,
  destinationRequest,
  devBoot,
  finishedBoot,
  givenLink,
  parseSent,
  pendingBoot,
  problemBoot,
  sheetPageFragment,
} from './model.ts';
import { applyCloudChange, cloudSentLine, isCloud, mayExport, roleOf } from '../lib/cloud.ts';
import { checkHostAddress, checkName, connectFailure, publishFailure, publishedOf, unpublishFailure, type Failure, type Said } from '../lib/publish.ts';
import { installVitals, mark, takePrefetch, type Phase } from './preboot.ts';
import { filesChanged, toHost } from './bridge.ts';
import { useShell } from './store.ts';

const notify = (title: string): void => {
  toast.add({ title });
};

const bootOf = (): ShellBoot => {
  const boot = useShell.getState().boot;
  if (!boot) throw new Error('No boot.');
  return boot;
};

function shareFragment(boot: ShellBoot | null, fragment: string): string {
  if (boot?.type === 'docs' && DOC_FRAGMENT.test(fragment)) return fragment;
  if (boot?.type === 'sheets') return sheetPageFragment(fragment);
  if (boot?.type === 'design') return designPageFragment(fragment);
  return boot?.type === 'slides' && SLIDE_FRAGMENT.test(fragment) ? fragment : '';
}

/** The Shell's own address for this artifact. */
export function shellLink(fragment = location.hash): string {
  const boot = bootOf();
  const base = boot.typeServer ? boot.typeServer.invite ?? location.origin + location.pathname : `${location.origin}/a/${encodeURIComponent(boot.id)}`;
  return base + shareFragment(boot, fragment);
}

/** Records a load phase (`window.__OPEN_ARTIFACT_VITALS__`). */
export function markPhase(phase: Phase): void {
  installVitals(window);
  mark(window, phase);
}

/**
 * The boot: the one the daemon injected, or, in development (no daemon
 * page), one built from `?id=` through the Library API. An injected
 * `pending` boot draws the Shell at once; its finished boot follows.
 */
export async function loadBoot(): Promise<void> {
  const injected = (window as { __OPEN_ARTIFACT_BOOT__?: ShellBoot | null }).__OPEN_ARTIFACT_BOOT__;
  const store = useShell.getState();
  if (injected) {
    store.setBoot(injected);
    if (injected.pending) await finishBoot(injected, false);
    else markPhase('oa:boot');
    return;
  }
  const id = artifactIdOf(new URLSearchParams(location.search).get('id'));
  if (!id) return store.setBoot(null, t('noBoot'));
  try {
    const detail = await api.artifact(id);
    let page: { page: string; page_url: string } | null = null;
    let problem: string | null = null;
    try {
      page = await api.open(id);
    } catch (error) {
      problem = errorText(error);
    }
    store.setBoot(devBoot(detail, page, problem));
    markPhase('oa:boot');
  } catch (error) {
    store.setBoot(null, errorText(error));
  }
}

/** Asks for the finished boot: the request the page's inline script started, else (or when it failed) a new one. */
async function bootFor(pending: ShellBoot, fresh: boolean): Promise<ShellBoot> {
  const prefetch = fresh ? null : takePrefetch(window, pending.id);
  if (prefetch) {
    let response: Response | null = null;
    try {
      response = await prefetch.res;
    } catch {
      // It did not reach the daemon (or timed out): ask again below.
    }
    if (response) return finishedBoot(await answerOf<unknown>(response), pending);
  }
  return finishedBoot(await api.boot(pending.id, { fresh }), pending);
}

/** Replaces a pending boot with the finished one, or with the problem and a way to try again. */
async function finishBoot(pending: ShellBoot, fresh: boolean): Promise<void> {
  try {
    useShell.getState().setBoot(await bootFor(pending, fresh));
    markPhase('oa:boot');
  } catch (error) {
    useShell.getState().setBoot(problemBoot(pending, t('bootFailed', { error: errorText(error) })), null, true);
  }
}

/** The problem state's Try again: the page's address asked for anew (a type server's own Shell loads again). */
export async function retryBoot(): Promise<void> {
  const boot = useShell.getState().boot;
  if (!boot) return;
  if (boot.typeServer) return location.reload();
  const pending = pendingBoot(boot);
  useShell.getState().setBoot(pending);
  await finishBoot(pending, true);
}

/** The frame was refused once already and has not shown its page since. */
let deniedAgain = false;

/**
 * The page's server refused the frame (`frame_denied`): its address is stale (the server restarted) or no longer
 * this visitor's. Asks for the address again once; refused again, the problem shows.
 */
export function frameDenied(reason: FrameDeniedReason): void {
  const boot = useShell.getState().boot;
  if (!boot || boot.pending) return;
  if (afterFrameDenied(boot, deniedAgain) === 'problem') {
    useShell.getState().setBoot(problemBoot(boot, t(reason === 'not_granted' ? 'frameNotGranted' : 'frameNotOpen')), null, true);
    return;
  }
  deniedAgain = true;
  void retryBoot();
}

/** The frame's page showed: a later refusal asks for its address again. */
export function frameShown(): void {
  deniedAgain = false;
  markPhase('oa:frame-ready');
}

/** Reloads the artifact's library record. */
export async function refreshArtifact(): Promise<void> {
  try {
    useShell.getState().setArtifact(await api.artifact(bootOf().id));
  } catch {
    // Keep what we had: the bar still works on the boot.
  }
}

/** Loads every artifact for Switch artifact. */
export async function loadLibrary(): Promise<void> {
  try {
    useShell.getState().setLibrary(await api.artifacts());
  } catch {
    if (!useShell.getState().library) useShell.getState().setLibrary([]);
  }
}

/** Pins or unpins the artifact. */
export async function togglePin(): Promise<void> {
  const pinned = !useShell.getState().artifact?.pinned;
  try {
    useShell.getState().mergeArtifact(await api.update({ id: bootOf().id, pinned }));
    notify(t(pinned ? 'pinned' : 'unpinned'));
  } catch (error) {
    notify(t(pinned ? 'couldNotPin' : 'couldNotUnpin', { error: errorText(error) }));
  }
}

/** Renames the artifact (nothing for an empty or unchanged title). */
export async function rename(next: string): Promise<void> {
  const title = next.trim();
  const store = useShell.getState();
  const current = store.artifact?.title ?? bootOf().title;
  if (!title || title === current) return;
  store.mergeArtifact({ title });
  try {
    store.mergeArtifact(await api.update({ id: bootOf().id, title }));
  } catch (error) {
    store.mergeArtifact({ title: current });
    notify(t('couldNotRename', { error: errorText(error) }));
  }
}

/** Duplicates the artifact and opens the copy. */
export async function duplicate(): Promise<void> {
  try {
    const copy = await api.duplicate(bootOf().id);
    notify(t('duplicated'));
    location.href = `/a/${encodeURIComponent(copy.id)}${location.search}`;
  } catch (error) {
    notify(t('couldNotDuplicate', { error: errorText(error) }));
  }
}

/** Hands the Shell back to the host, or goes to all artifacts. */
export function closeShell(): void {
  const { host, report } = useShell.getState();
  if (host) {
    // The host removes the Shell without unloading it: ask here (standalone, `beforeunload` asks).
    if (report.leaveLosesWork && !window.confirm(t('leaveLosesWork'))) return;
    toHost({ openArtifact: 'close' });
  } else location.href = '/';
}

/** Deletes the artifact's record (the folder stays) and closes the Shell. */
export async function deleteArtifact(): Promise<void> {
  try {
    await api.remove(bootOf().id);
    closeShell();
  } catch (error) {
    notify(t('couldNotDelete', { error: errorText(error) }));
  }
}

/** Asks the host to show the owner session. */
export function openSession(): void {
  const owner = useShell.getState().artifact?.owner;
  if (!owner) return;
  toHost({ openArtifact: 'open_session', session: owner.session, harness: owner.harness });
}

/** Asks the host to start a session with this prompt. */
export function newSession(prompt: string): void {
  toHost({ openArtifact: 'new_session', prompt, artifact: bootOf().url });
}

/**
 * Sends the export to one of the declared host's destinations: a page request to the owner's agent that names it
 * (the agent exports and hands the file to the host's destination its own way).
 */
export async function sendToDestination(destination: HostDestination, agent: string): Promise<void> {
  const host = useShell.getState().host;
  if (!host?.declared || !host.destinations.some((d) => d.id === destination.id)) return;
  const title = useShell.getState().artifact?.title || bootOf().title;
  try {
    await api.ask({ id: bootOf().id, text: destinationRequest(destination, title), label: t('destinationRequestLabel', { label: destination.label }) });
    notify(t('destinationSent', { label: destination.label, agent }));
  } catch (error) {
    notify(t('notSent', { error: errorText(error) }));
  }
}

/** Copies the Shell's link. */
export async function copyShellLink(fragment?: string): Promise<void> {
  await copyText(shellLink(fragment));
  notify(t('linkCopied'));
}

/**
 * Copy link (the title menu's, a slide's, a sheet's): the link the Export tab copies, so it opens for someone else,
 * with `fragment` (the page's own place, the address bar's by default). For the owner of an artifact that shares,
 * that is the invite link of its least role at the network address (copying it opens sharing on the network, as
 * there, and the note says so), or a cloud host's own address. For anyone else, a type that cannot share, or with
 * every link off, the Shell's own address.
 */
export async function copyGivenLink(fragment = location.hash): Promise<void> {
  const shares = await loadGivenLink();
  const view = shares ? useShell.getState().share.view : null;
  const given = view ? givenLink(view) : null;
  if (!view || !given) return copyShellLink(fragment);
  const opens = !view.lan && !view.cloud;
  if (!(await copyShareLink(given.which, given.url, fragment))) return notify(useShell.getState().share.error || t('linkCopied'));
  notify(t(opens ? 'linkCopiedNetwork' : 'linkCopied'));
}

/**
 * Loads the sharing state {@link copyGivenLink} picks from, when this viewer gives out invite links and it is not
 * loaded yet. The title menu calls it as it opens, so Copy link then copies at once, in the click (Safari copies
 * nothing after a wait). Resolves whether this viewer gives out invite links.
 */
export async function loadGivenLink(): Promise<boolean> {
  const boot = useShell.getState().boot;
  const shares = !!boot && roleOf(boot) === 'owner' && (!boot.typeServer || !!boot.typeServer.sharePath);
  const { view, unsupported } = useShell.getState().share;
  if (shares && !view && !unsupported) await refreshShare();
  return shares;
}

/** Copies the artifact's folder path. */
export async function copyPath(): Promise<void> {
  await copyText(bootOf().root);
  notify(t('pathCopied'));
}

// ---- sharing -----------------------------------------------------------------------------------------------------

let shareRead: Promise<boolean> | null = null;

/** Loads the sharing state, or changes it first when `change` is given. Resolves `false` when that failed. */
export function refreshShare(change?: Omit<ShareRequest, 'id'>): Promise<boolean> {
  if (change) return readShare(change);
  // The panel polls every 4 s: while a read is still out, the next one shares it instead of piling up.
  shareRead ??= readShare().finally(() => (shareRead = null));
  return shareRead;
}

async function readShare(change?: Omit<ShareRequest, 'id'>): Promise<boolean> {
  const store = useShell.getState();
  try {
    const boot = bootOf();
    let view: ShareView;
    if (boot.typeServer?.sharePath) {
      const response = await fetch(boot.typeServer.sharePath, change && {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? response.statusText);
      view = await response.json() as ShareView;
    } else {
      view = change ? await api.setShare({ id: boot.id, ...change }) : await api.share(boot.id);
    }
    store.patchShare({ view, error: '', unsupported: false });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'unsupported') store.patchShare({ view: null, unsupported: true, error: '' });
    else if (error instanceof ApiError && error.status === 0) store.patchShare({ error: t('shareNoAnswer') });
    else store.patchShare({ error: t('shareError', { error: errorText(error) }) });
    return false;
  }
}

let copiedTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copies a link and shows "Copied" on its button for a moment. A role's
 * link answers only once the artifact is shared on the network, so copying
 * one turns that on. A role's link carries `fragment` (the slide, the
 * sheet, the design page) as far as the type shares it. Resolves `false`
 * when turning it on failed.
 */
export async function copyShareLink(which: string, url: string, fragment = location.hash): Promise<boolean> {
  const store = useShell.getState();
  const page = which === 'page' ? '' : shareFragment(store.boot, fragment);
  await copyText(url + page);
  store.patchShare({ copied: which });
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    if (useShell.getState().share.copied === which) useShell.getState().patchShare({ copied: null });
  }, 1600);
  const view = store.share.view;
  // A cloud host's links work wherever its general access lets them: there is no network to open. Neither does the
  // web address of a published artifact.
  if (which !== 'page' && which !== 'web' && view && !view.lan && !view.cloud) return refreshShare({ lan: true });
  return true;
}

/**
 * Changes a cloud host's sharing: shown at once ({@link applyCloudChange}), then the host's answer replaces it; when
 * the host refuses, the panel goes back to what it showed and says why.
 */
export async function changeCloudShare(change: Omit<ShareRequest, 'id'>): Promise<boolean> {
  const store = useShell.getState();
  const before = store.share.view;
  const shown = before ? applyCloudChange(before, change) : null;
  if (shown) store.patchShare({ view: shown });
  const ok = await refreshShare(change);
  if (!ok && shown && useShell.getState().share.view === shown) useShell.getState().patchShare({ view: before });
  return ok;
}

/**
 * Whether the person may download or export now (a cloud host's broker asks before a page saves a file): anyone but
 * a viewer; a viewer when the owner lets viewers export, read from the sharing state (loaded first when it is not).
 */
export async function cloudMayExport(): Promise<boolean> {
  const role = roleOf(useShell.getState().boot);
  if (role !== 'viewer') return true;
  const booted = useShell.getState().boot?.cloud?.settings;
  if (!useShell.getState().share.view?.cloud && !booted) await refreshShare();
  return mayExport(role, useShell.getState().share.view?.cloud?.settings ?? booted);
}

// ---- publishing to the web ----------------------------------------------------------------------------------------

const said = (what: Said): string => t(what.key, what.vars);

/** An error's `{code, message, status}` (a thrown value that is not an `ApiError` reads as a failure to answer). */
const failureOf = (error: unknown): Failure =>
  error instanceof ApiError ? { code: error.code, message: error.message, status: error.status } : { code: 'error', message: errorText(error), status: 0 };

/** Whether publishing applies: the local daemon's Shell (not a cloud host's, not a type server's own). */
function publishable(): boolean {
  const boot = useShell.getState().boot;
  return !!boot && !isCloud(boot) && !boot.typeServer;
}

let remotesReading = false;
/** Counts connect attempts: a newer one (or Cancel) stops an older one's waiting. */
let connectGen = 0;

/** Loads the sites this computer publishes to (and so whether this artifact is published). */
export async function refreshRemotes(): Promise<void> {
  if (!publishable() || remotesReading) return;
  remotesReading = true;
  try {
    const { remotes, cloud } = await api.remotes();
    useShell.getState().patchPublish({ remotes, cloud, missing: false });
    void refreshDataPublish();
  } catch (error) {
    // An older daemon has no `remotes`: the panel leaves publishing out. Otherwise keep what was shown.
    if (error instanceof ApiError && error.code === 'not_found') useShell.getState().patchPublish({ remotes: [], missing: true });
  } finally {
    remotesReading = false;
  }
}

/** A Data dashboard's live data on its site, for the publish section (nothing for other types or an older daemon). */
export async function refreshDataPublish(): Promise<void> {
  const boot = useShell.getState().boot;
  if (!boot || boot.type !== 'data' || !publishable()) return;
  try {
    useShell.getState().patchPublish({ data: await api.dataPublish(boot.id) });
  } catch {
    useShell.getState().patchPublish({ data: null });
  }
}

/** Confirms (or takes back) that the dashboard's live data is published with it: a person's choice, never an agent's. */
export async function setDataPublish(on: boolean): Promise<void> {
  const store = useShell.getState();
  if (store.publish.busy) return;
  store.patchPublish({ busy: 'data', error: '' });
  try {
    useShell.getState().patchPublish({ data: await api.dataPublish(bootOf().id, { publish: on }) });
  } catch (error) {
    useShell.getState().patchPublish({ error: failureOf(error).message });
  } finally {
    useShell.getState().patchPublish({ busy: null });
  }
}

/** Runs a published dashboard's live queries on this computer now and puts the rows on its site ("Refresh now"). */
export async function refreshDataHere(): Promise<void> {
  const store = useShell.getState();
  if (store.publish.busy) return;
  store.patchPublish({ busy: 'data-refresh', error: '' });
  try {
    useShell.getState().patchPublish({ data: await api.dataPublish(bootOf().id, { refresh: true }) });
  } catch (error) {
    useShell.getState().patchPublish({ error: failureOf(error).message });
  } finally {
    useShell.getState().patchPublish({ busy: null });
  }
}

/** Opens the connect form, filled in when connecting a known site again. */
export function openConnect(prefill?: { host: string; name: string }): void {
  connectGen++;
  useShell.getState().patchPublish({ connect: { step: 'form', host: prefill?.host ?? '', name: prefill?.name ?? '', error: '' } });
}

/** Closes the connect form, or cancels a connect waiting for approval (the daemon stops asking the site). */
export function closeConnect(): void {
  const { connect } = useShell.getState().publish;
  const waiting = connect.step === 'code' ? connect.start.name : connect.step === 'starting' ? connect.name : null;
  connectGen++;
  useShell.getState().patchPublish({ connect: { step: 'closed' } });
  // An older daemon has no such route: its sign-in then runs out by itself, as before.
  if (waiting) void api.connectCancel(waiting).catch(() => undefined);
}

/** The panel closed: a finished or failed connect is not shown again; one waiting for approval goes on. */
export function publishPanelClosed(): void {
  const { connect } = useShell.getState().publish;
  if (connect.step === 'done' || connect.step === 'failed' || connect.step === 'form') useShell.getState().patchPublish({ connect: { step: 'closed' } });
  useShell.getState().patchPublish({ error: '' });
}

/**
 * Connects a site: checks the address and name, starts the daemon's sign-in (`remotes.add`: a code to approve on the
 * site), then waits for the approval (`remotes.add.wait`, 25 s at a time) until it is approved, refused or runs out.
 */
export async function connectSite(rawHost: string, rawName: string): Promise<void> {
  const store = useShell.getState();
  const checked = checkHostAddress(rawHost);
  const name = rawName.trim();
  if (!checked.ok) return store.patchPublish({ connect: { step: 'form', host: rawHost, name: rawName, error: said(checked.reason) } });
  const badName = checkName(name);
  if (badName) return store.patchPublish({ connect: { step: 'form', host: rawHost, name: rawName, error: said(badName) } });
  const host = checked.host;
  const gen = ++connectGen;
  const current = (): boolean => gen === connectGen;
  const fail = (error: unknown): void => {
    if (current()) useShell.getState().patchPublish({ connect: { step: 'failed', host, name, error: said(connectFailure(failureOf(error), host)) } });
  };
  store.patchPublish({ connect: { step: 'starting', host, name } });
  let start;
  try {
    start = await api.connect(name, host);
  } catch (error) {
    return fail(error);
  }
  if (!current()) {
    // Cancelled while the daemon was starting it: nobody waits for this code, so the daemon stops asking.
    if (useShell.getState().publish.connect.step === 'closed') void api.connectCancel(name).catch(() => undefined);
    return;
  }
  useShell.getState().patchPublish({ connect: { step: 'code', start } });
  let misses = 0;
  while (current()) {
    try {
      const out = await api.connectWait(name, 25_000);
      misses = 0;
      if (out.status === 'done') {
        if (!current()) return;
        useShell.getState().patchPublish({ connect: { step: 'done', host, user: out.user.name || out.user.email || out.user.id } });
        await refreshRemotes();
        return;
      }
    } catch (error) {
      // The daemon did not answer (a moment's hiccup): ask again a few times before giving up.
      if (error instanceof ApiError && error.status === 0 && ++misses < 4) {
        await new Promise((done) => setTimeout(done, 2000));
        continue;
      }
      return fail(error);
    }
  }
}

/** Publishes this artifact to a site; the panel then shows its web address. */
export async function publishTo(remote: string): Promise<void> {
  const store = useShell.getState();
  if (store.publish.busy) return;
  const host = store.publish.remotes?.find((r) => r.name === remote)?.host ?? remote;
  store.patchPublish({ busy: `publish:${remote}`, error: '' });
  try {
    // A dashboard with live data: the panel says beside Publish that its data goes too, so Publish confirms it.
    await api.publish(bootOf().id, remote, { data: store.publish.data?.live === true });
    await refreshRemotes();
    void refreshArtifact();
  } catch (error) {
    useShell.getState().patchPublish({ error: said(publishFailure(failureOf(error), host)) });
    void refreshRemotes();
  } finally {
    useShell.getState().patchPublish({ busy: null });
  }
}

/**
 * Turns publishing new artifacts by themselves on or off (a person's choice: the daemon's `cloud.settings`, which no
 * agent tool reaches). Artifacts made before are left as they are.
 */
export async function setAutoPublish(on: boolean): Promise<void> {
  const store = useShell.getState();
  if (store.publish.busy) return;
  store.patchPublish({ busy: 'cloud', error: '' });
  try {
    const { cloud } = await api.cloudSettings({ publish: on ? 'auto' : 'manual' });
    useShell.getState().patchPublish({ cloud });
    await refreshRemotes();
  } catch (error) {
    useShell.getState().patchPublish({ error: said({ key: 'pubCloudSettingsFailed', vars: { error: failureOf(error).message } }) });
  } finally {
    useShell.getState().patchPublish({ busy: null });
  }
}

/** Chooses the site used when none is picked, and for publishing by itself. */
export async function setDefaultSite(name: string): Promise<void> {
  const store = useShell.getState();
  if (store.publish.busy) return;
  store.patchPublish({ busy: 'cloud', error: '' });
  try {
    const { cloud } = await api.cloudSettings({ default: name });
    useShell.getState().patchPublish({ cloud });
    await refreshRemotes();
  } catch (error) {
    useShell.getState().patchPublish({ error: said({ key: 'pubCloudSettingsFailed', vars: { error: failureOf(error).message } }) });
  } finally {
    useShell.getState().patchPublish({ busy: null });
  }
}

/** Takes this artifact off its site (its folder stays, with the site's latest version). */
export async function unpublish(): Promise<void> {
  const store = useShell.getState();
  if (store.publish.busy) return;
  const host = publishedOf(store.publish.remotes, bootOf().id)?.remote.host ?? '';
  store.patchPublish({ busy: 'unpublish', error: '' });
  try {
    await api.unpublish(bootOf().id);
    await refreshRemotes();
    void refreshArtifact();
  } catch (error) {
    useShell.getState().patchPublish({ error: said(unpublishFailure(failureOf(error), host)) });
  } finally {
    useShell.getState().patchPublish({ busy: null });
  }
}

// ---- the folder as a zip ------------------------------------------------------------------------------------------

let zipping = false;

/**
 * Downloads the artifact's folder as a zip (the Export tab's last row): a
 * `HEAD` first, so a folder that will not zip (too large, or a type that
 * cannot) says so here instead of in the browser's download list; then a
 * plain link, which the browser streams to disk however large it is.
 */
export async function downloadArchive(): Promise<void> {
  if (zipping) return;
  zipping = true;
  const boot = bootOf();
  const url = api.archiveUrl(boot.id);
  try {
    let head: Response;
    try {
      head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    } catch (error) {
      throw new Error(t('archiveFailed', { error: errorText(error) }));
    }
    if (!head.ok) {
      if (head.status === 413) throw new Error(t('archiveTooLarge'));
      if (head.status === 409) throw new Error(t('archiveUnsupported', { type: boot.typeTitle }));
      // A HEAD has no body: the site's refusal (a plugin's sentence) is read from a GET, refused just as early.
      if (head.status === 403) {
        const refusal = await fetch(url, { cache: 'no-store' }).then((response) => response.json() as Promise<{ message?: unknown }>).catch(() => null);
        if (typeof refusal?.message === 'string' && refusal.message) throw new Error(refusal.message);
      }
      throw new Error(t('archiveFailed', { error: `HTTP ${head.status}` }));
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    toast.add({ title: t('archiveStarted', { name: fileNameOf(head.headers.get('Content-Disposition')) || 'folder.zip' }), description: t('archiveHint') });
  } catch (error) {
    notify(errorText(error));
  } finally {
    zipping = false;
  }
}

// ---- asking the agent ----------------------------------------------------------------------------------------------

const sentKey = (): string => `open-artifact-ask-${bootOf().id}`;

/** Restores the messages sent from this tab. */
export function restoreSent(): void {
  try {
    useShell.getState().setSent(parseSent(sessionStorage.getItem(sentKey())));
  } catch {
    // No session storage: start empty.
  }
}

/** Sends a message to the owner agent. Resolves `true` when it was sent. */
export async function ask(text: string, agent: string): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  const store = useShell.getState();
  store.setAskStatus(t('sending'));
  try {
    const out = await api.ask({ id: bootOf().id, text: body });
    const delivery = deliveryOf(out.via, out.status);
    const sent = appendSent(useShell.getState().sent, { text: body, at: new Date().toISOString(), delivery });
    store.setSent(sent);
    try {
      sessionStorage.setItem(sentKey(), JSON.stringify(sent));
    } catch {
      // Not kept across reloads; fine.
    }
    // A cloud host says whether the owner's computer has it now; the words follow what the pane knew of the agent.
    const state = useShell.getState();
    const cloudAgent = state.boot?.cloud ? (state.artifact?.agent ?? state.boot.cloud.agent) : undefined;
    if (cloudAgent && delivery !== 'failed') {
      const said = cloudSentLine(out.status, cloudAgent);
      store.setAskStatus(t(said.key, said.vars));
    } else store.setAskStatus(delivery === 'inbox' ? t('sentInbox', { agent }) : delivery === 'drafted' ? t('sentDrafted', { agent }) : delivery === 'delivered' ? t('sent') : t('notDelivered'));
    toHost({ openArtifact: 'comment_summon', text: body });
    return true;
  } catch (error) {
    store.setAskStatus(t('notSent', { error: errorText(error) }));
    return false;
  }
}

// ---- live updates --------------------------------------------------------------------------------------------------

/** Follows `/api/open-artifact.events`: refreshes the artifact, forgets the library, passes file changes to the page. */
export function startEvents(): () => void {
  return subscribeLibraryEvents((event) => {
    const boot = useShell.getState().boot;
    if (!boot) return;
    switch (event.type) {
      case 'artifacts/changed':
        useShell.getState().setLibrary(null);
        if (event.id !== boot.id) return;
        void refreshArtifact();
        // Published or unpublished (here, from the command line, or the site removed it).
        void refreshRemotes();
        // A static entry's files changed: the page applies them itself or the frame loads again.
        if (event.paths?.length && boot.pageKind === 'static') filesChanged(event.paths);
        break;
      case 'harness/changed':
        void refreshArtifact();
        break;
      case 'wake/state':
        if (event.artifactId === boot.id) void refreshArtifact();
        break;
      default:
        break;
    }
  });
}
