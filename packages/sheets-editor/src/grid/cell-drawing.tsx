import { Avatar } from '../kit/avatar.tsx';
import { Icon } from '../kit/icon.tsx';
import type { ReactNode } from 'react';
import * as React from 'react';
import type { Mark } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { FontToMeasure } from '../state/controller.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import type { TextInsets, TextOverflow } from './cell-metrics.ts';
import type { ChipPerson } from './cards-place.ts';
import type { DrawnCell } from './grid-drawing.tsx';
import { fontPointsToPixels, firstLineHeight, firstLineLeading, nextLineHeight } from './cell-metrics-values.ts';
import { githubLinkFace } from '../links/cell-links-view.tsx';
import { urlForDisplay } from '../links/url-display.ts';
import { personChipsFittingLines, hasRoomForPersonChipLines } from '../chips/person-chip-lines.ts';
import { PERSON_AVATAR_LOOK } from '../chips/person-avatar-look.ts';
import { wrappingOfWrapText } from './text-overflow.ts';
import { personChipLinesInRowHeight } from './chip-metrics.ts';
import { morePeopleCountText } from '../i18n/chip-labels.ts';
import { MENU_CARETS } from '../ui/menu-trigger.tsx';
import { chipBeyondLine, cellMarkSpacing } from './cell-metrics.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { IS_IOS_BROWSER } from './cell-drawing-values.ts';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
/** A color as it shows on a light page and on a dark one. */
export interface PaintPair {
  onLight: string;
  onDark: string;
}
/** The fill and text colors of a chip or a cell, or null where the page's own show. */
export interface ChipPaints {
  fill: PaintPair | null;
  text: PaintPair | null;
}
/** A style that also sets CSS custom properties. */
export type StyleWithVariables = React.CSSProperties & { [variable: `--${string}`]: string | number | undefined };
/** The font of a cell's format. */
export type CellFont = WholeCellFormat['font'];
/** Measures how wide a text is drawn in a font, in pixels. */
export type MeasureTextWidth = (text: string, font: FontToMeasure) => number;
/** The style a cell's font is drawn in. */
export interface CellFontStyle {
  fontFamily: string | undefined;
  fontSize: number;
  lineHeight: string;
  fontWeight: 700 | undefined;
  fontStyle: 'italic' | undefined;
  textDecorationLine: string | undefined;
  textDecorationStyle: 'double' | undefined;
}
/** The name of a tint a cell's text can be drawn in. */
export type TextTintName = keyof typeof TEXT_TINT_COLORS;
/** Which blank cells are given words for a screen reader: none, all, or those where a press does something. */
export type BlankCellWords = 'none' | 'all' | 'whereAPressActs' | 'whereAPressActsByCss';
/** Of a drawn cell, what tells where its text fades. */
export type CellTextToFade = Pick<
  DrawnCell,
  | 'textWidth'
  | 'textCutByViewAt'
  | 'textLeft'
  | 'left'
  | 'width'
  | 'hasLineAtRight'
  | 'indentToCenter'
  | 'takenAtRight'
  | 'linkDrawnAs'
  | 'alignment'
  | 'isCutAtEndOnly'
