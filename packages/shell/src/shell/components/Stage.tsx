/**
 * What fills the Shell under its bar: the artifact page in its frame, the
 * empty state (hand the artifact to an agent), or the problem state.
 */

import { SHELL_FRAME_NAME } from '@open-artifact/protocol';
import { Copy, LoaderCircle, MessageSquare, Play, RotateCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, cn } from '@open-artifact/ui';
import { copyText } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { attachFrame, embedded, frameLoaded } from '../bridge.ts';
import { ask, frameShown, markPhase, newSession, retryBoot } from '../actions.ts';
import { useAgentName, useCloud, useMayAsk } from '../hooks.ts';
import { COVER_FADE_MS, addressWithoutThread, pageAddress, pageOriginOf } from '../model.ts';
import { alignSpin } from '../preboot.ts';
import { useBoot, useShell } from '../store.ts';

/**
 * The page is on its way: the spinner of the page's skeleton (`index.html`), on the same clock, so one spinner turns
 * from the first paint until the page shows.
 */
export function PageLoading({ hiding = false }: { hiding?: boolean }) {
  return (
    <div
      role="status"
      data-shell-loading={hiding ? undefined : ''}
      aria-label={t('loading')}
      aria-hidden={hiding || undefined}
      className={cn(
        'absolute inset-0 flex items-center justify-center bg-canvas transition-opacity motion-reduce:transition-none',
        hiding && 'pointer-events-none opacity-0',
      )}
      style={{ transitionDuration: `${COVER_FADE_MS}ms` }}
    >
      <LoaderCircle ref={alignSpin} className="size-6 animate-spin text-fg-subtle motion-reduce:animate-none" />
    </div>
  );
}

const reducedMotion = (): boolean => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The artifact page, in the frame named `open-artifact-shell` with `open_artifact_shell` and `open_artifact_id` on its
 * address. The frame loads at once under a cover that fades when the page is ready.
 */
export function PageFrame() {
  const boot = useBoot();
  const ready = useShell((state) => state.pageReady);
  const [covered, setCovered] = useState(true);
  // Computed once: the `comment` thread moves from the Shell's address to the page's.
  const src = useMemo(() => pageAddress(boot, location.href, embedded), [boot]);
  useEffect(() => {
    const rest = addressWithoutThread(location.href);
    if (rest) history.replaceState(history.state, '', rest);
  }, []);
  useEffect(() => {
    if (!ready) {
      setCovered(true);
      return;
    }
    frameShown();
    const timer = setTimeout(() => setCovered(false), reducedMotion() ? 0 : COVER_FADE_MS);
    return () => clearTimeout(timer);
  }, [ready]);
  const origin = pageOriginOf(boot.page, location.href);
  const ref = useCallback((element: HTMLIFrameElement | null): void => {
    attachFrame(element, origin);
    if (element) markPhase('oa:frame-src');
  }, [origin]);
  const onLoad = (): void => {
    frameLoaded();
    markPhase('oa:frame-load');
  };
  if (!src) return null;
  return (
    <>
      <iframe
        ref={ref}
        name={SHELL_FRAME_NAME}
        src={src}
        title={boot.title}
        allow="clipboard-read; clipboard-write; fullscreen"
        // A restricted static type's page (installed, or a project not trusted yet): no popups, no top navigation.
        sandbox={boot.pageKind === 'static' && boot.sandbox ? boot.sandbox : undefined}
        onLoad={onLoad}
        inert={!ready}
        className="absolute inset-0 size-full border-0 bg-surface"
      />
      {(!ready || covered) && <PageLoading hiding={ready} />}
    </>
  );
}

