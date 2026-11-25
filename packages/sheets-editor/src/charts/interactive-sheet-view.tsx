import * as React from 'react';
import { flushSync } from 'react-dom';
import type { CellWrittenFromAnInteractive } from '@open-artifact/sheets-core';
import { Button } from '../kit/button.tsx';
import { Skeleton } from '../kit/skeleton.tsx';
import { Toolbar } from '../kit/toolbar.tsx';
import { asThemeMode, VIEWER_FONT_ATTRIBUTE } from '../shell/root-theme.ts';
import { useDocumentElementAttribute } from '../dom/use-document-element-attribute.ts';
import { pageInputHoldBack } from '../debug/input-hold-back.ts';
import { HAS_PERSON_ATTRIBUTE, holdFocusLeftChecksForATick } from '../grid/focus-left.ts';
import { zoomedStyle } from '../grid/zoom.ts';
import { useCoarseBarIconSize } from '../ui/bar-buttons.tsx';
import { stripFrameTimestampParams } from '../shell/frame-token.ts';
import type { InteractiveBeingStarted } from '../app/interactive-being-started.ts';
import type { InteractiveSheet } from '../state/places.ts';
import {
  interactiveFixAsk,
  interactiveSheetMessages,
  interactiveTroubleWords,
  type InteractiveTroubleWhy,
} from '../messages/import.ts';
import type { ChartInputs, ChartLook } from '../chart-frame/messages.ts';
import type { PageKeyFromInteractive, PageToInteractive } from '../interactive-frame/messages.ts';
import type { ChartCodeSource, WhyNoChartCode } from './chart-code.ts';
import type { ChartFrameDocumentSource } from './frame-document.ts';
import { CHART_FRAME_PORT_MESSAGE, type ChartFrameFault } from './frame-messages.ts';
import { createEmbedKeyboard, type EmbedKeyboard } from './embed-keyboard.ts';
import { createInteractiveWrites, parseInteractiveFrameReply, type InteractiveWrites } from './interactive-frame-talk.ts';
import { PlacedViewFixContext, PlacedViewFixOffer, type PlacedViewFix } from './fix-of-placed-view.tsx';

/** What the page runs interactive sheets with: their code, the frame's page, and the note of the one being started. */
export interface InteractivesRunOn {
  code: ChartCodeSource;
  frameDocument: ChartFrameDocumentSource;
  beingStarted: InteractiveBeingStarted;
  /** Told when an interactive is shown, or a problem is shown in its place. */
  count?: (event: InteractiveCount) => void;
}

export type InteractiveCount = 'interactive_shown' | 'interactive_not_shown';

/** Why an interactive's frame stopped: what its frame told, or that it broke the rules of the port. */
export type InteractiveFault = ChartFrameFault | 'misbehaved';

/** A key the frame handed back that the page acts on; leaving is the frame's own. */
export type InteractiveKeyForPage = Exclude<PageKeyFromInteractive, 'leave'>;

/** Writes cells from an interactive; `whenWritten` once the sheet has taken them. */
export type InteractiveWrite = (cells: CellWrittenFromAnInteractive[], whenWritten: () => void) => void;

type InteractiveStands = 'onItsWay' | 'drawn' | InteractiveFault;

interface InteractiveStand {
  of: string | null;
  stands: InteractiveStands;
  failedWith?: ChartInputs;
}

interface InteractiveTalk {
  send: (message: PageToInteractive) => void;
  writes: InteractiveWrites;
}

interface InteractiveFrameProps {
  frameDocument: string;
  artifact: string;
  inputs: ChartInputs;
  name: string;
  canWrite: boolean;
  keyboard: EmbedKeyboard;
  isDrawn: boolean;
  zoom: number;
  onWrite: InteractiveWrite;
  onKeyForPage: (key: PageKeyFromInteractive) => void;
  onDrawn: () => void;
  onFailed: (fault: InteractiveFault) => void;
  onGoneWithKeyboard: () => void;
}

