import { Menu, type MenuItemProps } from '../kit/menu.tsx';
import { Combobox } from '../kit/combobox.tsx';
import { Separator } from '../kit/separator.tsx';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import * as React from 'react';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { preventMouseDownDefault } from './dom-events.ts';
import { blockRepeatedEnterOrSpace, blockRepeatedTyping } from './repeated-key-guards.ts';
export interface DensitySubmenuProps {
  density: CellDensity;
  onDensityChosen: (density: CellDensity) => void;
  /** Wraps what a chosen row does into the row's click handler. */
  picked: (onChosen: () => void) => MenuItemProps['onClick'];
}
export function DensitySubmenu({ density, onDensityChosen, picked }: DensitySubmenuProps) {
  return <Menu.Submenu><Menu.SubmenuTrigger hint={densityLabel(density)}>{sheetMessages.layout()}</Menu.SubmenuTrigger><Menu.Popup onMouseDown={preventMouseDownDefault} onKeyDownCapture={blockRepeatedEnterOrSpace}><Menu.Group aria-label={sheetMessages.layout()}>{DENSITIES.map(
            (choice) =>
              <Menu.Item key={choice} checkedRole="radio" checked={choice === density} onClick={picked(() => onDensityChosen(choice))}>{densityLabel(choice)}</Menu.Item>,
          )}</Menu.Group></Menu.Popup></Menu.Submenu>;
}
export interface DensityPickerProps {
  density: CellDensity;
  onDensityChosen: (density: CellDensity) => void;
}
export function DensityPicker({ density, onDensityChosen }: DensityPickerProps) {
  let [labelId, hintId] = [React.useId(), React.useId()];
  let densityItems = React.useMemo(
    () =>
      DENSITIES.map(
        (choice) => ({
          value: choice,
          label: densityLabel(choice),
        }),
      ),
    [],
  );
  return <><Separator /><div className="flex items-center justify-between gap-md" onKeyDownCapture={blockRepeatedTyping}><span id={labelId} className="text-body font-medium">{sheetMessages.layout()}</span><Combobox aria-labelledby={labelId} aria-describedby={hintId} searchable={false} fullWidth={false} align="end" items={densityItems} value={density} onChange={(choice) => {
              if (choice !== null) onDensityChosen(choice);
            }} /><span id={hintId} hidden>{sheetMessages.onlyForYou()}</span></div></>;
}
export const densityLabel = (density: CellDensity) => (density === 'compact' ? sheetMessages.compact() : sheetMessages.comfortable());
export const DENSITIES: readonly CellDensity[] = ['comfortable', 'compact'];
