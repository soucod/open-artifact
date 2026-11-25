import { ContextMenu } from '../kit/context-menu.tsx';
import { AgentMark } from '../kit/agent-mark.tsx';
import { hasUnshownCharacters, cleanAskWords } from './chat-with-agent.ts';
import type { ChatWithAgent } from './chat-with-agent.ts';
import type { ErrorExplanation } from '../messages/formula-errors.ts';
import type { ErrorsToTellOfSelection } from '../formulas/errors-to-tell.ts';
import type { SheetController } from '../state/controller.ts';
import type { PageView } from '../view/page-view.ts';
import { errorExplanationWords } from '../messages/formula-errors.ts';
import { fixErrorsLabel } from '../i18n/change-labels.ts';
import { ASK_AGENT_TO_FIX_LABEL } from '../formulas/fix/errors-offer.ts';
import { isMenuHoldingField } from '../state/transitions.ts';
import { MenuItemWithWhyOff } from '../ui/menu-item-why-off.tsx';
import { oneRangeNeededText } from '../i18n/notice-labels.ts';
import { filterMessages, sortMessages } from '../tables/filter-messages.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
/** A cell in error as the agent is told of it: its address, the error, why it shows, and that in words. */
export interface ErrorToldToAgent {
  cell: string;
  error: ErrorExplanation['code'];
  why: ErrorExplanation['tell'];
  explanation: string;
}
/** The errors of the selection the agent is told of, and how many were left out to keep them short. */
export interface ErrorsToldToAgent {
  errors?: ErrorToldToAgent[];
  errorsLeftOut?: number;
}
/** What of the store asks the agent to fix the selection. */
type ControllerToFixSelection = Pick<SheetController, 'getView' | 'errorCountInSelection' | 'errorsToTellOfSelection'>;
/** What of the store asks for fixes on the page. */
type ControllerToFix = Pick<SheetController, 'getView' | 'dispatch' | 'isEventUnfinished'>;
/** Which fix the menu offers: of the active cell, of the selected cells, one yet to be known, or none. */
export type FixOfferInMenu = 'ofActiveCell' | 'ofSelectedCells' | 'yetToBeKnown' | null;
/** What the person may do that bears on fixes in the menu. */
export interface AccessToFix {
  canPersonEdit: boolean;
  isChatToBeHad: boolean | null;
}
/** Whether a menu item is in, held as it was while the menu stays open. */
export interface MenuItemLatch {
  isMenuOpen: boolean;
  isIn: boolean;
}
interface AskAgentMenuItemsProps {
  isIn: boolean;
  isMenuOfContextBar: boolean;
  canAttach: boolean;
  isOneRangeNeeded: boolean;
  isCutByOwnFilters: boolean;
  isCutByOwnSort: boolean;
  doCellsShowError: boolean;
  isPointerCoarse: boolean;
  isCommentNext?: boolean;
  isUnderEnter?: boolean;
  onAsked: (doCellsShowError: boolean) => void;
  onFixAsked?: (() => void) | null;
  isFixYetToBeKnown?: boolean;
}
export function errorsToTellAgent(errorsOfSelection: ErrorsToTellOfSelection | null, canEdit: boolean): ErrorsToldToAgent {
  if (errorsOfSelection === null) return {};
  let errors = errorsOfSelection.errors.map(({ cell, reason: { code, tell } }): ErrorToldToAgent => {
    let why = tell !== null && hasUnshownCharacters(JSON.stringify(tell)) ? null : tell;
    let explanation = cleanAskWords(
      errorExplanationWords(
        {
          code,
          tell: why,
        },
        canEdit,
      ),
    );
    return {
      cell,
      error: code,
      why,
      explanation,
    };
  });
  let bytesOf = (count: number) => new TextEncoder().encode(JSON.stringify(errors.slice(0, count))).length;
  let keptCount = errors.length;
  while (keptCount > 0 && bytesOf(keptCount) > MAX_ERRORS_BYTES_FOR_AGENT) keptCount -= 1;
  let leftOutCount = errorsOfSelection.leftOut + errors.length - keptCount;
  return {
    errors: errors.slice(0, keptCount),
    ...(leftOutCount === 0
      ? {}
      : {
          errorsLeftOut: leftOutCount,
        }),
  };
}
export function askAgentToFixSelection(
  chat: Pick<ChatWithAgent, 'openWithWhatWasPressed'>,
  controller: ControllerToFixSelection,
): Promise<boolean> {
  let { selectionByAddress, viewOnlyBecause } = controller.getView();
  if (selectionByAddress === null) return Promise.resolve(false);
  return chat.openWithWhatWasPressed(
    fixErrorsLabel(controller.errorCountInSelection()),
    selectionByAddress,
    ASK_AGENT_TO_FIX_LABEL,
    errorsToTellAgent(controller.errorsToTellOfSelection(), viewOnlyBecause !== 'readOnly'),
  );
}
export function askAgentAboutSelection(
  chat: Pick<ChatWithAgent, 'openAboutCells' | 'openWithWhatWasPressed'>,
  controller: ControllerToFixSelection & Pick<SheetController, 'isEventUnfinished'>,
  mayAskToFix: boolean,
): Promise<boolean> {
  let view = controller.getView();
  let selectionByAddress = view.selectionByAddress;
  if (selectionByAddress === null) return Promise.resolve(false);
  return mayAskToFix && view.viewOnlyBecause !== 'readOnly' && doesSelectionShowError(view) && !controller.isEventUnfinished()
    ? askAgentToFixSelection(chat, controller)
    : chat.openAboutCells(selectionByAddress).then(() => false);
}
export function askFixInPlace(controller: ControllerToFix, cardOf: string | null): boolean {
  if (controller.getView().noticeOfNoFix !== null)
    controller.dispatch({
      kind: 'noticeOfNoFixPutAway',
    });
  controller.dispatch({
    kind: 'fixInPlaceAsked',
    cardOf,
  });
  let { formulaFromWords, noticeOfNoFix } = controller.getView();
  return controller.isEventUnfinished() || formulaFromWords.stage?.kind === 'asked' || noticeOfNoFix !== null;
}
export function askFixFromMenu(controller: ControllerToFix, closeMenu: () => void): void {
  let { menu } = controller.getView();
  if (menu === null || isMenuHoldingField(menu)) return;
  closeMenu();
  if (!controller.isEventUnfinished()) askFixInPlace(controller, null);
}
export function askFixesOfSelectedCellsFromMenu(controller: ControllerToFix, closeMenu: () => void): boolean {
  let { menu } = controller.getView();
  if (menu === null || isMenuHoldingField(menu)) return false;
  closeMenu();
  if (controller.isEventUnfinished()) return false;
  controller.dispatch({
    kind: 'fixesOfSelectedCellsAsked',
  });
  return true;
}
export function fixOfferInMenu(
  view: Pick<
    PageView,
    'canActiveCellBeFixedHere' | 'selectionByAddress' | 'fixesOfSelectedCells' | 'isFixOfActiveCellYetToBeKnown' | 'doesFixWaitForCalculation'
  >,
  access: AccessToFix,
): FixOfferInMenu {
  if (!access.canPersonEdit) return null;
  if (view.canActiveCellBeFixedHere) return 'ofActiveCell';
  let fixesOfSelectedCells = view.selectionByAddress === null ? null : view.fixesOfSelectedCells;
  if (fixesOfSelectedCells === 'offered') return 'ofSelectedCells';
  return (view.isFixOfActiveCellYetToBeKnown || fixesOfSelectedCells === 'undecided') && !(view.doesFixWaitForCalculation && access.isChatToBeHad)
    ? 'yetToBeKnown'
    : null;
}
export function AskAgentMenuItems({
  isIn,
  isMenuOfContextBar,
  canAttach,
  isOneRangeNeeded,
  isCutByOwnFilters,
  isCutByOwnSort,
  doCellsShowError,
  isPointerCoarse,
  isCommentNext = false,
  isUnderEnter = false,
  onAsked,
  onFixAsked = null,
  isFixYetToBeKnown = false,
}: AskAgentMenuItemsProps) {
  if (!isIn || isMenuOfContextBar) return null;
  let canAsk = !isFixYetToBeKnown && (canAttach || onFixAsked !== null);
  let label = askAgentMenuLabel(doCellsShowError);
  return <><MenuItemWithWhyOff icon={<AgentMark size={ASK_AGENT_ICON_SIZE} {...(!canAsk && {
            color: 'currentColor',
          })} />} disabled={!canAsk} {...(!canAsk &&
          !isOneRangeNeeded && {
            'data-keeps-highlight': '',
          })} whyOff={isOneRangeNeeded
          ? oneRangeNeededText('askAgent')
          : isCutByOwnFilters && isCutByOwnSort && !isFixYetToBeKnown
            ? sortMessages.sortAndFilterCutCellsForAgent()
            : isCutByOwnFilters && !isFixYetToBeKnown
              ? filterMessages.filterCutsCellsForAgent()
              : isCutByOwnSort && !isFixYetToBeKnown
                ? sortMessages.sortCutsCellsForAgent()
                : null} isPointerCoarse={isPointerCoarse} {...(isUnderEnter && {
          className: 'sheet-row-under-enter',
        })} onClick={onFixAsked ?? (() => onAsked(doCellsShowError))}>{onFixAsked === null && !isFixYetToBeKnown ? label : sheetMessages.fixWithAgent()}</MenuItemWithWhyOff>{!isCommentNext && <ContextMenu.Separator />}</>;
}
export const CLOSED_MENU_ITEM_LATCH: MenuItemLatch = {
  isMenuOpen: false,
  isIn: false,
};
export const latchMenuItemWhileOpen = (
  latch: MenuItemLatch,
  isMenuOpen: boolean,
  isInNow: boolean | null,
  isInBefore: boolean,
): MenuItemLatch =>
  isMenuOpen === latch.isMenuOpen
    ? latch
    : {
        isMenuOpen,
        isIn: isMenuOpen ? (isInNow ?? isInBefore) : latch.isIn,
      };
export const doesSelectionShowError = ({
  errorOfActiveCell,
  selectedRange,
  calculating,
}: Pick<PageView, 'errorOfActiveCell' | 'selectedRange' | 'calculating'>): boolean =>
  calculating !== 'wrong' && errorOfActiveCell?.code !== '#TIMEOUT!' && (errorOfActiveCell !== null || selectedRange?.summary?.kind === 'errors');
export const MAX_ERRORS_BYTES_FOR_AGENT = 3000;
export const askAgentMenuLabel = (doCellsShowError: boolean): string =>
  doCellsShowError ? sheetMessages.askAgentToFix() : sheetMessages.askAgentAboutCells();
export const ASK_AGENT_ICON_SIZE = 16;
