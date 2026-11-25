import type { CaretInEntry, KeyPress, RefusalOfEveryEdit } from '../state/event-reducer.ts';
import type { PointedReference, PageState } from '../state/initial-state.ts';
import type { EditingMode, PageMode, PageTransition } from '../state/transitions.ts';
import type { EscapeInCells } from '../state/escape.ts';
import type { PopupOverEntry } from '../state/list-cards.ts';
import type { KeyMove } from '../selection/keyboard.ts';
import type { Jump } from '../selection/jumps.ts';
import type { sheetsToPointInFor } from '../formulas/sheet-pointed-in.ts';
import type { AltCommandAct } from './key-press.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { shouldArrowsMoveText, cycleReferenceDollars, caretOrEnd } from '../formulas/reference-pointing.ts';
import { doesEntryListTakeKey, isCaretInEntryList } from '../editor/entry-looks.ts';
import { withLineBreakAt } from '../editor/entry-lines.ts';
import { canSwitchSheetWhileEditing } from '../formulas/sheet-pointed-in.ts';
import { altCommandActOf } from './key-press.ts';
import { fontMarkOfShortcut } from '../editor/text-looks.ts';
import { isEntryExpanded } from '../editor/expanded-entry.ts';
import { MODIFIER_KEYS } from '../state/escape.ts';

/** A key press, with the caret of the entry when the key came in one. */
export interface KeyPressWithCaret extends KeyPress {
  caretInEntry?: CaretInEntry;
}
/** A step down or up a list, or to the sheet after or before. */
export type KeyStep = 1 | -1;
/** Where a key moves the focus: to the part before, to the next part, or back to the cells. */
export type FocusMove = 'partBefore' | 'nextPart' | 'cells';
/** A key that acts on the list the caret of the entry is in. */
export type EntryListKey = 'lineBreak' | 'tab' | 'shiftTab' | 'backspace';
/** A number format set by a key. */
export type NumberFormatOfKey = 'number' | 'time' | 'date' | 'currency' | 'percent' | 'scientific';
/** A horizontal alignment set by a key. */
export type AlignmentOfKey = 'left' | 'center';
/** What a key does to the groups of rows or columns at the selection. */
export type OutlineGroupAct = 'group' | 'ungroup' | 'expand' | 'collapse';
/** Where a key steps among the people of a cell: to the one before or after, to the first, or back to the caret. */
export type FieldStep = 'before' | 'after' | 'first' | 'caret';
/** A kind of list started in a cell by a key. */
export type ListKindOfKey = 'numbered' | 'bullet' | 'checkbox';
/** A font mark a key turns on or off: one of `FONT_MARKS` (editor/text-looks.ts). */
export type FontMarkOfKey = NonNullable<ReturnType<typeof fontMarkOfShortcut>>;
/** For each way, whether there is a sheet before or after to point at: the entry's own sheet, another one, or none. */
export type SheetsToPointIn = ReturnType<typeof sheetsToPointInFor>;
/** The start and end of the caret in an entry. */
export type CaretSpan = Pick<CaretInEntry, 'start' | 'end'>;
/** A format a key sets on the selected cells. */
export type FormatChoiceOfKey =
  | { toggle: FontMarkOfKey }
  | { numberFormatChoice: NumberFormatOfKey }
  | { horizontalAlignment: AlignmentOfKey }
  | { list: ListKindOfKey }
  | { clearsFormatting: true };
