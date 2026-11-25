/**
 * How each artifact type looks on the page, after Artifacts page: its colors, its icon, the chalk drawing
 * behind its tile, and the drawing a card shows until it has a thumbnail. Keyed by the daemon's type id; a type the page
 * has no entry for gets a neutral look.
 */
import type { CSSProperties, ReactNode } from 'react';

/** The types in the order the tiles and the Type filter show them, with design system after design. */
export const TYPE_ORDER = ['docs', 'slides', 'sheets', 'design', 'design-system', 'data', 'whiteboard', 'motion'] as const;
/** A type the page has a look for. */
export type KnownType = (typeof TYPE_ORDER)[number];
/** Whether the page has a look for a type id. */
export const isKnownType = (id: string): id is KnownType => (TYPE_ORDER as readonly string[]).includes(id);

/** Type ids in tile order: the known ones first, in {@link TYPE_ORDER}, then the rest as they came. */
export function inTypeOrder(ids: Iterable<string>): string[] {
  const list = [...new Set(ids)];
  const rank = (id: string) => (isKnownType(id) ? TYPE_ORDER.indexOf(id) : TYPE_ORDER.length + list.indexOf(id));
  return list.sort((a, b) => rank(a) - rank(b));
}

const COLORS: Record<KnownType, { wash: string; ink: string; tint: string }> = {
  docs: { wash: '#cce3fd', ink: '#1757ac', tint: '#3f8ef0' },
  slides: { wash: '#f7d9ca', ink: '#903710', tint: '#e8703a' },
  sheets: { wash: '#caecc8', ink: '#016c0f', tint: '#3d9e3a' },
  design: { wash: '#e4deff', ink: '#5437b8', tint: '#7a5cf0' },
  'design-system': { wash: '#fbe6bd', ink: '#865400', tint: '#c79a1b' },
  data: { wash: '#fbd4d4', ink: '#a42528', tint: '#e5484d' },
  whiteboard: { wash: '#fbd6e5', ink: '#902552', tint: '#d6409f' },
  motion: { wash: '#bfeee5', ink: '#006458', tint: '#14a38b' },
};
const NO_COLORS = { wash: '#ececec', ink: '#555555', tint: '#8a8a8a' };

/** The custom properties an element of one type is drawn with. */
export const typeStyle = (type: string): CSSProperties => {
  const c = isKnownType(type) ? COLORS[type] : NO_COLORS;
  return { '--oa-tint': c.tint, '--oa-wash': c.wash, '--oa-ink': c.ink } as CSSProperties;
};

export const BETA: readonly string[] = ['whiteboard', 'data', 'sheets', 'motion'];

export const svg = (size: number): CSSProperties => ({ display: 'block', width: size, height: size, flex: 'none' });

export function ArtifactsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style={svg(size)}>
      <rect x="3" y="6" width="8.5" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 6V5a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  const p = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const body = (() => {
    switch (type) {
      case 'docs':
        return (<><path d="M6 2.25h5.6c.4 0 .78.16 1.06.44l3.65 3.65c.28.28.44.66.44 1.06v7.85A2.75 2.75 0 0 1 14 18H6a2.75 2.75 0 0 1-2.75-2.75V5A2.75 2.75 0 0 1 6 2.25Z" {...p} /><path d="M12 2.4v2.85a2 2 0 0 0 2 2h2.6" {...p} /></>);
      case 'slides':
        return (<><path d="M1.25 2.75h17.5M2.75 2.75v8.75A2.25 2.25 0 0 0 5 13.75h10a2.25 2.25 0 0 0 2.25-2.25V2.75M10 13.75l-3 4M10 13.75l3 4" {...p} /></>);
      case 'sheets':
        return (<><rect x="2.25" y="2.25" width="15.5" height="15.5" rx="3" {...p} /><path d="M2.25 7.5h15.5M2.25 12.5h15.5M7 2.25v15.5" {...p} /></>);
      case 'design':
        return (<><path d="M10 2.25c-4.75 0-8.5 3.3-8.5 7.6 0 4.5 3.55 8.150 8.2 8.15 3.1 0 5.55-1.25 5.55-3.4 0-1.25-1.15-1.75-1.15-2.8 0-1.2 1.050-1.6 2.25-2.2 1.3-.65 2.15-1.5 2.15-3C18.5 3.95 14.6 2.25 10 2.25Z" {...p} /><circle cx="8" cy="6.6" r="1.35" fill="currentColor" /><circle cx="12.4" cy="6.9" r="1.35" fill="currentColor" /><circle cx="5.2" cy="10.3" r="1.35" fill="currentColor" /></>);
      case 'design-system':
        return (<><rect x="2.25" y="2.25" width="6.75" height="6.75" rx="1.75" {...p} /><circle cx="14.4" cy="5.6" r="3.4" {...p} /><circle cx="5.6" cy="14.4" r="3.4" {...p} /><rect x="11" y="11" width="6.75" height="6.75" rx="1.75" {...p} /></>);
      case 'data':
        return (<><path d="M1.75 16.25V11.5c0-.97.78-1.75 1.75-1.750H7V4c0-.97.78-1.75 1.75-1.75h2c.97 0 1.75.78 1.75 1.75v2.25h3.75c.97 0 1.75.78 1.75 1.75v8.25c0 .97-.78 1.75-1.75 1.75H3.5c-.97 0-1.75-.78-1.75-1.75Z" {...p} /><path d="M7 9.75V18M12.5 6.25V18" {...p} /></>);
      case 'whiteboard':
        return (<><path d="M11.52 8.25A5 5 0 1 0 8.25 11.52" {...p} /><rect x="8.25" y="8.25" width="10" height="10" rx="2.25" {...p} /></>);
      case 'motion':
        return (<><path d="M3.75 6.6h2M1.5 10H5M3.75 13.4h2" {...p} /><circle cx="13.75" cy="10" r="4.75" {...p} /></>);
      default:
        return <rect x="3" y="3" width="14" height="14" rx="2" {...p} />;
    }
  })();
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style={svg(size)}>
      {body}
    </svg>
  );
}

