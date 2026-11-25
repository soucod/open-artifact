import { Menu } from '../kit/menu.tsx';
import type { SheetController } from '../state/controller.ts';
import type { Figure, FiguresOfNumbers, FiguresOfSelection } from '../state/figures-of-selection.ts';
import type { SignsOfNumbers } from '../model/workbook.ts';
import type { MenuOpenChange } from './sheet-tabs/add-sheet.tsx';
import type { CaretTarget } from '../tables/own-filter-bar-view.tsx';
import * as React from 'react';
import { ToolbarMenu } from './format-toolbar.tsx';
import { MenuTriggerButton } from './menu-trigger.tsx';
import { figureForSelectionLabel, selectionSummaryLabel, figureWithValueLabel } from '../i18n/grid-action-labels.ts';
import { SUM_BAR_AGGREGATES } from '../state/transitions.ts';
import { formatNumberWithSigns } from '../format/number-signs.ts';
/** A figure the bar can show for the selected cells. */
export type FigureName = keyof FiguresOfNumbers;
/** A figure as the menu shows it: its name and its value in words. */
export interface FigureInWords {
  figure: FigureName;
  words: string;
}
/** The figures of the selection, read by name; a name with no figure is left out. */
export type FiguresKept = Omit<FiguresOfSelection, 'figures'> & { figures: Partial<FiguresOfNumbers> | null };
export function refreshFiguresWhenSettled(subscribe: SheetController['subscribe'], refresh: () => void) {
  let delayTimer = setTimeout(refresh, FIGURES_REFRESH_DELAY_MS);
  const intervalTimer = setInterval(refresh, FIGURES_REFRESH_INTERVAL_MS);
  const unsubscribe = subscribe(() => {
    clearTimeout(delayTimer);
    delayTimer = setTimeout(refresh, FIGURES_REFRESH_DELAY_MS);
  });
  return () => {
    unsubscribe();
    clearTimeout(delayTimer);
    clearInterval(intervalTimer);
  };
}
export interface FiguresMenuProps {
  all: FigureInWords[];
  onShow: FigureInWords;
  onPicked: (figure: FigureName) => void;
  onMenuOpenChange: MenuOpenChange;
  whatHasCaretAfter: () => CaretTarget;
}
export function FiguresMenu({
  all,
  onShow,
  onPicked,
  onMenuOpenChange,
  whatHasCaretAfter,
}: FiguresMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLElement>(null);
  const isOpenRef = React.useRef(false);
  React.useLayoutEffect(
    () => () => {
      const wasOpen = isOpenRef.current;
      if (wasOpen) onMenuOpenChange(false, null);
      const { current: button } = buttonRef;
      if (!wasOpen && button !== button?.ownerDocument.activeElement) return;
      queueMicrotask(() => {
        const caretAfter = whatHasCaretAfter();
        if (caretAfter !== false)
          caretAfter.focus({
            preventScroll: true,
          });
      });
    },
    [onMenuOpenChange, whatHasCaretAfter],
  );
  return <ToolbarMenu isOpen={isOpen} button={<MenuTriggerButton ref={buttonRef} variant="ghost" aria-label={figureForSelectionLabel(onShow.words)} chevron="toolbar"><span className="tabular-nums">{onShow.words}</span></MenuTriggerButton>} tooltip={null} onOpenChange={(open: boolean, event: Event | null) => {
      isOpenRef.current = open;
      setIsOpen(open);
      onMenuOpenChange(open, event);
    }} whatHasCaretAfter={whatHasCaretAfter} toolbar={buttonRef} side="top"><Menu.Group aria-label={selectionSummaryLabel()}>{all.map(
        ({ figure, words }) =>
          <Menu.Item key={figure} checkedRole="radio" checked={figure === onShow.figure} onClick={() => onPicked(figure)}><span className="tabular-nums">{words}</span></Menu.Item>,
      )}</Menu.Group></ToolbarMenu>;
}
export function useHasRoomForFigures(inPageRef: React.RefObject<HTMLElement | null>) {
  const [hasRoom, setHasRoom] = React.useState(true);
  React.useLayoutEffect(() => {
    const mediaQuery = inPageRef.current?.ownerDocument.defaultView?.matchMedia(FIGURES_ROOM_MEDIA_QUERY);
    if (mediaQuery === undefined) return;
    const update = () => setHasRoom(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [inPageRef]);
  return hasRoom;
}
export interface FiguresOfSelectionDueProps {
  store: Pick<SheetController, 'subscribe' | 'dispatch'>;
}
export function FiguresOfSelectionDue({ store }: FiguresOfSelectionDueProps) {
  React.useEffect(
    () =>
      refreshFiguresWhenSettled(
        store.subscribe,
        () =>
          store.dispatch({
            kind: 'figuresOfSelectionDue',
          }),
      ),
    [store],
  );
  return null;
}
export interface SelectionFiguresProps extends Pick<FiguresMenuProps, 'onMenuOpenChange' | 'whatHasCaretAfter'> {
  kept: FiguresKept;
  signsOfNumbers: SignsOfNumbers;
  store: FiguresOfSelectionDueProps['store'];
  inPage: React.RefObject<HTMLElement | null>;
}
export function SelectionFigures({
  kept: { figures, areDue, ofCells },
  signsOfNumbers,
  store,
  inPage,
  ...menuProps
}: SelectionFiguresProps) {
  const hasRoom = useHasRoomForFigures(inPage);
  const figuresDue = areDue
    ? <FiguresOfSelectionDue key={ofCells} store={store} />
    : null;
  const [pickedFigure, setPickedFigure] = React.useState<FigureName>('sum');
  if (!hasRoom) return null;
  const allFigures = SUM_BAR_AGGREGATES.flatMap((figureName): FigureInWords[] => {
    const figureOfName = figures?.[figureName];
    return figureOfName === undefined
      ? []
      : [
          {
            figure: figureName,
            words: figureWords(figureName, figureOfName, signsOfNumbers),
          },
        ];
  });
  const shownFigure = allFigures.find(({ figure }) => figure === pickedFigure) ?? allFigures.at(-1);
  if (shownFigure === undefined) return figuresDue;
  return <>{figuresDue}<div className="sheet-figures"><FiguresMenu all={allFigures} onShow={shownFigure} onPicked={setPickedFigure} {...menuProps} /></div></>;
}
export const FIGURES_REFRESH_DELAY_MS = 200;
export const FIGURES_REFRESH_INTERVAL_MS = 1000;
export const figureWords = (figure: FigureName, { value, written }: Figure, signsOfNumbers: SignsOfNumbers) =>
  figureWithValueLabel(figure, written ?? formatNumberWithSigns(value, signsOfNumbers));
export const FIGURES_ROOM_MEDIA_QUERY = '(min-width:500px)';
