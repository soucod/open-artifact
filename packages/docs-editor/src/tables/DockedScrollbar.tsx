/**
 * A scrollbar held at the foot of the window for a table too wide for the page whose own scrollbar is below the
 * window ({@link dockFor}). It lies over the part of the table in sight; the two scroll together, whichever is moved.
 */
import { type ReactNode, type UIEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../editor/format.ts';
import { type DockPlace, type ScrollingTable, dockFor, samePlace } from './dock.ts';

const BAR_HEIGHT = 12;

interface Docked {
  place: DockPlace;
  /** Left and top of the bar in the box the floating views are drawn in. */
  left: number;
  top: number;
}

function scrollingTable(wrapper: HTMLElement): ScrollingTable {
  const box = wrapper.getBoundingClientRect();
  const style = getComputedStyle(wrapper);
  const inner = box.left + wrapper.clientLeft;
  return {
    box,
    shownLeft: inner + (Number.parseFloat(style.paddingLeft) || 0),
    shownRight: inner + wrapper.clientWidth - (Number.parseFloat(style.paddingRight) || 0),
    overflow: wrapper.scrollWidth - wrapper.clientWidth,
  };
}

export function DockedScrollbar(): ReactNode {
  const view = useEditor(hold => hold.view);
  const doc = useEditor(hold => hold.state?.doc);
  const [docked, setDocked] = useState<Docked | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLElement | null>(null);
  const remeasure = useRef<() => void>(() => {});

  useEffect(() => {
    const scroller = view?.dom.closest<HTMLElement>('[data-doc-scroll]');
    const frame = scroller?.parentElement;
    if (!view || !scroller || !frame) return undefined;
    let raf = 0;
    const sized = new Set<Element>();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => later());
    const measure = () => {
      raf = 0;
      const wrappers = [...view.dom.querySelectorAll<HTMLElement>('.tableWrapper')];
      const tables = new Set(wrappers.flatMap(wrapper => [...wrapper.querySelectorAll(':scope > table')]));
      for (const each of sized) if (!tables.has(each)) resize?.unobserve(each);
      for (const each of tables) if (!sized.has(each)) resize?.observe(each);
      sized.clear();
      for (const each of tables) sized.add(each);

      const port = scroller.getBoundingClientRect();
      const top = port.top + scroller.clientTop;
      const left = port.left + scroller.clientLeft;
      const sight = { top, left, bottom: top + scroller.clientHeight, right: left + scroller.clientWidth };
      const place = view.dom.isConnected ? dockFor(wrappers.map(scrollingTable), sight, BAR_HEIGHT) : null;
      table.current = place ? wrappers[place.index]! : null;
      const outer = frame.getBoundingClientRect();
      const next = place ? { place, left: place.left - outer.left, top: sight.bottom - outer.top - BAR_HEIGHT } : null;
      setDocked(before =>
        samePlace(before?.place ?? null, next?.place ?? null) && Math.abs((before?.top ?? 0) - (next?.top ?? 0)) < 0.5 && Math.abs((before?.left ?? 0) - (next?.left ?? 0)) < 0.5
          ? before
          : next,
      );
      if (table.current && bar.current && Math.abs(bar.current.scrollLeft - table.current.scrollLeft) > 0.5) bar.current.scrollLeft = table.current.scrollLeft;
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    // Scroll events don't bubble, but one listener capturing on the page hears the page's and every table's.
    const onScroll = (event: Event) => {
      const wrapper = table.current;
      if (wrapper && event.target === wrapper && bar.current && Math.abs(bar.current.scrollLeft - wrapper.scrollLeft) > 0.5) bar.current.scrollLeft = wrapper.scrollLeft;
      later();
    };
    scroller.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', later);
    resize?.observe(scroller);
    resize?.observe(view.dom);
    remeasure.current = later;
    later();
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', later);
      resize?.disconnect();
      remeasure.current = () => {};
      table.current = null;
      setDocked(null);
    };
  }, [view]);

  useEffect(() => remeasure.current(), [doc]);

  // A bar that comes (or moves to another table) starts where its table is.
  useLayoutEffect(() => {
    if (bar.current && table.current) bar.current.scrollLeft = table.current.scrollLeft;
  }, [docked?.place.index, docked?.place.track]);

  if (!docked) return null;
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const wrapper = table.current;
    const at = event.currentTarget.scrollLeft;
    if (wrapper && Math.abs(wrapper.scrollLeft - at) > 0.5) wrapper.scrollLeft = at;
  };
  return (
    <div
      ref={bar}
      className="doc-table-dock absolute z-20 overflow-x-scroll overflow-y-hidden bg-page/85"
      style={{ left: docked.left, top: docked.top, width: docked.place.width, height: BAR_HEIGHT }}
      tabIndex={-1}
      aria-hidden="true"
      data-table-dock=""
      onScroll={onScroll}
    >
      <div style={{ width: docked.place.track, height: 1 }} />
    </div>
  );
}