export function Doodle({ type }: { type: string }) {
  const id = `oa-chalk-${type.replace(/[^\w-]/g, '_')}`;
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const shapes = (() => {
    switch (type) {
      case 'docs':
        return <path d="M12 28c5 14 10 27 15 38 7-10 14-21 20-31 4 9 8 19 11 28M84 74c9-10 18-20 27-30 4 11 7 23 11 34 6-8 12-15 20-23" {...line} />;
      case 'slides':
        return (<><rect x="-14" y="45" width="107" height="72" rx="11" {...line} /><rect x="4" y="66" width="116" height="52" rx="11" {...line} /><path d="M17 86h55" {...line} /></>);
      case 'sheets':
        return <path d="M9 -6v94M51 -6v94M90 -6v94M-6 23h122M-6 57h122" {...line} />;
      case 'design':
        return (<><rect x="15" y="18" width="106" height="64" {...line} />{([[15, 18], [121, 18], [15, 82], [121, 82]] as const).map(([x, y]) => <rect key={`${x},${y}`} x={x - 7} y={y - 7} width="14" height="14" rx="2" {...line} />)}</>);
      case 'design-system':
        return (<><circle cx="20" cy="22" r="13" {...line} /><rect x="98" y="6" width="32" height="26" rx="6" {...line} /><rect x="8" y="66" width="34" height="28" rx="6" {...line} /><circle cx="118" cy="76" r="15" {...line} /></>);
      case 'data':
        return <path d="M38 94v20M70 81v33M101 67v47M132 48v66" {...line} strokeWidth={11} />;
      case 'whiteboard':
        return (<><rect x="-12" y="60" width="46" height="31" rx="7" {...line} /><path d="M36 81c22-3 42-12 62-36 8-10 16-19 25-25M104 25l20-6 2 26" {...line} /></>);
      case 'motion':
        return <path d="M19 44c13-4 26-5 38-4 14 1 23 13 34 15 16 3 33-5 49-4M19 68c13 1 26 3 38 5 16 3 26 13 42 14 15 1 28-6 41-7" {...line} />;
      default:
        return <path d="M18 30h50M18 52h80M18 74h36" {...line} />;
    }
  })();
  return (
    <svg className="oa-tile-doodle" viewBox="0 0 140 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={3} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={3} xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.4 -0.7" result="grain" />
        <feComposite in="rough" in2="grain" operator="in" />
      </filter>
      <g filter={`url(#${id})`}>{shapes}</g>
    </svg>
  );
}

