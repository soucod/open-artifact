/** What {@link titleWhenCut} reads and sets on an element. */
export interface CutTextElement {
  scrollWidth: number;
  clientWidth: number;
  textContent: string | null;
  title: string;
  removeAttribute(name: string): void;
}

/** Gives a truncated label its full text as a hover title, and takes it away when it fits again. */
export function titleWhenCut(element: CutTextElement): void {
  if (element.scrollWidth > element.clientWidth) element.title = element.textContent ?? '';
  else element.removeAttribute('title');
}