/** What a key press does on the page. */
export type KeyAct =
  | (KeyMove & { kind: 'pointAtCells'; isToEdgeOfData: boolean; isStretching: boolean })
  | (KeyMove & { kind: 'move' | 'extendSelection' | 'takeCardRow' | 'takeDropdownListRow' | 'takePeopleListRow' | 'enterFormulaRead' })
  | (KeyMove & { kind: 'commitEdit'; isKeep?: true })
  | { kind: 'writeInEntry'; text: string; caretAt: number; typingIn: EditingMode['typingIn'] }
  | { kind: 'actOnLists'; key: EntryListKey }
  | {
      kind:
        | 'showSheetBeside'
        | 'goOnOutOfGrid'
        | 'moveInCard'
        | 'moveInDropdownList'
        | 'moveInPeopleList'
        | 'moveInTimeList'
        | 'moveInFunctionList'
        | 'moveInFormulaOffer';
      by: KeyStep;
    }
  | { kind: 'jump'; to: Jump; isExtending: boolean }
  | { kind: 'actOnGroups'; act: OutlineGroupAct }
  | { kind: 'insertOrDeleteLines'; what: keyof typeof LINE_EDITS_OF_COMMAND }
  | { kind: 'formatCells'; choice: FormatChoiceOfKey }
  | { kind: 'undoOrRedo'; direction: 'undo' | 'redo' }
  | { kind: 'fill'; toward: 'down' | 'right' }
  | { kind: 'selectWhole'; what: 'rows' | 'columns' }
  | { kind: 'removeFromField'; atCaret: 'theLast' | 'everyone' }
  | { kind: 'stepInField'; step: FieldStep }
  | { kind: 'startEditing'; text: string | null }
  | { kind: 'switchArrows' }
  | {
      kind:
        | 'addSheet'
        | 'sumUp'
        | 'pressBoxOfLine'
        | 'askForLinkForm'
        | 'collapseEntry'
        | 'expandEntry'
        | 'takeFunctionListRow'
        | 'takeFormulaOfferRow'
        | 'waitForFormula'
        | 'goBackToWords'
        | 'commitEditToSelection'
        | 'stayInField'
        | 'selectTableOrAll'
        | 'showOrHideFormulas'
        | 'enterToday'
        | 'selectAll'
        | 'shutCard'
        | 'goIntoCard'
        | 'stayInCard'
        | 'openCardOfOption'
        | 'shutList'
        | 'shutFunctionList'
        | 'waveFormulaOfferOff'
        | 'stopAskingForFormula'
        | 'cancelEdit'
        | 'goIntoCalendar'
        | 'openCell'
        | 'askForMenu'
        | 'letGo'
        | 'stepOutOfCells'
        | 'clearCells';
    };
