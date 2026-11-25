import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { CONTEXT_BAR_PART_ATTRIBUTE } from '../toolbar-tooltip.tsx';
import type { ContextTool } from './context-tools.ts';
/** A tool on a line of the toolbar; `section` holds the context tools. */
export type ToolOfBarLine =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align'
  | 'textColor'
  | 'fillColor'
  | 'borders'
  | 'conditionalFormatting'
  | 'chart'
  | 'numberFormat'
  | 'section'
  | 'more';
/** A tool drawn in the toolbar: one of its lines, or a context tool. */
export type ToolInBar = ToolOfBarLine | ContextTool;
/** What is beside a side of a tool: another tool, a line between tools, or the end of the bar. */
export type BesideTool = 'tool' | 'line' | 'end';
export interface NeighboursOfTool {
  before: BesideTool;
  after: BesideTool;
}
/** The space the toolbar puts around and between its tools, in pixels. */
export interface BarSpacing {
  padding: number;
  gap: number;
  /** The room a line between groups of tools takes. */
  acrossLine: number;
}
/** How much of the toolbar is shown: all of it, without some tools, or without most. */
export type BarForm = 'bar_whole' | 'bar_small' | 'bar_fewer';
export type BarEndKind = 'bar_end_icon' | 'bar_end_ask_and_comment' | 'bar_end_ask_agent';
export interface BarToolProps {
  tool: ToolInBar;
  /** Whether the tool is shown; a tool not drawn stays in the bar, hidden. */
  isDrawn?: boolean;
  /** Draws the children even when the tool has no button in the bar, as a menu it opens may still be open. */
  isDrawnWithNoButton?: boolean;
  children?: React.ReactNode;
}
export interface FoldedToolsOptions {
  scroller: React.RefObject<HTMLElement | null>;
  /** Whether a menu of the bar is open, which keeps the tool it belongs to in the bar. */
  isBusy: boolean;
  isSwipedRow: boolean;
}
/** The tools in the toolbar, and what is beside each. */
export interface BarToolsInView {
  besides: Map<ToolInBar, NeighboursOfTool>;
  ofBar: ToolInBar[];
}
export interface BarToolsProviderProps extends BarToolsInView {
  isHidden: boolean;
  children?: React.ReactNode;
}
export let FIRST_TOOLS_TO_FOLD: ToolOfBarLine[];
export function toolNeighbours(lines: ToolInBar[][], afterLast: BesideTool): Map<ToolInBar, NeighboursOfTool> {
  let filledLines = lines.filter(({ length }) => length > 0);
  return new Map(
    filledLines.flatMap(
      (line, lineIndex) =>
        line.map((tool, index): [ToolInBar, NeighboursOfTool] => {
          const before = index > 0 ? 'tool' : lineIndex > 0 ? 'line' : 'end';
          let isLastLine = lineIndex === filledLines.length - 1;
          const after = index < line.length - 1 ? 'tool' : isLastLine ? afterLast : 'line';
          return [
            tool,
            {
              before,
              after,
            },
          ];
        }),
    ),
  );
}
export function barWidthWithout(
  widths: Map<ToolOfBarLine, number>,
  folded: Set<ToolOfBarLine>,
  { padding, gap, acrossLine }: BarSpacing,
): number {
  let lineWidths = TOOLBAR_LINES.map(
    (line) => line.flatMap((tool) => (folded.has(tool) ? [] : (widths.get(tool) ?? []))),
  ).filter((widthsOfLine) => widthsOfLine.length > 0);
  return (
    2 * padding +
    sumOfWidths(lineWidths.map((widthsOfLine) => sumOfWidths(widthsOfLine) + gap * (widthsOfLine.length - 1))) +
    acrossLine * Math.max(lineWidths.length - 1, 0)
  );
}
export function toolsToFoldForWidth(
  widths: Map<ToolOfBarLine, number>,
  spacing: BarSpacing,
  room: number,
  foldOrder: ToolOfBarLine[][],
): ToolOfBarLine[] {
  let folded = new Set<ToolOfBarLine>();
  for (let step of foldOrder) {
    if (barWidthWithout(widths, folded, spacing) <= room) break;
    for (let tool of step) if (widths.has(tool)) folded.add(tool);
  }
  return [...folded];
}
export function toolsToFoldKeepingFolded(
  folded: ToolOfBarLine[],
  widths: Map<ToolOfBarLine, number>,
  spacing: BarSpacing,
  room: number,
  foldOrder: ToolOfBarLine[][],
): ToolOfBarLine[] {
  let toFold = toolsToFoldForWidth(widths, spacing, room, foldOrder);
  return folded.some((tool) => !toFold.includes(tool))
    ? toolsToFoldForWidth(widths, spacing, room - REFOLD_ROOM_MARGIN, foldOrder)
    : toFold;
}
export function barForm(folded: ToolOfBarLine[], isHidden: boolean): BarForm | null {
  if (isHidden) return null;
  if (folded.length === 0) return 'bar_whole';
  return folded.every((tool) => FIRST_TOOLS_TO_FOLD.includes(tool)) ? 'bar_small' : 'bar_fewer';
}
export function barEndKind(isAskShown: boolean, isCommentShown: boolean): BarEndKind {
  if (!isAskShown) return 'bar_end_icon';
  return isCommentShown ? 'bar_end_ask_and_comment' : 'bar_end_ask_agent';
}
export function BarTool({ tool, isDrawn = true, isDrawnWithNoButton = false, children }: BarToolProps) {
  let { besides, ofBar } = React.use(BarToolsContext);
  if (!ofBar.includes(tool)) return isDrawnWithNoButton ? children : null;
  return <span data-tool={tool} data-before={besides.get(tool)?.before} data-after={besides.get(tool)?.after} hidden={!isDrawn} className="flex flex-none">{children}</span>;
}
export function pixelsOf(text: string): number {
  let number = Number.parseFloat(text);
  return Number.isNaN(number) ? 0 : number;
}
export function roomForBarTools(toolbar: Element, footRow: Element, gap: number): number | null {
  let foot = toolbar.closest('.sheet-foot');
  let contextBarHolder = toolbar.closest('.sheet-context-bar')?.parentElement;
  if (foot === null || contextBarHolder === null || contextBarHolder === undefined) return null;
  let { left: footLeft, right: footRight } = getComputedStyle(foot);
  let commentPassWidth = elementWidthOrZero(toolbar.querySelector('[data-comment-pass]'));
  return (
    footRow.clientWidth -
    (pixelsOf(footLeft) + pixelsOf(footRight)) -
    (elementWidthOrZero(contextBarHolder) - elementWidthOrZero(toolbar)) -
    (commentPassWidth > 0 ? commentPassWidth + gap : 0)
  );
}
export function measureFoldedTools(
  toolbar: Element,
  widths: Map<ToolOfBarLine, number>,
  keptTools: ToolOfBarLine[],
  folded: ToolOfBarLine[],
): ToolOfBarLine[] | null {
  let footRow = footRowOf(toolbar);
  let toolsRow = toolbar.querySelector('[data-ui="Toolbar"] > div');
  let lineInBar = toolbar.querySelector('[data-line-in-bar]');
  if (footRow === null || footRow === undefined || toolsRow === null || lineInBar === null) return null;
  for (let tool of TOOLS_OF_BAR) {
    let width = toolbar.querySelector(`[data-tool="${tool}"]`)?.getBoundingClientRect().width;
    if (width !== undefined && width > 0) widths.set(tool, width);
  }
  let gap = pixelsOf(getComputedStyle(toolsRow).columnGap);
  let boldWidth = widths.get('bold');
  if (boldWidth !== undefined) widths.set('section', 4 * boldWidth + 3 * gap);
  let lineStyle = getComputedStyle(lineInBar);
  let toolbarStyle = getComputedStyle(toolbar);
  let acrossLine = 2 * gap + pixelsOf(lineStyle.marginLeft) + pixelsOf(lineStyle.borderLeftWidth) + pixelsOf(lineStyle.marginRight);
  let room = roomForBarTools(toolbar, footRow, gap);
  if (room === null) return null;
  return toolsToFoldKeepingFolded(
    folded,
    widths,
    {
      padding: (pixelsOf(toolbarStyle.paddingLeft) + pixelsOf(toolbarStyle.paddingRight)) / 2,
      gap,
      acrossLine,
    },
    room + 0.5,
    toolFoldOrderKeeping(keptTools),
  );
}
export function useFoldedTools({ scroller, isBusy, isSwipedRow }: FoldedToolsOptions): ToolOfBarLine[] {
  let [folded, setFolded] = React.useState(NO_FOLDED_TOOLS);
  let widthsRef = React.useRef(new Map<ToolOfBarLine, number>());
  let lastCaretRef = React.useRef<Element | null>(null);
  let keptToolsRef = React.useRef(NO_FOLDED_TOOLS);
  React.useLayoutEffect(() => {
    const scrollerElement = scroller.current;
    let view = scrollerElement?.ownerDocument.defaultView;
    let footRow = scrollerElement === null ? null : footRowOf(scrollerElement);
    if (scrollerElement === null || view === null || view === undefined) return;
    if (footRow === null || footRow === undefined) return;
    let toolsKeptFor = (element: Element | null): ToolOfBarLine[] => {
      let elementInBar = scrollerElement.contains(element) ? element : null;
      let ownTool = elementInBar?.closest('[data-tool]')?.getAttribute('data-tool');
      return (elementInBar?.closest('.sheet-section-of-bar') ?? null) !== null
        ? SECTION_TOOL_ONLY
        : TOOLS_OF_BAR.filter((tool) => tool === ownTool);
    };
    let measure = (focused: Element | null = scrollerElement.ownerDocument.activeElement) => {
      if (isBusy) {
        keptToolsRef.current = toolsKeptFor(scrollerElement.querySelector('[aria-expanded="true"]'));
        return;
      }
      let caretElement = scrollerElement.contains(focused) ? focused : lastCaretRef.current;
      let keepsKeptTools =
        caretElement === null &&
        scrollerElement.ownerDocument.hasFocus() &&
        (focused === null || focused === scrollerElement.ownerDocument.body || focused.closest(`[${CONTEXT_BAR_PART_ATTRIBUTE}]`) !== null);
      if (!keepsKeptTools) keptToolsRef.current = NO_FOLDED_TOOLS;
      let keptTools = keepsKeptTools ? keptToolsRef.current : toolsKeptFor(caretElement);
      let newFolded = isSwipedRow ? NO_FOLDED_TOOLS : measureFoldedTools(scrollerElement, widthsRef.current, keptTools, folded);
      if (newFolded !== null && newFolded.join() !== folded.join()) setFolded(newFolded);
    };
    measure();
    let measureNow = () => ReactDOM.flushSync(() => measure());
    let resizeObserver = new ResizeObserver(measureNow);
    resizeObserver.observe(footRow);
    let footChild = scrollerElement.closest('.sheet-foot > *');
    if (footChild !== null) resizeObserver.observe(footChild);
    resizeObserver.observe(scrollerElement);
    let mutationObserver = new MutationObserver(measureNow);
    let foot = scrollerElement.closest('.sheet-foot');
    if (foot !== null)
      mutationObserver.observe(foot, {
        attributes: true,
        attributeFilter: ['data-keeps-room-of-pane'],
      });
    let elementOrNull = (node: EventTarget | null) => (node instanceof view.Element ? node : null);
    let onFocusOut = ({ target, relatedTarget }: FocusEvent) => {
      lastCaretRef.current = scrollerElement.contains(elementOrNull(relatedTarget)) ? elementOrNull(target) : null;
      if (lastCaretRef.current === null) measure(elementOrNull(relatedTarget));
    };
    let onFocusIn = ({ target }: FocusEvent) => {
      lastCaretRef.current = null;
      measure(elementOrNull(target));
    };
    scrollerElement.addEventListener('focusout', onFocusOut);
    scrollerElement.addEventListener('focusin', onFocusIn);
    let onDocumentFocusIn = () => {
      if (keptToolsRef.current.length > 0) measure();
    };
    scrollerElement.ownerDocument.addEventListener('focusin', onDocumentFocusIn);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scrollerElement.removeEventListener('focusout', onFocusOut);
      scrollerElement.removeEventListener('focusin', onFocusIn);
      scrollerElement.ownerDocument.removeEventListener('focusin', onDocumentFocusIn);
    };
  });
  return folded;
}
export function BarToolsProvider({ ofBar, besides, isHidden, children }: BarToolsProviderProps) {
  let toolsInView = React.useMemo(
    (): BarToolsInView => ({
      besides,
      ofBar,
    }),
    [besides, ofBar],
  );
  return <BarToolsContext value={toolsInView}><div className={isHidden ? 'hidden' : 'contents'}>{children}</div></BarToolsContext>;
}
export const TOOLBAR_LINES: ToolOfBarLine[][] = [
  ['bold', 'italic', 'underline', 'align'],
  ['textColor', 'fillColor', 'borders', 'conditionalFormatting', 'chart'],
  ['numberFormat', 'section', 'more'],
];
export const NEVER_FOLDED_TOOLS = new Set<ToolOfBarLine>(['bold', 'italic', 'underline', 'numberFormat', 'more']);
export const TOOL_FOLD_ORDER: ToolOfBarLine[][] = [
  TOOLBAR_LINES.flat().filter((tool) => !NEVER_FOLDED_TOOLS.has(tool)),
  ['underline'],
  ['italic'],
  ['bold'],
];
export const toolFoldOrderKeeping = (kept: ToolOfBarLine[]): ToolOfBarLine[][] =>
  TOOL_FOLD_ORDER.map((step) => step.filter((tool) => !kept.includes(tool)));
