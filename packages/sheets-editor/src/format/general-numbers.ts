import { GENERAL_FORMAT_MAX_CHARS, toExponentialText, toPrecisionText, MAX_EXPONENT_FRACTION_DIGITS } from './shown-text.ts';
import { generalNumberFormatter, toFixedText } from '../clipboard/text-escaping.ts';
import { MAX_SIGNIFICANT_DIGITS } from './shown-text-values.ts';
export function generalTextWithoutExponent(number: number): string {
  let text = generalNumberText(number, GENERAL_FORMAT_MAX_CHARS);
  if (!text.includes('E')) return text;
  return Math.abs(number) >= 1 ? generalNumberFormatter.format(number) : '0';
}
export function generalNumberText(number: number, maxChars: number): string {
  if (toFixedText(number, 0).length > maxChars && toExponentialText(number, 0).length > maxChars) return generalTextWithoutExponent(number);
  for (let digits = MAX_SIGNIFICANT_DIGITS; digits >= 1; digits -= 1) {
    let text = toPrecisionText(number, digits);
    if (text.length <= maxChars) return text;
  }
  for (let digits = MAX_EXPONENT_FRACTION_DIGITS; digits >= 0; digits -= 1) {
    let text = toExponentialText(number, digits);
    if (text.length <= maxChars) return text;
  }
  let signRoom = number < 0 ? 3 : 2;
  let fixedText = toFixedText(number, Math.max(0, maxChars - signRoom));
  return fixedText === '0' ? generalTextWithoutExponent(number) : fixedText;
}
export function roundToShownPrecision(number: number): number {
  let text = generalNumberText(number, GENERAL_FORMAT_MAX_CHARS);
  return text.includes('E') && Math.abs(number) >= 1 ? Number(number.toFixed(0)) : Number(text);
}