/** Made but not written yet: hand it to an agent (a new session through the host, or by copying the prompt). */
export function EmptyArtifact() {
  const boot = useBoot();
  const agent = useAgentName();
  // A cloud host has no folder to name and no session to start here.
  const cloud = !!useCloud();
  const sessions = useShell((state) => !!state.host?.caps.sessions) && !cloud;
  const [status, setStatus] = useState('');
  const prompt = boot.prompt ?? '';
  return (
    <div className="max-w-2xl px-8 py-10">
      <h2 className="mb-2 mt-0 text-base font-semibold">{t('emptyTitle')}</h2>
      <p className="mb-3 mt-0 text-fg-muted">{cloud ? t('emptyBodyCloud', { type: boot.typeTitle }) : t('emptyBody', { type: boot.typeTitle, root: boot.root })}</p>
      <textarea
        readOnly
        value={prompt}
        aria-label={t('emptyTitle')}
        className="block min-h-28 w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2.5 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
      />
      <div className="mt-2.5 flex flex-wrap gap-2">
        {sessions ? (
          <Button
            size="lg"
            variant="primary"
            icon={<Play className="size-3.5" />}
            onClick={() => {
              newSession(prompt);
              setStatus(t('sentToSession'));
            }}
          >
            {t('startSession', { agent })}
          </Button>
        ) : null}
        <Button
          size="lg"
          icon={<Copy className="size-3.5" />}
          onClick={async () => {
            await copyText(prompt);
            setStatus(t('promptCopied'));
          }}
        >
          {t('copy')}
        </Button>
      </div>
      <p role="status" className="mt-2 text-xs text-fg-muted">
        {status}
      </p>
    </div>
  );
}

/** The page cannot open: why, where its folder is, and a way to ask the agent to look. */
export function ProblemState() {
  const boot = useBoot();
  const agent = useAgentName();
  const status = useShell((state) => state.askStatus);
  const canRetry = useShell((state) => state.canRetry);
  const cloud = !!useCloud();
  // Only a cloud host hides it by role (elsewhere it shows as it always did).
  const askable = useMayAsk() || !cloud;
  const problem = boot.problem || t('noPage');
  return (
    <div className="max-w-2xl px-8 py-10">
      <h2 className="mb-2 mt-0 flex items-center gap-2 text-base font-semibold">
        <TriangleAlert className="size-4 text-warning" />
        {t('problemTitle')}
      </h2>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">{problem}</pre>
      {cloud ? null : <p className="text-xs text-fg-muted">{t('folder', { root: boot.root })}</p>}
      <div className="flex flex-wrap gap-2">
        {canRetry ? (
          <Button size="lg" variant="primary" icon={<RotateCw className="size-3.5" />} onClick={() => void retryBoot()}>
            {t('tryAgain')}
          </Button>
        ) : null}
        {askable ? (
          <Button size="lg" icon={<MessageSquare className="size-3.5" />} onClick={() => void ask(t('problemAsk', { problem }), agent)}>
            {t('askToLook', { agent })}
          </Button>
        ) : null}
      </div>
      <p role="status" className="mt-2 text-xs text-fg-muted">
        {status}
      </p>
    </div>
  );
}

/** A newer type release wrote the artifact: the page is view-only here, and how to update. */
function ReadOnlyNotice() {
  const boot = useBoot();
  const unknown = '?';
  return (
    <p role="status" className="m-0 flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-xs text-fg-muted">
      <TriangleAlert className="size-3.5 shrink-0 text-warning" />
      {t('readOnlyNewer', { type: boot.typeTitle, release: boot.type_release ?? unknown, version: boot.type_version ?? unknown })}
    </p>
  );
}

/** The page (or the spinner while it is being opened), or the empty or problem state. */
export function Stage() {
  const boot = useBoot();
  const gen = useShell((state) => state.bootGen);
  const content = boot.pending ? (
    <PageLoading />
  ) : boot.empty ? (
    <EmptyArtifact />
  ) : boot.problem || !boot.page ? (
    <ProblemState />
  ) : (
    <PageFrame key={gen} />
  );
  if (boot.read_only && !boot.pending) {
    return (
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ReadOnlyNotice />
        <div className="relative min-h-0 flex-1 overflow-auto">{content}</div>
      </main>
    );
  }
  return <main className="relative min-w-0 flex-1 overflow-auto">{content}</main>;
}
