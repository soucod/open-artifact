import type { ChartInputs, ChartLook, FrameToPage } from '../chart-frame/messages.ts';

/** A value an interactive writes to a cell: a number, a text, a checkbox's state, or `null` to empty it. */
export type InteractiveWrittenValue = number | string | boolean | null;

/** One cell an interactive writes: the input's name, the row and column within its range (from 0), and the value. */
export type InteractiveRawWrite = [input: string, row: number, column: number, value: InteractiveWrittenValue];

/** The keys an interactive hands back to the page: Escape leaves it, F6 and Shift+F6 go to the next or last part. */
export type PageKeyFromInteractive = 'leave' | 'nextPart' | 'previousPart';

/**
 * What the page tells an interactive's frame over its port. `answered` is the number of the last write the page has
 * taken (written or turned down): the frame shows the writes after it over the inputs until they are answered too.
 */
export type PageToInteractive =
  | { kind: 'draw'; artifact: string; inputs: ChartInputs; look: ChartLook; canWrite: boolean }
  | { kind: 'areYouThere' }
  | { kind: 'inputsChanged'; inputs: ChartInputs; answered: number }
  | { kind: 'lookChanged'; look: ChartLook }
  | { kind: 'canWriteChanged'; canWrite: boolean }
  | { kind: 'enteredByKey' }
  | { kind: 'left' };

/**
 * What an interactive's frame tells the page. `pressed` comes at once on the person's own press, before the write it
 * may cause; `nth` counts the frame's writes from 1.
 */
export type InteractiveToPage =
  | { kind: 'here' }
  | { kind: 'keyboardLost' }
  | { kind: 'pressed'; at: number }
  | { kind: 'keyForPage'; key: PageKeyFromInteractive }
  | { kind: 'write'; cells: InteractiveRawWrite[]; nth: number }
  | FrameToPage;