>;
interface TextWidthProviderProps {
  within: React.RefObject<Element | null>;
  children: ReactNode;
}
interface CellChipProps {
  optionPaints: ChipPaints | null;
  hasBox?: boolean;
  fillsCell?: boolean;
  isBlank?: boolean;
  showsPeople?: boolean;
  inCell?: 'last';
  startsCell?: boolean;
  isBold?: boolean;
  before?: ReactNode;
  after?: ReactNode;
  textProps?: React.HTMLAttributes<HTMLSpanElement>;
  children: ReactNode;
}
interface LinkAddressOrGithubChipProps {
  url: string;
  isTypedWithWww: boolean;
}
interface PersonAvatarProps {
  name: string;
  avatarUrl: string | null;
}
interface PeopleChipsProps {
  first: PersonAvatarProps;
  firstName: ReactNode;
  textDecorationLine: string | undefined;
  others: readonly ChipPerson[];
  cellWidth: number;
  lineCount: number;
  font: CellFont;
  opensList: boolean;
}
/** Of a drawn cell, what tells how many lines its people's chips may take. */
export type CellOfPersonChipLines = Pick<DrawnCell, 'format' | 'width' | 'height' | 'mergedFromRowNumber' | 'takenAtRight' | 'isHeadingOfTable'>;
interface LinesBesideTextProps {
  from: 'left' | 'right';
  outsideTextBox: number;
  lines: number[];
}
interface TextThatRunsOnProps {
  cell: Pick<DrawnCell, 'textWidth' | 'alignment' | 'indentToCenter' | 'linesInTextBox'>;
  left: number;
  hasTextPaint: boolean;
  style: StyleWithVariables;
  children: ReactNode;
}
interface WordsForScreenReaderProps {
  words: string;
}
export function preloadMonoFont(element: Element) {
  let ownerDocument = element.ownerDocument;
  let monoFont = ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(MONO_FONT_VAR);
  if (monoFont !== undefined && monoFont !== '') ownerDocument.fonts.load(`1em ${monoFont}`).catch(() => {});
}
export function createTextWidthMeasurer(ownerDocument: Document): MeasureTextWidth | null {
  let canvasContext = ownerDocument.createElement('canvas').getContext('2d');
  let bodyStyle = ownerDocument.defaultView?.getComputedStyle(ownerDocument.body);
  if (canvasContext === null || bodyStyle === undefined) return null;
  let fontFamily = bodyStyle.fontFamily;
  let displayFontFamily = bodyStyle.getPropertyValue(DISPLAY_FONT_VAR);
  let widths = new Map<string, number>();
  return (text, font) => {
    let family = usesDisplayFont(font.size) ? displayFontFamily : fontFamily;
    let fontShorthand = `${font.italic ? 'italic ' : ''}${font.bold ? '700 ' : ''}${String(fontPointsToPixels(font.size))}px ${family}`;
    let cacheKey = `${fontShorthand}
${text}`;
    let cached = widths.get(cacheKey);
    if (cached !== undefined) return cached;
    canvasContext.font = fontShorthand;
    let { width } = canvasContext.measureText(text);
    if (widths.size >= TEXT_WIDTH_CACHE_LIMIT) widths.clear();
    widths.set(cacheKey, width);
    return width;
  };
}
export function TextWidthProvider({ within, children }: TextWidthProviderProps) {
  let [measureText, setMeasureText] = React.useState<MeasureTextWidth>(() => estimateCellTextWidth);
  React.useEffect(() => {
    let ownerDocument = within.current?.ownerDocument;
    let view = ownerDocument?.defaultView ?? null;
    if (ownerDocument === undefined || view === null) return;
    let updateMeasurer = () => setMeasureText(() => createTextWidthMeasurer(ownerDocument) ?? estimateCellTextWidth);
    updateMeasurer();
    ownerDocument.fonts.addEventListener('loadingdone', updateMeasurer);
    let fontObserver = new view.MutationObserver(updateMeasurer);
    fontObserver.observe(ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ['data-font'],
    });
    return () => {
      ownerDocument.fonts.removeEventListener('loadingdone', updateMeasurer);
      fontObserver.disconnect();
    };
  }, [within]);
  return <TextWidthContext value={measureText}>{children}</TextWidthContext>;
}
export function cellFontStyle({ bold, italic, underline, strikethrough, size }: CellFont): CellFontStyle {
  let decorations = [underline !== 'none' && 'underline', strikethrough && 'line-through'].filter(
    (decoration) => decoration !== false,
  );
  return {
    fontFamily: displayFontFamilyFor(size),
    fontSize: fontPointsToPixels(size),
    lineHeight: `${firstLineHeight(size)}px`,
    fontWeight: bold ? 700 : undefined,
    fontStyle: italic ? 'italic' : undefined,
    textDecorationLine: decorations.length === 0 ? undefined : decorations.join(' '),
    textDecorationStyle: underline === 'double' ? 'double' : undefined,
  };
}
export function textMarksStyle(marks: readonly Mark[]): Pick<CellFontStyle, 'fontWeight' | 'fontStyle' | 'textDecorationLine'> {
  let decorations = [marks.includes('underline') && 'underline', marks.includes('strikethrough') && 'line-through'].filter(
    (decoration) => decoration !== false,
  );
  return {
    fontWeight: marks.includes('bold') ? 700 : undefined,
    fontStyle: marks.includes('italic') ? 'italic' : undefined,
    textDecorationLine: decorations.length === 0 ? undefined : decorations.join(' '),
  };
}
export function wrappedTextLineStyle(size: number) {
  let marginBlock = firstLineLeading(size);
  return marginBlock === 0
    ? undefined
    : {
        lineHeight: `${nextLineHeight(size)}px`,
        marginBlock,
      };
}
export function CellChip({
  optionPaints,
  hasBox = true,
  fillsCell = false,
  isBlank = false,
  showsPeople = false,
  inCell,
  startsCell = false,
  isBold = false,
  before,
  after,
  textProps,
  children,
}: CellChipProps) {
  return <span className={optionPaints !== null && !isBold ? 'sheet-chip font-medium' : 'sheet-chip'} data-has-box={hasBox || undefined} data-fills-cell={fillsCell || undefined} data-is-blank={isBlank || undefined} data-shows-people={showsPeople || undefined} data-in-cell={inCell} data-starts-cell={startsCell || undefined} data-ends-in-mark={((inCell === 'last' || startsCell) && ChipMark(after) !== null) || undefined} data-is-option={optionPaints !== null || undefined} {...(optionPaints === null ? {} : paintDataAttributes(optionPaints))} style={optionPaints === null
        ? undefined
        : {
            ...fillPaintStyle(optionPaints.fill),
            ...textPaintStyle(optionPaints.text),
          }}>{ChipMark(before)}{children !== false &&
        <span className="sheet-chip-text" {...textProps}>{children}</span>}{ChipMark(after)}</span>;
}
export function LinkAddressOrGithubChip(props: LinkAddressOrGithubChipProps) {
  let { url, isTypedWithWww } = props;
  let githubFace = githubLinkFace(url);
  return githubFace === null
    ? <span className="sheet-link-words sheet-link-address">{urlForDisplay(url, isTypedWithWww)}</span>
    : <CellChip optionPaints={null} inCell="last" startsCell before={<Icon name={githubFace.icon} size="xs" alt={githubFace.iconInWords} />}>{githubFace.words}</CellChip>;
}
export function PeopleChips({
  first,
  firstName,
  textDecorationLine,
  others,
  cellWidth,
  lineCount,
  font,
  opensList,
}: PeopleChipsProps) {
  let textWidth = useTextWidth();
  let shownCount =
    others.length === 0
      ? 1
      : personChipsFittingLines({
          cellWidth,
          nameWidths: [first, ...others].map(({ name }) => textWidth(name, font)),
          widthOfCount: (count: number) =>
            textWidth(morePeopleCountText(count), {
              ...font,
              bold: true,
            }),
          fontSizeInPoints: font.size,
          opensList,
          lineCount,
        });
  let foldedCount = others.length + 1 - shownCount;
  return <><CellChip optionPaints={null} showsPeople {...lastChipProps(others.length === 0)} startsCell before={<PersonAvatar {...first} />} after={opensList && MENU_CARETS.chipInCell}>{firstName}</CellChip>{others.slice(0, shownCount - 1).map(
        ({ userId, ...person }, index) =>
          (<CellChip key={userId} optionPaints={null} showsPeople {...lastChipProps(foldedCount === 0 && index === shownCount - 2)} before={<PersonAvatar {...person} />}>{textDecorationLine === undefined
                  ? person.name
                  : (<span style={{
                        textDecorationLine,
                      }}>{person.name}</span>)}</CellChip>),
      )}{foldedCount > 0 &&
        <CellChip optionPaints={NO_OPTION_PAINTS} inCell="last" isBold={font.bold}>{morePeopleCountText(foldedCount)}</CellChip>}</>;
}
export function personChipLinesOfCell(cell: CellOfPersonChipLines, padding: Pick<TextInsets, 'over' | 'under'>): number {
  return wrappingOfWrapText(cell.format.alignment.wrap) !== 'clip' &&
    hasRoomForPersonChipLines(cell.width, cell.format.font.size) &&
    cell.mergedFromRowNumber === null &&
    cell.takenAtRight === 0 &&
    !cell.isHeadingOfTable
    ? personChipLinesInRowHeight(cell.height, cell.format.font.size, padding)
    : 1;
}
export function LinesBesideText(props: LinesBesideTextProps) {
  let { from, outsideTextBox, lines } = props;
  return <span className="sheet-lines-beside-text" style={{
      [from === 'left' ? 'marginLeft' : 'marginRight']: outsideTextBox === 0 ? undefined : -outsideTextBox,
    }}>{lines.map(
      (line) =>
        (<span key={line} style={{
              [from]: line,
            }} />),
    )}</span>;
}
export function textFadeStyle(cell: CellTextToFade, textBox: TextInsets): StyleWithVariables {
  let { textWidth, textCutByViewAt } = cell;
  let drawnWidth = cell.textLeft !== cell.left || textWidth !== cell.width || cell.hasLineAtRight ? textWidth - 1 : textWidth;
  let centerShift = (textBox.left + textWidth - textBox.right + cell.indentToCenter) / 2;
  let widthBeforeTaken = textWidth - (cell.takenAtRight > 0 ? 1 + cell.takenAtRight : textBox.right);
  let [cutFrom, cutTo] = fadesFromRightButton(cell)
    ? [`calc(100% - ${widthBeforeTaken - textBox.left}px - ${INK_PAST_WORDS})`, '100%']
    : cell.takenAtRight > 0 || cell.linkDrawnAs !== null
      ? ['0px', `calc(${widthBeforeTaken - textBox.left}px + ${INK_PAST_WORDS})`]
      : cell.alignment === 'left' || cell.isCutAtEndOnly
        ? ['0px', `calc(${drawnWidth - textBox.left}px + ${INK_PAST_WORDS})`]
        : cell.alignment === 'right'
          ? [`calc(100% - ${textWidth - textBox.right}px - ${INK_PAST_WORDS})`, '100%']
          : [`calc(50% - ${centerShift}px)`, `calc(50% + ${drawnWidth - centerShift}px)`];
  if (textCutByViewAt === null)
    return {
      '--sheet-text-cut-from': cutFrom,
      '--sheet-text-cut-to': cutTo,
    };
  let cutByView =
    cell.alignment === 'center' && cell.linkDrawnAs === null
      ? `calc(50% + ${textCutByViewAt - centerShift}px)`
      : `calc(${textCutByViewAt - textBox.left}px + ${INK_PAST_WORDS})`;
  return {
    '--sheet-text-cut-from': cutFrom,
    '--sheet-text-cut-to': `min(${cutTo}, ${cutByView})`,
  };
}
export function TextThatRunsOn(props: TextThatRunsOnProps) {
  let { textWidth, alignment, indentToCenter, linesInTextBox } = props.cell;
  let lastPixel = textWidth - 1;
  let isLineAtLeft = (line: number) =>
    alignment === 'right' || (alignment === 'center' && line < (lastPixel + indentToCenter) / 2);
  let outsideAtLeft = Math.max(0, -indentToCenter);
  let outsideAtRight = Math.max(0, indentToCenter);
  return <div className="sheet-text-that-runs-on" data-has-text-paint={props.hasTextPaint || undefined} style={{
      left: props.left,
      width: textWidth,
      ...props.style,
    }}>{alignment !== 'left' &&
        <LinesBesideText from="left" outsideTextBox={outsideAtLeft} lines={linesInTextBox.filter(isLineAtLeft).map((line) => line + outsideAtLeft)} />}{props.children}{alignment !== 'right' &&
        (<LinesBesideText from="right" outsideTextBox={outsideAtRight} lines={linesInTextBox
            .filter((line) => !isLineAtLeft(line))
            .map((line) => lastPixel + outsideAtRight - (line + 1))} />)}</div>;
}
export const FALLBACK_CHAR_WIDTH_EM = 0.55;
export const estimateCellTextWidth = (text: string, font: FontToMeasure): number =>
  text.length * FALLBACK_CHAR_WIDTH_EM * fontPointsToPixels(font.size);
