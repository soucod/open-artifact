import { DEFAULT_TIME_OF_DAY_PATTERN } from '../model/workbook.ts';
/** A number format the number format menu offers by name with a pattern of its own (every one but a foreign currency). */
export type NamedNumberFormatChoice = keyof typeof NUMBER_FORMAT_CHOICE_PATTERNS;
export const NUMBER_FORMAT_CHOICE_PATTERNS = {
  general: {
    pattern: 'General',
    example: '1234.5',
  },
  text: {
    pattern: '@',
    example: '007',
  },
  number: {
    pattern: '#,##0.00',
    example: '1,234.50',
  },
  roundedNumber: {
    pattern: '#,##0',
    example: '1,235',
  },
  numberInParentheses: {
    pattern: '#,##0.00;(#,##0.00)',
    example: '(1,234.50)',
  },
  currency: {
    pattern: '$#,##0.00',
    example: '$1,234.50',
  },
  roundedCurrency: {
    pattern: '$#,##0',
    example: '$1,235',
  },
  percent: {
    pattern: '0.00%',
    example: '12.50%',
  },
  roundedPercent: {
    pattern: '0%',
    example: '13%',
  },
  scientific: {
    pattern: '0.00E+00',
    example: '1.23E+03',
  },
  date: {
    pattern: 'm/d/yyyy',
    example: '3/15/2026',
  },
  mediumDate: {
    pattern: 'mmm d, yyyy',
    example: 'Mar 15, 2026',
  },
  longDate: {
    pattern: 'mmmm d, yyyy',
    example: 'March 15, 2026',
  },
  monthAndDay: {
    pattern: 'mmm d',
    example: 'Mar 15',
  },
  monthAndYear: {
    pattern: 'mmm yyyy',
    example: 'Mar 2026',
  },
  time: {
    pattern: DEFAULT_TIME_OF_DAY_PATTERN,
    example: '2:30 PM',
  },
  dateAndTime: {
    pattern: 'm/d/yyyy h:mm AM/PM',
    example: '3/15/2026 2:30 PM',
  },
  duration: {
    pattern: '[h]:mm:ss',
    example: '25:01:03',
  },
};
