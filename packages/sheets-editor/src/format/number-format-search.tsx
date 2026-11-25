import { Menu } from '../kit/menu.tsx';
import * as React from 'react';
import type { IconName } from '../kit/icon.tsx';
import type { ExamplesOfNumberFormats } from '../state/initial-state.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { FormatCommand } from './format-commands.ts';
import type { NumberFormatOrControlChoice } from './number-format-choices.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { toolSearchWords } from '../tools/search-words.ts';
import {
  PHONE_NUMBER_FORMAT,
  NUMBER_FORMAT_CHOICES,
  exampleOfChoice,
  isCurrencyCodeOffered,
  isNorthAmericanLocale,
} from './number-format-choices.ts';
import { toolUnavailableText } from '../i18n/chip-labels.ts';
import {
  numberFormatChoiceLabel,
  commandSearchStopWords,
  checkboxAndDropdownSearchWords,
  customFormatOfferLabel,
  commandMatchCountText,
} from '../i18n/format-labels.ts';
import { numberFormatIconOf } from '../ui/toolbar/number-format-menu.tsx';
import { localeMessages, languageNameOfLocale } from '../messages/locale.ts';
import { timeZoneMessages, shortTimeZoneLabel } from '../ui/locale-time-zone-pick.ts';
import { hasSearchWords, MATCH_RANK_OTHER_WORDS, queryMatchesOtherWords, searchCommands } from '../ui/search-menu/matching.ts';
import {
  customFormatRowLabel,
  isAgentBusyOrDone,
  handleCustomFormatKey,
  CustomFormatRowInView,
  CUSTOM_FORMAT_ROW_PROPS,
} from './custom-format-row.tsx';
import { swallowRestOfPress } from '../ui/press-swallow.ts';
import { CommandRows } from '../ui/menu-with-field.tsx';
import type { CustomFormatList } from './custom-format-row.tsx';
/** A cell control that can be put in the cells from the number format menu, in place of a format. */
export type CellControlInPlaceOfFormat = 'checkbox' | 'dropdown' | 'person' | 'date';
/** A cell control the number format menu offers, and whether the selected cells take it. */
export interface CellControlInsertChoice {
  what: CellControlInPlaceOfFormat;
  icon: IconName;
  label: string;
  fits: boolean;
  whyNotNow?: string;
}
/** The workbook settings the number format menu shows, and how to change them. */
export interface WorkbookInFormatMenu {
  locale: string;
  examples: ExamplesOfNumberFormats;
  onLocaleAsked: () => void;
  timeZone: WorkbookReads['timeZone'];
  onTimeZoneAsked: () => void;
}
/** A row of the number format menu that its search field finds: a format, a cell control, or a workbook setting. */
export interface NumberFormatCommand {
  id: string;
  label: string;
  otherWords: string[];
  /** Found only by its other words, not by its label. */
  isSoughtByOtherWords?: true;
  /** A row that sets no number format: a cell control or a workbook setting. */
  isNoFormat?: true;
  icon: IconName;
  isTicked?: boolean;
  actsOn: 'cells' | 'activeCell' | 'file';
  whyNot: string | null;
  run: () => void;
  /** An example of the format, or the setting's value, at the end of the row. */
  atEnd: string | null;
}
/** A label or a typed text as search words, in order and in any order: with every word, then without the little words. */
export interface WordForm {
  inOrder: string;
  inAnyOrder: string;
}
/** The rows whose words were typed whole, or the rows whose words were begun. */
export interface NamedOrBegunFormats {
  named: NumberFormatCommand[];
  begun: NumberFormatCommand[];
}
/** What Enter does in the search field of the number format menu: take a row, type on as a pattern, or nothing. */
export type NumberFormatEnterAction = { does: 'takes'; row: NumberFormatCommand } | { does: 'typesOn' } | { does: 'nothing' };
export interface NumberFormatSearchProps {
  written: CustomFormatList;
  choiceOfSelection: NumberFormatOrControlChoice | 'person' | null;
  inPlaceOfFormat: CellControlInsertChoice[];
  onInsertChosen: (control: CellControlInPlaceOfFormat) => void;
  areFormatsOnOffer: boolean;
  formatsThatFit: NumberFormatOrControlChoice[];
  doesFormatTakeControlOff: boolean;
  onChosen: (command: FormatCommand) => void;
  workbookInFormatMenu: WorkbookInFormatMenu;
  patternOfSelection: string | null;
  isPointerCoarse: boolean;
}
export function numberFormatCommands({
  choiceOfSelection,
  inPlaceOfFormat,
  onInsertChosen,
  areFormatsOnOffer,
  formatsThatFit,
  doesFormatTakeControlOff,
  onChosen,
  workbookInFormatMenu: { locale, examples, onLocaleAsked, timeZone, onTimeZoneAsked },
  patternOfSelection,
}: NumberFormatSearchProps): NumberFormatCommand[] {
  let phoneNumberCommand: NumberFormatCommand = {
    id: 'bar.numberFormat.phoneNumber',
    label: sheetMessages.phoneNumber(),
    otherWords: toolSearchWords('phoneNumber'),
    isSoughtByOtherWords: true,
    icon: 'Phone',
    isTicked: choiceOfSelection === null && !doesFormatTakeControlOff && patternOfSelection === PHONE_NUMBER_FORMAT.pattern,
    actsOn: 'cells',
    whyNot: null,
    run: () =>
      onChosen({
        customNumberFormat: {
          pattern: PHONE_NUMBER_FORMAT.pattern,
        },
      }),
    atEnd: PHONE_NUMBER_FORMAT.example,
  };
  return [
    ...inPlaceOfFormat.map(
      ({ what, icon, label, fits, whyNotNow }): NumberFormatCommand => ({
        id: `bar.insert.${what}`,
        label,
        otherWords: toolSearchWords(INSERT_OTHER_WORDS_KEYS[what]),
        isNoFormat: true,
        icon,
        isTicked: choiceOfSelection === what,
        actsOn: what === 'person' ? 'activeCell' : 'cells',
        whyNot: fits ? (whyNotNow ?? null) : toolUnavailableText(label),
        run: () => onInsertChosen(what),
        atEnd: null,
      }),
    ),
    ...(areFormatsOnOffer ? NUMBER_FORMAT_CHOICES : [])
      .filter((choice) => formatsThatFit.includes(choice))
      .map((choice): NumberFormatCommand => {
      let example = exampleOfChoice(examples, choice);
      return {
        id: `bar.numberFormat.${choice}`,
        label: numberFormatChoiceLabel(choice),
        otherWords: [...(isCurrencyCodeOffered(choice) ? [choice] : toolSearchWords(choice)), example],
        icon: numberFormatIconOf(choice).icon,
        isTicked: choiceOfSelection === choice,
        actsOn: 'cells',
        whyNot: null,
        run: () =>
          onChosen({
            numberFormatChoice: choice,
          }),
        atEnd: example,
      };
    }),
    ...(areFormatsOnOffer && isNorthAmericanLocale(locale) ? [phoneNumberCommand] : []),
    {
      id: 'bar.locale',
      label: localeMessages.locale(),
      otherWords: toolSearchWords('locale'),
      isNoFormat: true,
      icon: 'Globe',
      actsOn: 'file',
      whyNot: null,
      run: onLocaleAsked,
      atEnd: languageNameOfLocale(locale),
    },
    {
      id: 'bar.timeZone',
      label: timeZoneMessages.timeZone(),
      otherWords: toolSearchWords('timeZone'),
      isNoFormat: true,
      icon: 'Clock',
      actsOn: 'file',
      whyNot: null,
      run: onTimeZoneAsked,
      atEnd: shortTimeZoneLabel(timeZone),
    },
  ];
}
export function looksLikeFormatPattern(text: string) {
  if (!hasSearchWords(text) || hasRealWords(text)) return false;
  if (FORMAT_CODE_CHAR_PATTERN.test(text)) return true;
  let withoutAmPm = text.replaceAll(AM_PM_PATTERN, '');
  return DATE_CODE_ONLY_PATTERN.test(withoutAmPm) && (withoutAmPm !== text || DATE_CODE_RUN_PATTERN.test(text));
}
export function withoutLittleWords(words: string[]) {
  let littleWords = new Set(formatSearchWords(commandSearchStopWords()));
  return words.filter((word) => !littleWords.has(word));
}
export function wordsInAnyOrder(words: string[]) {
  let sorted = [...words];
  if (!words.some((word) => /^\p{N}/u.test(word))) sorted.sort();
  return sorted.join(' ');
}
export function formatWordForms(text: string): WordForm[] {
  let words = formatSearchWords(text);
  return [words, withoutLittleWords(words)].map(
    (wordList) => ({
      inOrder: wordList.join(' '),
      inAnyOrder: wordsInAnyOrder(wordList),
    }),
  );
}
export function formatWordFormsOf(text: string) {
  let forms = formatWordFormsCache.get(text) ?? (looksLikeFormatPattern(text) ? [] : formatWordForms(text));
  formatWordFormsCache.set(text, forms);
  return forms;
}
export function otherWordForms({ id, otherWords = [], atEnd, isNoFormat }: NumberFormatCommand) {
  let skippedWords = new Set(
    id === 'bar.insert.checkbox' || id === 'bar.insert.dropdown'
      ? checkboxAndDropdownSearchWords()
          .split(/[,،、，]/)
          .map((word) => word.trim().toLowerCase())
      : [],
  );
  return otherWords
    .filter((word) => isNoFormat === true || word !== atEnd)
    .filter((word) => !skippedWords.has(word.toLowerCase()))
    .map(formatWordFormsOf);
}
export function namedOrBegunFormats(rows: NumberFormatCommand[], typed: string): NamedOrBegunFormats {
  let ordered = [
    ...rows.filter(({ isNoFormat }) => isNoFormat !== true),
    ...rows.filter(({ isNoFormat }) => isNoFormat),
  ];
  let rowsWithTypedExample = ordered.filter((row) => isExampleTyped(row, typed));
  if (rowsWithTypedExample.length > 0)
    return {
      named: rowsWithTypedExample,
      begun: [],
    };
  let typedForms = formatWordForms(typed);
  let endsInLittleWord = withoutLittleWords(formatSearchWords(typed).slice(-1)).length === 0;
  for (let [formIndex, form] of typedForms.entries()) {
    if (form.inOrder === '') break;
    let rowsWithForm = (formsOf: (row: NumberFormatCommand) => WordForm[][]) =>
      ordered.filter((row) => formsOf(row).some((forms) => forms[formIndex]?.inAnyOrder === form.inAnyOrder));
    let begun = (formIndex === 1 && endsInLittleWord ? [] : ordered).filter(
      (row) =>
        soughtWordForms(row).some((forms) => forms[formIndex]?.inOrder.startsWith(form.inOrder) === true),
    );
    let namedRows = [rowsWithForm(labelWordForms), begun.length > 0 ? [] : rowsWithForm(otherWordForms)].find(
      ({ length }) => length > 0,
    );
    if (namedRows !== undefined)
      return {
        named: namedRows,
        begun: [],
      };
    if (begun.length > 0)
      return {
        named: [],
        begun,
      };
  }
  let isLabelBegun = (label: string) => `${typedForms[1]?.inOrder} `.startsWith(`${formatWordFormsOf(label)[1]?.inOrder} `);
  return {
    named: [],
    begun: ordered.filter(({ isNoFormat, label }) => isNoFormat === true && isLabelBegun(label)),
  };
}
export function numberFormatEnterAction(rows: NumberFormatCommand[], typed: string, isSearching: boolean): NumberFormatEnterAction {
  if (!isSearching) {
    let [topRow] = numberFormatRowsFor(rows, typed);
    return topRow?.whyNot === null
      ? {
          does: 'takes',
          row: topRow,
        }
      : {
          does: 'nothing',
        };
  }
  let { named, begun } = namedOrBegunFormats(rows, typed);
  let [first, ...rest] = [...named, ...begun];
  let isPatternTyped = looksLikeFormatPattern(typed) && !(first !== undefined && isExampleTyped(first, typed));
  if (first === undefined || first.whyNot !== null || isPatternTyped)
    return {
      does: 'typesOn',
    };
  return (
    named.length > 0
      ? rest.every((row) => row.label.startsWith(first.label))
      : withoutLittleWords(formatSearchWords(typed)).join('').length >= MATCH_RANK_OTHER_WORDS
  )
    ? {
        does: 'takes',
        row: first,
      }
    : {
        does: 'typesOn',
      };
}
export function numberFormatSearchField(props: NumberFormatSearchProps) {
  let written = {
    ...props.written,
    takesTypedPattern:
      props.written.takesTypedPattern &&
      !(SHORT_WORD_PATTERN.test(props.written.text.trim()) && !looksLikeFormatPattern(props.written.text)) &&
      FORMAT_TOKEN_PATTERN.test(
        props.written.text.replaceAll(
          FORMAT_LITERAL_PATTERN,
          (literal) => (ELAPSED_TIME_PATTERN.test(literal) ? literal : ''),
        ),
      ),
  };
  let typed = written.text;
  let enteredRef = React.useRef(false);
  let [isEntered, setIsEntered] = React.useState(false);
  let typePattern = (typedText: string) =>
    props.onChosen({
      patternToType: true,
      typedSoFar: typedText.trim(),
    });
  let saidOfTyped = (typedInField: string, withEnterHint: boolean) => {
    let rows = numberFormatCommands(props);
    let enterAction = numberFormatEnterAction(rows, typedInField, props.areFormatsOnOffer);
    let enterLabel = (
      {
        takes: enterAction.does === 'takes' ? enterAction.row.label : null,
        typesOn: customFormatRowLabel(written) ?? customFormatOfferLabel(typedInField.trim()),
        nothing: null,
      } satisfies Record<NumberFormatEnterAction['does'], string | null>
    )[enterAction.does];
    return commandMatchCountText(numberFormatRowsFor(rows, typedInField).length, withEnterHint ? enterLabel : null);
  };
  return {
    name: sheetMessages.findNumberFormat(),
    saidOf: (typedText: string, withEnterHint = true) =>
      typedText.trim() !== '' && !isEntered && !isAgentBusyOrDone(written) && saidOfTyped(typedText, withEnterHint),
    typed,
    onTyped(typedText: string) {
      enteredRef.current = false;
      setIsEntered(false);
      written.onTyped(typedText);
    },
    takeKeyFirst: (event: React.KeyboardEvent) =>
      props.areFormatsOnOffer &&
      handleCustomFormatKey(
        written,
        event,
        !enteredRef.current && numberFormatEnterAction(numberFormatCommands(props), typed, props.areFormatsOnOffer).does === 'typesOn',
      ),
    hasRowsAtRest: true,
    renderRowsFor(searchTyped: string) {
      if (searchTyped.trim() === '') return null;
      let rows = numberFormatCommands(props);
      let shownRows = numberFormatRowsFor(rows, searchTyped);
      let enterAction = numberFormatEnterAction(rows, searchTyped, props.areFormatsOnOffer);
      let isPatternUnderEnter = enterAction.does === 'typesOn';
      let [first, ...rest] = shownRows;
      let isFirstUnderEnter = first !== undefined && 'row' in enterAction && !isAgentBusyOrDone(written);
      let patternRow =
        props.areFormatsOnOffer &&
        (<CustomFormatRowInView list={written} isUnderEnter={isPatternUnderEnter} rowToDialog={(description) =>
            (<Menu.Item icon="Sliders" labelDir="auto" description={description} descriptionLines={2} {...CUSTOM_FORMAT_ROW_PROPS} keepOpen {...(isPatternUnderEnter && {
                className: 'sheet-row-under-enter',
              })} onClick={(event) => {
                if (written.isActTooSoon()) return;
                swallowRestOfPress(event);
                typePattern(searchTyped);
              }}>{customFormatOfferLabel(searchTyped.trim())}</Menu.Item>)} />);
      let separator = props.areFormatsOnOffer && shownRows.length > 0 && (<Menu.Separator />);
      return <>{isPatternUnderEnter && patternRow}{isPatternUnderEnter && separator}<Menu.Group aria-label={sheetMessages.cellType()}><CommandRows commands={isFirstUnderEnter
                ? [
                    {
                      ...first,
                      isUnderEnter: true,
                    },
                    ...rest,
                  ]
                : shownRows} isRowUnderEnterLit isOneChoice hintOf={({ id }: NumberFormatCommand) => rows.find((row) => row.id === id)?.atEnd ?? null} isPointerCoarse={props.isPointerCoarse} describe={() => null} onTaken={({ run }: NumberFormatCommand) => run()} /></Menu.Group>{!isPatternUnderEnter && separator}{!isPatternUnderEnter && patternRow}</>;
    },
    onEntered(typedNow: string): 'stay' | 'shut' {
      let enterAction = numberFormatEnterAction(numberFormatCommands(props), typedNow, props.areFormatsOnOffer);
      if (enterAction.does === 'nothing') return 'stay';
      if (enteredRef.current) return 'stay';
      enteredRef.current = true;
      setIsEntered(true);
      if ('row' in enterAction) enterAction.row.run();
      else typePattern(typedNow);
      return 'shut';
    },
  };
}
export const INSERT_OTHER_WORDS_KEYS = {
  checkbox: 'insertCheckbox',
  dropdown: 'insertDropdown',
  person: 'insertPerson',
  date: 'insertDate',
};
export const MAX_FORMAT_ROWS = 100;
export const FORMAT_LITERAL_PATTERN = /"[^"]*"|\[[^\]]*\]|\\./gu;
export const LONG_LETTER_RUN_PATTERN = /\p{L}{3,}/gu;
export const REPEATED_LETTER_PATTERN = /^(.)\1*$/iu;
export const hasRealWords = (text: string) =>
  (text.replaceAll(FORMAT_LITERAL_PATTERN, '').match(LONG_LETTER_RUN_PATTERN) ?? []).some(
    (word) => !REPEATED_LETTER_PATTERN.test(word),
  );
