import { FieldLabel, FieldRoot, FieldTextInput } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { Checkbox } from '../kit/checkbox.tsx';
import { Surface } from '../kit/surface.tsx';
import { UiRoot } from '../kit/theme.tsx';
import { Button } from '../kit/button.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import * as React from 'react';
import type { KeyWithModifiers } from '../keys/key-press.ts';
import type { CellsCountedOffer, DoneToCells } from '../state/initial-state.ts';
import type { ReplaceChosen } from '../state/event-reducer.ts';
import type { FindView } from '../view/page-view.ts';
import type { FindDirection, FindOptionsChange } from './find.ts';
import { describeLastDone } from '../i18n/last-done-labels.ts';
import { describeUndoOffer } from '../i18n/change-labels.ts';
import { useTopLayerClose } from './list-under-cell.tsx';
import { offerKeyboardWhenReady } from './keyboard-handoff.ts';
import { findMatchCounterText, findMatchHeardAs, findBarMessages, selectedCellsScopeLabel, searchInButtonLabel } from '../i18n/find-labels.ts';
import { SidePane, PANE_START_ATTRIBUTE, PaneSelect } from './side-pane/side-pane.tsx';
import { IS_APPLE_PLATFORM } from './dom-events.ts';
import { latinKeyOf } from '../keys/key-press.ts';
/** What the last replace did: the offer to undo a replace in many cells, or the replace in one cell. */
export type FindReplaced = CellsCountedOffer | DoneToCells;
/** Text given to the find field from outside, such as the selected cell's text. */
export interface FindTextGiven {
  text: string;
}
/** The side pane the find bar opens as when it replaces. */
export interface FindBarPane {
  ref: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  wasPointerPressedLast: () => boolean;
}
export interface FindBarProps {
  find: FindView;
  fieldRef: React.RefObject<HTMLInputElement | null>;
  replaceFieldRef: React.RefObject<HTMLInputElement | null>;
  canReplace: boolean;
  areFormulasShown: boolean;
  replaced: FindReplaced | null;
  textGiven: FindTextGiven | null;
  onText: (text: string) => void;
  onStep: (by: FindDirection) => void;
  onReplaceAsked: () => void;
  onOptions: (optionsChanged: FindOptionsChange) => void;
  pane: FindBarPane;
  onReplace: (text: string, where: ReplaceChosen['where']) => void;
  onUndoOrRedo: (event: KeyboardEvent) => void;
  onLookAgain: () => void;
  /** Moves the caret on to the next part of the page; says whether it moved. */
  onGoOn: (step: FindDirection) => boolean;
  onClose: () => void;
}
export interface FindBarUnlessGivenUpProps extends FindBarProps {
  hasLeftSinceAsked: () => boolean;
  onGivenUp: () => void;
}
export function findStepShortcut(event: KeyWithModifiers): FindDirection | null {
  if (!(event.key === 'F3' ? !event.altKey && !event.metaKey && !event.ctrlKey : isPrimaryShortcut(event, 'g'))) return null;
  return event.shiftKey ? -1 : 1;
}
export function replacedAnnouncement(replaced: FindReplaced, matchWords: string): string {
  if (!('kind' in replaced))
    return `${describeLastDone(replaced)}
${matchWords}`.trim();
  let { title, description = '' } = describeUndoOffer(replaced);
  return `${title}
${description}`.trim();
}
export function FindBar({
  find,
  fieldRef,
  replaceFieldRef,
  canReplace,
  areFormulasShown,
  replaced,
  textGiven,
  onText,
  onStep,
  onReplaceAsked,
  onOptions,
  pane,
  onReplace,
  onUndoOrRedo,
  onLookAgain,
  onGoOn,
  onClose,
}: FindBarProps) {
  let [text, setText] = React.useState('');
  let [textGivenSeen, setTextGivenSeen] = React.useState<FindTextGiven | null>(null);
  if (textGiven !== textGivenSeen) {
    setTextGivenSeen(textGiven);
    if (textGiven !== null) setText(textGiven.text);
  }
  let [replaceText, setReplaceText] = React.useState('');
  let [replacedSeen, setReplacedSeen] = React.useState(replaced);
  let buttonsRef = React.useRef<HTMLDivElement>(null);
  let [replaceCount, setReplaceCount] = React.useState(0);
  let [canUndoReplace, setCanUndoReplace] = React.useState(false);
  let [replacedBefore, setReplacedBefore] = React.useState(replaced);
  if (replaced !== replacedBefore) {
    setReplacedBefore(replaced);
    if (replaced !== null) setCanUndoReplace(true);
  }
  let [isFocused, setIsFocused] = React.useState(true);
  let typingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => clearTimeout(typingTimerRef.current ?? undefined), []);
  let { isReplaceShown } = find;
  useTopLayerClose(!isReplaceShown, onClose);
  let focusField = React.useEffectEvent((isReplace: boolean) => {
    let field = isReplace && text !== '' ? replaceFieldRef.current : fieldRef.current;
    if (field === null) return;
    return offerKeyboardWhenReady(
      field,
      () =>
        field.focus({
          preventScroll: true,
        }),
      {
        keys: {
          onShut: onClose,
        },
      },
    );
  });
  React.useEffect(() => focusField(isReplaceShown), [isReplaceShown]);
  React.useEffect(() => {
    let replaceField = isReplaceShown ? replaceFieldRef.current : null;
    let blockHistoryInput = (event: InputEvent) => {
      if (event.inputType.startsWith('history')) event.preventDefault();
    };
    replaceField?.addEventListener('beforeinput', blockHistoryInput);
    return () => replaceField?.removeEventListener('beforeinput', blockHistoryInput);
  }, [replaceFieldRef, isReplaceShown]);
  let lookAgain = React.useEffectEvent(onLookAgain);
  let hasEditsSinceLooked = find.editsSinceLooked > 0;
  React.useEffect(() => {
    if (!hasEditsSinceLooked) return;
    let timer = setTimeout(lookAgain, FIND_RELOOK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasEditsSinceLooked]);
  let onTextTyped = (typed: string) => {
    setCanUndoReplace(false);
    setReplacedSeen(replaced);
    clearTimeout(typingTimerRef.current ?? undefined);
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
      onText(typed);
    }, FIND_TYPING_DELAY_MS);
  };
  let onOptionsChanged = (optionsChanged: FindOptionsChange) => {
    setReplacedSeen(replaced);
    onOptions(optionsChanged);
  };
  let step = (stepBy: FindDirection) => {
    setReplacedSeen(replaced);
    if (typingTimerRef.current === null) return onStep(stepBy);
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    return onText(text);
  };
  let replace = (where: ReplaceChosen['where']) => {
    if (text === '')
      return fieldRef.current?.focus({
        preventScroll: true,
      });
    setReplaceCount((count) => count + 1);
    setReplacedSeen(replaced);
    let isStale = typingTimerRef.current !== null || text !== find.text;
    clearTimeout(typingTimerRef.current ?? undefined);
    typingTimerRef.current = null;
    if (isStale) onText(text);
    if (!isStale || where === 'everyCell') onReplace(replaceText, where);
  };
  let onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    let isEnterInFind = event.key === 'Enter' && event.target === fieldRef.current;
    let isEnterInReplace = event.key === 'Enter' && event.target === replaceFieldRef.current;
    let isBackward = (isEnterInFind || isEnterInReplace) && event.shiftKey;
    let stepBy = isBackward ? -1 : isEnterInFind ? 1 : findStepShortcut(event);
    let isOnButtons = event.target instanceof Node && buttonsRef.current?.contains(event.target) === true;
    let isHeldEnter = event.repeat && event.key === 'Enter' && !isBackward && (isEnterInReplace || isOnButtons);
    if (event.key === 'Escape') onClose();
    else if (isEnterInReplace && !isBackward && !event.repeat) replace('cellFound');
    else if (stepBy !== null) step(stepBy);
    else if (isUndoRedoShortcut(event) && canUndoReplace) onUndoOrRedo(event.nativeEvent);
    else if (event.key === 'F6' && !event.altKey) {
      if (!onGoOn(event.shiftKey ? -1 : 1)) return;
    } else if (!isHeldEnter && (!isUndoRedoShortcut(event) || !find.isReplaceShown || event.target === fieldRef.current)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  let onButtonsMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.target !== fieldRef.current && event.target !== replaceFieldRef.current) event.preventDefault();
  };
  let countText = find.text === '' || text === '' ? '' : findMatchCounterText(find);
  let matchText = countText === '' ? '' : findMatchHeardAs(find);
  let announcedMatch = isFocused ? matchText : '';
  const isReplaceNews = replaced !== null && replaced !== replacedSeen && (isFocused || !('kind' in replaced));
  let announcement = isReplaceNews ? replacedAnnouncement(replaced, announcedMatch) : announcedMatch;
  let announcementOfReplace = isReplaceNews ? replaced : null;
  let [shownAnnouncement, setShownAnnouncement] = React.useState({
    words: announcement,
    ofReplace: announcementOfReplace,
  });
  if (!hasEditsSinceLooked && (shownAnnouncement.words !== announcement || shownAnnouncement.ofReplace !== announcementOfReplace))
    setShownAnnouncement({
      words: announcement,
      ofReplace: announcementOfReplace,
    });
  let announced = shownAnnouncement.ofReplace === null || shownAnnouncement.ofReplace === replaced ? shownAnnouncement.words : '';
  let isNothingFound = find.count === 0;
  React.useLayoutEffect(() => {
    let field = fieldRef.current;
    if (isNothingFound && field?.ownerDocument.activeElement?.matches('search :disabled') === true)
      field.focus({
        preventScroll: true,
      });
  }, [isNothingFound, fieldRef]);
  let onFocusIn = () => {
    if (!isFocused) setReplacedSeen(replaced);
    setIsFocused(true);
  };
  let onFocusOut = ({ currentTarget, relatedTarget }: React.FocusEvent<HTMLElement>) =>
    setIsFocused(currentTarget.contains(relatedTarget));
  let findFieldProps = {
    ref: fieldRef,
    value: text,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setText(event.target.value);
      let { nativeEvent } = event;
      if (!(nativeEvent instanceof InputEvent && nativeEvent.isComposing)) onTextTyped(event.target.value);
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => onTextTyped(event.currentTarget.value),
    autoComplete: 'off',
    autoCapitalize: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    maxLength: 200,
  };
  let countOutput = <output aria-live="polite" aria-atomic="true" className={`text-secondary text-caption ${isReplaceShown ? 'whitespace-nowrap tabular-nums' : 'sheet-find-count'}`}><span aria-hidden="true">{countText}</span><span key={replaceCount} className="sr-only">{(announced === ''
            ? []
            : announced.split(`
`)
          ).map(
            (part) =>
              <span key={part} className="block">{`${part} `}</span>,
          )}</span></output>;
  let stepButtons = <><Button variant="ghost" iconOnly icon="ArrowUp" aria-label={findBarMessages.previous()} disabled={isNothingFound} onClick={() => step(-1)} /><Button variant="ghost" iconOnly icon="ArrowDown" aria-label={findBarMessages.next()} disabled={isNothingFound} onClick={() => step(1)} /></>;
  if (isReplaceShown) {
    let withinChoices = [...new Set([find.within, find.selectedCells])].filter((cells): cells is string => cells !== null);
    let searchInItems = [
      {
        value: 'sheet',
        label: findBarMessages.thisSheet(),
      },
      {
        value: 'allSheets',
        label: findBarMessages.allSheets(),
      },
      ...withinChoices.map(
        (cells) => ({
          value: `cells ${cells}`,
          label: selectedCellsScopeLabel(cells),
        }),
      ),
    ];
    let searchIn = find.isInAllSheets ? 'allSheets' : find.within === null ? 'sheet' : `cells ${find.within}`;
    return <search className="contents" onFocus={onFocusIn} onBlur={onFocusOut}><SidePane {...pane} title={findBarMessages.findAndReplace()} onClose={onClose} onKeyDown={onKeyDown}><div className="flex shrink-0 flex-col gap-md ps-lg pe-md pt-lg max-[600px]:gap-sm"><FieldRoot><div className="flex items-center justify-between"><FieldLabel>{findBarMessages.findWhat()}</FieldLabel><div role="presentation" className="-my-2 -me-1 flex gap-0.5" onMouseDown={onButtonsMouseDown}><TooltipGroup>{stepButtons}</TooltipGroup></div></div><TextInput {...findFieldProps} {...{
                    [PANE_START_ATTRIBUTE]: true,
                  }} slotEnd={countOutput} /></FieldRoot><FieldTextInput ref={replaceFieldRef} label={findBarMessages.replaceWith()} value={replaceText} onChange={({ target, nativeEvent }) => {
                if (nativeEvent instanceof InputEvent && nativeEvent.inputType.startsWith('history')) return;
                setCanUndoReplace(false);
                setReplaceText(target.value);
              }} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={200} /><FieldRoot><FieldLabel render={<span aria-hidden="true" />}>{findBarMessages.searchIn()}</FieldLabel><div className="flex"><PaneSelect name={searchInButtonLabel(searchInItems.find(({ value }) => value === searchIn)?.label ?? '')} value={searchIn} items={searchInItems} onChange={(within: string) =>
                      onOptionsChanged({
                        within: within === 'sheet' || within === 'allSheets' ? within : 'selectedCells',
                      })} /></div></FieldRoot><div className="flex flex-col gap-sm"><Checkbox label={findBarMessages.matchCase()} checked={find.options.matchesCase} onCheckedChange={(matchesCase) =>
                    onOptionsChanged({
                      matchesCase,
                    })} /><Checkbox label={findBarMessages.matchEntireCell()} checked={find.options.isWholeCell} onCheckedChange={(isWholeCell) =>
                    onOptionsChanged({
                      isWholeCell,
                    })} /><Checkbox label={findBarMessages.alsoInFormulas()} checked={find.options.isInFormulas || areFormulasShown} disabled={areFormulasShown} disabledReason={findBarMessages.whyAlsoInFormulas()} onCheckedChange={(isInFormulas) =>
                    onOptionsChanged({
                      isInFormulas,
                    })} /></div><div role="presentation" onMouseDown={onButtonsMouseDown}><div ref={buttonsRef} className={`grid gap-sm ${find.isInAllSheets ? 'grid-cols-[1fr_auto]' : 'grid-cols-2'}`}><Button variant="secondary" onClick={() => replace('cellFound')}>{findBarMessages.replace()}</Button><Button variant="secondary" onClick={({ detail }) => detail < 2 && replace('everyCell')}>{find.isInAllSheets ? findBarMessages.replaceAllInSheet() : findBarMessages.replaceAll()}</Button></div></div></div></SidePane></search>;
  }
  return <search aria-label={findBarMessages.find()} className="sheet-find-over-grid"><UiRoot render={<Surface elevation="panel" className="sheet-find-parts" onFocus={onFocusIn} onBlur={onFocusOut} onKeyDown={onKeyDown} onMouseDown={onButtonsMouseDown} />}><TooltipGroup><TextInput {...findFieldProps} className="sheet-find-field" placeholder={findBarMessages.find()} aria-label={findBarMessages.find()} />{countOutput}{stepButtons}{canReplace &&
            <Tooltip content={findBarMessages.findAndReplace()} shortcut={REPLACE_SHORTCUT}><Button variant="ghost" aria-description={findBarMessages.findAndReplace()} aria-keyshortcuts={IS_APPLE_PLATFORM ? 'Meta+Shift+H' : 'Control+H'} onClick={onReplaceAsked}>{findBarMessages.toReplace()}</Button></Tooltip>}<Button variant="ghost" iconOnly icon="X" aria-label={findBarMessages.close()} onClick={onClose} /></TooltipGroup></UiRoot></search>;
}
export function FindBarUnlessGivenUp({ hasLeftSinceAsked, onGivenUp, ...findBarProps }: FindBarUnlessGivenUpProps) {
  let [isGivenUp, setIsGivenUp] = React.useState(hasLeftSinceAsked);
  let { isReplaceShown } = findBarProps.find;
  let [replaceShownSeen, setReplaceShownSeen] = React.useState(isReplaceShown);
  if (isReplaceShown !== replaceShownSeen) {
    setReplaceShownSeen(isReplaceShown);
    if (isReplaceShown && hasLeftSinceAsked()) setIsGivenUp(true);
  }
  let giveUp = React.useEffectEvent(onGivenUp);
  React.useLayoutEffect(() => {
    if (isGivenUp) giveUp();
  }, [isGivenUp]);
  return isGivenUp
    ? null
    : <FindBar {...findBarProps} />;
}
export const FIND_TYPING_DELAY_MS = 120;
export const isPrimaryShortcut = (event: KeyWithModifiers, letter: string): boolean =>
  !event.altKey &&
  (IS_APPLE_PLATFORM ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
  latinKeyOf(event, true).toLowerCase() === letter;
export const isFindShortcut = (event: KeyWithModifiers): boolean => !event.shiftKey && isPrimaryShortcut(event, 'f');
export const isReplaceShortcut = (event: KeyWithModifiers): boolean => event.shiftKey === IS_APPLE_PLATFORM && isPrimaryShortcut(event, 'h');
export const REPLACE_SHORTCUT = IS_APPLE_PLATFORM ? 'cmd+shift+h' : 'cmd+h';
export const isUndoRedoShortcut = (event: KeyWithModifiers): boolean =>
  isPrimaryShortcut(event, 'z') || (!event.shiftKey && isPrimaryShortcut(event, 'y'));
export const FIND_RELOOK_DELAY_MS = 1000;
