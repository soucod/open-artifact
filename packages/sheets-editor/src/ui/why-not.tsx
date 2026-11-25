import type { TooltipSide } from '../kit/tooltip.tsx';
import type { ViewOnlyBecause } from '../view/page-view.ts';
import { toolUnavailableLabel } from '../i18n/grid-action-labels.ts';
export function focusControlInWrapper(element: Element | null) {
  let control = element?.matches(DISABLED_REASON_WRAPPER_SELECTOR) === true ? element.querySelector<HTMLElement>(ENABLED_CONTROL_SELECTOR) : null;
  control?.focus({
    preventScroll: true,
  });
  return control === element?.ownerDocument.activeElement ? control : null;
}
export const describeWhyNot = (label: string, whyNot: string | null) =>
  whyNot === null
    ? null
    : <><span className="sr-only">{toolUnavailableLabel(label)}{' '}</span>{whyNot}</>;
export const disabledByViewOnly = (viewOnlyBecause: ViewOnlyBecause | null) => ({
  disabled: viewOnlyBecause !== null,
  disabledReason: null,
});
export const disabledWithWhyNot = (label: string, whyNot: string | null, side: TooltipSide) => ({
  disabled: whyNot !== null,
  disabledReason: describeWhyNot(label, whyNot),
  disabledReasonSide: side,
});
export const DISABLED_REASON_WRAPPER_SELECTOR = '[data-ui-disabled-reason-wrapper]';
export const ENABLED_CONTROL_SELECTOR = 'button:enabled, [role][tabindex="0"]:not([aria-disabled="true"])';
export const isWrapperOfDisabledControl = (element: Element) =>
  element.matches(DISABLED_REASON_WRAPPER_SELECTOR) && element.querySelector(ENABLED_CONTROL_SELECTOR) === null;
