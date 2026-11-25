import { FieldNumberInput } from '../kit/number-input.tsx';
import type { FieldNumberInputProps } from '../kit/number-input.tsx';
import * as React from 'react';
import { digitsBetweenHint, wholeNumberBetweenHint } from '../i18n/grid-action-labels.ts';
export interface PixelsInputProps {
  ref: React.Ref<HTMLInputElement>;
  label: FieldNumberInputProps['label'];
  smallest: number;
  largest: number;
  disabled?: boolean;
  value: number | null;
  onValueChange: (value: number | null) => void;
}
/** How the typed value was last committed: by Enter, or by leaving the field. */
type PixelsCommittedBy = 'key' | 'leaving';
export function PixelsInput({
  ref,
  label,
  smallest,
  largest,
  disabled = false,
  value,
  onValueChange,
}: PixelsInputProps) {
  const [isUnreadable, setIsUnreadable] = React.useState(false);
  const [committedBy, setCommittedBy] = React.useState<PixelsCommittedBy | null>(null);
  const leavingByKeyRef = React.useRef(false);
  const rangeError =
    (isUnreadable ? committedBy !== null : value === null && !isUnreadable && committedBy === 'key') && !disabled
      ? digitsBetweenHint(smallest, largest)
      : null;
  return <><FieldNumberInput ref={ref} data-initial-focus onFocus={({ currentTarget }) => currentTarget.select()} onBlur={() => {
          setCommittedBy(leavingByKeyRef.current ? 'key' : 'leaving');
          leavingByKeyRef.current = false;
        }} onKeyDown={({ key, keyCode, nativeEvent }) => {
          leavingByKeyRef.current = key === 'Enter' || key === 'Tab';
          if (key === 'Enter' && !nativeEvent.isComposing && keyCode !== 229) setCommittedBy('key');
        }} onKeyUp={() => {
          leavingByKeyRef.current = false;
        }} onInput={() => setCommittedBy(null)} label={label} hint={rangeError === null ? wholeNumberBetweenHint(smallest, largest) : undefined} error={rangeError ?? undefined} min={smallest} max={largest} format={WHOLE_PIXELS_FORMAT} disabled={disabled} value={value} onValueChange={(nextValue, { isUnreadable: isTextUnreadable }) => {
          onValueChange(nextValue);
          setIsUnreadable(isTextUnreadable === true);
        }} /><p role="alert" className="sr-only">{committedBy === 'key' && rangeError}</p></>;
}
export const WHOLE_PIXELS_FORMAT = {
  maximumFractionDigits: 0,
  useGrouping: false,
};
