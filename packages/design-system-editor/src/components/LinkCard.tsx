/**
 * The link card of rich Markdown editing: the kit's card, with the Markdown
 * address rules and the editor's clipboard.
 */

import { LinkCard as Card } from '@open-artifact/ui';
import { normalizeTypedLink } from '../lib/link-card.ts';
import { copyText } from '../services/downloads.ts';

export interface LinkCardProps {
  link: HTMLAnchorElement;
  /** Writes a new address into the link; returns false when it could not. */
  onEdit(target: string): boolean;
  onRemove(): void;
  /** Gives focus back to the text, with the caret in the link. */
  onReturn(): void;
}

/** The address the Markdown names: the project path for project links. */
export function linkTarget(link: HTMLAnchorElement): string {
  return link.dataset.target ?? link.getAttribute('href') ?? '';
}

export function LinkCard({ link, onEdit, onRemove, onReturn }: LinkCardProps) {
  return <Card link={link} target={linkTarget(link)} href={link.href} normalize={normalizeTypedLink} onCopy={(target) => void copyText(target, 'link')} onEdit={onEdit} onRemove={onRemove} onReturn={onReturn} />;
}
