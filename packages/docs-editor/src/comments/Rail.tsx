/**
 * Comments beside the text: each card of the open tab level with its words, stacked so none overlap, the open card
 * kept by its words and nudged toward them. The column scrolls with the page, and other features' cards join it. Where
 * the page leaves no room for the column, a marker beside each line opens its cards one at a time, under the line. A
 * reaction is its own chip, in the column or by the line's marker, and opens no card. The column lies over the page's
 * right side, which leaves it room, so the page's scrollbar stays at the edge of the window.
 */
import type { CommentThread } from '@open-artifact/runtime';
import { cn } from '@open-artifact/ui';
import type { EditorView } from 'prosemirror-view';
import { ListChecks, MessageSquare } from 'lucide-react';
import { type ReactNode, type WheelEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PHONE_QUERY, useMedia } from '../app/media.ts';
import { useDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { type ColumnCard, newestFocus, setColumnMode, useMarginColumn } from '../margin/column.ts';
import { type MarkerRow, markerRows, stackCards } from '../margin/stack.ts';
import { CommentList } from './CommentList.tsx';
import { cancelComposer } from './actions.ts';
import { NewThreadCard } from './NewThreadCard.tsx';
import { type MarkedRange, liveRanges, rangesOf } from './plugin.ts';
import { type Hold, NEW_THREAD, docComments, setActive, useCommentUi, useThreads } from './store.ts';
import { ReactionChip, ThreadCard } from './ThreadCard.tsx';
import { isReactionThread } from './threads.ts';

const COLUMN_WIDTH = 320;
const MARKER_HEIGHT = 26;

export function CommentsRail(): ReactNode {
  const view = useDocs(state => state.comments);
  const tab = useDocs(state => state.activeTab);
  const available = docComments.store(state => state.available);
  const room = useMarginRoom();
  const phone = useMedia(PHONE_QUERY, false);
  if (!available) return null;
  if (view === 'all') return <CommentList />;
  if (view === 'hidden' || !tab) return null;
  return phone ? <CommentSheet tab={tab} /> : <Margin tab={tab} room={room} />;
}

const scroller = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-doc-scroll]');

