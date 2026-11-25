import type { Color, StretchOfADropdown } from '@open-artifact/sheets-core';
import { foldLabelCase, MAX_DROPDOWN_OPTIONS, isSameOptionLabel, MAX_OPTION_LABEL_LENGTH } from './dropdown-options.ts';
import { colorForAddedOption, isDropdownDeliberatelyUncolored } from './dropdown-colors.ts';
import { dropdownEditorOfPane } from '../state/queries.ts';
import { commitDropdownOptions } from './dropdown-editor.ts';
import { sanitizeCellText } from '../model/cell-text.ts';
import { colorsEqual } from '../model/colors.ts';
import { parseTsvCells } from '../clipboard/formats.ts';
import { unescapeClipboardText } from '../clipboard/text-escaping.ts';
import type { ColoredOption } from './dropdown-colors.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { DropdownPresetKey, LocalizedDropdownPreset } from '../i18n/chip-labels.ts';
import type { DropdownEditorInPane, DropdownReach, OptionOfDropdownInPane, PageState, TypedOptionInPane } from '../state/initial-state.ts';
import type { PageEffect } from '../state/transitions.ts';
/** The cells of a dropdown a change of its options goes to, and the options they held before the change when that is not what the sheet holds now. */
export interface DropdownEditTarget {
  /** `null` while the dropdown is not made yet. */
  dropdownId: string | null;
  stretches: StretchOfADropdown[];
  indexOfOwnStretch: number | null;
  reach: DropdownReach;
  optionsByThen?: OptionOfDropdownInPane[];
}
/** The dropdown being edited in the side pane: whether its options are being typed over from none, and its options as they were last colored. */
export interface DropdownEditor extends DropdownEditorInPane, DropdownEditTarget {
  isCustom?: boolean;
  lastInColor?: OptionOfDropdownInPane[];
}
/** Labels pasted among a dropdown's options: the options after, how many were added, how many skipped, and whether the dropdown is full. */
export interface OptionLabelsPasted {
  pasted: OptionOfDropdownInPane[];
  count: number;
  skipped: number;
  isFull: boolean;
}
/** What every option's color can be set to at once: none, or colors picked by their labels. */
export type EveryOptionColorOffer = 'none' | 'automatic';
/** The label typed for an option, kept: the options it names, and the edits that keep them. */
export interface TypedOptionCommitted {
  named: OptionOfDropdownInPane[];
  effects: PageEffect[];
}
export function pasteOptionLabels(
  options: readonly OptionOfDropdownInPane[],
  atIndex: number,
  pastedLabels: readonly string[],
  firstColor: Color | null,
): OptionLabelsPasted {
  let [replaced, others] = [options[atIndex], options.filter((option, index) => index !== atIndex)];
  let takenLabels = new Set(others.map((option) => foldLabelCase(option.label)));
  let added: OptionOfDropdownInPane[] = [];
  let [skipped, isFull] = [0, false];
  for (let [labelIndex, pastedLabel] of pastedLabels.entries()) {
    if (added.length >= MAX_DROPDOWN_OPTIONS - others.length) {
      [skipped, isFull] = [skipped + pastedLabels.length - labelIndex, true];
      break;
    }
    let label = cleanOptionLabel(pastedLabel).trim();
    let isNew = label !== '' && !takenLabels.has(foldLabelCase(label));
    if (!isNew) skipped += 1;
    if (labelIndex === 0 && replaced !== undefined)
      added.push(
        isNew
          ? {
              ...replaced,
              label,
            }
          : replaced,
      );
    else if (isNew) {
      let color = (added.length === 0 ? firstColor : null) ?? colorForAddedOption(label, [...others, ...added]);
      added.push({
        optionId: null,
        label,
        color,
      });
    }
    takenLabels.add(foldLabelCase(added.at(-1)?.label ?? ''));
  }
  return {
    pasted: [...options.slice(0, atIndex), ...added, ...options.slice(atIndex + 1)],
    count: added.length - (replaced === undefined ? 0 : 1),
    skipped,
    isFull,
  };
}
export function optionsWithTyped(editor: DropdownEditor): OptionOfDropdownInPane[] {
  let [options, { typed }] = [editorOptionsOf(editor), editor];
  if (typed === null) return [...options];
  if (typed.optionId !== null)
    return options.map(
      (option) =>
        option.optionId === typed.optionId
          ? {
              ...option,
              label: typed.label,
            }
          : option,
    );
  let color = typed.pickedColor ?? colorForAddedOption(typed.label, options);
  return [
    ...options,
    {
      optionId: null,
      label: typed.label,
      color,
    },
  ];
}
export function everyOptionColorOffer(editor: DropdownEditor): EveryOptionColorOffer | null {
  let options = optionsWithTyped(editor);
  if (options.some(({ color }) => color.kind !== 'none')) return 'none';
  return isDropdownDeliberatelyUncolored(options) ? 'automatic' : null;
}
export function isTypedOptionLabelUnsaved(state: PageState): boolean {
  let editor = dropdownEditorOfPane(state);
  let typed = editor?.typed ?? null;
  if (editor === null || typed === null) return false;
  let saved = editor.options.find(({ optionId }) => optionId === typed.optionId);
  return typed.label.trim() !== (saved?.label ?? '');
}
export function hasUnsavedSidePaneTyping(state: PageState): boolean {
  switch (state.sidePane?.kind) {
    case 'dropdown':
      return hasUnsavedDropdownTyping(state);
    case 'conditionalFormats':
      return (state.sidePane.rules.editor?.typed ?? null) !== null;
    case 'sort':
      return state.sidePane.sort.cellsTyped !== undefined && state.sidePane.sort.areCellsTypedRefused !== true;
    case 'pivotTable': {
      let { typed } = state.sidePane.pivotTable;
      return typed !== null && typed.isRefused !== true;
    }
    case 'versionHistory':
    case undefined:
      return false;
  }
}
export function changedCellsTyped(editor: Pick<DropdownEditor, 'cellsTyped' | 'stretches' | 'indexOfOwnStretch'>): string | null {
  let typedCells = editor.cellsTyped?.trim() ?? '';
  let ownRange = editor.stretches[editor.indexOfOwnStretch]?.range;
  return typedCells === '' || typedCells.toUpperCase() === ownRange ? null : typedCells;
}
export function hasUnsavedDropdownEdits(state: PageState): boolean {
  let editor = dropdownEditorOfPane(state);
  return isTypedOptionLabelUnsaved(state) || (editor !== null && changedCellsTyped(editor) !== null);
}
export function optionsAfterTypedLabel(editor: DropdownEditor): OptionOfDropdownInPane[] | null {
  let { typed } = editor;
  if (typed === null) return null;
  let label = typed.label.trim();
  let saved = editorOptionsOf(editor).find((option) => option.optionId === typed.optionId);
  if (label === '' || label === saved?.label || optionWithTypedLabel(editor) !== null) return null;
  return optionsWithTyped({
    ...editor,
    typed: {
      ...typed,
      label,
    },
  });
}
export function commitTypedOption(state: PageState, reads: WorkbookReads, editor: DropdownEditor): TypedOptionCommitted | null {
  let options = optionsAfterTypedLabel(editor);
  if (options === null) return null;
  let { effects } = commitDropdownOptions(state, reads, editor, options, 'entered');
  return effects.some((effect) => effect.kind === 'queueEdit' && (effect.ifQueued.undoOffer ?? null) !== null)
    ? null
    : {
        named: options,
        effects,
      };
}
export function optionWithTypedLabel(editor: DropdownEditor): OptionOfDropdownInPane | null {
  let [options, { typed }] = [editorOptionsOf(editor), editor];
  if (typed === null) return null;
  let label = typed.label.trim();
  let isOtherOption = (option: OptionOfDropdownInPane) => option.optionId !== typed.optionId;
  return options.find((option) => isOtherOption(option) && isSameOptionLabel(option.label, label)) ?? null;
}
export const DROPDOWN_SCROLL_SLOP = 8;
export const isFormulaText = (text: string): boolean => text.startsWith('=');
export const EMPTY_TYPED_OPTION: TypedOptionInPane = {
  optionId: null,
  label: '',
  pickedColor: null,
};
export const cleanOptionLabel = (text: string): string =>
  Array.from(sanitizeCellText(text.replace(/\p{Cc}/gu, ' ')))
    .slice(0, MAX_OPTION_LABEL_LENGTH)
    .join('');
