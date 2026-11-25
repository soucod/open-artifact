import { ContextMenu } from '../../kit/context-menu.tsx';
import { Menu } from '../../kit/menu.tsx';
import { AgentMark } from '../../kit/agent-mark.tsx';
import * as React from 'react';
import type { ReactNode } from 'react';
import type { MenuCommand } from '../search-menu/matching.ts';
import type { AskForCommands } from '../ask-for-commands.ts';
import type { AnchorOnPage } from '../../chips/people-list-view.tsx';
import type { ConditionalFormatsView } from '../../view/page-view.ts';
import type { MenuFieldEntered } from '../menu-with-field.tsx';
import type { HandymanAnswered, HandymanState } from './handyman-state.ts';
import {
  handymanReducer,
  HANDYMAN_AT_REST,
  isHandymanEmptyHanded,
  handymanEnterAction,
  handymanSections,
  hasAnswerSettled,
  hasRuleSettled,
} from './handyman-state.ts';
import { commandsOfferedToAgent, commandsNamedByAgent } from '../search-menu/command-groups.ts';
import { RULE_FROM_WORDS_COMMAND, RULE_FROM_WORDS_COMMAND_ID, MAX_COMMANDS_NAMED } from '../commands-from-words.ts';
import { commandsFoundByWords } from '../search-menu/matching.ts';
import { toolSearchMessages } from '../../messages/tool-search-words.ts';
import { joinWithDots, CONDITIONAL_FORMATTING_WORDS, rulesReadyHint } from '../../messages/conditional-format.ts';
import { AgentWritingRow } from '../../agent/agent-rows.tsx';
import { CommandRows } from '../menu-with-field.tsx';
import { RuleOfferMenuItem } from '../../format/conditional/ask-list.tsx';
/** The agent that finds tools for the words typed in the menu, and what the menu tells it. */
export interface Handyman {
  state: HandymanState;
  ask(words: string, commands: readonly MenuCommand[], canMakeRule: boolean): void;
  stop(): void;
  noteTyped(typed: string): void;
  noteRowTaken(id: string): void;
  noteRuleLetGo(): void;
}
export function useHandyman(
  askForCommands: AskForCommands,
  isMenuOpen: boolean,
  anchor: AnchorOnPage,
  onRuleAskedInWords: (words: string) => void,
  rules: ConditionalFormatsView | null,
): Handyman {
  const [state, dispatch] = React.useReducer(handymanReducer, HANDYMAN_AT_REST);
  const abortRef = React.useRef<AbortController | null>(null);
  const askCountRef = React.useRef(0);
  const [menuSeen, setMenuSeen] = React.useState({
    isMenuOpen,
    anchorOfMenu: anchor,
  });
  if (menuSeen.isMenuOpen !== isMenuOpen || menuSeen.anchorOfMenu !== anchor) {
    setMenuSeen({
      isMenuOpen,
      anchorOfMenu: anchor,
    });
    dispatch({
      kind: 'stopped',
    });
  }
  let isAsking = state.is === 'asking';
  React.useEffect(() => {
    if (isAsking) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [isAsking]);
  React.useEffect(() => () => abortRef.current?.abort(), []);
  let ruleWords = state.is === 'answered' && state.makesRule ? state.words : null;
  React.useEffect(() => {
    if (ruleWords !== null) onRuleAskedInWords(ruleWords);
  }, [ruleWords, onRuleAskedInWords]);
  let isRuleOffered = rules !== null && rules.offer !== null;
  let isRuleNotWritten = rules !== null && !isRuleOffered && rules.agent !== 'writes' && rules.agent !== 'isIdle';
  React.useEffect(() => {
    if (isRuleOffered)
      dispatch({
        kind: 'ruleStands',
        as: {
          is: 'written',
          landedAtMs: nowMs(),
        },
      });
    else
      dispatch({
        kind: 'ruleStands',
        as: {
          is: isRuleNotWritten ? 'notWritten' : 'awaited',
        },
      });
  }, [isRuleOffered, isRuleNotWritten]);
  let isMouseRef = React.useRef(true);
  React.useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = ({ pointerType }: PointerEvent) => {
      isMouseRef.current = pointerType === 'mouse';
      if (pointerType !== 'mouse')
        dispatch({
          kind: 'pointerMoved',
        });
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isMenuOpen]);
  let heedsPointer = state.is !== 'answered' || state.heedsPointer;
  React.useEffect(() => {
    if (heedsPointer) return;
    let firstPoint: { x: number; y: number } | null = null;
    const onPointerMove = ({ clientX, clientY, movementX, movementY }: PointerEvent) => {
      const hasMoved = movementX !== 0 || movementY !== 0 || (firstPoint !== null && (clientX !== firstPoint.x || clientY !== firstPoint.y));
      firstPoint ??= {
        x: clientX,
        y: clientY,
      };
      if (hasMoved)
        dispatch({
          kind: 'pointerMoved',
        });
    };
    document.addEventListener('pointermove', onPointerMove);
    return () => document.removeEventListener('pointermove', onPointerMove);
  }, [heedsPointer]);
  return {
    state,
    ask(words, commands, canMakeRule) {
      abortRef.current?.abort();
      const { signal } = (abortRef.current = new AbortController());
      const ask = (askCountRef.current += 1);
      dispatch({
        kind: 'asked',
        words,
        ask,
      });
      const offered = [...commandsOfferedToAgent(commands), ...(canMakeRule ? [RULE_FROM_WORDS_COMMAND] : [])];
      askForCommands(words.trim(), offered, signal).then(
        (answer) => {
          dispatch({
            kind: 'answered',
            ask,
            atMs: nowMs(),
            isUnderMouse: isMouseRef.current,
            commands: commandsNamedByAgent(commands, answer),
            makesRule: canMakeRule && answer.includes(RULE_FROM_WORDS_COMMAND_ID),
            foundByWords: commandsFoundByWords(commands, words, toolSearchMessages.littleWords(), MAX_COMMANDS_NAMED),
          });
          return;
        },
        () =>
          dispatch({
            kind: 'gaveNoAnswer',
            ask,
          }),
      );
    },
    stop: () =>
      dispatch({
        kind: 'stopped',
      }),
    noteTyped: (typed) =>
      dispatch({
        kind: 'typed',
        typed,
      }),
    noteRowTaken: (id) =>
      dispatch({
        kind: 'rowTaken',
        id,
      }),
    noteRuleLetGo: () =>
      dispatch({
        kind: 'ruleLetGo',
      }),
  };
}
export function handymanStatusWords(
  state: HandymanState,
  rules: ConditionalFormatsView | null,
  commandCountWords: (count: number) => string,
): string | null {
  switch (state.is) {
    case 'resting':
      return null;
    case 'asking':
      return toolSearchMessages.findingTools();
    case 'failed':
      return toolSearchMessages.couldNotSuggest();
    case 'answered': {
      if (isHandymanEmptyHanded(state)) return toolSearchMessages.noTool();
      const parts = state.commands.length > 0 ? [commandCountWords(state.commands.length)] : [];
      return joinWithDots(state.makesRule ? [...parts, handymanRuleWords(state, rules)] : parts);
    }
  }
}
export function handymanRuleWords({ rule }: Pick<HandymanAnswered, 'rule'>, rules: ConditionalFormatsView | null) {
  if (rule.is === 'notWritten') return CONDITIONAL_FORMATTING_WORDS.rulesNotWritten();
  const offeredCount = rules?.offer?.each.length;
  return rule.is === 'awaited' || offeredCount === undefined ? CONDITIONAL_FORMATTING_WORDS.writingRules() : rulesReadyHint(offeredCount);
}
export function enterOnHandyman(
  { state, noteRowTaken }: Pick<Handyman, 'state' | 'noteRowTaken'>,
  takeCommand: (command: MenuCommand, isByKey: boolean) => void,
  keepRule: () => void,
  askAgain: () => void,
): MenuFieldEntered {
  const enterAction = handymanEnterAction(state, handymanSections(state, noteRowTaken), nowMs());
  if (enterAction.does === 'keepRule') keepRule();
  if (enterAction.does === 'askAgain') askAgain();
  if (enterAction.does !== 'take') return enterAction.does === 'finish' ? 'shut' : 'stay';
  takeCommand(enterAction.command, true);
  return enterAction.command.keepsOpen === true ? 'stay' : 'shut';
}
interface MenuFieldFocusKeeperProps {
  isMenuOpen: boolean;
}
export function MenuFieldFocusKeeper({ isMenuOpen }: MenuFieldFocusKeeperProps) {
  const markerRef = React.useRef<HTMLSpanElement>(null);
  const focusedRef = React.useRef<Element | null>(null);
  React.useEffect(() => {
    const menu = markerRef.current?.closest('[role="menu"]');
    const onFocusIn = ({ target }: Event) => {
      focusedRef.current = target instanceof Element ? target : null;
    };
    menu?.addEventListener('focusin', onFocusIn);
    return () => menu?.removeEventListener('focusin', onFocusIn);
  }, []);
  React.useLayoutEffect(() => {
    const menu = markerRef.current?.closest('[role="menu"]');
    const doc = menu?.ownerDocument;
    const wasFocusedRemoved = focusedRef.current?.isConnected === false;
    const isFocusLost = doc?.activeElement === null || doc?.activeElement === doc?.body;
    if (isMenuOpen && wasFocusedRemoved && isFocusLost && doc?.hasFocus() === true)
      menu?.querySelector('input')?.focus({
        preventScroll: true,
      });
  });
  return <span ref={markerRef} hidden />;
}
interface HandymanRowsProps {
  handyman: Handyman;
  rules: ConditionalFormatsView | null;
  onRuleKept(): void;
  onRuleStopped(): void;
  onAskedAgain(): void;
  isPointerCoarse: boolean;
  describe(command: MenuCommand): string | null;
  hintOf(command: MenuCommand): string | null;
  onTaken(command: MenuCommand, isByKey: boolean): void;
  /** Shown when the agent found no tool, to take the words on to the chat. */
  wayOnToChat: ReactNode;
}
export function HandymanRows({
  handyman,
  rules,
  onRuleKept,
  onRuleStopped,
  onAskedAgain,
  isPointerCoarse,
  describe,
  hintOf,
  onTaken,
  wayOnToChat,
}: HandymanRowsProps) {
  const { state } = handyman;
  const sections = handymanSections(state, handyman.noteRowTaken);
  const does = handymanEnterAction(state, sections, Number.POSITIVE_INFINITY).does;
  const askAgainItem = <SuggestToolsItem isUnderEnter={does === 'askAgain'} onAsked={onAskedAgain} />;
  const groupProps: Pick<React.ComponentProps<typeof ContextMenu.Group>, 'style' | 'onClickCapture'> = {
    style:
      state.is === 'answered' && !state.heedsPointer
        ? {
            pointerEvents: 'none',
          }
        : undefined,
    onClickCapture(event) {
      if (hasAnswerSettled(state, nowMs())) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  return <>{state.is === 'asking' &&
        (<AgentWritingRow words={{
            writes: toolSearchMessages.findingTools(),
            stop: CONDITIONAL_FORMATTING_WORDS.stop(),
          }} isAmongRowsOfList sizeOfWandInList={HANDYMAN_WAND_SIZE} onStopped={handyman.stop} />)}{isHandymanEmptyHanded(state) &&
        <div className="px-md py-sm text-footnote text-muted">{state.is === 'failed' ? toolSearchMessages.couldNotSuggest() : toolSearchMessages.noTool()}</div>}{state.is === 'failed' && askAgainItem}{sections.map(
        ({ heading, commands }) =>
          (<ContextMenu.Group key={heading ?? ''} {...groupProps}>{heading !== null &&
                  <Menu.GroupLabel>{heading}</Menu.GroupLabel>}<CommandRows commands={commands} isPointerCoarse={isPointerCoarse} describe={describe} hintOf={hintOf} onTaken={onTaken} isRowUnderEnterLit /></ContextMenu.Group>),
      )}{state.is === 'answered' &&
        state.makesRule &&
        rules !== null &&
        (rules.offer !== null || rules.agent !== 'isIdle') &&
        (<ContextMenu.Group onClickCapture={(event) => {
            if (rules.offer === null || hasRuleSettled(state, nowMs())) return;
            event.preventDefault();
            event.stopPropagation();
          }}><Menu.GroupLabel>{CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()}</Menu.GroupLabel>{rules.offer !== null
              ? <RuleOfferMenuItem offer={rules.offer} isUnderEnter={does === 'keepRule'} onKept={onRuleKept} />
              : rules.agent === 'writes'
                ? (<AgentWritingRow words={{
                      writes: CONDITIONAL_FORMATTING_WORDS.writingRules(),
                      stop: CONDITIONAL_FORMATTING_WORDS.stop(),
                    }} isAmongRowsOfList sizeOfWandInList={HANDYMAN_WAND_SIZE} onStopped={onRuleStopped} />)
                : <><div className="px-md py-sm text-footnote text-muted">{CONDITIONAL_FORMATTING_WORDS.rulesNotWritten()}</div>{askAgainItem}</>}</ContextMenu.Group>)}{isHandymanEmptyHanded(state) && wayOnToChat}</>;
}
export const nowMs = () => performance.now();
export const HANDYMAN_WAND_SIZE = 16;
interface SuggestToolsItemProps {
  isUnderEnter: boolean;
  onAsked(): void;
}
export const SuggestToolsItem = ({ isUnderEnter, onAsked }: SuggestToolsItemProps) =>
  <ContextMenu.Item keepOpen icon={<AgentMark size={HANDYMAN_WAND_SIZE} />} {...(isUnderEnter && {
      className: 'sheet-row-under-enter',
    })} onClick={onAsked}>{toolSearchMessages.suggestTools()}</ContextMenu.Item>;