/** Whether the page keeps its full width beside the column: what the row holds besides the page and the margin is left out. */
function useMarginRoom(): boolean {
  const [room, setRoom] = useState(true);
  useLayoutEffect(() => {
    const page = scroller();
    const row = page?.parentElement;
    const sheet = page?.firstElementChild;
    if (!page || !row || !(sheet instanceof HTMLElement)) return;
    const measure = () => {
      let free = row.clientWidth;
      for (const child of row.children) {
        if (child === page || !(child instanceof HTMLElement) || child.hasAttribute('data-margin')) continue;
        const { position } = getComputedStyle(child);
        if (position !== 'absolute' && position !== 'fixed') free -= child.offsetWidth;
      }
      const wanted = Number.parseFloat(getComputedStyle(sheet).maxWidth);
      setRoom(!Number.isFinite(wanted) || free >= wanted + COLUMN_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const element of [row, page, sheet]) observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return room;
}

/** Where a range's first line is, in the scrolling page's coordinates. */
function rangeTop(view: EditorView, range: MarkedRange, page: HTMLElement): number | null {
  let top: number;
  try {
    if (range.kind === 'words') top = view.coordsAtPos(range.from, 1).top;
    else {
      const node = view.nodeDOM(range.from);
      top = node instanceof HTMLElement ? node.getBoundingClientRect().top : view.coordsAtPos(Math.min(range.from + 1, view.state.doc.content.size)).top;
    }
  } catch {
    return null;
  }
  return top - page.getBoundingClientRect().top + page.scrollTop;
}

interface MarginItem {
  id: string;
  thread: CommentThread | null;
  card?: ColumnCard;
}

function Margin({ tab, room }: { tab: string; room: boolean }): ReactNode {
  const threads = useThreads(state => state.threads);
  const active = useThreads(state => state.active);
  const composer = useCommentUi(state => state.composer);
  const activePlace = useCommentUi(state => state.activePlace);
  const holds = useCommentUi(state => (state.placed.tab === tab ? state.placed.holds : null));
  const editor = useEditor(useShallow(state => ({ view: state.view, state: state.state, tab: state.tab })));
  const ready = editor.tab === tab && !!editor.view && !!holds;
  const feeds = useMarginColumn(state => state.feeds);

  useEffect(() => {
    setColumnMode(room ? 'cards' : 'icons');
    return () => setColumnMode('off');
  }, [room]);

  const items = useMemo<MarginItem[]>(() => {
    if (!ready) return [];
    const out: MarginItem[] = [];
    for (const thread of threads) {
      const hold: Hold | undefined = holds?.[thread.id];
      if (!hold) continue;
      if (thread.status !== 'open' && thread.id !== active) continue;
      out.push({ id: thread.id, thread });
    }
    if (composer && composer.anchor.tab === tab) out.push({ id: NEW_THREAD, thread: null });
    for (const feed of Object.values(feeds)) for (const card of feed.cards) out.push({ id: card.id, thread: null, card });
    return out;
  }, [ready, threads, holds, active, composer, tab, feeds]);

  const layer = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const heights = useRef(new Map<string, number>());
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  const [markers, setMarkers] = useState<readonly MarkerRow[]>([]);
  const [tick, setTick] = useState(0);
  const placed = useRef<ReadonlySet<string>>(new Set());
  const bump = useCallback(() => setTick(value => value + 1), []);

  // The cards' heights, as they render and change.
  const observer = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(entries => {
            let changed = false;
            for (const entry of entries) {
              const id = (entry.target as HTMLElement).dataset.marginItem;
              if (!id) continue;
              const height = (entry.target as HTMLElement).offsetHeight;
              if (heights.current.get(id) !== height) {
                heights.current.set(id, height);
                changed = true;
              }
            }
            if (changed) bump();
          }),
    [bump],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);

  // One ref callback per card, kept across renders so a card is observed once.
  const refs = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const cardRef = (id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (element: HTMLDivElement | null) => {
        const before = cards.current.get(id);
        if (before && before !== element) observer?.unobserve(before);
        if (!element) {
          cards.current.delete(id);
          refs.current.delete(id);
          return;
        }
        cards.current.set(id, element);
        heights.current.set(id, element.offsetHeight);
        observer?.observe(element);
      };
      refs.current.set(id, ref);
    }
    return ref;
  };

  // The column follows the page's scroll; the page's own size changes move the words.
  useEffect(() => {
    const page = scroller();
    if (!page) return;
    const follow = () => {
      if (layer.current) layer.current.style.transform = `translateY(${-page.scrollTop}px)`;
    };
    follow();
    page.addEventListener('scroll', follow, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bump);
    resize?.observe(page);
    if (page.firstElementChild) resize?.observe(page.firstElementChild);
    window.addEventListener('resize', bump);
    return () => {
      page.removeEventListener('scroll', follow);
      resize?.disconnect();
      window.removeEventListener('resize', bump);
    };
  }, [bump, items.length > 0]);

  const commentFocus = composer && composer.anchor.tab === tab ? NEW_THREAD : active;
  const commentFocusAt = useRef({ id: null as string | null, at: 0 });
  if (commentFocus !== commentFocusAt.current.id) commentFocusAt.current = { id: commentFocus, at: Date.now() };
  const present = new Set(items.map(item => item.id));
  const fedFocus = new Set(Object.values(feeds).flatMap(feed => (feed.focus ? [feed.focus] : [])));
  // The newest wish lays the stack out; each card is open by its own feature's say.
  const focus = newestFocus(
    [[commentFocus, commentFocusAt.current.at], ...Object.values(feeds).map(feed => [feed.focus, feed.focusedAt] as const)],
    id => present.has(id),
  );

  useLayoutEffect(() => {
    const page = scroller();
    const view = editor.view;
    if (!page || !view || !ready) return;
    let fallback = 0;
    const firstBlock = view.dom.firstElementChild;
    if (firstBlock instanceof HTMLElement) fallback = firstBlock.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
    const anchored = items.map(item => {
      const range = item.card ? undefined : rangesOf(editor.state, item.id)[0];
      const top = item.card ? item.card.anchor(page) : range ? rangeTop(view, range, page) : null;
      return { id: item.id, top: top ?? fallback, height: heights.current.get(item.id) ?? 0 };
    });
    anchored.sort((a, b) => a.top - b.top);
    let next: Map<string, number>;
    const reactions = new Set(items.flatMap(item => (item.thread && isReactionThread(item.thread) ? [item.id] : [])));
    if (room) {
      next = stackCards(anchored, focus);
      setMarkers(before => (before.length ? [] : before));
    } else {
      const rows = markerRows(anchored.filter(item => item.id !== NEW_THREAD));
      const shown = anchored.find(item => item.id === focus && !reactions.has(item.id));
      next = new Map(shown ? [[shown.id, shown.top + MARKER_HEIGHT + 4]] : []);
      setMarkers(before => (JSON.stringify(before) === JSON.stringify(rows) ? before : rows));
    }
    setTops(before => (before.size === next.size && [...next].every(([id, top]) => before.get(id) === top) ? before : next));
  }, [items, editor.state, editor.view, ready, focus, tick, room]);

  // Cards placed before move to their new places; a card placed for the first time appears where it belongs.
  useEffect(() => {
    placed.current = new Set([...tops.keys()]);
  }, [tops]);

  // The column lies over the page, clear of its scrollbar (and of any panel after it); with cards to show, the page
  // leaves it room on its right.
  const column = useRef<HTMLDivElement>(null);
  const showing = items.length > 0;
  useLayoutEffect(() => {
    const page = scroller();
    const row = page?.parentElement;
    if (!page || !row || !showing) return;
    const fit = () => {
      if (!column.current) return;
      const gap = row.getBoundingClientRect().right - page.getBoundingClientRect().right;
      column.current.style.right = `${Math.max(0, gap) + page.offsetWidth - page.clientWidth}px`;
    };
    if (room) page.style.paddingRight = `${COLUMN_WIDTH}px`;
    // What lies beside the page, for how far a table may reach (tables/fit.ts).
    page.dataset.marginColumn = room ? 'rail' : 'icons';
    fit();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    resize?.observe(page);
    resize?.observe(row);
    return () => {
      resize?.disconnect();
      page.style.paddingRight = '';
      delete page.dataset.marginColumn;
    };
  }, [showing, room]);

  // With no comments the page keeps the middle of the window; the column comes in with the first one.
  if (!items.length) return null;

  const byId = new Map(items.map(item => [item.id, item]));
  const openItem = (id: string, open: boolean) => {
    const item = byId.get(id);
    if (item?.card) item.card.select(open);
    else if (item?.thread) setActive(open ? id : null);
  };
  // A marker opens the first of its cards, then the next; on its only card, open, it closes it. A reaction is pressed
  // where it shows.
  const choose = (ids: readonly string[]) => {
    const at = focus ? ids.indexOf(focus) : -1;
    const next = at !== -1 && ids.length === 1 ? null : ids[(at + 1) % ids.length]!;
    if (focus && focus !== next) openItem(focus, false);
    if (next) openItem(next, true);
  };
  const shown = room ? items : items.filter(item => tops.has(item.id) && !(item.thread && isReactionThread(item.thread)));

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement && target.scrollHeight > target.clientHeight) return;
    scroller()?.scrollBy({ top: event.deltaY, left: 0 });
  };

  return (
    <div
      ref={column}
      className={cn(
        'pointer-events-none absolute inset-y-0 right-0 w-80 max-w-full overflow-hidden [&_[data-margin-item]]:pointer-events-auto',
        room ? 'z-10' : 'z-30',
      )}
      aria-label="Comments"
      role="complementary"
      data-margin=""
      onWheel={onWheel}
    >
      <div ref={layer} className="absolute inset-x-0 top-0">
        {room ? null : markers.map(row => <Marker key={row.ids.join(' ')} row={row} items={byId} open={focus} onChoose={choose} />)}
        {shown.map(item => {
          const top = tops.get(item.id);
          const open = room ? (item.card ? fedFocus.has(item.id) : item.id === commentFocus) : item.id === focus;
          const style = { top: top ?? 0, visibility: top === undefined ? ('hidden' as const) : undefined };
          return (
            <div
              key={item.id}
              ref={cardRef(item.id)}
              data-margin-item={item.id}
              className={cn('absolute inset-x-0 px-3', placed.current.has(item.id) && 'transition-[top,transform] duration-150', open && room && '-translate-x-2')}
              style={style}
            >
              {item.card ? (
                item.card.render(open)
              ) : item.thread ? (
                <MarginCard thread={item.thread} hold={holds?.[item.id]} open={open} place={activePlace} />
              ) : (
                <NewThreadCard />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One line's marker in the gutter: its reactions as chips, then what its other cards are and how many. */
function Marker({ row, items, open, onChoose }: { row: MarkerRow; items: ReadonlyMap<string, MarginItem>; open: string | null; onChoose(ids: readonly string[]): void }): ReactNode {
  const reactions = row.ids.flatMap(id => {
    const thread = items.get(id)?.thread;
    return thread && isReactionThread(thread) ? [thread] : [];
  });
  const ids = row.ids.filter(id => !reactions.some(thread => thread.id === id));
  const comments = ids.filter(id => items.get(id)?.thread).length;
  const others = ids.reduce((sum, id) => {
    const item = items.get(id);
    return item?.thread ? sum : sum + (item?.card?.count ?? 1);
  }, 0);
  const label = [comments ? `${comments} ${comments === 1 ? 'comment' : 'comments'}` : '', others ? `${others} ${others === 1 ? 'suggestion' : 'suggestions'}` : '']
    .filter(Boolean)
    .join(', ');
  const Icon = comments ? MessageSquare : ListChecks;
  return (
    <div className="absolute right-3 flex items-center gap-1" style={{ top: row.top, height: MARKER_HEIGHT }} data-margin-marker={row.ids.join(' ')}>
      {reactions.map(thread => (
        <div key={thread.id} className="pointer-events-auto" onMouseDown={event => event.preventDefault()}>
          <ReactionChip thread={thread} open={false} onOpen={() => setActive(thread.id)} />
        </div>
      ))}
      {ids.length ? (
        <button
          type="button"
          aria-label={`${label} on this line`}
          title={`${label} on this line`}
          aria-pressed={!!open && ids.includes(open)}
          className={cn(
            'pointer-events-auto inline-flex h-full items-center gap-1 rounded-md px-1.5 text-[12px] text-chrome-muted transition-colors hover:bg-chrome-hover hover:text-chrome-fg',
            open && ids.includes(open) && 'bg-chrome-hover text-chrome-fg ring-1 ring-chrome-accent/60',
          )}
          onMouseDown={event => event.preventDefault()}
          onClick={() => onChoose(ids)}
        >
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {comments + others}
        </button>
      ) : null}
    </div>
  );
}

/** The open thread, or the new one being written, in a sheet over the foot of the page; a tap outside closes it. */
function CommentSheet({ tab }: { tab: string }): ReactNode {
  const active = useThreads(state => state.active);
  const thread = useThreads(state => (state.active ? state.threads.find(item => item.id === state.active) : undefined));
  const composer = useCommentUi(state => state.composer);
  const activePlace = useCommentUi(state => state.activePlace);
  const holds = useCommentUi(state => (state.placed.tab === tab ? state.placed.holds : null));
  const writing = !!composer && composer.anchor.tab === tab;
  const reading = !writing && !!thread && active !== NEW_THREAD && !!holds?.[thread.id];
  if (!writing && !reading) return null;
  const close = () => (writing ? cancelComposer() : setActive(null));
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" onClick={close} />
      <div
        role="dialog"
        aria-label={writing ? 'New comment' : 'Comment'}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-chrome p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-chrome-popup"
      >
        {reading && thread ? <MarginCard thread={thread} hold={holds?.[thread.id]} open place={activePlace} /> : <NewThreadCard />}
      </div>
    </>
  );
}

function MarginCard({ thread, hold, open, place }: { thread: CommentThread; hold: Hold | undefined; open: boolean; place: string | null }): ReactNode {
  const state = useEditor(editor => editor.state);
  const onOpen = () => setActive(thread.id);
  if (isReactionThread(thread)) return <ReactionChip thread={thread} open={open} onOpen={onOpen} />;
  const removable = open && liveRanges(state, thread) > 1 ? place : undefined;
  return <ThreadCard thread={thread} hold={hold} open={open} removablePlace={removable} onOpen={onOpen} />;
}