export const INTERACTIVE_EMBED_ID = 'interactive';
export const INTERACTIVE_CHECK_EVERY_MS = 1000;
export const INTERACTIVE_CHECKS_UNANSWERED = 10;
export const INTERACTIVE_CHECKS_TO_DRAW = 40;
export const INTERACTIVE_ACTIVATION_WAIT_MS = 25;
export const INTERACTIVE_LEFT_WAIT_MS = 100;
export const INTERACTIVE_ACTIVATION_LASTS_MS = 60000;
export const INTERACTIVE_TOUCH_LASTS_MS = 1500;
export const INTERACTIVE_MESSAGES_PER_CHECK = 500;
export const isUserActivationActive = (): boolean => canTellUserActivation() && navigator.userActivation.isActive;
export const canTellUserActivation = (): boolean => 'userActivation' in navigator;

export function InteractiveFrame({
  frameDocument,
  artifact,
  inputs,
  name,
  canWrite,
  keyboard,
  isDrawn,
  zoom,
  onWrite,
  onKeyForPage,
  onDrawn,
  onFailed,
  onGoneWithKeyboard,
}: InteractiveFrameProps) {
  let [theme, viewerFont] = [asThemeMode(useDocumentElementAttribute('data-mode')), useDocumentElementAttribute(VIEWER_FONT_ATTRIBUTE)];
  let look = React.useMemo(
    (): ChartLook => ({
      theme,
      viewerFont,
    }),
    [theme, viewerFont],
  );
  let holderRef = React.useRef<HTMLDivElement>(null);
  let frameRef = React.useRef<HTMLIFrameElement | null>(null);
  let talkRef = React.useRef<InteractiveTalk | null>(null);
  let drawMessage = React.useEffectEvent(
    (): Extract<PageToInteractive, { kind: 'draw' }> => ({
      kind: 'draw',
      artifact,
      inputs,
      look,
      canWrite,
    }),
  );
  let canWriteNow = React.useEffectEvent(() => canWrite && !pageInputHoldBack.isHeldBack());
  let write = React.useEffectEvent(onWrite);
  let keyForPage = React.useEffectEvent(onKeyForPage);
  let drawn = React.useEffectEvent(onDrawn);
  let failed = React.useEffectEvent(onFailed);
  let goneWithKeyboard = React.useEffectEvent(onGoneWithKeyboard);
  React.useLayoutEffect(() => {
    let frame = document.createElement('iframe');
    frame.className = 'sheet-interactive-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.tabIndex = -1;
    frame.ariaHidden = 'true';
    frame.srcdoc = frameDocument;
    frameRef.current = frame;
    let { port1: port, port2: framePort } = new MessageChannel();
    let send = (message: PageToInteractive) =>
      port.postMessage(message, {
        transfer: [],
      });
    let isGone = false;
    let fail = (fault: InteractiveFault) => {
      if (!isGone) flushSync(() => failed(fault));
    };
    let pressed = (at: number) => {
      let ageMs = Math.max(0, Date.now() - at);
      if (keyboard.reported(INTERACTIVE_EMBED_ID, performance.now() - ageMs, ageMs)) keyboard.enter(INTERACTIVE_EMBED_ID);
      noteActivation();
      if (canWriteNow() && isActivationFresh()) talkRef.current?.writes.release();
    };
    let [activatedAt, touchedAt] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    let isActivationAwaited = false;
    let noteActivation = () => {
      if (keyboard.owner() !== INTERACTIVE_EMBED_ID || !document.hasFocus()) return;
      touchedAt = performance.now();
      if (isUserActivationActive()) activatedAt = touchedAt;
    };
    let isActivationFresh = () =>
      performance.now() - activatedAt < INTERACTIVE_ACTIVATION_LASTS_MS && performance.now() - touchedAt < INTERACTIVE_TOUCH_LASTS_MS;
    let [checksUnanswered, messagesThisCheck] = [0, 0];
    let checksToDraw = INTERACTIVE_CHECKS_TO_DRAW;
    let checkTimer = setInterval(() => {
      messagesThisCheck = 0;
      noteActivation();
      checksUnanswered = document.hidden ? 0 : checksUnanswered + 1;
      if (!document.hidden) checksToDraw -= 1;
      if (checksUnanswered > INTERACTIVE_CHECKS_UNANSWERED || checksToDraw < 0) fail('tookTooLong');
      else
        send({
          kind: 'areYouThere',
        });
    }, INTERACTIVE_CHECK_EVERY_MS);
    port.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
      let reply = parseInteractiveFrameReply(data);
      messagesThisCheck += 1;
      if (reply === null || messagesThisCheck > INTERACTIVE_MESSAGES_PER_CHECK) return fail('misbehaved');
      switch (reply.kind) {
        case 'here':
          checksUnanswered = 0;
          return;
        case 'drawn':
          checksToDraw = Number.POSITIVE_INFINITY;
          return drawn();
        case 'failed':
          return fail(reply.fault);
        case 'pressed': {
          isActivationAwaited = !isUserActivationActive();
          if (!isActivationAwaited) pressed(reply.at);
          else setTimeout(() => !isGone && isUserActivationActive() && pressed(reply.at), INTERACTIVE_ACTIVATION_WAIT_MS);
          return;
        }
        case 'keyboardLost':
          setTimeout(
            () =>
              keyboard.owner() !== INTERACTIVE_EMBED_ID &&
              send({
                kind: 'left',
              }),
            INTERACTIVE_LEFT_WAIT_MS,
          );
          return keyboard.blurred(INTERACTIVE_EMBED_ID);
        case 'keyForPage':
          return keyboard.owner() === INTERACTIVE_EMBED_ID ? keyForPage(reply.key) : undefined;
        case 'write':
          noteActivation();
          if (canWriteNow() && isActivationFresh()) return talkRef.current?.writes.write(reply.cells, reply.nth);
          if (canWriteNow() && isActivationAwaited) return talkRef.current?.writes.hold(reply.cells, reply.nth);
          return talkRef.current?.writes.write([], reply.nth);
      }
    });
    port.start();
    frame.addEventListener('load', () => {
      if (talkRef.current !== null) return fail('misbehaved');
      let draw = drawMessage();
      talkRef.current = {
        send,
        writes: createInteractiveWrites(draw.inputs, {
          tellFrame: send,
          write: (...args) => write(...args),
          later: (act, ms) => void setTimeout(act, ms),
        }),
      };
      frame.contentWindow?.postMessage(CHART_FRAME_PORT_MESSAGE, '*', [framePort]);
      return send(draw);
    });
    let onWindowMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.contentWindow) return;
      fail('misbehaved');
    };
    window.addEventListener('message', onWindowMessage);
    window.addEventListener('messageerror', onWindowMessage);
    let unmount = keyboard.mount(INTERACTIVE_EMBED_ID, frame, () =>
      send({
        kind: 'enteredByKey',
      }),
    );
    holderRef.current?.append(frame);
    return () => {
      isGone = true;
      let hadKeyboard = keyboard.owner() === INTERACTIVE_EMBED_ID && document.hasFocus();
      clearInterval(checkTimer);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('messageerror', onWindowMessage);
      talkRef.current?.writes.end();
      talkRef.current = null;
      port.close();
      unmount();
      frame.remove();
      frameRef.current = null;
      if (hadKeyboard)
        setTimeout(() => {
          holdFocusLeftChecksForATick();
          goneWithKeyboard();
        });
    };
  }, [frameDocument, keyboard]);
  React.useLayoutEffect(() => frameRef.current?.setAttribute('title', name), [name]);
  React.useLayoutEffect(() => talkRef.current?.writes.inputsAre(inputs), [inputs]);
  React.useEffect(
    () =>
      talkRef.current?.send({
        kind: 'lookChanged',
        look,
      }),
    [look],
  );
  React.useEffect(
    () =>
      talkRef.current?.send({
        kind: 'canWriteChanged',
        canWrite,
      }),
    [canWrite],
  );
  return <div ref={holderRef} className="size-full origin-top-left" style={zoomedStyle(zoom)} data-is-on-show={isDrawn} />;
}

