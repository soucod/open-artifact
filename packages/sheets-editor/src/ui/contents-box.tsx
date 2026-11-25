import type * as React from 'react';
/** The props of a box that draws no box of its own: anything a `div` takes but its class. */
export type ContentsBoxProps = Omit<React.ComponentProps<'div'>, 'className'>;
export const ContentsBox = (props: ContentsBoxProps) =>
  <div {...props} className="contents" />;