export const FORMAT_CODE_CHAR_PATTERN = /[\d#?@]/;
export const ELAPSED_TIME_PATTERN = /^\[(?:h+|m+|s+)\]$/i;
export const FORMAT_TOKEN_PATTERN = /[\d#?@dmyhs]|general/i;
export const SHORT_WORD_PATTERN = /^\p{L}{1,2}$/u;
export const AM_PM_PATTERN = /AM\/PM|A\/P/gi;
export const DATE_CODE_ONLY_PATTERN = /^[dmyhs\P{L}]*$/iu;
export const DATE_CODE_RUN_PATTERN = /([dmyhs])\1|[dmyhs]\P{L}+[dmyhs]/iu;
export const formatSearchWords = (text: string): string[] =>
  text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+|[\p{S}%#@*]/gu) ?? [];
export const formatWordFormsCache = new Map<string, WordForm[]>();
export const labelWordForms = ({ label, atEnd, isNoFormat }: NumberFormatCommand) =>
  [label, ...label.split(/[()]/), ...((isNoFormat === true ? null : atEnd)?.match(/^[\p{S}%]|[\p{S}%]$/gu) ?? [])].map(formatWordFormsOf);
export const soughtWordForms = ({ label, otherWords = [], isSoughtByOtherWords }: NumberFormatCommand) =>
  (isSoughtByOtherWords === true ? otherWords : [label]).map(formatWordFormsOf);
export const isExampleTyped = ({ atEnd, isNoFormat }: NumberFormatCommand, typed: string) =>
  isNoFormat !== true && atEnd?.toLowerCase() === typed.trim().toLowerCase();
export const numberFormatRowsFor = (rows: NumberFormatCommand[], typed: string): NumberFormatCommand[] => {
  let { named, begun } = namedOrBegunFormats(rows, typed);
  let searchable = rows.filter((row) => row.isSoughtByOtherWords !== true || queryMatchesOtherWords(row, typed));
  let found = [...new Set<NumberFormatCommand>([...named, ...begun, ...searchCommands(searchable, typed, MAX_FORMAT_ROWS)])];
  return [
    ...found.filter(({ whyNot }) => whyNot === null),
    ...found.filter(({ whyNot }) => whyNot !== null),
  ];
};