export const DISPLAY_FONT_VAR = '--ui-font-sans-display';
export const DISPLAY_FONT_MIN_PX = 16;
export const usesDisplayFont = (size: number): boolean => fontPointsToPixels(size) > DISPLAY_FONT_MIN_PX;
export const MONO_FONT_VAR = '--ui-font-mono';
export const MONO_FONT_FAMILY = `var(${MONO_FONT_VAR})`;
export const displayFontFamilyFor = (size: number): string | undefined => (usesDisplayFont(size) ? `var(${DISPLAY_FONT_VAR})` : undefined);
export const TEXT_WIDTH_CACHE_LIMIT = 2000;
export const TextWidthContext = React.createContext<MeasureTextWidth>(estimateCellTextWidth);
export const useTextWidth = () => React.useContext(TextWidthContext);
export const SELECTION_SUMMARY_ID = 'selection-summary';
export const whiteOwedStyle = ({ atLeft, atRight }: TextOverflow): StyleWithVariables => ({
  ...(atLeft > 0 && {
    '--sheet-white-owed-at-left': `${atLeft}px`,
  }),
  ...(atRight > 0 && {
    '--sheet-white-owed-at-right': `${atRight}px`,
  }),
});
export const textClearanceStyle = ({ over, under, left, right }: TextInsets, densityOfChip: CellDensity | null = null): StyleWithVariables => ({
  '--sheet-clear-over-text': `${over}px`,
  '--sheet-clear-under-text': `${under}px`,
  '--sheet-clear-left-of-text': `${left}px`,
  '--sheet-clear-right-of-text': `${right}px`,
  ...(densityOfChip !== null && {
    '--sheet-chip-beyond-line': `${chipBeyondLine({
      over,
    })}px`,
    '--sheet-after-mark': `${cellMarkSpacing(densityOfChip).after}px`,
    '--sheet-mark-into-words': `${cellMarkSpacing(densityOfChip).intoWords}px`,
  }),
});
export const entryFontStyle = (font: CellFont, isMono: boolean) => ({
  ...cellFontStyle(font),
  ...(isMono && {
    fontFamily: MONO_FONT_FAMILY,
  }),
  lineHeight: `${nextLineHeight(font.size)}px`,
});
export const DEFAULT_CELL_FONT_STYLE = {
  fontSize: fontPointsToPixels(DEFAULT_CELL_FORMAT.font.size),
  lineHeight: `${firstLineHeight(DEFAULT_CELL_FORMAT.font.size)}px`,
};
export const TEXT_TINT_COLORS = {
  black: 'var(--ui-text-primary)',
  blue: 'var(--ui-text-tint-blue)',
  cyan: 'var(--ui-text-tint-aqua)',
  gray: 'var(--ui-text-secondary)',
  green: 'var(--ui-text-tint-green)',
  magenta: 'var(--ui-text-tint-magenta)',
  orange: 'var(--ui-text-tint-orange)',
  red: 'var(--ui-text-tint-red)',
  violet: 'var(--ui-text-tint-violet)',
  white: 'var(--ui-surface-2)',
  yellow: 'var(--ui-text-tint-yellow)',
};
export const referenceTintStyle = (tint: string) => ({
  '--sheet-reference-fill': `var(--sheet-reference-tint-${tint})`,
  '--sheet-reference-badge': `var(--ui-bg-tint-${tint})`,
  '--sheet-reference-text': `var(--ui-text-tint-${tint})`,
});
export const fillPaintStyle = (fill: PaintPair | null): StyleWithVariables =>
  fill === null
    ? {}
    : {
        '--sheet-fill-on-light': fill.onLight,
        '--sheet-fill-on-dark': fill.onDark,
      };