interface InteractiveTroubleProps {
  why: InteractiveTroubleWhy;
  onShown: () => void;
  onRunAgain?: () => void;
}

export function InteractiveTrouble({ why, onShown, onRunAgain }: InteractiveTroubleProps) {
  let { title, advice } = interactiveTroubleWords(why);
  let fixOffer = PlacedViewFixOffer(interactiveFixAsk(why));
  let shown = React.useEffectEvent(onShown);
  React.useEffect(() => shown(), []);
  return <div className="flex size-full flex-col items-center justify-center gap-sm p-md text-center"><output className="flex flex-col gap-xs"><span className="text-body font-medium text-primary">{title}</span>{fixOffer === null && <span className="text-footnote text-secondary">{advice}</span>}</output>{fixOffer}{onRunAgain !== undefined && <Button variant="secondary" size="sm" onClick={onRunAgain}>{interactiveSheetMessages.runAgain()}</Button>}</div>;
}

/** What the section and the running interactive are given alike. */
interface InteractiveSheetShared {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  runsOn: InteractivesRunOn | null;
  interactive: InteractiveSheet;
  isViewOnly: boolean;
  zoom: number;
  onWrite: InteractiveWrite;
  onKeyForPage: (key: InteractiveKeyForPage) => void;
  onGoneWithKeyboard: () => void;
}

