import type * as React from 'react';
export interface SplitToolProps {
  /** Gets the fieldset or the span, whichever is drawn. */
  ref: React.RefCallback<HTMLElement>;
  label: string;
  /** Whether the tool shows its own face; without one it is only a wrapper. */
  hasFace: boolean;
  children: React.ReactNode;
}
export function SplitTool({ ref, label, hasFace, children }: SplitToolProps) {
  return hasFace
    ? <fieldset ref={ref} aria-label={label} data-has-face className="sheet-split-tool m-0 flex min-w-0 flex-none border-0 p-0">{children}</fieldset>
    : <span ref={ref} className="sheet-split-tool flex flex-none">{children}</span>;
}
