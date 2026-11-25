/**
 * A small card under a hovered element that sits in a link: its address
 * and, for web and mail links, a button that opens it in a new tab. It
 * shows without selecting anything, and stays while the pointer moves
 * onto it.
 */

import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openableLink, shownLink } from '../lib/hover-link.ts';

/** How long the card stays after the pointer leaves the element. */
const LINGER_MS = 400;

export interface HoverLinkProps {
  /** The hovered link and the element's screen box, or `null`. */
  link: { href: string; left: number; top: number; height: number } | null;
}

export function HoverLink({ link }: HoverLinkProps) {
  const [shown, setShown] = useState(link);
  const over = useRef(false);
  const latest = useRef(link);
  latest.current = link;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (link) setShown(link);
    else if (!over.current) timer.current = setTimeout(() => !over.current && setShown(null), LINGER_MS);
  }, [link?.href, link?.left, link?.top, link?.height]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!shown) return null;
  const opens = openableLink(shown.href);
  return (
    <div
      data-hover-link=""
      className="pointer-events-auto absolute z-10 flex max-w-[280px] items-center gap-1 rounded-[10px] bg-chrome py-1 pl-2.5 pr-1 text-[12px] font-control text-chrome-fg shadow-chrome-popup"
      style={{ left: Math.max(8, shown.left), top: shown.top + shown.height + 6 }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => {
        over.current = true;
        clearTimeout(timer.current);
      }}
      onPointerLeave={() => {
        over.current = false;
        // Back on the element: the card stays for it.
        timer.current = setTimeout(() => !latest.current && setShown(null), LINGER_MS);
      }}
    >
      <span className="min-w-0 flex-1 truncate" title={shown.href}>
        {shownLink(shown.href)}
      </span>
      {opens ? (
        <button
          type="button"
          aria-label={`Open ${shown.href}`}
          title="Open in a new tab"
          className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-chrome-muted outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:bg-chrome-hover"
          onClick={() => window.open(opens, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