interface InteractiveRunningProps extends InteractiveSheetShared {
  runsOn: InteractivesRunOn;
  nodeId: string;
  inputs: ChartInputs;
  sectionId: string;
  enterRef: React.RefObject<((keyAt?: number) => void) | null>;
}

export function InteractiveRunning({
  sectionRef,
  runsOn: { code, frameDocument: frameDocumentSource, beingStarted, count },
  interactive: { name },
  nodeId,
  inputs,
  isViewOnly,
  zoom,
  sectionId,
  enterRef,
  onWrite,
  onKeyForPage,
  onGoneWithKeyboard,
}: InteractiveRunningProps) {
  let followCode = React.useCallback((listener: () => void) => code.follow(nodeId, listener), [code, nodeId]);
  let compiled = React.useSyncExternalStore(followCode, () => code.of(nodeId));
  let frameDocument = React.useSyncExternalStore(frameDocumentSource.follow, frameDocumentSource.now);
  let artifact = compiled.kind === 'compiled' ? compiled.artifact : null;
  let [stand, setStand] = React.useState(
    (): InteractiveStand => ({
      of: null,
      stands: beingStarted.wasLeftStarting(nodeId) ? 'tookTooLong' : 'onItsWay',
    }),
  );
  let stands = stand.of === null || stand.of === artifact ? stand.stands : 'onItsWay';
  let trouble = stands === 'onItsWay' || stands === 'drawn' ? null : stands;
  let focusSection = () =>
    sectionRef.current?.focus({
      preventScroll: true,
    });
  let stopForTakingCaret = React.useEffectEvent(() => {
    holdFocusLeftChecksForATick();
    flushSync(() =>
      setStand({
        of: artifact,
        stands: 'tookCaret',
      }),
    );
  });
  let [keyboard] = React.useState(() =>
    createEmbedKeyboard({
      home: () => document.getElementById(sectionId),
      giveBack: (element) =>
        element.focus({
          preventScroll: true,
        }),
      onStop: () => stopForTakingCaret(),
      onAdrift() {},
      onPressOutside() {},
      onLeft() {},
      onOwner(owner) {
        let section = document.getElementById(sectionId);
        section?.toggleAttribute(HAS_PERSON_ATTRIBUTE, owner !== null);
        let frame = section?.querySelector('iframe') ?? null;
        if (frame !== null) frame.ariaHidden = owner === null ? 'true' : null;
      },
    }),
  );
  let isDrawn = stands === 'drawn';
  React.useEffect(
    () => (
      (enterRef.current = isDrawn ? (keyAt?: number) => keyboard.enter(INTERACTIVE_EMBED_ID, keyAt) : null),
      () => void (enterRef.current = null)
    ),
    [enterRef, isDrawn, keyboard],
  );
  let artifactToRun = artifact !== null && trouble === null && typeof frameDocument === 'object' && frameDocument !== null ? artifact : null;
  React.useLayoutEffect(() => {
    if (artifactToRun === null) return;
    beingStarted.starts(nodeId);
    let onVisibilityChange = () => (document.hidden ? beingStarted.hasNotFrozen() : beingStarted.starts(nodeId));
    window.addEventListener('pagehide', beingStarted.hasNotFrozen);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', beingStarted.hasNotFrozen);
      beingStarted.hasNotFrozen();
    };
  }, [artifactToRun, nodeId, beingStarted]);
  React.useEffect(() => {
    if (isDrawn) count?.('interactive_shown');
  }, [isDrawn, count]);
  let countNotShown = () => count?.('interactive_not_shown');
  if (compiled.kind === 'none') return <InteractiveTrouble why={INTERACTIVE_CODE_TROUBLES[compiled.why]} onShown={countNotShown} />;
  if (trouble !== null) {
    let runAgainSoon = () =>
      setStand({
        of: artifact,
        stands: 'onItsWay',
      });
    if (INTERACTIVE_TROUBLES_FROM_DATA.has(trouble) && stand.failedWith !== inputs) runAgainSoon();
    let canRunAgain = trouble === 'tookCaret' || trouble === 'tookTooLong';
    let runAgain = () => {
      focusSection();
      runAgainSoon();
    };
    return <InteractiveTrouble why={INTERACTIVE_FRAME_TROUBLES[trouble]} onShown={countNotShown} onRunAgain={canRunAgain ? runAgain : undefined} />;
  }
  if (frameDocument === 'notFetched' || !stripFrameTimestampParams()) return <InteractiveTrouble why="notLoaded" onShown={countNotShown} />;
  return <>{artifact !== null &&
      frameDocument !== null &&
      <InteractiveFrame key={artifact} frameDocument={frameDocument.text} artifact={artifact} inputs={inputs} name={name} canWrite={!isViewOnly && canTellUserActivation()} keyboard={keyboard} isDrawn={isDrawn} zoom={zoom} onWrite={onWrite} onKeyForPage={(key) => (keyboard.release(), focusSection(), key === 'leave' ? undefined : onKeyForPage(key))} onDrawn={() =>
          setStand({
            of: artifact,
            stands: 'drawn',
          })} onFailed={(fault) =>
          setStand({
            of: artifact,
            stands: fault,
            failedWith: inputs,
          })} onGoneWithKeyboard={onGoneWithKeyboard} />}{!isDrawn && <InteractiveOnItsWay />}</>;
}

