import { Skeleton, SkeletonGroup } from '../kit/skeleton.tsx';
import { Button } from '../kit/button.tsx';
import { PaneSection, PANE_GUTTER_CLASSES, PaneSelect } from '../ui/side-pane/side-pane.tsx';
import { importSettingsLabels, optionNthLabel, labelAndExample, labelAndChosen, importLineLabel } from './destination.tsx';
import {
  importReviewMessages,
  columnNameAndKindLabel,
  columnReadingWithNoteLabel,
  joinImportWordsWithSemicolons,
  importColumnMessages,
  columnReadingKindLabel,
  textBecomesWords,
} from './csv-file.tsx';
import { lastDataLineNumber } from './column-readings.ts';
import { truncateToCleanText } from './import-basics.ts';
import type { ImportFile, ImportPreviewColumn, ImportQuestion, ImportQuestionExample } from '../state/initial-state.ts';
import type { ImportChangeByHand, ImportReading } from '../state/event-reducer.ts';
interface AgentsReadSectionProps {
  summary: string | null;
  isSummaryWhole: boolean;
  isPlanIn: boolean;
  notes: string[];
  agentAtWorkInWords: string;
}
interface AgentsReadFailedProps {
  why: string;
  onAskedAgain: (() => void) | null;
}
interface HeadingsLineSelectProps {
  table: Pick<ImportFile, 'lines'>;
  headerLine: number | null;
  linesLeftOut: number[];
  isOff: boolean;
  onPicked: (headerLine: number | null) => void;
}
/** Columns whose readings were asked for again, and how many times columns were asked for, so that saying them again is heard. */
export interface ColumnsAskedAgain {
  columns: number[];
  times: number;
}
/** The label of an option of a question, and an example of what it makes of the file. */
export interface QuestionOptionLabel {
  label: string;
  example: string | null;
}
export function AgentsReadSection(props: AgentsReadSectionProps) {
  let { summary, isSummaryWhole, isPlanIn, notes, agentAtWorkInWords } = props;
  let isSummaryPartial = summary !== null && !isSummaryWhole;
  return <PaneSection title={<><span aria-hidden>{importSettingsLabels.summary()}</span><span className="sr-only">{importSettingsLabels.summaryByAgent()}</span></>} actions={<span aria-hidden className="text-footnote text-secondary">{importSettingsLabels.byAgent()}</span>} className="sheet-import-is-there-from-the-start" doesTitleStay><div className={`sheet-import-agents-read flex min-w-0 flex-col gap-1.5 py-px ${PANE_GUTTER_CLASSES}`} data-is-being-written={!isPlanIn || undefined}>{(summary === null ? !isPlanIn : isSummaryPartial) &&
          <span className="sr-only">{agentAtWorkInWords}</span>}{(summary === null ? !isPlanIn : isSummaryPartial) &&
          <SkeletonGroup decorative className={`sheet-import-agents-read-bars flex-col justify-around ${isSummaryPartial ? 'hidden motion-reduce:flex' : 'flex'}`}><Skeleton width="100%" className="text-footnote" /><Skeleton width="92%" className="text-footnote" /><Skeleton width="48%" className="text-footnote" /></SkeletonGroup>}{summary !== null &&
          <p dir="auto" aria-hidden={isSummaryPartial || undefined} className={`${AGENT_READ_TEXT_CLASS.className} text-primary ${isSummaryPartial ? 'motion-reduce:hidden' : ''}`}>{summary}</p>}{isPlanIn &&
          notes.length > 0 &&
          (<ul className="flex min-w-0 list-disc flex-col gap-1.5">{notes.map(
              (note) =>
                <li key={note} dir="auto" className={`ms-4 ${AGENT_READ_TEXT_CLASS.className} text-primary`}>{note}</li>,
            )}</ul>)}</div></PaneSection>;
}
export function AgentsReadFailed({ why, onAskedAgain }: AgentsReadFailedProps) {
  return <PaneSection title={importSettingsLabels.summary()} className="sheet-import-is-there-from-the-start"><div className={`flex min-w-0 flex-col items-start gap-2 py-px ${PANE_GUTTER_CLASSES}`}><p className={`${AGENT_READ_TEXT_CLASS.className} text-primary`}>{why}</p>{onAskedAgain !== null &&
          <Button variant="secondary" onClick={onAskedAgain}>{importReviewMessages.tryAgain()}</Button>}</div></PaneSection>;
}
/** The names and readings of the columns asked for again, in words; false when there are none. */
export function columnsNamedWords(askedAgain: ColumnsAskedAgain | null, columns: ImportPreviewColumn[]) {
  let columnWords = columns
    .filter(({ columnIndex }) => askedAgain?.columns.includes(columnIndex) === true)
    .map(
      ({ name, reading, optionCount, keptAsTextCount }) =>
        columnNameAndKindLabel(name, columnReadingWithNoteLabel(reading, optionCount, keptAsTextCount)),
    );
  return columnWords.length > 0 && joinImportWordsWithSemicolons(columnWords);
}
export function dateOrderLabel(reading: ImportReading) {
  if (reading.kind !== 'date' && reading.kind !== 'dateAndTime') return null;
  switch (reading.order) {
    case 'dayMonthYear':
      return importColumnMessages.dayFirst();
    case 'monthDayYear':
      return importColumnMessages.monthFirst();
    case 'yearMonthDay':
      return importColumnMessages.yearFirst();
  }
}
export function decimalSignLabel(reading: ImportReading) {
  if (!('decimalSign' in reading)) return null;
  return reading.decimalSign === 'comma' ? importSettingsLabels.commaDecimal() : importSettingsLabels.periodDecimal();
}
/** By option, the reading each gives the first column whose reading differs between the options. */
export function readingsThatDiffer(question: Pick<ImportQuestion, 'options'>) {
  let readingsAt = (readingIndex: number) =>
    question.options.map((option) => option.readings[readingIndex]?.reading);
  let differingIndex = question.options[0]?.readings.findIndex(
    (_, readingIndex) =>
      new Set(readingsAt(readingIndex).map((optionReading) => JSON.stringify(optionReading))).size > 1,
  );
  return readingsAt(Math.max(0, differingIndex ?? 0));
}
export function questionOptionLabels(question: Pick<ImportQuestion, 'options'>, examples: ImportQuestionExample[][]): QuestionOptionLabel[] {
  let readings = readingsThatDiffer(question);
  let isOnlyOfItsKind = (reading: ImportReading) =>
    readings.filter((other) => other?.kind === reading.kind).length === 1;
  let labelParts = readings.map((reading, optionIndex) => {
    let becomes = examples[optionIndex]?.[0]?.becomes ?? null;
    let kindLabel =
      reading === undefined
        ? null
        : isOnlyOfItsKind(reading)
          ? columnReadingKindLabel(reading.kind)
          : (dateOrderLabel(reading) ?? decimalSignLabel(reading));
    let exampleLabel = becomes === null ? null : withoutYear(becomes, reading);
    return [kindLabel, exampleLabel].filter((part) => part !== null);
  });
  let isUnique = (parts: string[]) =>
    labelParts.filter(
      (other) =>
        other.join(`
`) ===
        parts.join(`
`),
    ).length === 1;
  return labelParts.map((parts, optionIndex) => {
    let [label = '', ...rest] = parts.length > 0 && isUnique(parts) ? parts : [optionNthLabel(optionIndex + 1), ...parts];
    let [example = null, becomes] = rest;
    return {
      label,
      example: example !== null && becomes !== undefined ? labelAndExample(example, becomes) : example,
    };
  });
}
export function HeadingsLineSelect(props: HeadingsLineSelectProps) {
  let { table, headerLine, linesLeftOut, isOff, onPicked } = props;
  let lineText = (lineNumber: number) =>
    (table.lines[lineNumber - 1] ?? []).filter((text) => text.trim() !== '').join(', ');
  let firstTableLine = lastDataLineNumber(table, linesLeftOut) ?? 0;
  let lineChoices: number[] = [];
  for (let lineNumber = 1; lineNumber <= Math.min(table.lines.length, HEADING_SCAN_LINES); lineNumber++) {
    if (lineChoices.length === MAX_HEADING_CHOICES) break;
    if (lineNumber < firstTableLine && lineText(lineNumber) !== '') lineChoices.push(lineNumber);
  }
  if (headerLine !== null && !lineChoices.includes(headerLine)) lineChoices.push(headerLine);
  return <PaneSelect name={labelAndChosen(importSettingsLabels.headings(), headerLine === null ? importSettingsLabels.noHeadings() : importLineLabel(headerLine))} hasLongRows longestLabelInCharacters={Math.max(0, ...lineChoices.map((lineNumber) => importLineLabel(lineNumber).length))} isOff={isOff} value={headerLine === null ? 'none' : String(headerLine)} items={[
      ...lineChoices.map(
        (lineNumber) => ({
          value: String(lineNumber),
          label: importLineLabel(lineNumber),
          hint: truncateToCleanText(lineText(lineNumber), HEADING_HINT_CHARS),
        }),
      ),
      {
        value: 'none',
        label: importSettingsLabels.noHeadings(),
      },
    ]} onChange={(value: string) => onPicked(value === 'none' ? null : Number(value))} />;
}
export const AGENT_READ_TEXT_CLASS = {
  className: 'text-footnote leading-snug [overflow-wrap:anywhere]',
};
export const askedAgainColumns = (previous: ColumnsAskedAgain | null, columns: number[]): ColumnsAskedAgain => ({
  columns,
  times: (previous?.times ?? 0) + 1,
});
export const columnsAskedAgainAfterChange = (previous: ColumnsAskedAgain | null, change: ImportChangeByHand) =>
  change.kind === 'column' && change.reading !== undefined ? askedAgainColumns(previous, [change.columnIndex]) : null;
export const withoutYear = (text: string, reading: ImportReading | undefined) => (reading?.kind === 'date' ? text.replace(/,? \d{4}$/, '') : text);
export const heardBecomesWords = (examples: ImportQuestionExample[][]) =>
  examples.map(
    ([example]) =>
      example === undefined || example.becomes === null ? undefined : textBecomesWords(example.text, example.becomes),
  );
export const MAX_HEADING_CHOICES = 12;
export const HEADING_SCAN_LINES = 200;
export const HEADING_HINT_CHARS = 70;
