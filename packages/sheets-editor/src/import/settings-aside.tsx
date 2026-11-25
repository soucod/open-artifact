import { Menu } from '../kit/menu.tsx';
import { columnsQuestionDecides, wasQuestionAskedBefore, stoodByHandChanges, importPlanSoFar, importLinesLeftOut } from './import-review.ts';
import { questionColumnIndexes } from './column-readings.ts';
import { importColumnsLeftOut } from './bring-in.ts';
import { questionOptionLabels, heardBecomesWords, readingsThatDiffer } from './settings-pane.tsx';
import {
  importSettingsLabels,
  labelAndExample,
  labelAndChosen,
  formatUnitList,
  plusCountLabel,
  notCheckedYetLabel,
  lineCountLabel,
  importLineLabel,
  moreLinesLeftOutLabel,
} from './destination.tsx';
import {
  importReviewMessages,
  cellsStayTextWords,
  textStaysTextWords,
  joinImportWordsWithCommas,
  columnReadingKindLabel,
  kindWithNoteLabel,
  formatOfColumnLabel,
} from './csv-file.tsx';
import { READING_KIND_ICONS, SuggestedByAgentHeader, formatSuggestionLabels, KeptAsTextCountInBox, keptAsTextTooltip } from './preview-table.tsx';
import { PaneRow, PaneSelect, PANE_SELECT_TRIGGER_CLASSES, PANE_SELECT_HEIGHT_CLASSES, PaneSelectCaret } from '../ui/side-pane/side-pane.tsx';
import { columnsNamedInNote } from './by-hand.ts';
import { importPlacesLeft } from './import-flow.ts';
import { shortenImportLabel } from './preview.ts';
import { blockRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { truncateToCleanText } from './import-basics.ts';
import type { ImportTextOnRow } from './csv-file.tsx';
import type {
  ImportChangeStood,
  ImportOfAFile,
  ImportPlan,
  ImportQuestion,
  ImportQuestionExample,
  ImportStood,
} from '../state/initial-state.ts';
/** Cells of a column that would stay text, as a row of the settings notes them. */
export interface CellsThatStayTextInColumn {
  columnIndex: number;
  count: number;
  /** The first of them, to show in a tooltip. */
  first: ImportTextOnRow[];
  /** How many digits wide the count is kept. */
  digits: number;
}
interface ImportQuestionRowProps {
  open: ImportOfAFile;
  plan: ImportPlan;
  question: ImportQuestion;
  /** Examples of each option, by option. */
  examples: ImportQuestionExample[][];
  isOpen: boolean;
  isOff: boolean;
  isShortInBox?: boolean;
  cellsThatStayText?: CellsThatStayTextInColumn;
  onAnswered: (optionIndex: number) => void;
}
interface LeftOutLinesMenuProps {
  open: ImportOfAFile;
  isOff: boolean;
  onSet: (line: number, isLeftOut: boolean) => void;
}
export function ImportQuestionRow(props: ImportQuestionRowProps) {
  let {
    open,
    plan,
    question,
    examples,
    isOpen,
    isOff,
    isShortInBox = false,
    onAnswered,
  } = props;
  let columnsOfQuestion = columnsQuestionDecides(question);
  let columns = columnsOfQuestion.length > 0 ? columnsOfQuestion : questionColumnIndexes(question);
  let columnsNotSetByHand = columns.filter((columnIndex) => open.byHand.columns[columnIndex]?.reading === undefined);
  let [firstColumn = 0] = columns;
  let readingSetByHand = columnsNotSetByHand.length > 0 ? undefined : plan.columns[firstColumn]?.reading;
  let columnsAsked = readingSetByHand === undefined ? columnsNotSetByHand : columns;
  let columnNames = columnsAsked.map((columnIndex) => plan.columns[columnIndex]?.name ?? '');
  let leftOutColumns = importColumnsLeftOut(open, plan);
  let columnsComingIn = columnsAsked.filter((columnIndex) => !leftOutColumns.includes(columnIndex));
  let { cellsThatStayText } = props;
  let stayTextNote =
    cellsThatStayText !== undefined &&
    columnsComingIn.length === 1 &&
    columnsComingIn[0] === cellsThatStayText.columnIndex &&
    cellsThatStayText.count > 0
      ? cellsThatStayText
      : null;
  let stayTextCount = stayTextNote?.count ?? 0;
  let [firstName = '', ...otherNames] = columnNames;
  let optionLabels = questionOptionLabels(question, examples);
  let wasAskedBefore = wasQuestionAskedBefore(open, question);
  let pickedValue =
    readingSetByHand === undefined ? String(open.answers[question.id] ?? question.recommendedIndex) : IMPORT_ANSWER_OTHERWISE;
  let descriptionOf = (optionIndex: number) => {
    let firstExample = examples[optionIndex]?.[0];
    let parts = [
      ...(optionIndex !== question.recommendedIndex ? [] : [wasAskedBefore ? importSettingsLabels.notCertain() : importReviewMessages.recommended()]),
      ...(String(optionIndex) === pickedValue && stayTextCount > 0
        ? [cellsStayTextWords(stayTextCount)]
        : firstExample?.becomes === null
          ? [textStaysTextWords(firstExample.text)]
          : []),
    ];
    return parts.length === 0
      ? {}
      : {
          description: joinImportWordsWithCommas(parts),
        };
  };
  let heardBecomes = heardBecomesWords(examples);
  let differingReadings = readingsThatDiffer(question);
  let items = [
    ...question.options.map((option, optionIndex) => {
      let readingKind = differingReadings[optionIndex]?.kind;
      return {
        value: String(optionIndex),
        label: optionLabels[optionIndex]?.label ?? '',
        ...(typeof optionLabels[optionIndex]?.example === 'string' && {
          example: optionLabels[optionIndex].example,
        }),
        ...(isShortInBox &&
          readingKind !== undefined &&
          differingReadings.filter((reading) => reading?.kind === readingKind).length === 1 && {
            inBox: columnReadingKindLabel(readingKind),
          }),
        ...(heardBecomes[optionIndex] !== undefined && {
          heard: heardBecomes[optionIndex],
        }),
        ...(readingKind !== undefined && READING_KIND_ICONS[readingKind]),
        ...descriptionOf(optionIndex),
      };
    }),
    ...(readingSetByHand === undefined
      ? []
      : [
          {
            value: IMPORT_ANSWER_OTHERWISE,
            label: columnReadingKindLabel(readingSetByHand.kind),
            ...READING_KIND_ICONS[readingSetByHand.kind],
            ...(stayTextCount > 0 && {
              description: cellsStayTextWords(stayTextCount),
            }),
          },
        ]),
  ];
  let picked = items.find((item) => item.value === pickedValue);
  // An item has the key only when its option has an example.
  let pickedLabel = picked !== undefined && 'example' in picked ? labelAndExample(picked.label, picked.example!) : (picked?.label ?? '');
  let fullName = labelAndChosen(
    formatUnitList(columnNames),
    stayTextCount > 0 ? kindWithNoteLabel(pickedLabel, cellsStayTextWords(stayTextCount)) : pickedLabel,
  );
  return <PaneRow label={firstName} labelInFull={formatUnitList(columnNames)} {...(otherNames.length > 0 && {
      labelEnd: plusCountLabel(otherNames.length),
    })} hasDot={isOpen} isPointedAt={stoodByHandChanges(open).some((change) => change.kind === 'column' && columns.includes(change.columnIndex))}><PaneSelect name={isOpen ? notCheckedYetLabel(fullName) : fullName} {...(!wasAskedBefore && {
        heard: question.ask,
      })} heading={formatOfColumnLabel(formatUnitList(columnNames))} {...(wasAskedBefore && {
        suggested: {
          value: String(question.recommendedIndex),
          caption: <SuggestedByAgentHeader />,
          inWords: formatSuggestionLabels.suggestedByAgent(),
          captionOfTheRest: formatSuggestionLabels.otherFormats(),
        },
      })} {...(stayTextNote !== null && {
        beforeCaret: <KeptAsTextCountInBox count={stayTextNote.count} digits={stayTextNote.digits} />,
      })} {...(cellsThatStayText !== undefined && {
        tooltip:
          stayTextNote === null
            ? null
            : keptAsTextTooltip({
                picked: pickedLabel,
                count: stayTextNote.count,
                cells: stayTextNote.first,
              }),
      })} isSamePickTold isOff={isOff} value={pickedValue} items={items} onChange={(value: string) => onAnswered(Number(value))} /></PaneRow>;
}
export function previewColumnsOfImportNotes(open: ImportOfAFile) {
  let { preview } = importPlanSoFar(open);
  let columnIndexes = new Set(open.plan.questions.flatMap((question) => questionColumnIndexes(question)));
  return open.plan.notes.map((note) => {
    let columnsNamed = columnsNamedInNote(note, open.plan.columns).flatMap((namedIndex) => {
      let column = preview.columns.find((previewColumn) => previewColumn.columnIndex === namedIndex);
      return column === undefined || columnIndexes.has(namedIndex) ? [] : [column];
    });
    for (let { columnIndex } of columnsNamed) columnIndexes.add(columnIndex);
    return columnsNamed;
  });
}
export function namesOfStoodSettings(open: ImportOfAFile, { stood, namesOfStood }: Pick<ImportStood, 'stood' | 'namesOfStood'>) {
  let isStood = (kind: ImportChangeStood['kind']) => stood.some((change) => change.kind === kind);
  let sheetNameLabels = isStood('sheetName') ? [importSettingsLabels.name()] : [];
  let hasPlacesLeft = importPlacesLeft(open).length > 0;
  let questionColumns = open.plan.questions.flatMap((question) => questionColumnIndexes(question));
  let columnOrder = [
    ...questionColumns,
    ...importColumnsInSettings(open)
      .filter((columnIndex) => !questionColumns.includes(columnIndex))
      .toSorted((left, right) => left - right),
  ];
  let orderOfColumn = (columnIndex: number) =>
    columnOrder.includes(columnIndex) ? columnOrder.indexOf(columnIndex) : columnOrder.length + columnIndex;
  let names = [
    ...(hasPlacesLeft ? [] : sheetNameLabels),
    ...(isStood('headings') ? [importSettingsLabels.headings()] : []),
    ...(isStood('line') ? [importSettingsLabels.leftOut()] : []),
    ...(isStood('destination') ? [importSettingsLabels.importAs()] : []),
    ...(hasPlacesLeft ? sheetNameLabels : []),
    ...stood
      .flatMap((change) => (change.kind === 'column' ? [change.columnIndex] : []))
      .toSorted((left, right) => orderOfColumn(left) - orderOfColumn(right))
      .map((columnIndex) => namesOfStood[columnIndex] ?? ''),
  ];
  return [...new Set(names)].map(shortenImportLabel).filter((name) => name !== '');
}
export function LeftOutLinesMenu({ open, isOff, onSet }: LeftOutLinesMenuProps) {
  let { lines, moreCount } = importLinesLeftOut(open);
  let lineTextOf = (lineNumber: number) =>
    (open.table.lines[lineNumber - 1] ?? []).filter((field) => field.trim() !== '').join(', ');
  let leftOutCountLabel = lineCountLabel(importPlanSoFar(open).preview.lineLeftOutCount);
  return <PaneRow label={importSettingsLabels.leftOut()} isPointedAt={stoodByHandChanges(open).some(({ kind }) => kind === 'line')}><Menu.Root><Menu.Trigger render={<button type="button" disabled={isOff} aria-label={labelAndChosen(importSettingsLabels.leftOut(), leftOutCountLabel)} className={`${PANE_SELECT_TRIGGER_CLASSES.className} ${PANE_SELECT_HEIGHT_CLASSES.className}`}><span className="min-w-0 flex-1 truncate">{leftOutCountLabel}</span><PaneSelectCaret /></button>} /><Menu.Popup align="start" className="w-auto max-w-[min(26rem,var(--available-width))] min-w-[var(--anchor-width)]" onKeyDownCapture={blockRepeatedEnterOrSpace}><Menu.Group aria-label={importSettingsLabels.leftOut()}>{lines.map(
                ({ line, isLeftOut, canComeBack }) =>
                  <Menu.Item key={line} checked={isLeftOut} disabled={!canComeBack} disabledReason={importSettingsLabels.aboveTheHeadings()} keepOpen onClick={() => onSet(line, !isLeftOut)}><span className="flex min-w-0 flex-1 items-baseline gap-sm"><span className="shrink-0">{importLineLabel(line)}</span><span dir="auto" className="min-w-0 truncate text-footnote text-muted" title={truncateToCleanText(lineTextOf(line), LEFT_OUT_LINE_TITLE_CHARS)}>{truncateToCleanText(lineTextOf(line), LEFT_OUT_LINE_PREVIEW_CHARS)}</span></span></Menu.Item>,
              )}{moreCount > 0 &&
                <Menu.Item disabled>{moreLinesLeftOutLabel(moreCount)}</Menu.Item>}</Menu.Group></Menu.Popup></Menu.Root></PaneRow>;
}
export const IMPORT_ANSWER_OTHERWISE = 'otherwise';
export const importColumnsInSettings = (open: ImportOfAFile) => [
  ...open.plan.questions.flatMap((question) => questionColumnIndexes(question)),
  ...(open.isPlanByAgent
    ? previewColumnsOfImportNotes(open)
        .flat()
        .map((column) => column.columnIndex)
    : []),
];
export const LEFT_OUT_LINE_PREVIEW_CHARS = 48;
export const LEFT_OUT_LINE_TITLE_CHARS = 300;