interface InteractiveSheetSectionProps extends InteractiveSheetShared {
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  fix: PlacedViewFix;
  wasKeyPressedLast: () => boolean;
}

export function InteractiveSheetSection({ onKeyDown, fix, wasKeyPressedLast, ...rest }: InteractiveSheetSectionProps) {
  let { sectionRef, runsOn, interactive } = rest;
  let { code } = interactive;
  let [sectionId, wayInId] = [React.useId(), React.useId()];
  let [isFocusByKey, setIsFocusByKey] = React.useState(false);
  let enterRef = React.useRef<((keyAt?: number) => void) | null>(null);
  let enterSoon = (at: number) => void setTimeout(() => enterRef.current?.(at));
  return <div role="presentation" className="absolute inset-0" onKeyDown={(event) => {
      if (!((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) && event.target === sectionRef.current) || enterRef.current === null)
        return onKeyDown(event);
      event.preventDefault();
      return enterSoon(event.timeStamp);
    }} onFocus={() => setIsFocusByKey(wasKeyPressedLast())} onKeyUp={({ key }) => (key === 'Tab' || key === 'Escape') && setIsFocusByKey(true)} onClick={(event) => event.target === sectionRef.current && enterSoon(event.timeStamp)}><div id={sectionId} role="tabpanel" ref={sectionRef} className="sheet-interactive" tabIndex={0} aria-label={interactive.name} aria-roledescription={interactiveSheetMessages.interactive()} aria-describedby={wayInId} data-is-focus-by-key={isFocusByKey}><span id={wayInId} hidden>{interactiveSheetMessages.wayIn()}</span><PlacedViewFixContext value={fix}>{code.kind === 'none'
          ? <InteractiveTrouble why={code.why === 'tooMuchToRead' ? 'tooMuchData' : 'cantBeShown'} onShown={() => runsOn?.count?.('interactive_not_shown')} />
          : runsOn === null
            ? <InteractiveOnItsWay />
            : React.createElement(InteractiveRunning, {
                ...rest,
                key: code.nodeId,
                runsOn,
                nodeId: code.nodeId,
                inputs: code.inputs,
                sectionId,
                enterRef,
              })}</PlacedViewFixContext></div></div>;
}

