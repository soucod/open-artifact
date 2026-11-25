/**
 * Who else is here (`report.peers`), beside History and Share: their
 * avatars, and a list with each person's Follow, or Stop while this view
 * follows them, where the page offers following (`report.following`).
 * Escape in the Shell stops following, as it does in the page.
 */

import { useEffect, useRef } from 'react';
import type { ChromePeer } from '@open-artifact/protocol';
import { Menu, MenuItem, MenuLabel, cn, toast } from '@open-artifact/ui';
import { t } from '../../lib/i18n.ts';
import { command } from '../bridge.ts';
import { followedPeer, inkOnColor, offersFollow, peerColorOf, peerInitials } from '../model.ts';
import { useShell } from '../store.ts';

/** Avatars shown on the bar before "+N". */
const SHOWN = 3;

/** A peer's name in the list; `inSentence`, as the object of "Follow …", "Following …". */
const nameOf = (peer: ChromePeer, inSentence = false): string => (peer.self ? t(inSentence ? 'yourOtherTab' : 'youOtherTab') : peer.name);

function Avatar({ peer, ring, className }: { peer: ChromePeer; ring?: boolean; className?: string }) {
  const color = peerColorOf(peer);
  return (
    <span
      aria-hidden
      data-peer-avatar={peer.key}
      className={cn(
        'inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-surface',
        ring && 'outline-2 outline-offset-1',
        className,
      )}
      style={{ background: color, color: inkOnColor(color), outlineColor: ring ? color : undefined, outlineStyle: ring ? 'solid' : undefined }}
    >
      {peerInitials(peer.name)}
    </span>
  );
}

/** Tells the person when following starts, and when it stops because the followed person left. */
function useFollowNotes(peers: ChromePeer[] | undefined, following: string | null | undefined): void {
  const last = useRef<{ key: string; name: string } | null>(null);
  useEffect(() => {
    const before = last.current;
    const peer = following ? peers?.find((p) => p.key === following) : undefined;
    if (peer) {
      if (before?.key !== peer.key) toast.add({ title: t('followingToast', { name: nameOf(peer, true) }) });
      last.current = { key: peer.key, name: nameOf(peer, true) };
      return;
    }
    if (following) return; // a key not listed yet: wait for the list
    // No list at all is a page loading again, not someone leaving.
    if (before && peers && !peers.some((p) => p.key === before.key)) toast.add({ title: t('stoppedFollowingLeft', { name: before.name }) });
    last.current = null;
  }, [peers, following]);
}

/** The bar's people: nothing while nobody else is here. */
export function Peers() {
  const peers = useShell((state) => state.report.peers);
  const following = useShell((state) => state.report.following);
  const followed = useShell((state) => followedPeer(state.report));
  const canFollow = useShell((state) => offersFollow(state.report));
  useFollowNotes(peers, following);

  useEffect(() => {
    if (!followed) return;
    const onKey = (event: KeyboardEvent) => {
      // Escape in an open menu or dialog closes that instead.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"]')) return;
      command({ cmd: 'follow', key: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [followed]);

  if (!peers?.length) return null;
  // The followed person first, so their ring is always on the bar.
  const ordered = followed ? [followed, ...peers.filter((peer) => peer !== followed)] : peers;
  const shown = ordered.slice(0, SHOWN);
  const more = ordered.length - shown.length;
  const names = ordered.map((peer) => nameOf(peer)).join(', ');
  const label = followed ? `${t('followingName', { name: nameOf(followed, true) })} · ${t('peopleHereNames', { names })}` : t('peopleHereNames', { names });

  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          data-peers=""
          aria-label={label}
          title={label}
          className="inline-flex h-8 shrink-0 items-center rounded-control px-1 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent data-[popup-open]:bg-hover"
        >
          <span className="flex items-center">
            {shown.map((peer, index) => (
              <Avatar key={peer.key} peer={peer} ring={peer === followed} className={index > 0 ? '-ml-1.5' : undefined} />
            ))}
            {more > 0 ? <span className="ml-1 text-xs text-fg-muted">{t('peopleMore', { count: more })}</span> : null}
          </span>
        </button>
      }
    >
      <MenuLabel>{t('peopleHere')}</MenuLabel>
      {ordered.map((peer) => {
        const on = peer === followed;
        const row = (
          <span className="flex min-w-56 items-center gap-2.5">
            <Avatar peer={peer} ring={on} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{nameOf(peer)}</span>
              {peer.followsYou ? <span className="text-xs text-fg-subtle">{t('followingYou')}</span> : null}
            </span>
            {canFollow ? (
              <span
                data-follow={on ? 'on' : 'off'}
                aria-label={on ? t('stopFollowingName', { name: nameOf(peer, true) }) : t('followName', { name: nameOf(peer, true) })}
                className={cn('rounded-control px-2 py-0.5 text-xs font-medium', on ? 'bg-fg text-surface' : 'bg-surface-2 text-fg')}
              >
                {on ? t('stopFollow') : t('follow')}
              </span>
            ) : null}
          </span>
        );
        return canFollow ? (
          <MenuItem key={peer.key} onSelect={() => command({ cmd: 'follow', key: on ? null : peer.key })}>
            {row}
          </MenuItem>
        ) : (
          <div key={peer.key} className="px-2 py-1.5 text-sm">
            {row}
          </div>
        );
      })}
    </Menu>
  );
}
