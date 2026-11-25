import { Popover } from '../kit/popover.tsx';
import { Tooltip } from '../kit/tooltip.tsx';
import * as React from 'react';
import { describedArgumentAt, isBooleanLiteralName, describeFunction } from './function-help.ts';
import { formulaArgumentSeparator } from '../format/number-signs.ts';
import { Fragment } from 'react/jsx-runtime';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import {
  hasRoomForCardBesideList,
  useLastNonNull,
  ListRow,
  ListRowQuietText,
  ListGroup,
  ListUnderCell,
  ListSeparator,
  withListTabStops,
} from '../ui/list-under-cell.tsx';
import {
  functionArgumentWords,
  autocompleteColumnsHeading,
  autocompleteFunctionsHeading,
  functionCategoryLabel,
  autocompleteColumnWords,
  autocompleteRowWords,
  functionWithoutArgumentsWords,
  formulaAutocompleteLabel,
} from '../messages/formula-autocomplete.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { rememberCaretAtEnd } from '../editor/entry-boxes.ts';
import { entryEditorOf } from '../dom/entry-editor.ts';
import { useCoveredUnderCells, popupCollisionPadding } from '../shell/bottom-insets.ts';
import type { DecimalSignName } from '@open-artifact/sheets-core';
import type { CatalogFunction } from './function-catalog.ts';
import type { CaretInText, FunctionList as FunctionListState, FunctionListRow } from '../state/initial-state.ts';
import type { FunctionGuideAtCall } from './autocomplete.ts';
import type { EditingMode } from '../state/transitions.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { EntryBoxes } from '../editor/entry-boxes.ts';
import type { AnchorOnPage, ListboxIds } from '../chips/people-list-view.tsx';
/** A piece of a function's signature, and whether it is the argument being typed. */
export interface SignaturePiece {
  text: string;
  isBeingTyped: boolean;
}
/** A piece of a signature as it is drawn: with its key, and whether the line may break after it. */
export interface SignaturePart extends SignaturePiece {
  key: number;
  canBreakLine: boolean;
}
/** A place to put a popup against that is no element of its own, with the element it lies in. */
export interface AnchorInElement extends AnchorOnPage {
  readonly contextElement: Element | undefined;
}
/** What was last read out about the function list or the argument being typed. */
export interface FunctionAnnouncement {
  readonly words: string | null;
  readonly call: FunctionGuideAtCall | null;
  readonly row: FunctionListRow | null;
  readonly heading: string | null;
}
/** A row of the function list the pointer is on, and the list it was on then. */
interface PointedFunctionRow {
  at: FunctionListRow;
  in: FunctionListState;
}
interface FunctionSignatureProps {
  signature: CatalogFunction;
  argumentAt: number | null;
  argumentCount: number | null;
}
interface FunctionRowNameProps {
  name: string;
  isAlone: boolean;
}
interface FunctionRowSignatureProps {
  signature: CatalogFunction;
}
interface FunctionListAnnouncerProps {
  list: FunctionListState | null;
  guide: FunctionGuideAtCall | null;
  writtenWhole: FunctionListRow | null;
  timesCaretTold: number;
  isBoxAComboBox: boolean;
  isReferencePointedAt: boolean;
}
interface FunctionHelpProps {
  list: FunctionListState | null;
  guide: FunctionGuideAtCall | null;
  caretAfterPick: CaretInText | null;
  writtenWhole: FunctionListRow | null;
  typingIn: EditingMode['typingIn'] | null;
  isBoxInSight: boolean;
  isCellBoxAComboBox: boolean;
  isReferencePointedAt: boolean;
  cellAnchor: AnchorOnPage;
  cellElementId: string | null;
  decimalSign: DecimalSignName;
  boxes: EntryBoxes;
  dispatch: (event: PageEvent) => void;
}
interface FunctionListProps {
  list: FunctionListState | null;
  anchor: AnchorOnPage;
  cellElementId: string | null;
  inPage: React.RefObject<HTMLElement | null>;
  onRowChosen: (row: FunctionListRow) => void;
  onShut: (event: Event) => void;
}
interface FunctionGuideProps {
  guide: FunctionGuideAtCall | null;
  anchor: AnchorOnPage;
}
export function argumentPieces(signature: CatalogFunction, argumentAt: number | null, argumentCount: number | null): SignaturePiece[] {
  let { arguments: allArguments } = signature;
  let shownArgs = allArguments.filter(({ isHidden }) => !isHidden);
  let pieces = shownArgs.map(
    ({ name, isOptional, repeats }) => ({
      text: isOptional ? `[${name}]` : name,
      repeats,
    }),
  );
  let repeatAt = pieces.findIndex(({ repeats }) => repeats);
  let texts = pieces.map(({ text }) => text);
  if (repeatAt === -1) {
    let isPastEnd = argumentAt !== null && argumentAt >= texts.length && allArguments.length > texts.length;
    return signaturePieces(texts, argumentAt === null || isPastEnd ? null : Math.min(argumentAt, texts.length - 1));
  }
  let repeating = pieces.filter(({ repeats }) => repeats).map(({ text }) => text);
  let before = texts.slice(0, repeatAt + repeating.length);
  let after = texts.slice(repeatAt + repeating.length);
  let typedArgument = argumentAt === null ? undefined : describedArgumentAt(signature, argumentAt, argumentCount);
  let typedIndex = typedArgument === undefined ? -1 : shownArgs.indexOf(typedArgument);
  if (typedIndex >= before.length) return signaturePieces([...before, SIGNATURE_ELLIPSIS, ...after], typedIndex + 1);
  let intoRepeat = argumentAt === null ? 0 : Math.max(0, argumentAt - repeatAt);
  let rounds = Math.floor(intoRepeat / repeating.length);
  if (rounds === 0) return signaturePieces([...before, SIGNATURE_ELLIPSIS, ...after], argumentAt);
  if (rounds === 1) return signaturePieces([...before, ...repeating, SIGNATURE_ELLIPSIS, ...after], argumentAt);
  return signaturePieces(
    [...before, SIGNATURE_ELLIPSIS, ...repeating, SIGNATURE_ELLIPSIS, ...after],
    before.length + 1 + (intoRepeat % repeating.length),
  );
}
export function signatureParts(
  signature: CatalogFunction,
  argumentAt: number | null,
  argumentCount: number | null,
  decimalSign: DecimalSignName,
): SignaturePart[] {
  if (isBooleanLiteralName(signature.name))
    return [
      {
        ...plainPiece(signature.name),
        key: 0,
        canBreakLine: false,
      },
    ];
  let separator = plainPiece(`${formulaArgumentSeparator(decimalSign)} `);
  return [
    plainPiece(`${signature.name}(`),
    ...argumentPieces(signature, argumentAt, argumentCount).flatMap(
      (piece, index) => (index === 0 ? [piece] : [separator, piece]),
    ),
    plainPiece(')'),
  ].map(
    (piece, index) => ({
      text: piece.text,
      isBeingTyped: piece.isBeingTyped,
      canBreakLine: piece === separator,
      key: index,
    }),
  );
}
export function FunctionSignature({ signature, argumentAt, argumentCount }: FunctionSignatureProps) {
  return signatureParts(signature, argumentAt, argumentCount, React.use(DecimalSignContext)).map(
    ({ text, isBeingTyped, canBreakLine, key }) =>
      <React.Fragment key={key}>{isBeingTyped
            ? <strong className="font-semibold whitespace-nowrap">{text}</strong>
            : canBreakLine
              ? text
              : <span className="whitespace-nowrap">{text}</span>}</React.Fragment>,
  );
}
export function measureTextWidth(element: HTMLElement, text: string): number {
  let ownerDocument = element.ownerDocument;
  let style = ownerDocument.defaultView?.getComputedStyle(element);
  if (style === undefined) return 0;
  let probe = ownerDocument.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  for (let property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing'] satisfies (keyof CSSStyleDeclaration)[])
    probe.style[property] = style[property];
  probe.style.fontFeatureSettings = style.fontFeatureSettings;
  probe.style.fontVariantNumeric = style.fontVariantNumeric;
  probe.textContent = text;
  ownerDocument.body.append(probe);
  let { width } = probe.getBoundingClientRect();
  probe.remove();
  return width;
}
export function useCaretAnchor(boxRef: React.RefObject<HTMLTextAreaElement | null>, caretAt: number): AnchorInElement {
  return React.useMemo(
    () => ({
      get contextElement() {
        return boxRef.current ?? undefined;
      },
      getBoundingClientRect() {
        let box = boxRef.current;
        let style = box?.ownerDocument.defaultView?.getComputedStyle(box);
        if (box === null || style === undefined) return new DOMRect();
        let { left, top, right, height } = box.getBoundingClientRect();
        let contentLeft = left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
        let lineStart =
          box.value.lastIndexOf(
            `
`,
            caretAt,
          ) + 1;
        let caretX = measureTextWidth(box, box.value.slice(lineStart, caretAt)) - box.scrollLeft;
        return new DOMRect(Math.min(Math.max(contentLeft, contentLeft + caretX), right), top, 0, height);
      },
    }),
    [boxRef, caretAt],
  );
}
export function useCaretMoves({ cell, formulaBar }: EntryBoxes, dispatch: (event: PageEvent) => void): number {
  let [caretMoves, setCaretMoves] = React.useState(0);
  React.useEffect(() => {
    let ownerDocument = formulaBar.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    let noteCaret = () => {
      let box = [cell.current, formulaBar.current].find(
        (element) => element !== null && element === ownerDocument.activeElement,
      );
      let { selectionStart: start = null, selectionEnd: end = null } = box ?? {};
      if (box === undefined || box === null || start === null || end === null) return;
      dispatch({
        kind: 'entryCaretMoved',
        text: box.value,
        start,
        end,
      });
      if (isFormulaText(box.value)) setCaretMoves((count) => count + 1);
    };
    ownerDocument.addEventListener('selectionchange', noteCaret);
    ownerDocument.addEventListener('input', noteCaret);
    return () => {
      ownerDocument.removeEventListener('selectionchange', noteCaret);
      ownerDocument.removeEventListener('input', noteCaret);
    };
  }, [cell, formulaBar, dispatch]);
  return caretMoves;
}
export function hasRoomBesideFunctionList(anchor: AnchorOnPage, inPage: React.RefObject<HTMLElement | null>): boolean {
  let pageWidth = inPage.current?.ownerDocument.documentElement.clientWidth ?? 0;
  let furthestLeft = pageWidth - FUNCTION_LIST_NARROW_WIDTH - FUNCTION_LIST_EDGE;
  let left = Math.max(FUNCTION_LIST_EDGE, Math.min(anchor.getBoundingClientRect().left, furthestLeft));
  return hasRoomForCardBesideList(
    {
      left,
      right: left + FUNCTION_LIST_NARROW_WIDTH,
    },
    pageWidth,
  );
}
export function FunctionRowName({ name, isAlone }: FunctionRowNameProps) {
  let signature = describeFunction(name);
  if (!isAlone && signature !== null)
    return <FunctionRowSignature signature={signature} />;
  return <span aria-hidden className="min-w-0 flex-1 truncate">{name}</span>;
}
export function FunctionRowSignature({ signature }: FunctionRowSignatureProps) {
  return <span aria-hidden className="flex min-w-0 flex-1 flex-col"><span><FunctionSignature signature={signature} argumentAt={null} argumentCount={null} /></span><span className="text-footnote break-words text-secondary">{signature.description}</span></span>;
}
export function passPointerThroughParent(element: HTMLElement | null): void {
  element?.parentElement?.style.setProperty('pointer-events', 'none');
}
export function argumentAnnouncement(call: FunctionGuideAtCall, withFunctionName: boolean): string | null {
  let signature = describeFunction(call.name);
  let shownArgs = signature?.arguments.filter(({ isHidden }) => !isHidden) ?? [];
  let argument = signature === null ? undefined : describedArgumentAt(signature, call.argumentAt, call.argumentCount);
  if (call.said === 'never' || argument === undefined || argument.isHidden) return null;
  return functionArgumentWords({
    functionName: withFunctionName ? call.name : null,
    number: call.argumentAt + 1,
    count: shownArgs.some(({ repeats }) => repeats) ? null : shownArgs.length,
    argument: argument.name,
    isOptional: argument.isOptional,
  });
}
export function functionListHeadingOf({ columns, names, families }: FunctionListState, highlighted: FunctionListRow): string | null {
  if (typeof highlighted !== 'string') return autocompleteColumnsHeading();
  if (columns.length > 0) return autocompleteFunctionsHeading();
  let family = families.findLast(({ from }) => from <= names.indexOf(highlighted));
  return family === undefined ? null : functionCategoryLabel(family.family);
}
export function nextFunctionAnnouncement(
  said: FunctionAnnouncement,
  rowToSay: FunctionListRow | null,
  guide: FunctionGuideAtCall | null,
  writtenWhole: FunctionListRow | null = null,
  heading: string | null = null,
): FunctionAnnouncement {
  if (rowToSay !== null) {
    if (said.row !== null && autocompleteColumnWords(rowToSay) === autocompleteColumnWords(said.row) && heading === said.heading) return said;
    return {
      words: heading === null || heading === said.heading ? autocompleteColumnWords(rowToSay) : autocompleteRowWords(heading, rowToSay),
      call: null,
      row: rowToSay,
      heading,
    };
  }
  if (writtenWhole !== null && typeof writtenWhole !== 'string')
    return {
      ...NO_FUNCTION_ANNOUNCEMENT,
      words: writtenWhole.cells,
      call: guide,
    };
  if (guide === null)
    return writtenWhole === null
      ? NO_FUNCTION_ANNOUNCEMENT
      : {
          ...NO_FUNCTION_ANNOUNCEMENT,
          words: functionWithoutArgumentsWords(writtenWhole),
        };
  const isSameCall = said.call?.name === guide.name && said.call.start === guide.start;
  if (isSameCall && said.call.argumentAt === guide.argumentAt && said.call.argumentCount === guide.argumentCount) return said;
  let argumentWords = argumentAnnouncement(guide, !isSameCall);
  return argumentWords === null
    ? NO_FUNCTION_ANNOUNCEMENT
    : {
        ...NO_FUNCTION_ANNOUNCEMENT,
        words: argumentWords,
        call: guide,
      };
}
export function FunctionListAnnouncer({
  list,
  guide,
  writtenWhole,
  timesCaretTold,
  isBoxAComboBox,
  isReferencePointedAt,
}: FunctionListAnnouncerProps) {
  let rowToSay = list === null || isBoxAComboBox ? null : list.highlighted;
  let heading = list === null || rowToSay === null ? null : functionListHeadingOf(list, rowToSay);
  let isSayNow = list === null ? guide === null || guide.said !== 'afterRest' : list.isHighlightedByKey;
  let [announcement, setAnnouncement] = React.useState(NO_FUNCTION_ANNOUNCEMENT);
  let toSay = React.useMemo(
    () => ({
      rowToSay,
      heading,
      guide: list === null ? guide : null,
      writtenWhole,
      timesCaretTold,
    }),
    [rowToSay, heading, list, guide, writtenWhole, timesCaretTold],
  );
  React.useEffect(() => {
    if (isReferencePointedAt) return;
    let timer = setTimeout(
      () =>
        setAnnouncement((said) => nextFunctionAnnouncement(said, toSay.rowToSay, toSay.guide, toSay.writtenWhole, toSay.heading)),
      isSayNow ? 0 : FUNCTION_ANNOUNCE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [toSay, isSayNow, isReferencePointedAt]);
  return <LiveAnnouncer words={announcement.words} />;
}
export function FunctionHelp({
  list,
  guide,
  caretAfterPick,
  writtenWhole,
  typingIn,
  isBoxInSight,
  isCellBoxAComboBox,
  isReferencePointedAt,
  cellAnchor,
  cellElementId,
  decimalSign,
  boxes,
  dispatch,
}: FunctionHelpProps) {
  let timesCaretTold = useCaretMoves(boxes, dispatch);
  let caretAfterPickRef = React.useRef<CaretInText | null>(null);
  React.useLayoutEffect(() => {
    let box = typingIn === null ? null : boxes[typingIn].current;
    if (box === null || caretAfterPick === null || caretAfterPick === caretAfterPickRef.current) return;
    caretAfterPickRef.current = caretAfterPick;
    if (box.value !== caretAfterPick.text) return;
    box.setSelectionRange(caretAfterPick.start, caretAfterPick.end);
    rememberCaretAtEnd(box);
  }, [caretAfterPick, typingIn, boxes]);
  let isInFormulaBar = useLastNonNull(typingIn) === 'formulaBar';
  let listAnchorInBar = useCaretAnchor(boxes.formulaBar, useLastNonNull(list)?.typedFrom ?? 0);
  let guideAnchorInBar = useCaretAnchor(boxes.formulaBar, useLastNonNull(guide)?.start ?? 0);
  let listAnchor = isInFormulaBar ? listAnchorInBar : cellAnchor;
  let guideAnchor = isInFormulaBar ? guideAnchorInBar : cellAnchor;
  let { chooseRow, shut } = React.useMemo(
    () => ({
      chooseRow: (row: FunctionListRow) =>
        dispatch({
          kind: 'functionListRowChosen',
          ...(typeof row === 'string'
            ? {
                name: row,
              }
            : {
                columnId: row.columnId,
              }),
        }),
      shut: (event: Event) => {
        let isInBox = entryEditorOf(event.target) === boxes.cell.current || event.target === boxes.formulaBar.current;
        let isInList = event.target instanceof Element && event.target.closest(`[${OPENS_FUNCTION_LIST_ATTRIBUTE}]`) !== null;
        if (event.type !== 'keydown' && !isInBox && !isInList)
          dispatch({
            kind: 'functionListShut',
          });
      },
    }),
    [dispatch, boxes],
  );
  return <DecimalSignContext value={decimalSign}><FunctionList list={list} anchor={listAnchor} cellElementId={cellElementId} inPage={boxes.formulaBar} onRowChosen={chooseRow} onShut={shut} /><FunctionGuide guide={isBoxInSight ? guide : null} anchor={guideAnchor} /><FunctionListAnnouncer list={list} guide={guide} writtenWhole={writtenWhole} timesCaretTold={timesCaretTold} isBoxAComboBox={isCellBoxAComboBox && typingIn === 'cell'} isReferencePointedAt={isReferencePointedAt} /></DecimalSignContext>;
}
export const FUNCTION_LIST_ID = 'function-list';
export const OPENS_FUNCTION_LIST_ATTRIBUTE = 'data-opens-function-list';
export const functionListRowId = (row: FunctionListRow): string =>
  typeof row === 'string' ? `${FUNCTION_LIST_ID}-${row}` : `${FUNCTION_LIST_ID}-column-${row.columnId}`;
export const functionListActiveDescendant = ({ highlighted }: Pick<FunctionListState, 'highlighted'>): ListboxIds => ({
  id: FUNCTION_LIST_ID,
  highlightedRowId: functionListRowId(highlighted),
});
export const SIGNATURE_ELLIPSIS = '…';
export const DecimalSignContext = React.createContext<DecimalSignName>('point');
export const signaturePieces = (texts: readonly string[], typedIndex: number | null): SignaturePiece[] =>
  texts.map(
    (text, index) => ({
      text,
      isBeingTyped: index === typedIndex,
    }),
  );
export const plainPiece = (text: string): SignaturePiece => ({
  text,
  isBeingTyped: false,
});
export const FUNCTION_LIST_NARROW_WIDTH = 200;
export const FUNCTION_LIST_EDGE = 8;
export const FUNCTION_POINT_DELAY_MS = 300;
export const functionRowAnchor = (rowId: string, inPage: React.RefObject<HTMLElement | null>): AnchorInElement => ({
  get contextElement() {
    return inPage.current?.ownerDocument.getElementById(rowId) ?? undefined;
  },
  getBoundingClientRect() {
    let rowElement = inPage.current?.ownerDocument.getElementById(rowId) ?? null;
    let listFrame = rowElement?.closest('[role=listbox]')?.parentElement;
    if (rowElement === null || listFrame === null || listFrame === undefined) return new DOMRect();
    let { top, height } = rowElement.getBoundingClientRect();
    let { left, width } = listFrame.getBoundingClientRect();
    return new DOMRect(left, top, width, height);
  },
});
export const FunctionList = React.memo(function ({
  list,
  anchor,
  cellElementId,
  inPage,
  onRowChosen,
  onShut,
}: FunctionListProps) {
  let shownList: FunctionListState | null = useLastNonNull(list);
  let names = shownList?.names ?? [];
  let columns = shownList?.columns ?? [];
  let families = shownList?.families ?? [];
  let [hasRoomBeside, setHasRoomBeside] = React.useState(true);
  let insets = useCoveredUnderCells();
  let measureRoomBeside = React.useCallback(() => setHasRoomBeside(hasRoomBesideFunctionList(anchor, inPage)), [anchor, inPage]);
  let [pointed, setPointed] = React.useState<PointedFunctionRow | null>(null);
  let pointedRow = pointed !== null && pointed.in === list ? pointed.at : null;
  let [settledPointedRow, setSettledPointedRow] = React.useState<FunctionListRow | null>(null);
  React.useEffect(() => {
    let timer = setTimeout(() => setSettledPointedRow(pointedRow), pointedRow === null ? 0 : FUNCTION_POINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pointedRow]);
  let rowToDescribe = pointedRow !== null && settledPointedRow === pointedRow ? pointedRow : shownList?.highlighted;
  let signatureToShow = typeof rowToDescribe === 'string' ? describeFunction(rowToDescribe) : null;
  let isOpen = list !== null;
  let rowAnchor = React.useMemo(
    () => (!isOpen || typeof rowToDescribe !== 'string' ? null : functionRowAnchor(functionListRowId(rowToDescribe), inPage)),
    [isOpen, rowToDescribe, inPage],
  );
  let renderRow = (row: FunctionListRow, index: number) =>
    <ListRow key={functionListRowId(row)} id={functionListRowId(row)} placeInList={index + 1} rowsInList={columns.length + names.length} isHighlighted={row === shownList?.highlighted} onChosen={() => onRowChosen(row)} onPointedAt={() =>
          setPointed(
            (pointedNow) =>
              list === null || (pointedNow?.at === row && pointedNow.in === list)
                ? pointedNow
                : {
                    at: row,
                    in: list,
                  },
          )} isOnlyTintedByPointer tellsOfEveryMove onPointerLeave={() => setPointed(null)}><span className="sr-only">{autocompleteColumnWords(row)}</span>{typeof row === 'string'
            ? <FunctionRowName name={row} isAlone={hasRoomBeside} />
            : <span aria-hidden className="flex min-w-0 flex-1 items-baseline gap-md"><span className="min-w-0 flex-1 break-words">{row.heading}</span><ListRowQuietText>{row.cells}</ListRowQuietText></span>}</ListRow>;
  let functionRows = names.map((row, index) => renderRow(row, columns.length + index));
  let hasBothKinds = columns.length > 0 && names.length > 0;
  let functionRowsGroup = hasBothKinds
    ? <ListGroup headingId={`${FUNCTION_LIST_ID}-heading-functions`} heading={autocompleteFunctionsHeading()}>{functionRows}</ListGroup>
    : functionRows;
  return <><ListUnderCell id={FUNCTION_LIST_ID} isOpen={isOpen} anchor={anchor} cellElementId={cellElementId} label={formulaAutocompleteLabel(columns.length > 0)} className={hasRoomBeside ? 'w-[200px]' : 'w-[400px] max-w-[calc(100vw-16px)]'} mostHeightOfRows={families.length === 0 ? '264px' : '376px'} doHeadingsStayInSight={families.length > 0} onShut={onShut} onRoomBesideMeasured={measureRoomBeside}>{columns.length > 0 &&
            <ListGroup headingId={`${FUNCTION_LIST_ID}-heading-columns`} heading={autocompleteColumnsHeading()}>{columns.map(renderRow)}</ListGroup>}{hasBothKinds && <ListSeparator />}{families.length === 0
            ? functionRowsGroup
            : families.map(
                ({ family, from }, index) =>
                  <ListGroup key={family} headingId={`${FUNCTION_LIST_ID}-heading-${family}`} heading={functionCategoryLabel(family)} doesHeadingStayInSight>{functionRows.slice(from, families[index + 1]?.from)}</ListGroup>,
              )}</ListUnderCell>{rowAnchor !== null &&
        signatureToShow !== null &&
        (<Tooltip anchor={rowAnchor} open={hasRoomBeside} side="right" align="start" sideOffset={8} collisionPadding={popupCollisionPadding(insets)} collisionAvoidance={{
            fallbackAxisSide: 'none',
          }} className="max-w-[194px]" content={<span aria-hidden><FunctionSignature signature={signatureToShow} argumentAt={null} argumentCount={null} /></span>} detail={<span aria-hidden>{signatureToShow.description}</span>} />)}</>;
});
export const FunctionGuide = React.memo(function ({ guide, anchor }: FunctionGuideProps) {
  let call: FunctionGuideAtCall | null = useLastNonNull(guide);
  let signature = call === null ? null : describeFunction(call.name);
  let insets = useCoveredUnderCells();
  return withListTabStops(
    <Popover.Root open={guide !== null}><Popover.Popup anchor={anchor} side="bottom" align="start" sideOffset={2} collisionPadding={popupCollisionPadding(insets)} padding="none" initialFocus={false} finalFocus={false} keepFocus role="presentation" aria-hidden data-function-guide ref={passPointerThroughParent} className="pointer-events-none max-w-[min(420px,calc(100vw-16px))]"><div className="px-sm py-xs text-footnote leading-5">{signature !== null &&
            call !== null &&
            <FunctionSignature signature={signature} argumentAt={call.argumentAt} argumentCount={call.argumentCount} />}</div></Popover.Popup></Popover.Root>,
  );
});
export const FUNCTION_ANNOUNCE_DELAY_MS = 500;
export const NO_FUNCTION_ANNOUNCEMENT: FunctionAnnouncement = {
  words: null,
  call: null,
  row: null,
  heading: null,
};
