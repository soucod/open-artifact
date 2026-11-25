import { FieldRoot } from '../../kit/field.tsx';
import { TextInput } from '../../kit/text-input.tsx';
import { SegmentedControl } from '../../kit/segmented-control.tsx';
import { Menu } from '../../kit/menu.tsx';
import { Popover } from '../../kit/popover.tsx';
import { Button } from '../../kit/button.tsx';
import { Icon } from '../../kit/icon.tsx';
import { Tooltip, TooltipGroup } from '../../kit/tooltip.tsx';
import type { Color, ColumnId, Shade } from '@open-artifact/sheets-core';
import type { ColorProperty } from '../../i18n/format-labels.ts';
import type { FontMark } from '../../state/initial-state.ts';
import type { ColorPickerChoices } from '../../view/page-view.ts';
import type { StyleWithVariables, PaintPair } from '../../grid/cell-drawing.tsx';
import type { ConditionChoice, OperandKind, ScaleAnchorKind, ScaleStop } from '../../messages/conditional-format.ts';
import type { ActInRulesPane } from './pane-state.ts';
import type { ColumnChoice, FieldState, FormatWhereView, OperandView, RuleEditorView, StopView, TestView } from './editor-view.ts';
import * as React from 'react';
import {
  ELLIPSIS_INPUT_CLASSES,
  PaneRowNote,
  PaneRow,
  PaneSelect,
  PANE_SELECT_TRIGGER_CLASSES,
  PANE_SELECT_HEIGHT_CLASSES,
  PaneSelectCaret,
  PaneSection,
  revealInSidePane,
  PaneTableButton,
} from '../../ui/side-pane/side-pane.tsx';
import { whenBlurredToNothing } from '../../grid/focus-left.ts';
import {
  controlWithChoiceLabel,
  CONDITIONAL_FORMATTING_WORDS,
  operandKindLabel,
  ruleColumnName,
  thisCellOfColumnWords,
  conditionOperatorLabel,
  rulePresetLabel,
  scaleAnchorKindLabel,
  scaleStopLabel,
  scaleStopControlLabel,
  ruleMatchCountWords,
  movedToNumbersWords,
} from '../../messages/conditional-format.ts';
import { SheetDateInput } from '../../chips/date-input.tsx';
import { fillPaintStyle } from '../../grid/cell-drawing.tsx';
import { shownCellColor } from '../cell-colors.ts';
import { colorsEqual, colorKey, NO_COLOR, STANDARD_HUE_COLORS } from '../../model/colors.ts';
import { optionColorName } from '../../i18n/chip-labels.ts';
import { cellColorName, dropdownPaneMessages, colorButtonLabel } from '../../i18n/format-labels.ts';
import { blockRepeatedEnterOrSpace } from '../../ui/repeated-key-guards.ts';
import { popupPropsUnderHeader } from '../../shell/bottom-insets.ts';
import { COLOR_POPUP_PADDING, SheetColorPicker } from '../color-picker.tsx';
import { ruleFormatSampleProps, colorScaleStripes } from './rule-samples.tsx';
import { RULE_FORMAT_PRESETS, isFontStyleOn } from './rule-edits.ts';
import { sheetMessages, textStyleLabel } from '../../i18n/sheet-messages.ts';
import { TEXT_TOGGLE_ICONS } from '../../ui/search-menu/bar-commands.tsx';
import { useFocusRescue } from '../../ui/focus-rescue.ts';
import { WordsWithColumnNames } from '../../ui/card-rows.tsx';
/** What the color picker of the page offers, read when it opens. */
type ColorPickerShows = () => ColorPickerChoices;
interface RuleTextFieldProps {
  box: FieldState;
  name: string;
  /** The id of the note that says why the text does not read. */
  whyNotSaidBy: string;
  isOfDigits?: boolean;
  slotEnd?: React.ReactNode;
  onAct: ActInRulesPane;
}
interface RuleFieldRefusalProps {
  box: FieldState | null;
  id: string;
  isInRow?: boolean;
  children: React.ReactNode;
}
interface RuleOperandFieldsProps {
  test: number;
  operand: OperandView;
  onAct: ActInRulesPane;
}
interface RuleConditionFieldsProps {
  test: TestView;
  isAlone: boolean;
  onAct: ActInRulesPane;
  onRemove: () => void;
}
interface RuleColorSwatchProps {
  property: ColorProperty;
  color: Color;
}
interface RuleColorChooserProps {
  property: ColorProperty;
  color: Color;
  otherColor: Color;
  shade: Shade;
  form: 'field' | 'swatch';
  name: string;
  nameOfPicker: string;
  isOff?: boolean;
  whatColorPickerShows: ColorPickerShows;
  onChosen: (color: Color) => void;
}
interface RuleFormatSectionProps {
  does: Pick<FormatWhereView, 'format' | 'preset'>;
  whatColorPickerShows: ColorPickerShows;
  onAct: ActInRulesPane;
}
interface ColorScaleRampProps {
  colors: Color[];
}
interface ColorScaleStopFieldsProps {
  which: ScaleStop;
  /** `undefined` for a middle stop the scale does not have. */
  stop: StopView | undefined;
  isOfDates: boolean;
  whatColorPickerShows: ColorPickerShows;
  onAct: ActInRulesPane;
}
interface ConditionalRuleEditorProps {
  editor: RuleEditorView;
  whatColorPickerShows: ColorPickerShows;
  onAct: ActInRulesPane;
}
/** A test just removed, so the caret can move to the remove button now in its place. */
interface RemovedTest {
  at: number;
  outOf: number;
  menu: Element | null;
}
export function RuleTextField({
  box,
  name,
  whyNotSaidBy,
  isOfDigits,
  slotEnd,
  onAct,
}: RuleTextFieldProps) {
  return <FieldRoot invalid={!box.isReadable} className="min-w-0 flex-1"><TextInput fullWidth className={ELLIPSIS_INPUT_CLASSES} dir="auto" aria-label={name} aria-describedby={box.isReadable ? undefined : whyNotSaidBy} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode={isOfDigits === true ? 'numeric' : undefined} value={box.text} slotEnd={slotEnd} onChange={(event) =>
        onAct({
          kind: 'type',
          field: box.field,
          text: event.target.value,
        })} onBlur={({ relatedTarget, currentTarget }) => {
        if (!box.isBeingTyped) return;
        if (relatedTarget !== null)
          onAct({
            kind: 'enterTyped',
          });
        else
          whenBlurredToNothing(
            currentTarget,
            () =>
              onAct({
                kind: 'enterTyped',
              }),
          );
      }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          return onAct({
            kind: 'enterTyped',
          });
        }
        if (!box.isReadable && (event.ctrlKey || event.metaKey) && /^[yz]$/i.test(event.key)) return event.stopPropagation();
        if (event.key !== 'Escape' || (!box.isBeingTyped && box.isReadable)) return;
        event.preventDefault();
        event.stopPropagation();
        return onAct({
          kind: 'dropTyped',
          field: box.field,
        });
      }} /></FieldRoot>;
}
export function RuleFieldRefusal({ box, id, isInRow = false, children }: RuleFieldRefusalProps) {
  if (box === null || box.isReadable) return null;
  return <PaneRowNote id={id} isRefusal isInRow={isInRow}>{children}</PaneRowNote>;
}
export function RuleOperandFields({ test, operand, onAct }: RuleOperandFieldsProps) {
  const { slot, choice, choices, value } = operand;
  let operandId = React.useId();
  const isNumberOperand = value?.kind === 'number' || value?.kind === 'days';
  return <div className={`flex min-w-0 shrink-0 flex-col ${slot === 'otherEnd' ? 'pt-1' : ''}`}><PaneRow label=""><div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-1 py-px"><div className="flex min-w-0 flex-auto"><PaneSelect name={controlWithChoiceLabel(CONDITIONAL_FORMATTING_WORDS.kindOfValue(), operandKindLabel(choice))} value={choice} items={choices.map(
                (operandKind) => ({
                  value: operandKind,
                  label: operandKindLabel(operandKind),
                }),
              )} onChange={(chosen: OperandKind) =>
                onAct({
                  kind: 'chooseOperand',
                  test,
                  slot,
                  choice: chosen,
                })} /></div>{isNumberOperand &&
            (<div className={`flex min-w-0 flex-col ${value.kind === 'days' ? 'flex-[99_1_3rem]' : 'flex-[99_1_5.5rem]'}`}><RuleTextField box={value} name={CONDITIONAL_FORMATTING_WORDS.value()} whyNotSaidBy={operandId} {...(value.kind === 'days' && {
                    isOfDigits: true,
                  })} onAct={onAct} /><RuleFieldRefusal box={value} id={operandId} isInRow>{CONDITIONAL_FORMATTING_WORDS.enterANumber()}</RuleFieldRefusal></div>)}{value?.kind === 'day' &&
            (<SheetDateInput aria-label={CONDITIONAL_FORMATTING_WORDS.value()} className="min-w-0 flex-[99_1_8rem]" value={value.day} onValueCommitted={(pickedDay) => {
                if (pickedDay !== null)
                  onAct({
                    kind: 'chooseDay',
                    test,
                    slot,
                    day: pickedDay,
                  });
              }} />)}{value?.kind === 'column' &&
            (<div className="flex min-w-0 flex-auto"><PaneSelect name={controlWithChoiceLabel(
                  CONDITIONAL_FORMATTING_WORDS.value(),
                  ruleColumnName(
                    value.columns.find((columnChoice) => columnChoice.value === value.c)?.column ?? {
                      kind: 'gone',
                    },
                  ),
                )} value={value.c} items={value.columns.map(
                  (columnChoice) => ({
                    value: columnChoice.value,
                    label: ruleColumnName(columnChoice.column),
                  }),
                )} onChange={(columnId: ColumnId) =>
                  onAct({
                    kind: 'chooseOperandColumn',
                    test,
                    slot,
                    c: columnId,
                  })} /></div>)}</div></PaneRow></div>;
}
export function RuleConditionFields({ test, isAlone, onAct, onRemove }: RuleConditionFieldsProps) {
  let {
    index,
    tested,
    columns,
    choice,
    choices,
    isOfDates,
    operands,
    text,
    count,
  } = test;
  let [valueRefusalId, countRefusalId] = [React.useId(), React.useId()];
  let columnName = ({ value, column }: ColumnChoice) =>
    value === null ? thisCellOfColumnWords(column) : ruleColumnName(column);
  let testedColumn = columns.find(({ value }) => value === tested);
  return <div className={`flex min-w-0 shrink-0 flex-col ${index === 0 ? '' : 'pt-2'}`}><PaneRow label={index === 0 ? CONDITIONAL_FORMATTING_WORDS.when() : CONDITIONAL_FORMATTING_WORDS.and()}><PaneSelect name={controlWithChoiceLabel(
            CONDITIONAL_FORMATTING_WORDS.column(),
            testedColumn === undefined
              ? ruleColumnName({
                  kind: 'gone',
                })
              : columnName(testedColumn),
          )} value={tested ?? THIS_CELL_TESTED_VALUE} items={columns.map(
            (columnChoice) =>
              columnChoice.value === null && columnChoice.column.kind !== 'eachCell'
                ? {
                    value: THIS_CELL_TESTED_VALUE,
                    label: ruleColumnName(columnChoice.column),
                    hint: CONDITIONAL_FORMATTING_WORDS.thisCell(),
                  }
                : {
                    value: columnChoice.value ?? THIS_CELL_TESTED_VALUE,
                    label: columnName(columnChoice),
                  },
          )} onChange={(testedValue: ColumnId | typeof THIS_CELL_TESTED_VALUE) =>
            onAct({
              kind: 'chooseTested',
              test: index,
              tested:
                testedValue === THIS_CELL_TESTED_VALUE
                  ? {
                      kind: 'theCellItself',
                    }
                  : {
                      kind: 'sameRowInColumn',
                      c: testedValue,
                    },
            })} {...(!isAlone && {
            lastRow: {
              label: CONDITIONAL_FORMATTING_WORDS.removeCondition(),
              onPicked: onRemove,
            },
          })} /></PaneRow><div className="contents" data-comparison-awaited={choice === null ? '' : undefined}><PaneRow label=""><PaneSelect name={controlWithChoiceLabel(
              CONDITIONAL_FORMATTING_WORDS.condition(),
              choice === null ? CONDITIONAL_FORMATTING_WORDS.chooseACondition() : conditionOperatorLabel(choice, isOfDates),
            )} value={choice ?? NO_CONDITION_CHOSEN_VALUE} placeholder={CONDITIONAL_FORMATTING_WORDS.chooseACondition()} items={choices.map(
              (conditionChoice) => ({
                value: conditionChoice,
                label: conditionOperatorLabel(conditionChoice, isOfDates),
              }),
            )} onChange={(chosen: ConditionChoice | typeof NO_CONDITION_CHOSEN_VALUE) => {
              if (chosen !== NO_CONDITION_CHOSEN_VALUE)
                onAct({
                  kind: 'chooseCondition',
                  test: index,
                  choice: chosen,
                });
            }} /></PaneRow></div>{operands.map(
        (operand) =>
          <RuleOperandFields key={operand.slot} test={index} operand={operand} onAct={onAct} />,
      )}{text !== null &&
        (<PaneRow label="">{text.offered === null
              ? <RuleTextField box={text} name={CONDITIONAL_FORMATTING_WORDS.value()} whyNotSaidBy={valueRefusalId} onAct={onAct} />
              : (<PaneSelect name={controlWithChoiceLabel(CONDITIONAL_FORMATTING_WORDS.value(), text.text)} value={text.text} items={text.offered.map(
                    (offeredText) => ({
                      value: offeredText,
                      label: offeredText,
                    }),
                  )} onChange={(chosenText: string) =>
                    onAct({
                      kind: 'chooseText',
                      test: index,
                      text: chosenText,
                    })} />)}</PaneRow>)}<RuleFieldRefusal box={text?.offered === null ? text : null} id={valueRefusalId}>{CONDITIONAL_FORMATTING_WORDS.enterText()}</RuleFieldRefusal>{count !== null &&
        <PaneRow label=""><RuleTextField box={count} name={CONDITIONAL_FORMATTING_WORDS.value()} whyNotSaidBy={countRefusalId} isOfDigits onAct={onAct} /></PaneRow>}<RuleFieldRefusal box={count} id={countRefusalId}>{CONDITIONAL_FORMATTING_WORDS.enterANumber()}</RuleFieldRefusal></div>;
}
export function RuleColorSwatch({ property, color }: RuleColorSwatchProps) {
  return <span aria-hidden className="sheet-swatch sheet-swatch-of-rule flex-none" data-has-fill={color.kind !== 'none' || undefined} data-is-empty={color.kind === 'none' || undefined} style={fillPaintStyle(shownCellColor(property, color))} />;
}
export function RuleColorChooser({
  property,
  color,
  otherColor,
  shade,
  form,
  name,
  nameOfPicker,
  isOff = false,
  whatColorPickerShows,
  onChosen,
}: RuleColorChooserProps) {
  let [openPicker, setOpenPicker] = React.useState<'list' | 'picker' | null>(null);
  let swatchesRef = React.useRef<HTMLButtonElement>(null);
  let isOpenChangeSwallowedRef = React.useRef(false);
  let colorChoices = ruleColorChoicesOfShade(shade);
  let colorChoiceName = (namedColor: Color) =>
    namedColor.kind === 'standard' && colorChoices.some((colorChoice) => colorsEqual(colorChoice, namedColor))
      ? optionColorName(namedColor)
      : cellColorName(property, namedColor);
  return <><Menu.Root open={openPicker === 'list'} onOpenChange={(isOpen) => {
          let isSwallowed = isOpenChangeSwallowedRef.current;
          isOpenChangeSwallowedRef.current = false;
          if (!isSwallowed) setOpenPicker(isOpen ? 'list' : null);
        }}><Menu.Trigger render={form === 'field'
                ? <button ref={swatchesRef} type="button" aria-label={name} disabled={isOff} className={`${PANE_SELECT_TRIGGER_CLASSES.className} ${PANE_SELECT_HEIGHT_CLASSES.className}`}><RuleColorSwatch property={property} color={color} /><span className="min-w-0 flex-1 truncate">{colorChoiceName(color)}</span><PaneSelectCaret /></button>
                : <Button ref={swatchesRef} variant="ghost" iconOnly aria-label={name} tooltip={colorChoiceName(color)} disabled={isOff} className="sheet-button-of-swatch-at-rows-end" icon={<RuleColorSwatch property={property} color={color} />} />} /><Menu.Popup align={form === 'field' ? 'start' : 'end'} {...(form === 'field' && {
              className: 'min-w-[var(--anchor-width)]',
            })} onKeyDownCapture={blockRepeatedEnterOrSpace}><Menu.Group aria-label={nameOfPicker}>{colorChoices.map(
                  (colorChoice) =>
                    <Menu.Item key={colorKey(colorChoice)} label={colorChoiceName(colorChoice)} checked={colorsEqual(color, colorChoice)} checkedRole="radio" checkPosition="trailing" onClick={() => onChosen(colorChoice)}><span className="flex min-w-32 items-center gap-2"><RuleColorSwatch property={property} color={colorChoice} />{colorChoiceName(colorChoice)}</span></Menu.Item>,
                )}</Menu.Group><Menu.Separator /><Menu.Item onClick={() => {
                  isOpenChangeSwallowedRef.current = true;
                  setOpenPicker('picker');
                }}><span className="flex items-center gap-2"><span className="grid w-4 place-items-center"><Icon name="Palette" size="sm" /></span>{dropdownPaneMessages.moreColors()}</span></Menu.Item></Menu.Popup></Menu.Root><Popover.Root open={openPicker === 'picker'} onOpenChange={(isOpen) => {
          if (!isOpen) setOpenPicker(null);
        }}><Popover.Popup {...popupPropsUnderHeader()} anchor={swatchesRef} side="bottom" align={form === 'field' ? 'start' : 'end'} padding={COLOR_POPUP_PADDING} aria-label={nameOfPicker} finalFocus={() => swatchesRef.current ?? true}><SheetColorPicker property={property} color={color} whatIsColored={{
              kind: 'cells',
              otherColor,
            }} whatItShows={whatColorPickerShows} onChosen={onChosen} onDone={() => setOpenPicker(null)} /></Popover.Popup></Popover.Root></>;
}
export function RuleFormatSection({
  does: { format, preset },
  whatColorPickerShows,
  onAct,
}: RuleFormatSectionProps) {
  let [fillColor, textColor] = [format.fillColor ?? NO_COLOR, format.font?.color ?? NO_COLOR];
  return <PaneSection title={CONDITIONAL_FORMATTING_WORDS.format()}><PaneRow label={CONDITIONAL_FORMATTING_WORDS.preview()}><span aria-hidden className="sheet-rule-sample sheet-rule-preview" {...ruleFormatSampleProps(format)}>{CONDITIONAL_FORMATTING_WORDS.sample()}</span></PaneRow><PaneRow label={CONDITIONAL_FORMATTING_WORDS.presetsLabel()}><fieldset aria-label={CONDITIONAL_FORMATTING_WORDS.presets()} className="m-0 grid min-w-0 flex-1 grid-cols-6 gap-1 border-0 p-0"><TooltipGroup>{RULE_FORMAT_PRESETS.map(
              (formatPreset) =>
                (<Tooltip key={formatPreset.key} content={rulePresetLabel(formatPreset.key)}><button type="button" aria-label={rulePresetLabel(formatPreset.key)} aria-pressed={preset === formatPreset.key} className="sheet-rule-sample sheet-rule-preset" {...ruleFormatSampleProps(formatPreset.format)} onClick={() =>
                        onAct({
                          kind: 'choosePreset',
                          preset: formatPreset.key,
                        })}><span aria-hidden>{CONDITIONAL_FORMATTING_WORDS.sample()}</span></button></Tooltip>),
            )}</TooltipGroup></fieldset></PaneRow><PaneRow label={sheetMessages.cellColor()}><RuleColorChooser property="fillColor" color={fillColor} otherColor={textColor} shade={100} form="field" name={colorButtonLabel('fillColor', fillColor)} nameOfPicker={sheetMessages.cellColor()} whatColorPickerShows={whatColorPickerShows} onChosen={(chosenColor) =>
            onAct({
              kind: 'chooseColor',
              property: 'fillColor',
              color: chosenColor,
            })} /></PaneRow><PaneRow label={sheetMessages.textColor()}><RuleColorChooser property="textColor" color={textColor} otherColor={fillColor} shade={600} form="field" name={colorButtonLabel('textColor', textColor)} nameOfPicker={sheetMessages.textColor()} whatColorPickerShows={whatColorPickerShows} onChosen={(chosenColor) =>
            onAct({
              kind: 'chooseColor',
              property: 'textColor',
              color: chosenColor,
            })} /></PaneRow><PaneRow label={CONDITIONAL_FORMATTING_WORDS.style()}><span className="flex items-center gap-0.5"><TooltipGroup>{RULE_TEXT_STYLES.map(
              (style) =>
                (<Button key={style} variant="ghost" iconOnly icon={TEXT_TOGGLE_ICONS[style].icon} aria-label={textStyleLabel(style)} pressed={isFontStyleOn(format, style)} onClick={() =>
                      onAct({
                        kind: 'toggleStyle',
                        style,
                      })} />),
            )}</TooltipGroup></span></PaneRow></PaneSection>;
}
export function ColorScaleRamp({ colors }: ColorScaleRampProps) {
  let rampFills = colorScaleStripes(colors, COLOR_SCALE_RAMP_STEPS).flatMap(({ fill }) => fill ?? []);
  let rampGradient = (paint: keyof PaintPair) =>
    `linear-gradient(90deg,${rampFills.map((fill) => fill[paint]).join(',')})`;
  let rampStyle: StyleWithVariables = {
    '--sheet-run-on-light': rampGradient('onLight'),
    '--sheet-run-on-dark': rampGradient('onDark'),
  };
  return <span aria-hidden className="sheet-rule-sample sheet-color-scale-ramp sheet-color-scale-run" style={rampStyle} />;
}
export function ColorScaleStopFields({
  which,
  stop,
  isOfDates,
  whatColorPickerShows,
  onAct,
}: ColorScaleStopFieldsProps) {
  let stopFieldId = React.useId();
  let stopColor = stop?.color ?? NO_COLOR;
  let stopAt = stop?.at ?? null;
  let stopName = (anchorKind: ScaleAnchorKind) => scaleAnchorKindLabel(anchorKind, which, isOfDates);
  return <><PaneRow label={scaleStopLabel(which)} trailing={<RuleColorChooser property="fillColor" color={stopColor} otherColor={NO_COLOR} shade={SCALE_STOP_SWATCH_SHADE} form="swatch" name={scaleStopControlLabel(which, colorButtonLabel('fillColor', stopColor))} nameOfPicker={scaleStopControlLabel(which, sheetMessages.cellColor())} isOff={stop === undefined} whatColorPickerShows={whatColorPickerShows} onChosen={(chosenColor) =>
            onAct({
              kind: 'chooseStopColor',
              stop: which,
              color: chosenColor,
            })} />}><PaneSelect name={scaleStopControlLabel(which, stop === undefined ? CONDITIONAL_FORMATTING_WORDS.noMiddle() : stopName(stop.choice))} value={stop?.choice ?? NO_MIDDLE_STOP_VALUE} items={[
            ...(which === 'middle'
              ? [
                  {
                    value: NO_MIDDLE_STOP_VALUE,
                    label: CONDITIONAL_FORMATTING_WORDS.noMiddle(),
                  },
                ]
              : []),
            ...(stop?.choices ?? [DEFAULT_SCALE_ANCHOR_CHOICE]).map(
              (anchorChoice) => ({
                value: anchorChoice,
                label: stopName(anchorChoice),
              }),
            ),
          ]} onChange={(chosenAnchor: ScaleAnchorKind | typeof NO_MIDDLE_STOP_VALUE) =>
            onAct(
              chosenAnchor === NO_MIDDLE_STOP_VALUE || stop === undefined
                ? {
                    kind: 'setMiddleStop',
                    isOn: chosenAnchor !== NO_MIDDLE_STOP_VALUE,
                  }
                : {
                    kind: 'chooseAnchor',
                    stop: which,
                    choice: chosenAnchor,
                  },
            )} /></PaneRow>{stopAt !== null &&
        (<PaneRow label="" trailing={null}>{stopAt.kind === 'day'
              ? (<SheetDateInput aria-label={scaleStopControlLabel(which, CONDITIONAL_FORMATTING_WORDS.value())} className="min-w-0 flex-1" value={stopAt.day} onValueCommitted={(isoDay) => {
                    if (isoDay !== null)
                      onAct({
                        kind: 'chooseStopDay',
                        stop: which,
                        day: isoDay,
                      });
                  }} />)
              : (<RuleTextField box={stopAt} name={scaleStopControlLabel(which, CONDITIONAL_FORMATTING_WORDS.value())} whyNotSaidBy={stopFieldId} {...(stop?.choice === 'percentile' && {
                    isOfDigits: true,
                  })} onAct={onAct} />)}</PaneRow>)}<RuleFieldRefusal box={stopAt?.kind === 'typed' ? stopAt : null} id={stopFieldId}>{CONDITIONAL_FORMATTING_WORDS.enterANumber()}</RuleFieldRefusal></>;
}
export function ConditionalRuleEditor({ editor, whatColorPickerShows, onAct }: ConditionalRuleEditorProps) {
  let { cells, cellsPickedByPage, does, matches, outOf } = editor;
  let rulesHeadingId = React.useId();
  let testsListRef = React.useRef<HTMLDivElement>(null);
  let removedTestRef = React.useRef<RemovedTest | null>(null);
  let removeTest = (test: number, testIndex: number) => {
    let testCount = does.kind === 'formatWhere' ? does.tests.length : 0;
    let openMenu = testsListRef.current?.ownerDocument.activeElement?.closest('[role="menu"]') ?? null;
    onAct(
      {
        kind: 'removeTest',
        test,
      },
      (isRemoved) => {
        if (isRemoved)
          removedTestRef.current = {
            at: testIndex,
            outOf: testCount,
            menu: openMenu,
          };
      },
    );
  };
  React.useLayoutEffect(() => {
    let [removedTest, testsList] = [removedTestRef.current, testsListRef.current];
    if (removedTest === null) return;
    removedTestRef.current = null;
    if (testsList === null || testsList.children.length >= removedTest.outOf) return;
    let ownerDocument = testsList.ownerDocument;
    let isCaretLost =
      ownerDocument.hasFocus() &&
      (ownerDocument.activeElement === ownerDocument.body || removedTest.menu?.contains(ownerDocument.activeElement) === true);
    let nextRemoveButton =
      testsList.children[Math.min(removedTest.at, testsList.children.length - 1)]?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? null;
    if (!isCaretLost || nextRemoveButton === null) return;
    nextRemoveButton.focus({
      preventScroll: true,
    });
    revealInSidePane(nextRemoveButton.closest('aside'), nextRemoveButton, true);
  });
  let addedTestRef = React.useRef<{ from: Element | null } | null>(null);
  let isLastTestAwaitingComparison = does.kind === 'formatWhere' && does.tests.at(-1)?.choice === null;
  let focusAwaitedComparison = () => {
    let comparisonButton = testsListRef.current?.querySelector('[data-comparison-awaited]')?.querySelector('button');
    if (comparisonButton === null || comparisonButton === undefined) return;
    comparisonButton.focus({
      preventScroll: true,
    });
    revealInSidePane(comparisonButton.closest('aside'), comparisonButton, true);
  };
  React.useLayoutEffect(() => {
    let [addedTest, ownerDocument] = [addedTestRef.current, testsListRef.current?.ownerDocument];
    if (addedTest === null || ownerDocument === undefined) return;
    addedTestRef.current = null;
    let isCaretLost =
      ownerDocument.hasFocus() && (ownerDocument.activeElement === ownerDocument.body || ownerDocument.activeElement === addedTest.from);
    if (isLastTestAwaitingComparison && isCaretLost) focusAwaitedComparison();
  });
  let addTestButtonRef = React.useRef<HTMLButtonElement>(null);
  let focusAddTestHandlers = useFocusRescue(
    () =>
      addTestButtonRef.current?.focus({
        preventScroll: true,
      }),
  );
  return <><div className="shrink-0 pt-md pb-xs"><PaneRow><SegmentedControl fullWidth aria-label={CONDITIONAL_FORMATTING_WORDS.kindOfRule()} value={does.kind} segments={[
              {
                value: 'formatWhere',
                label: CONDITIONAL_FORMATTING_WORDS.highlight(),
              },
              {
                value: 'colorScale',
                label: CONDITIONAL_FORMATTING_WORDS.colorScale(),
              },
            ]} onChange={(effectKind) =>
              onAct({
                kind: 'chooseKindOfEffect',
                effect: effectKind,
              })} /></PaneRow></div><PaneSection title={CONDITIONAL_FORMATTING_WORDS.appliesTo()} className="border-t-0!" {...(matches !== null && {
          actions: <span className="text-footnote text-secondary">{ruleMatchCountWords(does.kind === 'formatWhere' && does.isWholeRow, matches, outOf)}</span>,
        })}><PaneRow label={CONDITIONAL_FORMATTING_WORDS.cells()}><RuleTextField box={cells} name={CONDITIONAL_FORMATTING_WORDS.cells()} whyNotSaidBy={rulesHeadingId} slotEnd={<PaneTableButton name={CONDITIONAL_FORMATTING_WORDS.takeSelection()} onPressed={() =>
                  onAct({
                    kind: 'useSelection',
                  })} />} onAct={onAct} /></PaneRow><RuleFieldRefusal box={cells} id={rulesHeadingId}>{CONDITIONAL_FORMATTING_WORDS.enterCells()}</RuleFieldRefusal>{cellsPickedByPage !== null &&
            <PaneRowNote><WordsWithColumnNames words={movedToNumbersWords(cellsPickedByPage.column)} /></PaneRowNote>}</PaneSection>{does.kind === 'formatWhere'
        ? (<><PaneSection title={CONDITIONAL_FORMATTING_WORDS.conditions()} {...(does.canTestBeAdded && {
                  actions: (<Button variant="ghost" iconOnly icon="Add" ref={addTestButtonRef} aria-label={CONDITIONAL_FORMATTING_WORDS.addCondition()} className="-me-2 text-secondary" onClick={() => {
                      let caretBefore = testsListRef.current?.ownerDocument.activeElement ?? null;
                      if (isLastTestAwaitingComparison) focusAwaitedComparison();
                      else
                        onAct(
                          {
                            kind: 'addTest',
                          },
                          (isAdded) => {
                            addedTestRef.current = isAdded
                              ? {
                                  from: caretBefore,
                                }
                              : null;
                          },
                        );
                    }} />),
                })}><div ref={testsListRef} className="contents" {...focusAddTestHandlers}>{does.tests.map((test) => {
                    let testKey = test.choice === null ? does.tests.length - 1 : test.index;
                    return <RuleConditionFields key={testKey} test={test} isAlone={test.choice !== null && does.tests.filter(({ choice }) => choice !== null).length === 1} onAct={onAct} onRemove={() => removeTest(test.index, testKey)} />;
                  })}</div></PaneSection><RuleFormatSection does={does} whatColorPickerShows={whatColorPickerShows} onAct={onAct} /></>)
        : (<PaneSection title={CONDITIONAL_FORMATTING_WORDS.scale()} {...(!does.hasNumbersToColor && {
              above: CONDITIONAL_FORMATTING_WORDS.noNumbersToColor(),
            })}><PaneRow label={CONDITIONAL_FORMATTING_WORDS.preview()}><ColorScaleRamp colors={does.stops.map(({ color }) => color)} /></PaneRow>{(['lowest', 'middle', 'highest'] satisfies ScaleStop[]).map(
                (which) =>
                  <ColorScaleStopFields key={which} which={which} stop={does.stops.find(({ stop }) => stop === which)} isOfDates={does.stops.some(({ isOfDates }) => isOfDates)} whatColorPickerShows={whatColorPickerShows} onAct={onAct} />,
              )}</PaneSection>)}</>;
}
export const THIS_CELL_TESTED_VALUE = '';
export const NO_CONDITION_CHOSEN_VALUE = '';
export const ruleColorChoicesOfShade = (shade: Shade): Color[] => [
  NO_COLOR,
  ...STANDARD_HUE_COLORS.filter((hueColor) => hueColor.kind === 'standard' && hueColor.shade === shade),
];
export const RULE_TEXT_STYLES: FontMark[] = ['bold', 'italic', 'underline', 'strikethrough'];
export const COLOR_SCALE_RAMP_STEPS = 33;
export const NO_MIDDLE_STOP_VALUE: 'none' = 'none';
export const DEFAULT_SCALE_ANCHOR_CHOICE: ScaleAnchorKind = 'percentile';
export const SCALE_STOP_SWATCH_SHADE: Shade = 300;