/** A key act on the formula in the entry. */
export type FormulaKeyAct = Extract<KeyAct, { kind: 'pointAtCells' | 'switchArrows' | 'writeInEntry' }>;
/** What the page holds that changes what a key does. */
export interface KeyActSettings {
  sheetsToPointIn: SheetsToPointIn;
  pointedReference: PointedReference | null;
  /** Why the page is only viewed, or `null` when it can be edited. */
  viewOnlyBecause: RefusalOfEveryEdit;
  doesEntryTakeLineBreaks: boolean;
  hasCellsToFill: boolean;
  isSteppedOutOfCells?: boolean;
  doesKeyOpenLinkForm?: boolean;
}
export function focusMoveOfKey(keyEvent: KeyPress): FocusMove | null {
  if (keyEvent.isAltHeld || keyEvent.isRepeat) return null;
  if (keyEvent.key === 'F6') return keyEvent.isShiftHeld ? 'partBefore' : 'nextPart';
  return keyEvent.key === 'Escape' ? 'cells' : null;
}
export function jumpOfKey({ key, isModifierHeld, isAltHeld }: Pick<KeyPress, 'key' | 'isModifierHeld' | 'isAltHeld'>): Jump | null {
  if (isAltHeld) return null;
  if (key === 'Home')
    return {
      kind: isModifierHeld ? 'startOfSheet' : 'startOfRow',
    };
  if (key === 'End')
    return {
      kind: isModifierHeld ? 'endOfSheet' : 'endOfRow',
    };
  let arrowMove = ARROW_KEY_MOVES[key];
  if (isModifierHeld)
    return arrowMove === undefined
      ? null
      : {
          kind: 'edgeOfData',
          ...arrowMove,
        };
  if (key === 'PageDown')
    return {
      kind: 'page',
      by: 1,
    };
  return key === 'PageUp'
    ? {
        kind: 'page',
        by: -1,
      }
    : null;
}
export function listKeyOf({ key, isShiftHeld }: Pick<KeyPress, 'key' | 'isShiftHeld'>): Exclude<EntryListKey, 'lineBreak'> | null {
  if (key === 'Tab') return isShiftHeld ? 'shiftTab' : 'tab';
  return key === 'Backspace' && !isShiftHeld ? 'backspace' : null;
}
export function formulaKeyActOf(mode: PageMode, keyEvent: KeyPressWithCaret, pointedReference: PointedReference | null): FormulaKeyAct | null {
  if (mode.kind !== 'editing' || !isFormulaText(mode.text) || keyEvent.isAltHeld) return null;
  if (mode.isBegunToListFunctions === true) return null;
  if (keyEvent.caretInEntry?.isComposing === true) return null;
  let caret = caretInEntryOf(mode, keyEvent);
  let arrowMove = ARROW_KEY_MOVES[keyEvent.key];
  if (arrowMove !== undefined && shouldArrowsMoveText(mode, caret, pointedReference))
    return {
      kind: 'pointAtCells',
      ...arrowMove,
      isToEdgeOfData: keyEvent.isModifierHeld,
      isStretching: keyEvent.isShiftHeld,
    };
  if (keyEvent.isModifierHeld || keyEvent.isShiftHeld) return null;
  if (keyEvent.key === 'F2')
    return {
      kind: 'switchArrows',
    };
  let referenceWithDollars = keyEvent.key === 'F4' ? cycleReferenceDollars(mode.text, caret) : null;
  return referenceWithDollars === null
    ? null
    : {
        kind: 'writeInEntry',
        ...referenceWithDollars,
        typingIn: mode.typingIn,
      };
}
export function popupForKey(popup: PopupOverEntry | null, { key, isAltHeld }: Pick<KeyPress, 'key' | 'isAltHeld'>): PopupOverEntry | null {
  if (popup === null || !isFormulaPopupYetToRest(popup)) return popup;
  if (key !== 'Enter' || isAltHeld) return null;
  return popup === 'formulaOfferYetToRest' ? 'formulaOffer' : 'formulaRead';
}
export function keyActOf(
  mode: PageMode,
  keyEvent: KeyPressWithCaret,
  popupOpen: PopupOverEntry | null,
  escapeDoes: EscapeInCells,
  {
    sheetsToPointIn,
    pointedReference,
    viewOnlyBecause,
    doesEntryTakeLineBreaks: entryTakesLineBreaks,
    hasCellsToFill,
    isSteppedOutOfCells = false,
    doesKeyOpenLinkForm = false,
  }: KeyActSettings = {
    sheetsToPointIn: ANY_SHEETS_TO_POINT_IN,
    pointedReference: null,
    viewOnlyBecause: null,
    doesEntryTakeLineBreaks: false,
    hasCellsToFill: false,
  },
): KeyAct | null {
  let popup = popupForKey(popupOpen, keyEvent);
  let formulaAct = viewOnlyBecause === null ? formulaKeyActOf(mode, keyEvent, pointedReference) : null;
  let isPopupNoteOrNone = popup === null || popup === 'formulaNote';
  let lineBreakActOf = (allowsInList = false): KeyAct | null => {
    if (!(mode.kind === 'editing' && entryTakesLineBreaks && doesPopupLetLineBreak(popup, allowsInList) && viewOnlyBecause === null)) return null;
    return doesEntryListTakeKey(mode, 'lineBreak', entryAtCaretOf(mode, keyEvent))
      ? {
          kind: 'actOnLists',
          key: 'lineBreak',
        }
      : {
          kind: 'writeInEntry',
          ...withLineBreakAt(mode.text, caretInEntryOf(mode, keyEvent)),
          typingIn: mode.typingIn,
        };
  };
  if (formulaAct !== null && (isPopupNoteOrNone || formulaAct.kind !== 'pointAtCells')) return formulaAct;
  let isDropdownList = popup === 'list' || popup === 'listOnRowToCard' || popup === 'listOnOption';
  let isPeopleList = popup === 'peopleList';
  let isTimeList = popup === 'timeList';
  let isUpOrDown = keyEvent.key === 'ArrowDown' || keyEvent.key === 'ArrowUp';
  if (keyEvent.isAltHeld && !keyEvent.isShiftHeld && isUpOrDown) {
    let step: KeyStep = keyEvent.key === 'ArrowDown' ? 1 : -1;
    let sheetThatWay = step === 1 ? sheetsToPointIn.after : sheetsToPointIn.before;
    let canSwitchSheet =
      (sheetThatWay !== null || keyEvent.isRepeat) && canSwitchSheetWhileEditing(mode, keyEvent.caretInEntry, sheetThatWay === 'entrysOwn', true);
    if (keyEvent.isModifierHeld || (mode.kind === 'editing' && !canSwitchSheet)) return null;
    return {
      kind: 'showSheetBeside',
      by: step,
    };
  }
  let groupAct = keyEvent.isAltHeld && keyEvent.isShiftHeld && !keyEvent.isModifierHeld ? OUTLINE_GROUP_SHORTCUTS[keyEvent.key] : undefined;
  if (groupAct !== undefined)
    return mode.kind === 'navigating' && popup === null
      ? {
          kind: 'actOnGroups',
          act: groupAct,
        }
      : null;
  let commandOfKey = altCommandActOf(keyEvent);
  if (commandOfKey !== null) return mode.kind === 'navigating' && popup === null ? COMMAND_KEY_ACTS[commandOfKey] : null;
  if (isSumKey(keyEvent))
    return (mode.kind === 'navigating' && popup === null) || keyEvent.isRepeat
      ? {
          kind: 'sumUp',
        }
      : null;
  if (keyEvent.key === 'Tab' && isSteppedOutOfCells) return null;
  if (keyEvent.key === 'F6' && !keyEvent.isAltHeld)
    return mode.kind === 'navigating'
      ? {
          kind: 'goOnOutOfGrid',
          by: keyEvent.isShiftHeld ? -1 : 1,
        }
      : null;
  let jumpTo = mode.kind === 'navigating' && popup === null ? jumpOfKey(keyEvent) : null;
  if (jumpTo !== null)
    return {
      kind: 'jump',
      to: jumpTo,
      isExtending: keyEvent.isShiftHeld,
    };
  if (keyEvent.isModifierHeld) {
    let lowerKey = keyEvent.key.toLowerCase();
    let fontMark = fontMarkOfShortcut(keyEvent);
    if (fontMark !== undefined)
      return {
        kind: 'formatCells',
        choice: {
          toggle: fontMark,
        },
      };
    let isShiftWithoutAlt = keyEvent.isShiftHeld && !keyEvent.isAltHeld;
    let numberFormatChoice = isShiftWithoutAlt ? NUMBER_FORMAT_SHORTCUTS[keyEvent.key] : undefined;
    if (numberFormatChoice !== undefined)
      return {
        kind: 'formatCells',
        choice: {
          numberFormatChoice,
        },
      };
    let alignment = isShiftWithoutAlt ? ALIGNMENT_SHORTCUTS[lowerKey] : undefined;
    if (alignment !== undefined)
      return {
        kind: 'formatCells',
        choice: {
          horizontalAlignment: alignment,
        },
      };
    let listKind = listKindOfShortcut(keyEvent);
    if (listKind !== undefined)
      return {
        kind: 'formatCells',
        choice: {
          list: listKind,
        },
      };
    if (mode.kind === 'editing' && keyEvent.key === 'Enter' && keyEvent.isAltHeld && !keyEvent.isShiftHeld)
      return viewOnlyBecause === null
        ? {
            kind: 'pressBoxOfLine',
          }
        : null;
    if (lowerKey === 'k' && !keyEvent.isShiftHeld && !keyEvent.isAltHeld && doesKeyOpenLinkForm && popup === null)
      return {
        kind: 'askForLinkForm',
      };
    if (keyEvent.key === 'Enter' && isShiftWithoutAlt) {
      if (isEntryExpanded(mode))
        return {
          kind: 'collapseEntry',
        };
      let isFormulaEntry = mode.kind === 'editing' && isFormulaText(mode.text);
      if (popup === null && !isFormulaEntry && viewOnlyBecause === null)
        return {
          kind: 'expandEntry',
        };
    }
    if (mode.kind === 'editing' && keyEvent.key === 'Enter' && !keyEvent.isShiftHeld && !keyEvent.isAltHeld) {
      let stayPut = {
        rowDelta: 0,
        columnDelta: 0,
      };
      if (popup === 'card' || popup === 'cardOfOption')
        return {
          kind: 'takeCardRow',
          ...stayPut,
        };
      if (isDropdownList)
        return {
          kind: 'takeDropdownListRow',
          ...stayPut,
        };
      if (isPeopleList)
        return {
          kind: 'takePeopleListRow',
          ...stayPut,
        };
      if (popup === 'functionList')
        return {
          kind: 'takeFunctionListRow',
        };
      if (popup === 'formulaOffer')
        return {
          kind: 'takeFormulaOfferRow',
        };
      if (popup === 'formulaRead')
        return {
          kind: 'enterFormulaRead',
          ...stayPut,
        };
      if (popup === 'formulaAsked' || popup === 'formulaArriving')
        return {
          kind: 'waitForFormula',
        };
      if (popup === 'formulaProposed')
        return {
          kind: 'commitEdit',
          ...stayPut,
          isKeep: true,
        };
      if (popup === 'formulaToDiscard')
        return {
          kind: 'goBackToWords',
        };
      if (mode.isExpanded === true)
        return {
          kind: 'commitEdit',
          ...stayPut,
        };
      return (
        (hasCellsToFill ? null : lineBreakActOf()) ?? {
          kind: 'commitEditToSelection',
        }
      );
    }
    if (mode.kind !== 'navigating') return null;
    if (isPeopleList && (lowerKey === 'a' || keyEvent.key === ' '))
      return {
        kind: 'stayInField',
      };
    if (lowerKey === 'a')
      return {
        kind: 'selectTableOrAll',
      };
    if ((keyEvent.key === '`' || keyEvent.key === '~') && !keyEvent.isAltHeld)
      return {
        kind: 'showOrHideFormulas',
      };
    if (lowerKey === 'z' && !keyEvent.isAltHeld)
      return {
        kind: 'undoOrRedo',
        direction: keyEvent.isShiftHeld ? 'redo' : 'undo',
      };
    if (lowerKey === 'y' && !keyEvent.isAltHeld && !keyEvent.isShiftHeld)
      return {
        kind: 'undoOrRedo',
        direction: 'redo',
      };
    let isNoShiftNoAlt = !keyEvent.isShiftHeld && !keyEvent.isAltHeld;
    if (lowerKey === 'd' && isNoShiftNoAlt)
      return {
        kind: 'fill',
        toward: 'down',
      };
    if (lowerKey === 'r' && isNoShiftNoAlt)
      return {
        kind: 'fill',
        toward: 'right',
      };
    if (keyEvent.key === ';' && !keyEvent.isAltHeld)
      return {
        kind: 'enterToday',
      };
    if (keyEvent.key !== ' ') return null;
    return keyEvent.isShiftHeld
      ? {
          kind: 'selectAll',
        }
      : {
          kind: 'selectWhole',
          what: 'columns',
        };
  }
  let stepSign = keyEvent.isShiftHeld ? -1 : 1;
  if (keyEvent.key === 'Enter' && keyEvent.isAltHeld && mode.kind === 'editing') return lineBreakActOf(true);
  let commitMove =
    keyEvent.key === 'Enter'
      ? {
          rowDelta: stepSign,
          columnDelta: 0,
        }
      : keyEvent.key === 'Tab'
        ? {
            rowDelta: 0,
            columnDelta: stepSign,
          }
        : null;
  let isPlainRight = keyEvent.key === 'ArrowRight' && mode.kind === 'navigating' && !keyEvent.isShiftHeld && !keyEvent.isAltHeld;
  let isPlainLeft = keyEvent.key === 'ArrowLeft' && mode.kind === 'navigating' && !keyEvent.isShiftHeld && !keyEvent.isAltHeld;
  if (popup === 'card' || popup === 'cardOfOption') {
    if (isUpOrDown && !keyEvent.isShiftHeld && !keyEvent.isAltHeld)
      return {
        kind: 'moveInCard',
        by: keyEvent.key === 'ArrowDown' ? 1 : -1,
      };
    if (keyEvent.key === 'Enter' && mode.kind === 'navigating')
      return {
        kind: 'takeCardRow',
        rowDelta: 0,
        columnDelta: 0,
      };
    if (commitMove !== null)
      return {
        kind: 'takeCardRow',
        ...commitMove,
      };
    if (keyEvent.key === 'Escape' || isPlainLeft)
      return {
        kind: 'shutCard',
      };
    if (isPlainRight)
      return {
        kind: 'goIntoCard',
      };
    let isClearKeyInCells = mode.kind === 'navigating' && (keyEvent.key === 'Delete' || keyEvent.key === 'Backspace');
    if (popup === 'cardOfOption' && isClearKeyInCells)
      return {
        kind: 'stayInCard',
      };
  }
  if (popup === 'listOnRowToCard' && isPlainRight)
    return {
      kind: 'takeDropdownListRow',
      rowDelta: 0,
      columnDelta: 0,
    };
  if (popup === 'listOnOption' && isPlainRight)
    return {
      kind: 'openCardOfOption',
    };
  if ((popup === 'listOnRowToCard' || popup === 'listOnOption') && isPlainLeft && keyEvent.isRepeat)
    return {
      kind: 'shutCard',
    };
  let isTabFromRowToCard = popup === 'listOnRowToCard' && keyEvent.key === 'Tab';
  if (isDropdownList && !isTabFromRowToCard) {
    if (isUpOrDown && !keyEvent.isShiftHeld && !keyEvent.isAltHeld)
      return {
        kind: 'moveInDropdownList',
        by: keyEvent.key === 'ArrowDown' ? 1 : -1,
      };
    if (commitMove !== null)
      return {
        kind: 'takeDropdownListRow',
        ...commitMove,
      };
    if (keyEvent.key === 'Escape' && mode.kind === 'navigating')
      return {
        kind: 'shutList',
      };
  }
  if (isPeopleList) {
    if (isUpOrDown && !keyEvent.isShiftHeld)
      return {
        kind: 'moveInPeopleList',
        by: keyEvent.key === 'ArrowDown' ? 1 : -1,
      };
    if (commitMove !== null)
      return {
        kind: 'takePeopleListRow',
        ...commitMove,
      };
    if (keyEvent.key === 'Escape' && mode.kind === 'navigating')
      return {
        kind: 'shutList',
      };
    if (keyEvent.key === 'Backspace' && (mode.kind === 'navigating' || mode.text === ''))
      return {
        kind: 'removeFromField',
        atCaret: 'theLast',
      };
    if (mode.kind === 'navigating') {
      if (keyEvent.key === 'Delete')
        return {
          kind: 'removeFromField',
          atCaret: 'everyone',
        };
      let fieldStep = !keyEvent.isShiftHeld && !keyEvent.isAltHeld ? FIELD_STEP_KEYS[keyEvent.key] : undefined;
      if (fieldStep !== undefined)
        return {
          kind: 'stepInField',
          step: fieldStep,
        };
      if (keyEvent.key === ' ')
        return {
          kind: 'stayInField',
        };
    }
  }
  if (mode.kind === 'editing') {
    if (isTimeList && isUpOrDown && !keyEvent.isShiftHeld)
      return {
        kind: 'moveInTimeList',
        by: keyEvent.key === 'ArrowDown' ? 1 : -1,
      };
    if (popup === 'functionList') {
      if (isUpOrDown && !keyEvent.isShiftHeld)
        return {
          kind: 'moveInFunctionList',
          by: keyEvent.key === 'ArrowDown' ? 1 : -1,
        };
      if (commitMove !== null)
        return {
          kind: 'takeFunctionListRow',
        };
      if (keyEvent.key === 'Escape')
        return {
          kind: 'shutFunctionList',
        };
    }
    let step: KeyStep = keyEvent.key === 'ArrowDown' ? 1 : -1;
    if (popup === 'formulaOffer' || popup === 'formulaRead') {
      if (isUpOrDown && !keyEvent.isShiftHeld)
        return {
          kind: 'moveInFormulaOffer',
          by: step,
        };
      if (keyEvent.key === 'Escape')
        return {
          kind: 'waveFormulaOfferOff',
        };
      if (keyEvent.key === 'Enter' && popup === 'formulaRead' && commitMove !== null)
        return {
          kind: 'enterFormulaRead',
          ...commitMove,
        };
      if (keyEvent.key === 'Enter')
        return {
          kind: 'takeFormulaOfferRow',
        };
      if (keyEvent.key === 'Tab')
        return {
          kind: 'waveFormulaOfferOff',
        };
    }
    if (popup === 'formulaAsked') {
      if (commitMove !== null)
        return {
          kind: 'waitForFormula',
        };
      if (keyEvent.key === 'Escape')
        return {
          kind: 'stopAskingForFormula',
        };
    }
    if (popup === 'formulaArriving' && commitMove !== null)
      return {
        kind: 'waitForFormula',
      };
    let isFormulaOfAgentUp = popup === 'formulaArriving' || popup === 'formulaProposed' || popup === 'formulaToDiscard';
    if (isFormulaOfAgentUp && isUpOrDown && !keyEvent.isShiftHeld)
      return {
        kind: 'moveInFormulaOffer',
        by: step,
      };
    if (popup === 'formulaToDiscard' && commitMove !== null)
      return {
        kind: 'goBackToWords',
      };
    if (isFormulaOfAgentUp && keyEvent.key === 'Escape')
      return {
        kind: 'goBackToWords',
      };
    if (popup === 'formulaNote' && keyEvent.key === 'Escape')
      return {
        kind: 'waveFormulaOfferOff',
      };
    let entryAtCaret = entryAtCaretOf(mode, keyEvent);
    let listKey = keyEvent.isAltHeld || viewOnlyBecause !== null ? null : listKeyOf(keyEvent);
    if (listKey !== null && doesEntryListTakeKey(mode, listKey, entryAtCaret))
      return {
        kind: 'actOnLists',
        key: listKey,
      };
    let lineBreakInList =
      keyEvent.key === 'Enter' &&
      keyEvent.isShiftHeld &&
      (isCaretInEntryList(mode, entryAtCaret) || doesEntryListTakeKey(mode, 'lineBreak', entryAtCaret))
        ? lineBreakActOf()
        : null;
    if (lineBreakInList !== null) return lineBreakInList;
    if (commitMove !== null && popup === 'formulaProposed')
      return {
        kind: 'commitEdit',
        ...commitMove,
        isKeep: true,
      };
    let lineBreakInExpanded = keyEvent.key === 'Enter' && mode.isExpanded === true ? lineBreakActOf() : null;
    if (lineBreakInExpanded !== null) return lineBreakInExpanded;
    if (keyEvent.key === 'Escape' && mode.isExpanded === true)
      return {
        kind: 'collapseEntry',
      };
    let isSumForSelection = mode.isSumForSelectedCells === true && isFormulaText(mode.text);
    if (keyEvent.key === 'Enter' && !keyEvent.isShiftHeld && isSumForSelection)
      return {
        kind: 'commitEditToSelection',
      };
    if (commitMove !== null)
      return {
        kind: 'commitEdit',
        ...commitMove,
      };
    if (popup === 'calendar' && keyEvent.key === 'ArrowDown' && !keyEvent.isShiftHeld)
      return {
        kind: 'goIntoCalendar',
      };
    let arrowMove =
      !isFormulaText(mode.text) &&
      !mode.text.includes(`
`) &&
      mode.arrowsActOn === 'cells' &&
      popup === null &&
      !keyEvent.isShiftHeld &&
      !keyEvent.isAltHeld
        ? ARROW_KEY_MOVES[keyEvent.key]
        : undefined;
    if (arrowMove !== undefined)
      return {
        kind: 'commitEdit',
        ...arrowMove,
      };
    return keyEvent.key === 'Escape'
      ? {
          kind: 'cancelEdit',
        }
      : null;
  }
  if (keyEvent.key === 'Enter')
    return {
      kind: 'openCell',
    };
  if (keyEvent.key === 'F2')
    return {
      kind: 'startEditing',
      text: null,
    };
  if (commitMove !== null)
    return {
      kind: 'move',
      ...commitMove,
    };
  let arrowMove = ARROW_KEY_MOVES[keyEvent.key];
  if (arrowMove !== undefined)
    return {
      kind: keyEvent.isShiftHeld ? 'extendSelection' : 'move',
      ...arrowMove,
    };
  if (keyEvent.key === ' ' && keyEvent.isShiftHeld)
    return {
      kind: 'selectWhole',
      what: 'rows',
    };
  if (keyEvent.key === 'F10' && keyEvent.isShiftHeld)
    return {
      kind: 'askForMenu',
    };
  if (keyEvent.key === 'Escape' && escapeDoes === 'leaves') return null;
  if (keyEvent.key === 'Escape')
    return {
      kind: escapeDoes === 'letsGo' ? 'letGo' : 'stepOutOfCells',
    };
  if (keyEvent.key === 'Delete' || keyEvent.key === 'Backspace')
    return {
      kind: 'clearCells',
    };
  return keyEvent.key.length === String.fromCodePoint(keyEvent.key.codePointAt(0) ?? 0).length
    ? {
        kind: 'startEditing',
        text: keyEvent.key,
      }
    : null;
}
export const withDropWhatIsHeld = (state: PageState): PageTransition => ({
  state,
  effects: [
    {
      kind: 'dropWhatIsHeld',
    },
  ],
});
export const ARROW_KEY_MOVES: Partial<Record<string, KeyMove>> = {
  ArrowUp: {
    rowDelta: -1,
    columnDelta: 0,
  },
  ArrowDown: {
    rowDelta: 1,
    columnDelta: 0,
  },
  ArrowLeft: {
    rowDelta: 0,
    columnDelta: -1,
  },
  ArrowRight: {
    rowDelta: 0,
    columnDelta: 1,
  },
};
export const NUMBER_FORMAT_SHORTCUTS: Partial<Record<string, NumberFormatOfKey>> = {
  '1': 'number',
  '2': 'time',
  '3': 'date',
  '4': 'currency',
  '5': 'percent',
  '6': 'scientific',
};
export const ALIGNMENT_SHORTCUTS: Partial<Record<string, AlignmentOfKey>> = {
  l: 'left',
  e: 'center',
};
export const OUTLINE_GROUP_SHORTCUTS: Partial<Record<string, OutlineGroupAct>> = {
  ArrowRight: 'group',
  ArrowLeft: 'ungroup',
  ArrowDown: 'expand',
  ArrowUp: 'collapse',
};
export const COMMAND_KEY_ACTS: Record<AltCommandAct, KeyAct> = {
  insertRowsOrColumns: {
    kind: 'insertOrDeleteLines',
    what: 'insert',
  },
  deleteRowsOrColumns: {
    kind: 'insertOrDeleteLines',
    what: 'delete',
  },
  clearFormatting: {
    kind: 'formatCells',
    choice: {
      clearsFormatting: true,
    },
  },
  addSheet: {
    kind: 'addSheet',
  },
};
export const LINE_EDITS_OF_COMMAND = {
  insert: {
    rows: 'insertRowAbove',
    columns: 'insertColumnLeft',
  },
  delete: {
    rows: 'deleteRows',
    columns: 'deleteColumns',
  },
} as const;
export const isActLeftToCtrlAlt = (key: string, act: KeyAct): boolean =>
  act.kind === 'jump' ||
  act.kind === 'goIntoCalendar' ||
  act.kind === 'pointAtCells' ||
  act.kind === 'switchArrows' ||
  (act.kind === 'writeInEntry' && key !== 'Enter') ||
  (ARROW_KEY_MOVES[key] !== undefined && (act.kind === 'move' || act.kind === 'extendSelection' || act.kind === 'commitEdit'));
