import { Menu } from '../../kit/menu.tsx';
import { useRovingToolbar } from '../../kit/roving-toolbar.ts';
import { Surface } from '../../kit/surface.tsx';
import { AgentMark } from '../../kit/agent-mark.tsx';
import { Icon } from '../../kit/icon.tsx';
import { Button } from '../../kit/button.tsx';
import type { CaretTarget } from '../../tables/own-filter-bar-view.tsx';
import type { WordsOfLoad } from '../../shell/load-announcer.ts';
import type { MenuOpenChange } from '../sheet-tabs/add-sheet.tsx';
import type { AgentAmongWaysIn } from './ways-in-state.ts';
import * as React from 'react';
import { FILE_UPLOAD_ICON, IMPORT_FILE_SOURCES, type ImportFileSource } from '../../import/file-sources.tsx';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { importFileChoices } from '../../import/csv-file.tsx';
import { AGENT_ASK_PRESSED_MS } from './ways-in-state.ts';
import { useCoarseBarIconSize } from '../bar-buttons.tsx';
import { preventMouseDownDefault } from '../dom-events.ts';
import { ToolbarMenu } from '../format-toolbar.tsx';
import { MenuTriggerButton } from '../menu-trigger.tsx';
import { ANNOUNCEMENT_HOLD_MS } from '../../agent/agent-said-announcer.tsx';
import { LiveAnnouncer } from '../live-announcer.tsx';
import { translateMessage } from '../../i18n/messages.ts';
export interface WaysInImportChoice {
  icon: React.ReactNode;
  name: string;
  /** `'awaited'`: a way the agent offered before, kept in place (drawn disabled) while the offer is away for a moment. */
  onChosen: (() => void) | 'awaited';
}
export interface WaysInImportProps {
  onImportChosen: (choices: typeof importFileChoices) => void;
  filesForAgent?: readonly ImportFileSource[];
  onFileForAgentChosen?: (source: ImportFileSource) => void;
}
export function waysInImportChoices(
  kinds: readonly ImportFileSource[],
  { onImportChosen, filesForAgent = NO_FILES_FOR_AGENT, onFileForAgentChosen }: WaysInImportProps,
): WaysInImportChoice[] {
  let importIcon = <Icon name={FILE_UPLOAD_ICON} size="sm" />;
  if (kinds.length === 0)
    return [
      {
        icon: importIcon,
        name: sheetMessages.importFile(),
        onChosen: (): void => onImportChosen(importFileChoices),
      },
    ];
  return [
    ...importFileChoices.map((importKind) => ({
      icon: importIcon,
      name: importKind.inMenu(),
      onChosen: (): void => onImportChosen([importKind]),
    })),
    ...kinds.map((kind) => ({
      icon: IMPORT_FILE_SOURCES[kind].mark,
      name: IMPORT_FILE_SOURCES[kind].name(),
      onChosen: filesForAgent.includes(kind) ? (): void => onFileForAgentChosen?.(kind) : ('awaited' as const),
    })),
  ];
}
export function createFreshPaintClickGuard() {
  let drawnKey: string | null = null;
  let firstPaintAt = Number.POSITIVE_INFINITY;
  let isNextClickMeant: boolean | null = null;
  let pointerDownAt = 0;
  let lastDroppedAt = Number.NEGATIVE_INFINITY;
  return {
    drawn(key: string) {
      if (key !== drawnKey) firstPaintAt = Number.POSITIVE_INFINITY;
      drawnKey = key;
    },
    paintedAt(timeStamp: number) {
      firstPaintAt = Math.min(firstPaintAt, timeStamp);
    },
    pointerWentDownAt(timeStamp: number) {
      pointerDownAt = timeStamp;
      isNextClickMeant = timeStamp - firstPaintAt >= WAYS_IN_FRESH_PAINT_MS;
    },
    isMouseDownDropped(clickCount: number) {
      if ((clickCount === 2 || clickCount === 3) && pointerDownAt - lastDroppedAt > AGENT_ASK_PRESSED_MS) isNextClickMeant = false;
      let isDropped = isNextClickMeant === false;
      lastDroppedAt = isDropped ? Number.NEGATIVE_INFINITY : pointerDownAt;
      return isDropped;
    },
    pointerWasCanceled() {
      isNextClickMeant = null;
    },
    isClickMeant(clickCount: number) {
      let isMeant = clickCount === 0 || isNextClickMeant !== false;
      isNextClickMeant = null;
      return isMeant;
    },
  };
}
export function useWaysInOverflow(toolbar: HTMLDivElement | null) {
  let [overflows, setOverflows] = React.useState(false);
  let fullWidthRef = React.useRef(0);
  React.useLayoutEffect(() => {
    let sheetFoot = toolbar?.closest('.sheet-foot') ?? null;
    if (toolbar === null || sheetFoot === null || sheetFoot.parentElement === null) return;
    let measure = () => {
      let style = getComputedStyle(toolbar);
      if (!overflows) {
        let buttons = [...toolbar.querySelectorAll(':scope > button')];
        fullWidthRef.current =
          buttons.reduce((total, button) => total + button.getBoundingClientRect().width, 0) +
          (buttons.length - 1) * cssPixels(style, 'column-gap') +
          cssPixels(style, 'padding-left') +
          cssPixels(style, 'padding-right');
      }
      let roomForWaysIn = cssPixels(style, '--sheet-room-for-ways-in');
      if (roomForWaysIn > 0) setOverflows(fullWidthRef.current > roomForWaysIn);
    };
    measure();
    let resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(sheetFoot.parentElement);
    resizeObserver.observe(toolbar);
    let mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(sheetFoot, {
      attributes: true,
      attributeFilter: ['style', 'data-keeps-room-of-pane'],
    });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [toolbar, overflows]);
  return overflows;
}
export interface WaysInToolbarProps extends WaysInImportProps {
  ref: (element: HTMLDivElement | null) => void;
  onAskAgent: AgentAmongWaysIn;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  whatHasCaretAfter: () => CaretTarget;
  onMenuOpenChange: MenuOpenChange;
}
export function WaysInToolbar({
  ref,
  onAskAgent,
  onKeyDown,
  whatHasCaretAfter,
  onMenuOpenChange,
  ...addChoiceProps
}: WaysInToolbarProps) {
  let barIconSize = useCoarseBarIconSize();
  let rovingToolbar = useRovingToolbar();
  let { ref: rovingRef } = rovingToolbar;
  let [toolbarElement, setToolbarElement] = React.useState<HTMLDivElement | null>(null);
  let toolbarRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setToolbarElement(element);
      ref(element);
      rovingRef(element);
    },
    [ref, rovingRef],
  );
  let [keptKinds, setKeptKinds] = React.useState<readonly ImportFileSource[] | null>(null);
  let kinds = keptFilesForAgent(keptKinds, addChoiceProps.filesForAgent ?? NO_FILES_FOR_AGENT);
  if (kinds !== keptKinds) setKeptKinds(kinds);
  let importChoices = waysInImportChoices(kinds, addChoiceProps);
  let isImportFolded = useWaysInOverflow(toolbarElement) && importChoices.length > 1;
  let drawnKey = [
    onAskAgent !== null,
    ...(isImportFolded ? [sheetMessages.importFile()] : importChoices.map(({ name: wayName }) => wayName)),
  ].join();
  let [isImportMenuOpen, setImportMenuOpen] = React.useState(false);
  let toolbarHolderRef = React.useRef<HTMLElement | null>(null);
  let [freshPaintGuard] = React.useState(createFreshPaintClickGuard);
  React.useEffect(() => {
    freshPaintGuard.drawn(drawnKey);
    let frame = requestAnimationFrame(freshPaintGuard.paintedAt);
    return () => cancelAnimationFrame(frame);
  }, [freshPaintGuard, drawnKey]);
  return <Surface elevation="panel" role="toolbar" aria-label={typeof onAskAgent === 'function' ? sheetMessages.agentOrImportOffered() : sheetMessages.importOffered()} className="sheet-ways-in" data-size={barIconSize} {...rovingToolbar} ref={toolbarRef} onKeyDown={(event) => {
      onKeyDown(event);
      rovingToolbar.onKeyDown(event);
    }} onMouseDown={preventMouseDownDefault} onPointerDownCapture={({ timeStamp }) => freshPaintGuard.pointerWentDownAt(timeStamp)} onPointerCancelCapture={freshPaintGuard.pointerWasCanceled} onMouseDownCapture={(event) => {
      if (!freshPaintGuard.isMouseDownDropped(event.detail)) return;
      event.preventDefault();
      event.stopPropagation();
    }} onClickCapture={(event) => {
      if (!freshPaintGuard.isClickMeant(event.detail)) event.stopPropagation();
    }}>{onAskAgent !== null &&
        (<Button variant="ghost" icon={<span className="grid size-4 place-items-center"><AgentMark size={14} /></span>} {...(onAskAgent === 'awaited'
            ? AWAITED_WAY_IN_PROPS
            : {
                onClick: onAskAgent,
              })}><span className="font-normal">{sheetMessages.askAgent()}</span></Button>)}{isImportFolded
        ? (<ToolbarMenu isOpen={isImportMenuOpen} button={<MenuTriggerButton ref={toolbarHolderRef} variant="ghost" icon={<Icon name={FILE_UPLOAD_ICON} size="sm" />} chevron="toolbar"><span className="font-normal">{sheetMessages.importFile()}</span></MenuTriggerButton>} tooltip={null} onOpenChange={(isOpen: boolean, event: Event | null) => {
              setImportMenuOpen(isOpen);
              onMenuOpenChange(isOpen, event);
            }} whatHasCaretAfter={whatHasCaretAfter} toolbar={toolbarHolderRef} side="top" placedBy={{
              align: 'start',
            }}>{importChoices.map(
              ({ icon, name: wayName, onChosen }) =>
                onChosen !== 'awaited' &&
                <Menu.Item key={wayName} icon={icon} onClick={onChosen}>{wayName}</Menu.Item>,
            )}</ToolbarMenu>)
        : importChoices.map(
            ({ icon, name: wayName, onChosen }) =>
              (<Button key={wayName} variant="ghost" icon={icon} {...(onChosen === 'awaited'
                    ? AWAITED_WAY_IN_PROPS
                    : {
                        onClick: onChosen,
                      })}><span className="font-normal">{wayName}</span></Button>),
          )}</Surface>;
}
export interface WaysInHintAnnouncerProps {
  areUp: boolean;
  canAskAgent: boolean;
  /** What tells whether words about the load are yet to be said. */
  wordsOfLoad: Pick<WordsOfLoad, 'areWordsToCome' | 'onChanged'>;
}
export function WaysInHintAnnouncer({ areUp, canAskAgent, wordsOfLoad }: WaysInHintAnnouncerProps) {
  let areWordsToCome = React.useSyncExternalStore(
    React.useCallback((onChange: () => void) => wordsOfLoad.onChanged(onChange), [wordsOfLoad]),
    () => wordsOfLoad.areWordsToCome(),
    () => false,
  );
  let isHintDue = areUp && !areWordsToCome;
  let [isHintOver, setHintOver] = React.useState(false);
  React.useEffect(() => {
    if (!isHintDue) return;
    let timer = setTimeout(() => setHintOver(true), ANNOUNCEMENT_HOLD_MS);
    return () => {
      clearTimeout(timer);
      setHintOver(true);
    };
  }, [isHintDue]);
  return <LiveAnnouncer words={isHintDue && !isHintOver && waysInF6Hint(canAskAgent)} />;
}
export const waysInF6Hint = (canAskAgent: boolean) =>
  canAskAgent
    ? translateMessage({
        defaultMessage: 'Press F6 to ask Agent to fill this sheet, or to import a file.',
        id: 'r5UEkkYQT5',
      })
    : translateMessage({
        defaultMessage: 'Press F6 to import a file.',
        id: 'Bsw9ujQHVi',
      });
const NO_FILES_FOR_AGENT: readonly ImportFileSource[] = [];
/** The agent's file ways stay put once drawn while they're offered again soon (drawn as awaited meanwhile). */
export const keptFilesForAgent = (
  keptKinds: readonly ImportFileSource[] | null,
  filesForAgent: readonly ImportFileSource[],
): readonly ImportFileSource[] =>
  keptKinds !== null && (keptKinds.length > 0 || filesForAgent.length === 0) ? keptKinds : filesForAgent;
export const WAYS_IN_FRESH_PAINT_MS = 400;
export const cssPixels = (style: CSSStyleDeclaration, property: string) => {
  let pixels = Number.parseFloat(style.getPropertyValue(property));
  return Number.isNaN(pixels) ? 0 : pixels;
};
export const AWAITED_WAY_IN_PROPS = {
  className: 'invisible',
  disabled: true,
};
