import type { Color, Hue } from '@open-artifact/sheets-core';
import type { DropdownPreset } from '../i18n/chip-labels.ts';
import { DROPDOWN_CHIP_SHADE } from './dropdown-colors.ts';
import { NO_COLOR } from '../model/colors.ts';
export const standardHue = (hue: Hue): Color => ({
  kind: 'standard',
  hue,
  shade: DROPDOWN_CHIP_SHADE,
});
export const STATUS_OPTION_SET: DropdownPreset = {
  key: 'status',
  options: [
    {
      key: 'notStarted',
      color: NO_COLOR,
    },
    {
      key: 'inProgress',
      color: standardHue('blue'),
    },
    {
      key: 'blocked',
      color: standardHue('red'),
    },
    {
      key: 'done',
      color: standardHue('green'),
    },
  ],
};
export const DROPDOWN_OPTION_SETS: DropdownPreset[] = [
  STATUS_OPTION_SET,
  {
    key: 'priority',
    options: [
      {
        key: 'low',
        color: standardHue('teal'),
      },
      {
        key: 'medium',
        color: standardHue('yellow'),
      },
      {
        key: 'high',
        color: standardHue('red'),
      },
    ],
  },
  {
    key: 'yesNo',
    options: [
      {
        key: 'yes',
        color: standardHue('green'),
      },
      {
        key: 'no',
        color: standardHue('red'),
      },
    ],
  },
  {
    key: 'approval',
    options: [
      {
        key: 'pending',
        color: standardHue('purple'),
      },
      {
        key: 'approved',
        color: standardHue('green'),
      },
      {
        key: 'rejected',
        color: standardHue('red'),
      },
    ],
  },
  {
    key: 'health',
    options: [
      {
        key: 'onTrack',
        color: standardHue('green'),
      },
      {
        key: 'atRisk',
        color: standardHue('yellow'),
      },
      {
        key: 'offTrack',
        color: standardHue('red'),
      },
    ],
  },
  {
    key: 'size',
    options: [
      {
        key: 'small',
        color: standardHue('blue'),
      },
      {
        key: 'mediumSize',
        color: standardHue('orange'),
      },
      {
        key: 'large',
        color: standardHue('teal'),
      },
      {
        key: 'extraLarge',
        color: standardHue('yellow'),
      },
    ],
  },
];