export const cutByViewStyle = (cutAt: number): StyleWithVariables => ({
  '--sheet-cut-by-view-at': `${cutAt}px`,
});
export const importMarkDelayStyle = (turnMs: number): StyleWithVariables => ({
  '--sheet-turn-of-mark': `${turnMs}ms`,
});
export const textPaintStyle = (textPaint: PaintPair | null): StyleWithVariables =>
  textPaint === null
    ? {}
    : {
        '--sheet-text-on-light': textPaint.onLight,
        '--sheet-text-on-dark': textPaint.onDark,
      };
export const paintDataAttributes = (paints: ChipPaints) => ({
  'data-has-fill': paints.fill !== null || undefined,
  'data-has-text-paint': paints.text !== null || undefined,
});
export const ChipMark = (mark: ReactNode) =>
  mark === undefined || mark === null || mark === false
    ? null
    : <span className="sheet-chip-mark">{mark}</span>;
export const PersonAvatar = ({ name, avatarUrl }: PersonAvatarProps) =>
  <Avatar {...PERSON_AVATAR_LOOK} name={name} {...(avatarUrl === null
      ? {}
      : {
          src: avatarUrl,
        })} size="xs" aria-hidden />;
export const NO_OPTION_PAINTS: ChipPaints = {
  fill: null,
  text: null,
};
export const peopleListKeepsToColumn = (lineCount: number, peopleCount: number, linesInRoom: number): boolean =>
  lineCount > 1 && peopleCount <= lineCount && peopleCount < linesInRoom;
