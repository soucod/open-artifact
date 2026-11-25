import type { SignsOfNumbers } from '../model/workbook.ts';
import { cleanTextForAgent } from '../agent/prompt-text.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { ODD_FORMULA_CHAR_PATTERN } from '../formulas/agent-answer-checks.ts';
/** The order a sheet writes the day and the month of a date in. */
export type DayMonthOrder = keyof typeof DAY_MONTH_ORDER_WORDS;
/** Whether a sheet tells the time of day by a 12-hour or a 24-hour clock. */
export type ClockOfSheet = keyof typeof CLOCK_PATTERNS;
/** Whether a sheet's locale puts the currency sign before or after the amount. */
export type CurrencySignPlacement = keyof typeof CURRENCY_SIGN_WORDS;
/** How a sheet writes numbers, dates and times, as the agent is told when asked for a number format. */
export interface WaysOfWritingInSheet {
  orderOfDayAndMonth: DayMonthOrder;
  signsOfNumbers: SignsOfNumbers;
  currencySign: CurrencySignPlacement;
  clock: ClockOfSheet;
  /** The pattern the sheet's own dates are written with, when it can be told. */
  ownDate: string | null;
}
/** An ask of the agent for a number format: the words of the prompt, and no data. */
export interface NumberFormatAsk {
  words: string;
  data: null;
}
export function ownDatePatternOf(sample: string | null): string | null {
  let pattern = (sample ?? '')
    .replace('2026', 'yyyy')
    .replace(/0?5/, (digits) => 'd'.repeat(digits.length))
    .replace(/0?3/, (digits) => 'm'.repeat(digits.length));
  return /^(?:yyyy|dd?|mm?|[-./ ])+$/.test(pattern) ? pattern : null;
}
export function currencySignPlacement(locale: string): CurrencySignPlacement {
  try {
    if (Intl.NumberFormat.supportedLocalesOf(locale).length === 0) return 'beforeTheAmount';
    let partTypes = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
    })
      .formatToParts(1)
      .map(({ type }) => type);
    return partTypes.indexOf('currency') > partTypes.indexOf('integer') ? 'afterTheAmount' : 'beforeTheAmount';
  } catch {
    return 'beforeTheAmount';
  }
}
export function numberSignsWords({ decimalSign, groupSign }: SignsOfNumbers): string {
  let inSheetSigns = (text: string) =>
    text.replaceAll(/[.,]/g, (sign) => NUMBER_SIGN_WORDS[sign === '.' ? decimalSign : groupSign].typed);
  return `
- A pattern is always written with a point for the decimals and a comma for grouping, whatever the Sheet. This Sheet shows them as its own signs, ${NUMBER_SIGN_WORDS[decimalSign].inWords} for the decimals and ${NUMBER_SIGN_WORDS[groupSign].inWords} between thousands: #,##0.00 shows ${inSheetSigns('1,234.50')}. The person writes numbers that way, so read their ${inSheetSigns('1,234.50')} as #,##0.00 and their ${inSheetSigns('0.5')} as 0.0.${decimalSign === 'comma' ? ' A comma of theirs always stands before decimals, so 25,000 is 0.000.' : ''} Text in quotation marks is shown as it is, so there keep their signs, as in "<${inSheetSigns('0.05')}". No pattern changes the Sheet's signs: if they ask for others, or for numbers as another country writes them, answer null.`;
}
export function numberFormatFromWordsRequest(typed: string, cellsPattern: string | null, sheet: WaysOfWritingInSheet): NumberFormatAsk {
  let patternKept = patternToKeep(cellsPattern);
  let dayMonthOrder = DAY_MONTH_ORDER_WORDS[sheet.orderOfDayAndMonth];
  let clockPattern = CLOCK_PATTERNS[sheet.clock];
  let ownDate = sheet.ownDate ?? dayMonthOrder.inDigits;
  let { decimalSign, groupSign, sizesOfGroups: groupSizes } = sheet.signsOfNumbers;
  let oddSigns = decimalSign === 'point' && groupSign === 'comma' ? null : sheet.signsOfNumbers;
  return {
    words: `You write number formats in a spreadsheet app. A person selected cells and opened the box where the pattern of a custom number format is typed. Where the pattern would go, they said in their own words how the cells should look. Write the one pattern that gives it.

How a pattern is written here:
- Digits: 0 always shows a digit, # shows one only if the number has it, ? leaves a blank in its place. A point sets the decimals. A comma between digits groups thousands, as in #,##0. % multiplies by a hundred. 0.00E+00 is scientific, and takes no grouping; ##0.0E+00 is engineering notation, with exponents in threes. Other characters among the digits stay where they are, as in 000-00-0000, or (000) 000-0000 for a phone number.${oddSigns === null ? '' : numberSignsWords(oddSigns)}${groupSizes === 'threes' ? '' : INDIAN_GROUPING_WORDS}
- Each comma after the last digit divides by a thousand. Always show K, M, B or T after such a number, so that it isn't read as a smaller one: one comma and "K" for thousands, 0.0,"K"; two and "M" for millions, 0.0,,"M"; three and "B" for billions, 0.0,,,"B"; four and "T" for trillions, 0.0,,,,"T". In place of the letter goes the person's own word for thousands or millions, as in #,##0," T€", #,##0," k€", 0.0,," Mio.", #,##0,"千円", 0.0,,"百万円", or a unit that is a thousand or a million times larger than the cells', as in 0.0," km" for meters shown as km. The words in 000s, or $000s, ask for thousands with the K. Only thousands can be divided by: not 万 or 億, nor a hundred. A k, K, M, B, bn, T or tn that the person typed by itself after the digits, and not in quotation marks, asks for this, shown as they typed it.
- Text to show stands in straight double quotation marks, as in 0.0" kg", and so do letters and digits that are shown as they are: 0"/10", "1 in "0, [<0.01]"<0.01";0.00. These characters need none: $ - + ( ) : ! ^ & ' ~ { } < > = / and the blank, and whatever is not ASCII, such as € £ ¥ ₹ ° ² ▲ ▼.
- A unit is shown as the person wrote it, all of it: miles gives " miles", items/box gives " items/box". A blank stands before it, unless their example has none, as in 45p. A short word or abbreviation that you don't know is most likely a unit of the person's trade, to be shown so. A currency's letters are shown only if the person asks for the letters, as in USD in front: "USD "#,##0. A currency, degrees, squares and cubes that the person names in words are shown by the usual sign: ${CURRENCY_SIGN_WORDS[sheet.currencySign]}
- Up to four sections, set apart by semicolons: for positive numbers; negative numbers; zero; text. One section alone is for every number. A section for negative numbers adds no minus sign, so write the - or the parentheses, as in General;[Red]-General and General;(General) and +General;-General;General, where zero has a section of its own so that it gets no sign. A plus sign, arrows, or colors for up and down always take these three sections, with zero plain: one section that begins with + shows -+ for a negative number. So +2.5x asks for +0.0"x";-0.0"x";0.0"x", and arrows for ▲0.0%;▼0.0%;0.0%. An example in parentheses, or after △, shows a negative number: (250) asks for #,##0;(#,##0), and △250 for #,##0;△#,##0. A section with nothing in it shows nothing. @ stands for the cell's text, and @ alone is plain text.
- Fractions: # ?/? shows 1 1/2, # ??/?? allows two digits under the line, and # ?/8 counts eighths.
- Accounting: negative numbers in parentheses and a dash for zero, as in #,##0.00;(#,##0.00);"-".
- A section may begin with a color: [Black] [Blue] [Cyan] [Green] [Magenta] [Red] [White] [Yellow]. There are no others.
- The first two sections may each begin with a condition in the place of positive and negative, as in [>=1000000]0.0,,"M";[>=1000]0.0,"K";0, or [>=1000000000]0.0,,,"B";[>=1000000]0.0,,"M";0.0,"K" where billions are asked for too, and [=1]"Yes";[=0]"No";General. A section whose condition lets in negative numbers alone, such as [<0], adds no minus sign either, so write it: [Red][<0]-0.00;[Blue][>100]0.00;0.00. In a pattern with a condition every other section adds the minus sign by itself, even to a text: [=0]"Closed";"Open" shows -Open. So one text for zero and another for all else go by the signs, with no condition: "Open";"Open";"Closed".
- Dates: yy yyyy; m mm mmm mmmm; d dd ddd dddd. Times: h hh; m mm right after h or before s; s ss; AM/PM for a 12-hour clock. A length of time, such as hours worked, a total, time elapsed or a lap, has its first part in square brackets, so that it doesn't start again at 24 hours or at 60 minutes: [h]:mm, [h]:mm:ss, [m]:ss, [h]"h "mm"m", and [m]" min" for the total in minutes. Hours alone would hide the minutes, so show both unless the person wants hours alone. d is a day of the month, never a count of days, so no pattern shows a length of time in days and hours. Names of months and days come out in this Sheet's language, whatever language the person writes in. A date in digits is m/d/yyyy or m/d: these two alone show it as this Sheet writes dates, in its own order and with its own signs. A time of day with nothing said of the clock is ${clockPattern}, by this Sheet's clock, and a date with its time is m/d/yyyy ${clockPattern}, with the year. Every other date is shown as it is spelled, so there put the ${dayMonthOrder.inWords}, ${withLeadingZeros(ownDate)} with leading zeros, ${withShortYear(ownDate)} with a short year. Only where the person asks for or shows the day first or the month first, or asks for another country's dates, spell that order out, as in dd/mm/yyyy and mm/dd/yyyy. Naming two parts, as in day and month, asks for no order, and nor does an example whose first two numbers could each be a month, as in 05/01/2026.
- General is a cell with no format. In a section it stands for the number as such a cell shows it, with the decimals that it has. Where the person says nothing of decimals and shows none, write General for the digits and not 0, which would round them away: General"°", General" pts", "No. "General. General takes no %, no comma that divides and no digits beside it: there write 0.
- Where the person shows an example of the look, make the pattern from the example, with all that stands at its digits where the example has it: 980円, £12/hr, $300 (net). Words that a reader expects in each cell are part of the look, as in Room 12 and FY 2026. Words that only say what kind of number it is or what is wanted aren't shown, as in fax no. 020 7946 0000, which is 000 0000 0000.
- An amount or a measure whose decimals the person gives has its thousands grouped too, as in #,##0.000" t". Codes, numbers of things such as orders or accounts, and years are never grouped.
- The Cell type list has ready-made formats. Where the person's words name one of them and ask for nothing more, answer with its pattern, unless the cells' pattern has something to keep: automatic General; number #,##0.00; whole or rounded number #,##0; negative numbers in parentheses #,##0.00;(#,##0.00); percent 0.00%; rounded percent 0%; scientific 0.00E+00; date m/d/yyyy; month and year mmm yyyy; time ${clockPattern}; date and time m/d/yyyy ${clockPattern}; duration [h]:mm:ss. The words may be the beginning of such a name, or misspelled.
- Prefer the plainest pattern that a person would have typed themselves.

No pattern can give these: calendar quarters or week numbers; 1st, 2nd, 3rd; ${oddSigns === null ? 'a point, a blank or an apostrophe between thousands, a comma for decimals' : "other signs for the decimals or between thousands than this Sheet's own"}${groupSizes === 'threes' ? ', or groups of two digits' : ''}; rounding to anything but a power of ten or a fraction; multiplying by anything but the hundred of one %, as for 0.0025 shown as 25; another value than the cell holds, such as an amount converted into another currency. Nor what is no number format: bold, font, size, fill, borders, alignment, sorting, formulas.
${patternKept === null ? '' : patternNowWords(patternKept, sheet.ownDate)}
The person wrote: ${JSON.stringify(cleanTextForAgent(typed))}

If what they wrote is a pattern with a slip in it, such as text with no quotation marks, write it as they meant it. Never answer with their whole text in quotation marks: every number would show it. The name of a month or of a day of the week, such as March or Sunday, asks for such names: mmmm for a month, dddd for a day.
Answer with this JSON alone, and nothing before or after it: {"pattern":"…"}. If no pattern can give what they ask for, or you cannot tell what they mean, answer {"pattern":null}.`,
    data: null,
  };
}
export function readPatternAnswer(answer: unknown): string | null {
  let pattern = isNonNullObject(answer) ? answer.pattern : null;
  return typeof pattern !== 'string' || ODD_FORMULA_CHAR_PATTERN.test(pattern) ? null : pattern;
}
export const MAX_PATTERN_LENGTH_FOR_AGENT = 200;
export const looksLikeWordsNotPattern = (typed: string): boolean =>
  /[\p{L}1-9]/u.test(typed.replaceAll(/\\(.)|"[^"]*"/gu, '$1')) && !'general'.startsWith(typed.toLowerCase());
export const MAX_PATTERN_TO_KEEP_LENGTH = 40;
export const KEEPABLE_PATTERN = /^(?:[-+0#?.,%;:/() $€£¥dmyhs]|AM\/PM|General)+$/i;
export const patternToKeep = (pattern: string | null): string | null =>
  pattern !== null && pattern.length <= MAX_PATTERN_TO_KEEP_LENGTH && KEEPABLE_PATTERN.test(pattern) ? pattern : null;
export const SAMPLE_DATE_SERIAL = 46086;
export const withLeadingZeros = (datePattern: string): string => datePattern.replace(/d+/, 'dd').replace(/m+/, 'mm');
export const withShortYear = (datePattern: string): string => datePattern.replace('yyyy', 'yy');
export const ownDateWords = (
  ownDate: string,
): string => `Its m/d/yyyy or m/d stands for this Sheet's own way of writing a date, which is ${ownDate}. A change to it has to be spelled out that way: ${withLeadingZeros(ownDate)} for leading zeros, ${withShortYear(ownDate)} for a short year.
`;
export const OWN_DATE_PATTERN = /^m\/d(?:\/yyyy)?(?![/dy])/;
export const patternNowWords = (pattern: string, ownDate: string | null): string => `
The cells' pattern now: ${pattern}
${OWN_DATE_PATTERN.test(pattern) && ownDate !== null && ownDate !== 'm/d/yyyy' ? ownDateWords(ownDate) : ''}Where the person asks for a change to how the cells look now, change that alone and keep the rest of this pattern, such as its currency sign, its grouping and its decimals. Where they show an example, or ask for a format of another kind, go by their words alone: a pattern for dates or times has nothing to keep for an ask about decimals, negative numbers, currencies or units, nor has one for numbers for an ask about dates or times, and a currency sign does not stay beside a percent sign, a unit or leading zeros. Cells with a pattern for dates hold dates: a pattern for numbers would show them as numbers of days, such as 46096, so what no pattern for dates can give, such as a week's number, has no pattern.
`;
export const DAY_MONTH_ORDER_WORDS = {
  monthDayYear: {
    inWords: "month before the day: mmmm d, yyyy with the month's name",
    inDigits: 'm/d/yyyy',
  },
  dayMonthYear: {
    inWords: "day before the month: d mmmm yyyy with the month's name",
    inDigits: 'd/m/yyyy',
  },
};
export const CLOCK_PATTERNS = {
  twelveHours: 'h:mm AM/PM',
  twentyFourHours: 'h:mm',
};
export const CURRENCY_SIGN_WORDS = {
  beforeTheAmount: `$ € £ ¥ ₹ before the number; "°C", " m²" after it. An amount of money has grouping and the currency's usual decimals, as in $#,##0.00, unless the person says otherwise.`,
  afterTheAmount: `$ € £ ¥ ₹; "°C", " m²". In this Sheet all of them stand after the number, the currency sign too, with a blank before it: #,##0.00 €. An amount of money has grouping and the currency's usual decimals, as there, unless the person says otherwise.`,
};
export const NUMBER_SIGN_WORDS = {
  point: {
    inWords: 'a point',
    typed: '.',
  },
  comma: {
    inWords: 'a comma',
    typed: ',',
  },
  noBreakSpace: {
    inWords: 'a blank',
    typed: ' ',
  },
  narrowNoBreakSpace: {
    inWords: 'a blank',
    typed: ' ',
  },
  apostrophe: {
    inWords: 'an apostrophe',
    typed: "'",
  },
};
export const INDIAN_GROUPING_WORDS = `
- This Sheet groups the digits before the last three in twos, by itself: #,##0 shows 12,34,567. No pattern changes that.`;
