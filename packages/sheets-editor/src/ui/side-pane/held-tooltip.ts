import * as React from 'react';
/** Props for the button whose tooltip is held back until the person moves to the pane, and how to stop holding it. */
export interface TooltipHeldAsPaneOpens {
  ofButton: { tooltip?: string; onBlur: () => void };
  end: () => void;
}
export function useTooltipHeldAsPaneOpens(): TooltipHeldAsPaneOpens {
  let [isHeld, setIsHeld] = React.useState(true);
  let end = () => setIsHeld(false);
  return {
    ofButton: {
      ...(isHeld && {
        tooltip: '',
      }),
      onBlur: end,
    },
    end,
  };
}