export const lastChipProps = (isLast: boolean): { inCell?: 'last' } =>
  isLast
    ? {
        inCell: 'last',
      }
    : {};
export const JUSTIFY_BY_ALIGNMENT = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};
export const ALIGN_ITEMS_BY_VERTICAL = {
  top: undefined,
  center: 'center',
  bottom: 'flex-end',
};
export const INK_PAST_WORDS = 'var(--sheet-ink-past-words)';
export const fadesFromRightButton = (cell: Pick<DrawnCell, 'takenAtRight' | 'alignment' | 'isCutAtEndOnly' | 'linkDrawnAs'>): boolean =>
  cell.takenAtRight > 0 && cell.alignment === 'right' && !cell.isCutAtEndOnly && cell.linkDrawnAs === null;
export const ariaIndex = (index: number): number => index + 1;
export const ariaRowIndexText = (rowNumber: number | string) => ({
  'aria-rowindextext': String(rowNumber),
});
export const ariaColIndexText = (columnText: string) => ({
  'aria-colindextext': columnText,
});
export const AnnounceActiveCellContext = React.createContext(false);
export const ACTIVE_CELL_ADDRESS_ID = 'address-of-active-cell';
export const BlankCellWordsContext = React.createContext<BlankCellWords>('none');
export const BLANK_CELL_WORDS_BY_PLATFORM: BlankCellWords = IS_IOS_BROWSER
  ? 'all'
  : !IS_APPLE_PLATFORM || typeof CSS > 'u' || CSS.supports('-moz-appearance', 'none')
    ? 'none'
    : CSS.supports('font', '-apple-system-body')
      ? 'whereAPressActs'
      : 'whereAPressActsByCss';
export const WordsForScreenReader = ({ words }: WordsForScreenReaderProps) =>
  <span role="text" aria-label={words} className="absolute inset-0" />;
export { IS_IOS_BROWSER } from './cell-drawing-values.ts';