export const sumOfWidths = (widths: number[]): number => widths.reduce((sum, width) => sum + width, 0);
export const REFOLD_ROOM_MARGIN = 0.1;
export const BAR_FORM_ATTRIBUTE = 'data-form-of-bar';
export const BAR_END_ATTRIBUTE = 'data-end-of-bar';
export const SMALL_BAR_SELECTOR = `[${BAR_FORM_ATTRIBUTE}=bar_small],[${BAR_FORM_ATTRIBUTE}=bar_fewer]`;
[FIRST_TOOLS_TO_FOLD = []] = toolFoldOrderKeeping([]);
export const NO_FOLDED_TOOLS: ToolOfBarLine[] = [];
export const SECTION_TOOL_ONLY: ToolOfBarLine[] = ['section'];
export const TOOLS_OF_BAR = TOOLBAR_LINES.flat().filter((tool) => tool !== 'section');
export const BarToolsContext = React.createContext<BarToolsInView>({
  besides: new Map(),
  ofBar: TOOLS_OF_BAR,
});
export const footRowOf = (toolbar: Element): HTMLElement | null | undefined => toolbar.closest('.sheet-foot')?.parentElement;
export const elementWidthOrZero = (element: Element | null | undefined): number => element?.getBoundingClientRect().width ?? 0;