export const movesCaretInEntry = ({ key, isModifierHeld }: Pick<KeyPress, 'key' | 'isModifierHeld'>): boolean =>
  (isModifierHeld && !MODIFIER_KEYS.has(key)) || ARROW_KEY_MOVES[key] !== undefined || /^(?:Home|End|PageUp|PageDown|F2)$/.test(key);
export const isSumKey = ({ key, isAltHeld, isModifierHeld }: Pick<KeyPress, 'key' | 'isAltHeld' | 'isModifierHeld'>): boolean =>
  isAltHeld && !isModifierHeld && (key === '=' || key === '≠');
export const ANY_SHEETS_TO_POINT_IN: SheetsToPointIn = {
  before: 'another',
  after: 'another',
};
export const FIELD_STEP_KEYS: Partial<Record<string, FieldStep>> = {
  ArrowLeft: 'before',
  ArrowRight: 'after',
  Home: 'first',
  End: 'caret',
};
export const caretInEntryOf = (mode: PageMode, { caretInEntry }: Pick<KeyPressWithCaret, 'caretInEntry'>): CaretSpan =>
  caretOrEnd(mode.kind === 'editing' ? mode.text : '', caretInEntry);
export const entryAtCaretOf = (mode: PageMode, keyEvent: Pick<KeyPressWithCaret, 'caretInEntry'>): CaretInEntry => ({
  ...caretInEntryOf(mode, keyEvent),
  text: mode.kind === 'editing' ? mode.text : '',
  isComposing: keyEvent.caretInEntry?.isComposing === true,
});
export const LIST_KIND_OF_DIGIT_KEY: Partial<Record<string, ListKindOfKey>> = {
  '7': 'numbered',
  Digit7: 'numbered',
  '8': 'bullet',
  Digit8: 'bullet',
  '9': 'checkbox',
  Digit9: 'checkbox',
};
export const listKindOfShortcut = ({
  key,
  isModifierHeld,
  isShiftHeld,
  isAltHeld,
}: Pick<KeyPress, 'key' | 'isModifierHeld' | 'isShiftHeld' | 'isAltHeld'>): ListKindOfKey | undefined =>
  isModifierHeld && isShiftHeld && !isAltHeld ? LIST_KIND_OF_DIGIT_KEY[key] : undefined;
export const isKeyWritingInEntry = (mode: PageMode, keyEvent: KeyPressWithCaret): boolean =>
  formulaKeyActOf(mode, keyEvent, null)?.kind === 'writeInEntry';
export const doesPopupLetLineBreak = (popup: PopupOverEntry | null, allowsInList: boolean): boolean =>
  popup === null || popup === 'formulaNote' || (allowsInList && (popup === 'functionList' || isFormulaPopupYetToRest(popup)));
export const isFormulaPopupYetToRest = (popup: PopupOverEntry | null): boolean => popup === 'formulaOfferYetToRest' || popup === 'formulaReadYetToRest';