/** What the person chose on the interactive sheet's bar. */
export type InteractiveSheetBarChoice = 'interactiveResetChosen' | 'interactiveSaveAsDefaultChosen';

interface InteractiveSheetBarProps {
  ref?: React.Ref<HTMLDivElement>;
  canBeReset: boolean;
  hasDefaultsToSave: boolean;
  comment: React.ReactNode;
  onChosen: (kind: InteractiveSheetBarChoice) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
}

export function InteractiveSheetBar({ ref, canBeReset, hasDefaultsToSave, comment, onChosen, onKeyDown }: InteractiveSheetBarProps) {
  return <div className="sheet-context-bar" data-stands="footBar"><div className="sheet-scroller" data-size={useCoarseBarIconSize()}><div ref={ref} role="presentation" className="sheet-row-of-tools w-max min-w-full" onKeyDown={onKeyDown}><Toolbar flush className="py-0" label={interactiveSheetMessages.bar()} divider={false}><Button variant="ghost" disabled={!canBeReset} onClick={() => onChosen('interactiveResetChosen')}>{interactiveSheetMessages.reset()}</Button><Button variant="ghost" disabled={!hasDefaultsToSave} onClick={() => onChosen('interactiveSaveAsDefaultChosen')}>{interactiveSheetMessages.saveAsDefault()}</Button>{comment !== null && <span data-before="end" data-after="end" className="flex flex-none">{comment}</span>}</Toolbar></div></div></div>;
}

export const INTERACTIVE_CODE_TROUBLES: Record<WhyNoChartCode, InteractiveTroubleWhy> = {
  notPublished: 'cantBeShown',
  notCompiled: 'cantBeShown',
  notFetched: 'notLoaded',
  tookCaret: 'notLoaded',
  anotherTookCaret: 'notLoaded',
  tookTooLong: 'cantBeShown',
};
export const INTERACTIVE_FRAME_TROUBLES: Record<InteractiveFault, InteractiveTroubleWhy> = {
  notAModule: 'cantBeShown',
  threw: 'cantBeShown',
  misbehaved: 'cantBeShown',
  inputMissing: 'cantBeShown',
  tooManyRows: 'tooMuchData',
  notDrawnInSheets: 'cantBeShown',
  tookTooLong: 'stoppedAnswering',
  tookCaret: 'tookKeyboard',
};
export const INTERACTIVE_TROUBLES_FROM_DATA: ReadonlySet<InteractiveFault> = new Set<InteractiveFault>(['threw', 'inputMissing', 'tooManyRows']);
export const InteractiveOnItsWay = () => <div aria-hidden className="sheet-interactive-on-its-way"><Skeleton decorative width="30%" className="text-heading" /><Skeleton decorative width="60%" /><Skeleton decorative width="45%" /></div>;

