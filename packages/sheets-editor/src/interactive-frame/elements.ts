/**
 * The elements an interactive's code may make: plain controls and text, and the svg a chart draws with. Anything that
 * links, loads or embeds is not among them, and neither are the properties that would.
 */
import { ChartFault, isObject } from '../chart-frame/chart-runtime.ts';
import { DRAWN_TAGS } from '../chart-frame/drawing.ts';

const wordSet = (...lists: string[]): ReadonlySet<string> => new Set(lists.join(' ').split(' '));

export const CONTROL_TAGS = wordSet(
  'div p span label button input select option optgroup textarea fieldset legend output meter progress',
  'strong em b i small br hr ul ol li h1 h2 h3 h4 h5 h6 table caption thead tbody tfoot tr th td section header footer',
);

/** Properties that would take the frame somewhere, load something, or write markup the code did not make. */
const PROPERTIES_LEFT_OUT = wordSet(
  'dangerouslySetInnerHTML href xlinkHref src srcSet srcDoc action formAction formTarget target ping download',
  'background poster data codebase manifest',
);

/** The same names as React writes them out, whatever their case and with any `:` left out (`xlink:href`, `srcset`). */
const PROPERTIES_LEFT_OUT_AS_WRITTEN: ReadonlySet<string> = new Set([...PROPERTIES_LEFT_OUT].map((name) => name.toLowerCase()));
const isLeftOut = (name: string): boolean => PROPERTIES_LEFT_OUT_AS_WRITTEN.has(name.replaceAll(':', '').toLowerCase());

const INPUT_TYPES = wordSet('text number range checkbox radio search date time month week datetime-local color button');

export const isTagOfInteractive = (tag: string): boolean => CONTROL_TAGS.has(tag) || DRAWN_TAGS.has(tag);

/** The properties as the element gets them: those that would load or link left out, and an input of a plain type. */
export function propsOfInteractive(tag: string, props: unknown): Record<string, unknown> | null {
  if (!isObject(props)) return null;
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) if (!isLeftOut(name)) kept[name] = value;
  if (tag === 'input' && kept.type !== undefined && !(typeof kept.type === 'string' && INPUT_TYPES.has(kept.type))) throw new ChartFault('notDrawnInSheets');
  if (tag === 'button' && kept.type === 'submit') kept.type = 'button';
  return kept;
}

/** Whether a type the code hands createElement is one it may make: an element above, or a component of its own. */
export function checkTypeOfInteractive(type: unknown, isOwn: (type: unknown) => boolean): void {
  if (typeof type === 'string' ? !isTagOfInteractive(type) : !isOwn(type)) throw new ChartFault('notDrawnInSheets');
}
