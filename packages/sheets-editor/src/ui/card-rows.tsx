import type * as React from 'react';
import type { MessagePart } from '../i18n/messages.ts';
export interface WordsWithColumnNamesProps {
  words: readonly MessagePart[];
}
export interface CardSectionHeadingProps {
  id?: string;
  className?: string;
  children: React.ReactNode;
}
export interface CardRowTextsProps {
  title: readonly MessagePart[];
  second?: string;
  className?: string;
}
export function WordsWithColumnNames({ words }: WordsWithColumnNamesProps) {
  let parts: React.ReactNode[] = [];
  for (let word of words)
    parts.push(
      typeof word === 'string'
        ? word
        : <bdi key={parts.length} data-names-column={word.namesColumn}>{word.setApart}</bdi>,
    );
  return <>{parts}</>;
}
export function CardSectionHeading(props: CardSectionHeadingProps) {
  let { id, className = '', children } = props;
  return <h3 id={id} className={`mt-3 flex min-w-0 shrink-0 items-center gap-1.5 px-lg py-1 text-footnote leading-4 font-medium text-secondary select-none ${className}`}>{children}</h3>;
}
export function showTitleIfTextOverflows({ currentTarget }: React.PointerEvent<HTMLElement>): void {
  let isOverflowing = currentTarget.scrollHeight > currentTarget.clientHeight || currentTarget.scrollWidth > currentTarget.clientWidth;
  currentTarget.title = isOverflowing ? currentTarget.textContent : '';
}
export function CardRowTexts({ title, second, className = '' }: CardRowTextsProps) {
  return <span className={`flex min-h-8 min-w-0 flex-1 flex-col justify-center ${className}`}><span className="line-clamp-2 min-w-0 text-body wrap-anywhere text-primary group-focus-visible/row:line-clamp-none touch:line-clamp-none" onPointerEnter={showTitleIfTextOverflows}><WordsWithColumnNames words={title} /></span>{second !== undefined &&
        <span className="min-w-0 truncate text-footnote leading-4 text-secondary group-focus-visible/row:whitespace-normal group-has-focus-visible/rule:pe-7 touch:whitespace-normal" onPointerEnter={showTitleIfTextOverflows}>{second}</span>}</span>;
}
export const cardRowButtonProps = {
  className:
    'group/row flex min-h-11 min-w-0 flex-1 cursor-default items-center gap-md rounded-lg py-1.5 ps-2 pe-1 text-start outline-none focus-visible:shadow-focus focus-visible:outline-hidden pointer-coarse:min-h-12',
};
export const cardRowFrameProps = {
  className: 'relative ms-[calc(var(--ui-pad-lg)-0.5rem)] me-[calc(var(--ui-pad-md)-0.25rem)] flex min-w-0 items-center rounded-lg',
};
export const CARD_ROW_HOVER_CLASSES = 'hover:bg-fill-ghost-selected';
export const cardRowEndButtonsProps = {
  className:
    'absolute inset-y-0 end-0 flex items-center opacity-0 transition-opacity duration-100 group-hover/rule:opacity-100 group-has-focus-visible/rule:opacity-100 group-data-reorder/rule:opacity-0 motion-reduce:transition-none',
};
export const wordsFadeUnderButtonProps = {
  className: 'sheet-words-fade-under-button',
};
export const FIND_OMITTED_ATTRIBUTE = 'data-find-omitted';
