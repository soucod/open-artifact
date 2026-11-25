import type * as React from 'react';
import type { CellAt } from '@open-artifact/sheets-core';
import type { SheetController } from '../state/controller.ts';
import { isPaneMenuOfContextBar } from '../state/context-bar.ts';
export interface ContextBarMenuNoting {
  store: SheetController;
  /** The context bar menu last seen open, or null. */
  noted: React.RefObject<string | null>;
  /** Says whether a context bar menu is still noted open, and the event that closed one, if any. */
  note: (isMenuNoted: boolean, closedBy: Event | null) => void;
  onCardAsked: () => void;
}
export interface ContextBarMenuHandlers {
  onOpenChange(menu: string, isOpen: boolean, event: Event | null, filterBarOf?: string | CellAt): void;
  onRulesAskedByRow(rowKind: 'cells' | 'toolbar', isFromPane: boolean): void;
  onNoMenuInState: () => void;
}
export function contextBarMenuHandlers({
  store,
  noted,
  note,
  onCardAsked,
}: ContextBarMenuNoting): ContextBarMenuHandlers {
  let afterEventsSettle = (then: () => void) => {
    let notedMenu = noted.current;
    if (notedMenu === null) return;
    store.lookOnceEventsAreFinished(() => {
      if (noted.current !== notedMenu) return;
      if (store.getView().contextBarMenu !== null) return;
      noted.current = null;
      note(false, null);
      then();
    });
  };
  let handlers: ContextBarMenuHandlers = {
    onOpenChange(menu, isOpen, event, filterBarOf) {
      if (isOpen) noted.current = menu;
      else if (noted.current === menu) noted.current = null;
      store.dispatch({
        kind: 'contextBarMenuChanged',
        menu,
        isOpen,
        ...(filterBarOf !== undefined && {
          ofFilterBarFor: filterBarOf,
        }),
      });
      note(noted.current !== null, isOpen ? null : event);
      if (!isOpen) return;
      let opensInPane = menu === 'conditionalFormatting' && !store.getView().doRulesOpenInCard;
      if (isPaneMenuOfContextBar(menu) && !opensInPane) onCardAsked();
    },
    onRulesAskedByRow(_rowKind, isFromPane) {
      if (!isFromPane && store.getView().conditionalFormats?.drawnAs !== 'pane') return handlers.onOpenChange('conditionalFormatting', true, null);
      store.dispatch({
        kind: 'conditionalFormatsAsked',
        by: 'menu',
      });
    },
    onNoMenuInState: () => afterEventsSettle(() => {}),
  };
  return handlers;
}
