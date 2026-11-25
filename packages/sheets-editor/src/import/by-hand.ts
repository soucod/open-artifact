import { isSameJson, importTextAt, optionsLimitedToColumns, doOptionsDiffer } from './column-readings.ts';
import type { ImportLineChoice } from './column-readings.ts';
import type {
  ImportByHand,
  ImportChangeStood,
  ImportColumnByHand,
  ImportColumnPlan,
  ImportFile,
  ImportPlan,
  ImportQuestion,
  ImportReadingWords,
} from '../state/initial-state.ts';
import type { ImportChangeByHand, ImportReading } from '../state/event-reducer.ts';
export function applyByHandChange(byHand: ImportByHand, change: ImportChangeByHand): ImportByHand {
  switch (change.kind) {
    case 'sheetName':
      return {
        ...byHand,
        sheetName: change.name,
      };
    case 'headings':
      return {
        ...byHand,
        headings: {
          line: change.line,
        },
      };
    case 'line':
      return {
        ...byHand,
        lines: {
          ...byHand.lines,
          [change.line]: change.isLeftOut,
        },
      };
    case 'column': {
      let { kind, columnIndex, ...columnChange } = change;
      let column = {
        ...byHand.columns[columnIndex],
        ...columnChange,
      };
      return {
        ...byHand,
        columns: {
          ...byHand.columns,
          [columnIndex]: column,
        },
      };
    }
  }
}
export function questionOptionOfReading(questions: ImportQuestion[], columnIndex: number, reading: ImportReading) {
  let readings = [
    {
      columnIndex,
      reading,
    },
  ];
  for (let { id: questionId, options } of questions) {
    let optionIndex = options.findIndex(({ readings: optionReadings }) => isSameJson(optionReadings, readings));
    if (optionIndex >= 0)
      return {
        questionId,
        optionIndex,
      };
  }
  return null;
}
export function wordIndexesIn(text: string, word: string) {
  let indexes: number[] = [];
  if (word === '') return indexes;
  for (let index = text.indexOf(word); index >= 0; index = text.indexOf(word, index + 1)) {
    let end = index + word.length;
    let isPlural = word.length >= 3 && text[end] === 's';
    if (!isWordCharacterOfNote(text[index - 1]) && !isWordCharacterOfNote(text[isPlural ? end + 1 : end])) indexes.push(index);
  }
  return indexes;
}
export function withoutTrailingParenthesis(name: string) {
  let openIndex = name.endsWith(')') ? name.lastIndexOf('(') : -1;
  return openIndex < 0 ? name : name.slice(0, openIndex).trimEnd();
}
export function columnsNamedInNote(note: string, columns: Pick<ImportColumnPlan, 'name'>[]) {
  let columnsByName = new Map<string, number[]>();
  let lowerNames = columns.map(({ name }) => name.toLowerCase());
  lowerNames.forEach((name, columnIndex) => {
    columnsByName.set(name, [...(columnsByName.get(name) ?? []), columnIndex]);
  });
  lowerNames.forEach((name, columnIndex) => {
    let shortName = withoutTrailingParenthesis(name);
    if (lowerNames.includes(shortName)) return;
    columnsByName.set(shortName, [...(columnsByName.get(shortName) ?? []), columnIndex]);
  });
  let lowerNote = note.toLowerCase();
  let namedColumns = new Set<number>();
  let longestFirst = [...columnsByName].toSorted(([name], [otherName]) => otherName.length - name.length);
  for (let [name, columnIndexes] of longestFirst)
    for (let wordIndex of wordIndexesIn(lowerNote, name)) {
      for (let columnIndex of columnIndexes) namedColumns.add(columnIndex);
      lowerNote = lowerNote.slice(0, wordIndex) + ' '.repeat(name.length) + lowerNote.slice(wordIndex + name.length);
    }
  return [...namedColumns].toSorted((columnIndex, otherIndex) => columnIndex - otherIndex);
}
export function changesByHand(
  plan: ImportPlan,
  { sheetName, headings, lines, columns }: ImportByHand,
  previousPlan: ImportPlan | null = null,
): ImportChangeStood[] {
  let headerLine = headings === null ? plan.headerLine : headings.line;
  return [
    ...(headings !== null && headings.line !== plan.headerLine
      ? [
          {
            kind: 'headings',
          } satisfies ImportChangeStood,
        ]
      : []),
    ...Object.entries(lines).flatMap(
      ([line, isLeftOut]): ImportChangeStood[] =>
        Number(line) <= (headerLine ?? 0) || isLeftOut === plan.linesLeftOut.includes(Number(line))
          ? []
          : [
              {
                kind: 'line',
                line: Number(line),
              },
            ],
    ),
    ...(sheetName !== null && ![sheetName, previousPlan?.sheetName].includes(plan.sheetName)
      ? [
          {
            kind: 'sheetName',
          } satisfies ImportChangeStood,
        ]
      : []),
    ...Object.entries(columns).flatMap(([columnIndex, { name, reading }]): ImportChangeStood[] => {
      let planColumn = plan.columns[Number(columnIndex)];
      return (reading !== undefined && !isSameJson(reading, planColumn?.reading)) ||
        (name !== undefined && ![name, previousPlan?.columns[Number(columnIndex)]?.name].includes(planColumn?.name))
        ? [
            {
              kind: 'column',
              columnIndex: Number(columnIndex),
            },
          ]
        : [];
    }),
  ];
}
export function notesStillTrue(plan: ImportPlan, byHand: ImportByHand) {
  let changes = changesByHand(plan, byHand);
  let isColumnTouched = (columnIndex: number) =>
    byHand.columns[columnIndex]?.isLeftOut === true ||
    changes.some((change) => change.kind === 'column' && change.columnIndex === columnIndex);
  let isAboutTouchedLine = (note: string) => {
    let numbers = new Set((note.match(/(?<![\d.,:/$€£¥-])\d+(?![.,:/]?\d|%)/g) ?? []).map(Number));
    return changes.some((change) => change.kind === 'line' && plan.linesLeftOut.includes(change.line) && numbers.has(change.line));
  };
  return plan.notes.filter((note) => !columnsNamedInNote(note, plan.columns).some(isColumnTouched) && !isAboutTouchedLine(note));
}
export function byHandAfterNewPlan(byHand: ImportByHand, plans: ImportPlan[], newPlan: ImportPlan): ImportByHand {
  let isUnlikeAll = <Value>(byHandValue: Value, valueOf: (plan: ImportPlan) => Value) =>
    [byHandValue, ...plans.map(valueOf)].every((other) => !isSameJson(valueOf(newPlan), other));
  let { sheetName, headings, columns } = byHand;
  return {
    ...byHand,
    sheetName: sheetName !== null && isUnlikeAll(sheetName, (plan) => plan.sheetName) ? null : sheetName,
    headings: headings !== null && isUnlikeAll(headings.line, (plan) => plan.headerLine) ? null : headings,
    columns: Object.fromEntries(
      Object.entries(columns).flatMap(([columnIndex, { name, reading, isLeftOut }]): [string, ImportColumnByHand][] => {
        let index = Number(columnIndex);
        let kept = {
          ...(name !== undefined &&
            !isUnlikeAll<string | undefined>(name, (plan) => plan.columns[index]?.name) && {
              name,
            }),
          ...(reading !== undefined &&
            !isUnlikeAll<ImportReading | undefined>(reading, (plan) => plan.columns[index]?.reading) && {
              reading,
            }),
          ...(isLeftOut !== undefined && {
            isLeftOut,
          }),
        };
        return Object.keys(kept).length === 0 ? [] : [[columnIndex, kept]];
      }),
    ),
  };
}
export function linesWithByHand(plan: ImportLineChoice, byHand: Pick<ImportByHand, 'headings' | 'lines'>, file: Pick<ImportFile, 'lines'>): ImportLineChoice {
  let headerLine = byHand.headings === null ? plan.headerLine : byHand.headings.line;
  let linesAboveHeader =
    headerLine === null ? file.lines.slice(0, (plan.headerLine ?? 1) - 1).map((_, index) => index + 1) : [];
  let leftOut = new Set([...linesAboveHeader, ...plan.linesLeftOut]);
  for (let [line, isLeftOut] of Object.entries(byHand.lines))
    if (isLeftOut) leftOut.add(Number(line));
    else leftOut.delete(Number(line));
  let linesLeftOut = [...leftOut].filter((line) => line > (headerLine ?? 0));
  linesLeftOut.sort((line, otherLine) => line - otherLine);
  return {
    headerLine,
    linesLeftOut,
  };
}
export function planWithByHand(
  plan: ImportPlan,
  byHand: ImportByHand,
  file: ImportFile,
  defaultNames: ImportReadingWords['names'],
): ImportPlan {
  let { headerLine, linesLeftOut } = linesWithByHand(plan, byHand, file);
  let headingAt = (columnIndex: number) => {
    let heading = headerLine === null ? '' : importTextAt(file, headerLine, columnIndex).trim();
    return heading === '' ? (defaultNames.columns[columnIndex] ?? '') : heading;
  };
  return {
    ...plan,
    sheetName: byHand.sheetName ?? plan.sheetName,
    headerLine,
    linesLeftOut,
    columns: plan.columns.map(
      (column, columnIndex) => ({
        name: byHand.columns[columnIndex]?.name ?? (headerLine === plan.headerLine ? column.name : headingAt(columnIndex)),
        reading: byHand.columns[columnIndex]?.reading ?? column.reading,
      }),
    ),
    questions: questionsLeftByHand(byHand, plan.questions),
    notes: notesStillTrue(plan, byHand),
    summary: summaryStillTrue(plan, byHand),
  };
}
export const NOTHING_BY_HAND: ImportByHand = {
  sheetName: null,
  headings: null,
  lines: {},
  columns: {},
};
export const withoutReadingsByHand = (byHand: ImportByHand, columnIndexes: number[]): ImportByHand => ({
  ...byHand,
  columns: Object.fromEntries(
    Object.entries(byHand.columns).map(([columnIndex, column]): [string, ImportColumnByHand] => {
      let { reading, ...withoutReading } = column;
      return [columnIndex, columnIndexes.includes(Number(columnIndex)) ? withoutReading : column];
    }),
  ),
});
export const isWordCharacterOfNote = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}]/u.test(character);
export const summaryStillTrue = (plan: ImportPlan, byHand: ImportByHand) =>
  changesByHand(plan, byHand).some(({ kind }) => kind === 'headings') ? null : (plan.summary ?? null);
export const columnsLeftOutByHand = ({ columns }: Pick<ImportByHand, 'columns'>) =>
  Object.entries(columns).flatMap(([columnIndex, { isLeftOut }]) => (isLeftOut === true ? [Number(columnIndex)] : []));
export const questionsLeftByHand = ({ columns }: Pick<ImportByHand, 'columns'>, questions: ImportQuestion[]) =>
  questions.flatMap((question) => {
    let options = optionsLimitedToColumns(question, (columnIndex) => columns[columnIndex]?.reading === undefined);
    return doOptionsDiffer(options)
      ? [
          {
            ...question,
            options,
          },
        ]
      : [];
  });