/** A 16-unit line icon. */
export function Icon({ d, size = 16, fill }: { d: ReactNode | string; size?: number; fill?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill={fill ? 'currentColor' : 'none'} stroke={fill ? undefined : 'currentColor'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={svg(size)}>
      {typeof d === 'string' ? <path d={d} /> : d}
    </svg>
  );
}

export const ICON = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>,
  clear: 'm4.5 4.5 7 7m0-7-7 7',
  filter: 'M2.5 4.5h11M4.5 8h7M6.5 11.5h3',
  list: <><path d="M5.75 4h7.75M5.75 8h7.75M5.75 12h7.75" /><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeWidth="1.8" /></>,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  plus: 'M8 3v10M3 8h10',
  chat: 'M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.2L5.4 13.8a.3.3 0 0 1-.5-.23V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z',
  pin: 'M9.75 2.25 13.75 6.25M10.75 3.25 7 6.25 4.5 6.5 9.5 11.5 9.75 9 12.75 5.25M7 9l-4 4',
  more: <><circle cx="3.5" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12.5" cy="8" r=".6" fill="currentColor" /></>,
  rename: 'M10.5 3 13 5.5 5.5 13 2.5 13.5 3 10.5 10.5 3Z',
  link: 'M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.25-2.25a2.5 2.5 0 0 0-3.54-3.54L8.250 4.2M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.46 9a2.5 2.5 0 0 0 3.54 3.54l.75-.75',
  share: 'M8 2.5v7.5M5 5.25 8 2.5l3 2.75M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4',
  trash: 'M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4 4.25l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.75 7v4M9.25 7v4',
  info: <><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.25M8 5.25h.01" /></>,
  chevron: 'm6 3.5 4.5 4.5L6 12.5',
  tick: 'm3 8.5 3.25 3.25L13 4.75',
  people: <><circle cx="6" cy="5.5" r="2.25" /><path d="M2 13c0-2.2 1.8-3.75 4-3.75S10 10.8 10 13M10.5 3.5a2.25 2.25 0 0 1 0 4M12 9.5c1.3.45 2.25 1.75 2.25 3.5" /></>,
};

/** The card's picture of its type, with the artifact's title in it, until it has a thumbnail (or where none can be taken). */
export function Drawn({ type, title }: { type: string; title: string }) {
  const name = <div className="oa-paper-title">{title}</div>;
  switch (type) {
    case 'slides':
      return (
        <div className="oa-slide">
          {name}
          <div className="oa-line" />
        </div>
      );
    case 'motion':
      return (
        <div className="oa-film">
          <div className="oa-film-title">{title}</div>
          <svg viewBox="0 0 20 20" aria-hidden="true" style={svg(22)}>
            <path d="M7 5.5v9l7.5-4.5L7 5.5Z" fill="currentColor" />
          </svg>
          <div className="oa-film-bar" />
        </div>
      );
    case 'whiteboard':
      return (
        <div className="oa-paper">
          {name}
          <svg className="oa-flow" viewBox="0 0 120 36" aria-hidden="true">
            <rect x="1" y="3" width="30" height="15" rx="3" />
            <rect x="45" y="3" width="30" height="15" rx="3" />
            <rect x="89" y="19" width="30" height="15" rx="3" />
            <path d="M31 10.5h14M75 10.5h12a3 3 0 0 1 3 3v5.5" />
          </svg>
        </div>
      );
    case 'sheets':
      return (
        <div className="oa-paper">
          {name}
          <svg className="oa-cells" viewBox="0 0 120 48" aria-hidden="true">
            <rect className="oa-cells-head" x=".5" y=".5" width="119" height="9.5" />
            <rect className="oa-cells-pick" x="40" y="19.5" width="40" height="9.5" />
            <path d="M.5 .5h119v47H.5ZM.5 10h119M.5 19.5h119M.5 29h119M.5 38.5h119M40 .5v47M80 .5v47" />
          </svg>
        </div>
      );
    case 'design':
      return (
        <div className="oa-paper">
          {name}
          <div className="oa-boards">
            <div className="oa-board" />
            <div className="oa-board" />
          </div>
        </div>
      );
    case 'design-system':
      return (
        <div className="oa-paper">
          {name}
          <div className="oa-swatches">
            <span className="oa-swatch" />
            <span className="oa-swatch" />
            <span className="oa-swatch" />
            <span className="oa-swatch" />
          </div>
          <div className="oa-specimen">Aa</div>
        </div>
      );
    case 'data':
      return (
        <div className="oa-paper">
          {name}
          <div className="oa-kpis">
            <span className="oa-kpi" />
            <span className="oa-kpi" />
            <span className="oa-kpi" />
          </div>
          <div className="oa-bars">
            {[45, 70, 55, 90, 65, 80].map((h, i) => (
              <span key={i} className="oa-bar" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      );
    default:
      return (
        <div className="oa-paper">
          {name}
          {[92, 100, 84, 96, 70].map((w, i) => (
            <div key={i} className="oa-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      );
  }
}
