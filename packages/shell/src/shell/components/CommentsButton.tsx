import { ChevronDown, MessageCircle } from 'lucide-react';
import type { ChromeCommand, ChromeReport } from '@open-artifact/protocol';
import { Menu, MenuItem, Tooltip, cn } from '@open-artifact/ui';
import { t } from '../../lib/i18n.ts';
import { useShell } from '../store.ts';
import { actionOf, countText, showsComments } from '../model.ts';

/**
 * The comments button: comment mode on and off, a filled bubble
 * while on ("Done commenting"), an outlined one with a dot while open
 * comments wait ("N open comments"); and a caret whose menu shows the
 * comments list ("Show all comments N") or hides it ("Hide comments").
 */
export function CommentsButton({ comments, command, readOnly = false, disabled = false }: {
  comments: ChromeReport['comments'];
  command: (command: ChromeCommand) => void;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const selection = useShell(state => actionOf(state.report, 'comment_selection'));
  if (!comments || !showsComments({ comments })) return null;
  const on = comments.on;
  const count = Math.max(0, comments.count || 0);
  const waiting = !on && count > 0;
  const tip = on ? t('doneCommenting') : count === 1 ? t('openComment') : count > 0 ? t('openComments', { count: countText(count) }) : t('comments');
  return (
    <span data-comments-button="" className="inline-flex items-center">
      <Tooltip label={tip}>
        <button
          type="button"
          aria-label={t('comments')}
          disabled={disabled}
          aria-pressed={readOnly ? comments.open : on}
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-hover hover:text-fg',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            on && 'text-fg',
          )}
          onClick={() => command(readOnly ? { cmd: 'comments_list', open: !comments.open } : { cmd: 'comments_mode', on: !on })}
        >
          <span className="relative inline-flex">
            <MessageCircle className="size-4" fill={on ? 'currentColor' : 'none'} />
            {waiting ? <span aria-hidden data-comments-dot="" className="absolute -right-0.5 -top-px size-1.5 rounded-full bg-accent ring-[1.5px] ring-surface" /> : null}
          </span>
        </button>
      </Tooltip>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            aria-label={t('commentOptions')}
            disabled={disabled}
            title={t('commentOptions')}
            className="-ml-0.5 inline-flex h-8 w-5 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent data-[popup-open]:bg-hover"
          >
            <ChevronDown className="size-3" />
          </button>
        }
      >
        {selection && !readOnly && (
          <MenuItem disabled={selection.disabled} onSelect={() => command({ cmd: 'action', id: selection.id })}>
            {t('actionCommentSelection')}
          </MenuItem>
        )}
        {comments.open ? (
          <MenuItem onSelect={() => command({ cmd: 'comments_list', open: false })}>{t('hideComments')}</MenuItem>
        ) : (
          <MenuItem onSelect={() => command({ cmd: 'comments_list', open: true })}>
            <span className="flex items-center gap-6">
              <span className="flex-1">{t('showAllComments')}</span>
              {count ? <span className="text-xs text-fg-subtle">{countText(count)}</span> : null}
            </span>
          </MenuItem>
        )}
      </Menu>
    </span>
  );
}