export const isOptionColorSameAs = (color: Color, other: Color): boolean =>
  colorsEqual(color, other) || (color.kind === 'standard' && other.kind === 'standard' && color.hue === other.hue && color.shade === 100);
export const isOptionSetSameAs = (options: readonly ColoredOption[], set: LocalizedDropdownPreset): boolean =>
  set.options.length === options.length &&
  set.options.every(({ label, color }, index) => {
    let option = options[index];
    return option !== undefined && option.label === label && isOptionColorSameAs(option.color, color);
  });
export const readySetKeyOf = ({ readySets }: Pick<PageState, 'readySets'>, options: readonly ColoredOption[]): DropdownPresetKey | null =>
  readySets?.find(({ set }) => isOptionSetSameAs(options, set))?.set.key ?? null;
export const optionsFromReadySet = (options: readonly OptionOfDropdownInPane[], set: LocalizedDropdownPreset) =>
  set.options.map(
    (setOption) => ({
      optionId: options.find(({ label }) => isSameOptionLabel(label, setOption.label))?.optionId ?? null,
      ...setOption,
    }),
  );
export const chosenOptionSetKey = (
  state: Pick<PageState, 'readySets'>,
  { isCustom, options }: Pick<DropdownEditor, 'isCustom' | 'options'>,
): DropdownPresetKey | 'custom' =>
  (isCustom ? null : readySetKeyOf(state, options)) ?? 'custom';
export const QUOTED_FORMULA_PREFIX_PATTERN = /^'(?=\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/;
export const labelsOfPastedText = (text: string, dropsQuotedFormulaMark: boolean = false): string[] =>
  parseTsvCells(text)
    .flat()
    .map(
      (label) => (dropsQuotedFormulaMark ? unescapeClipboardText(label).replace(QUOTED_FORMULA_PREFIX_PATTERN, '') : label).trim(),
    )
    .filter((label) => label !== '');
export const editorOptionsOf = ({ options, isCustom }: Pick<DropdownEditor, 'options' | 'isCustom'>): OptionOfDropdownInPane[] => (isCustom ? [] : options);
export const hasUnsavedDropdownTyping = (state: PageState): boolean =>
  isTypedOptionLabelUnsaved(state) || dropdownEditorOfPane(state)?.cellsTyped !== undefined;
