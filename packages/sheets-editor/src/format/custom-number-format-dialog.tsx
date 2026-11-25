import { Dialog } from '../kit/dialog.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { Form } from '../kit/form.tsx';
import { Button } from '../kit/button.tsx';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import * as React from 'react';
import type { CustomNumberFormat } from '../state/initial-state.ts';
import type { HowActBegan } from './answer-holds.ts';
import type { ShownUnderPattern } from './number-format-choices.ts';
import { createLateEnterTracker } from '../ui/menu-with-field.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { isHistoryOrDropInputType } from '../editor/commit-entry.ts';
import {
  customFormatStage,
  withoutOfferWhenTyping,
  CustomFormatAgentRow,
  formatCallFailedAnnouncement,
  formatWritingProblemText,
  CustomFormatAnnouncer,
} from './custom-format-row.tsx';
import type { ActHoldAtAnswer } from './custom-format-row.tsx';
import { customFormatProblemText, formatPreviewText } from '../i18n/format-labels.ts';
import { useActHoldAtAnswer } from '../agent/answer-holds.tsx';
export interface CustomFormatPatternInputProps {
  ref: React.Ref<HTMLInputElement>;
  pattern: string;
  isInvalid: boolean;
  /** Selects the whole pattern the first time the field takes focus, when it opened on the pattern of the cells. */
  opensOnPatternOfCells: boolean;
  isHeldAsItIs: boolean;
  /** Takes a key for the agent's row; returns whether it was taken. */
  onKeyForAgent: (key: string) => boolean;
  onKeyHeld: (key: string) => void;
  onTyped: (pattern: string, isOfUndoOrRedo: boolean) => void;
}
export function CustomFormatPatternInput({
  ref,
  pattern,
  isInvalid,
  opensOnPatternOfCells,
  isHeldAsItIs,
  onKeyForAgent,
  onKeyHeld,
  onTyped,
}: CustomFormatPatternInputProps) {
  let hasFocusedRef = React.useRef(false);
  let [lateEnter] = React.useState(createLateEnterTracker);
  return <TextInput ref={ref} data-initial-focus aria-label={sheetMessages.customFormat()} aria-invalid={isInvalid || undefined} aria-describedby={CUSTOM_FORMAT_LINE_ID} readOnly={isHeldAsItIs} className={isHeldAsItIs ? 'text-secondary' : undefined} onKeyDown={(event) => {
      let vendor = event.currentTarget.ownerDocument.defaultView?.navigator.vendor ?? '';
      let isLateEnter = lateEnter.isLateEnter(event, vendor);
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (isLateEnter) event.preventDefault();
      if (isLateEnter || event.repeat) onKeyHeld(event.key);
      else if (onKeyForAgent(event.key)) event.preventDefault();
    }} onCompositionEnd={lateEnter.compositionEnded} onFocus={({ currentTarget }) => {
      if (!hasFocusedRef.current && opensOnPatternOfCells) currentTarget.select();
      hasFocusedRef.current = true;
    }} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={pattern} onChange={({ currentTarget, nativeEvent }) => {
      let inputType = nativeEvent instanceof InputEvent ? nativeEvent.inputType : '';
      onTyped(currentTarget.value, !/^(?:insert|delete)/.test(inputType) || isHistoryOrDropInputType(inputType));
    }} />;
}
export const CLOSED_CUSTOM_FORMAT_ENTRY: CustomNumberFormat = {
  pattern: '',
  reading: {
    kind: 'nothingTyped',
  },
  isRefusalTold: false,
  agent: null,
  hold: null,
  hasHeldTextOfOthers: false,
  typedIn: 'dialog',
  shownUnderPattern: new Map() satisfies ShownUnderPattern,
};
export const CUSTOM_FORMAT_LINE_ID = 'custom-number-format-line';
export interface CustomNumberFormatDialogProps {
  entry: CustomNumberFormat | null;
  isAgentOffered: boolean;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onTyped: (pattern: string, isOfUndoOrRedo: boolean) => void;
  onEntered: (howActBegan: HowActBegan) => void;
  onDropped: () => void;
  onEscaped: () => void;
  onAgentAsked: (howActBegan: HowActBegan) => void;
  onActHeld: () => void;
}
export const CustomNumberFormatDialog = React.memo(function ({
  entry,
  isAgentOffered,
  whatHasCaretAfter,
  onTyped,
  onEntered,
  onDropped,
  onEscaped,
  onAgentAsked,
  onActHeld,
}: CustomNumberFormatDialogProps) {
  let [lastEntry, setLastEntry] = React.useState(CLOSED_CUSTOM_FORMAT_ENTRY);
  if (entry !== null && entry !== lastEntry) setLastEntry(entry);
  let { pattern, reading, isRefusalTold, agent, hold } = entry ?? lastEntry;
  let agentStage = customFormatStage(agent, isAgentOffered);
  let stageOnLine = withoutOfferWhenTyping(agentStage, isRefusalTold);
  let refusalWords = reading.kind === 'refused' && isRefusalTold && stageOnLine === null ? customFormatProblemText(reading.why) : null;
  let exampleText = reading.kind === 'numberFormat' ? (reading.example?.trim() ?? '') : '';
  let patternFieldRef = React.useRef<HTMLInputElement>(null);
  let stageKind = agentStage?.kind ?? null;
  let heldAct: ActHoldAtAnswer = useActHoldAtAnswer({
    hold,
    tellOfActHeld: onActHeld,
    isNoAct: (target: EventTarget) => target === patternFieldRef.current,
  });
  let applyButtonRef = React.useRef<HTMLElement>(null);
  let focusPatternField = () => {
    let activeElement = patternFieldRef.current?.ownerDocument.activeElement ?? null;
    if (activeElement !== null && (activeElement.id === CUSTOM_FORMAT_LINE_ID || activeElement === applyButtonRef.current))
      patternFieldRef.current?.focus({
        preventScroll: true,
      });
  };
  let askAgent = () => {
    if (!heldAct.isActRefused()) focusPatternField();
    onAgentAsked(heldAct.howActBegan());
  };
  let onKeyForAgent = (key: string) => {
    if (key !== 'Enter' || (stageKind !== 'offered' && stageKind !== 'asked')) return false;
    if (isAgentOffered) askAgent();
    else heldAct.noteKeyThatTakesNothing();
    return true;
  };
  return <Dialog.Root open={entry !== null} onOpenChange={(isOpen, { reason }) => {
      if (isOpen) return;
      if (reason === 'escape-key') onEscaped();
      else onDropped();
    }}><Dialog.Popup size="sm" initialFocus={patternFieldRef} finalFocus={whatHasCaretAfter}><Form className="contents" onSubmit={() => onEntered(heldAct.howActBegan())} {...heldAct.handlers} onKeyDown={(event) => {
          if (event.key === 'Enter' && event.repeat) event.preventDefault();
        }}><Dialog.Header>{sheetMessages.customFormat()}</Dialog.Header><div className="sheet-field-over-line flex flex-col gap-1.5"><CustomFormatPatternInput ref={patternFieldRef} pattern={pattern} isInvalid={refusalWords !== null || (stageOnLine?.kind === 'cameToNothing' && stageOnLine.why === 'noFormat')} opensOnPatternOfCells={(entry ?? lastEntry).hasHeldTextOfOthers} isHeldAsItIs={stageKind === 'asked'} onKeyForAgent={onKeyForAgent} onKeyHeld={(key) => {
                  if (key === 'Enter') heldAct.noteKeyThatTakesNothing();
                }} onTyped={onTyped} />{stageOnLine !== null
                ? <CustomFormatAgentRow id={CUSTOM_FORMAT_LINE_ID} stage={stageOnLine} onAgentAsked={askAgent} onStopped={onEscaped} />
                : <p id={CUSTOM_FORMAT_LINE_ID} className={`sheet-line-under-field box-content min-h-[1lh] text-footnote wrap-anywhere ${refusalWords === null ? 'text-secondary' : 'text-danger'}`}>{refusalWords ?? (exampleText !== '' && formatPreviewText(exampleText))}</p>}</div><p role="alert" className="sr-only">{refusalWords ??
              (agent?.kind === 'cameToNothing' &&
                (agent.why === 'callFailed' ? formatCallFailedAnnouncement() : formatWritingProblemText(agent.why)))}</p><CustomFormatAnnouncer entry={entry ?? lastEntry} isOfferSaid={isAgentOffered} example={exampleText} /><Dialog.Footer align="end"><Dialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} /><Button ref={applyButtonRef} type="submit" variant="primary" disabled={reading.kind === 'nothingTyped' || stageKind === 'asked'}>{sheetMessages.apply()}</Button></Dialog.Footer></Form></Dialog.Popup></Dialog.Root>;
});
