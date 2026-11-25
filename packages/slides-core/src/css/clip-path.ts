import { LIMITS } from '../limits.ts';
import { ok, reject, splitTopLevel, type ParseResult } from './values.ts';

interface Coordinate {
  percent: number;
  px: number;
}

export interface ClipPolygon {
  rule: 'nonzero' | 'evenodd';
  points: Array<[Coordinate, Coordinate]>;
}

const NUMBER = String.raw`[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?`;
const LENGTH = new RegExp(`^(${NUMBER})(px|%)?$`);
const CALC = new RegExp(`^calc\\(\\s*(${NUMBER})(px|%)\\s+([+-])\\s+(${NUMBER})(px|%)\\s*\\)$`);
const valid = (value: number): boolean => Math.abs(value) <= Number.MAX_SAFE_INTEGER;

function coordinate(text: string): Coordinate | undefined {
  const length = LENGTH.exec(text);
  if (length) {
    const value = Number(length[1]);
    if (!valid(value) || (!length[2] && value !== 0)) return undefined;
    return length[2] === '%' ? { percent: value, px: 0 } : { percent: 0, px: value };
  }
  const calc = CALC.exec(text);
  if (!calc || calc[2] === calc[5]) return undefined;
  const first = Number(calc[1]);
  const second = Number(calc[4]) * (calc[3] === '-' ? -1 : 1);
  if (!valid(first) || !valid(second)) return undefined;
  return calc[2] === '%' ? { percent: first, px: second } : { percent: second, px: first };
}

/** Why a clip-path other than a border-box polygon is refused, and what to write instead. */
function refusal(value: string): string {
  const box = /(?:^|\s)((?:padding|content|margin|fill|stroke|view)-box)(?:\s|$)/.exec(value)?.[1];
  if (box) return `clip-path polygons are relative to the border box; drop ${box}`;
  const shape = /^(?:border-box\s+)?([a-z-]+)\(/.exec(value)?.[1];
  if (shape === 'inset' || shape === 'circle' || shape === 'ellipse') {
    return `clip-path ${shape}() is not supported; use border-radius, or write the outline as polygon(...)`;
  }
  return 'clip-path takes none or polygon(...); draw other outlines in an <svg>';
}

/** The supported clip path grammar, relative to the element's border box. */
export function parseClipPath(raw: string): ParseResult<ClipPolygon | null> {
  const value = raw.trim().toLowerCase();
  if (value === 'none') return ok(null);
  // The reference box may stand on either side of the shape; border-box is the default.
  const match = /^polygon\(([\s\S]*)\)(?:\s+border-box)?$/.exec(value) ?? /^border-box\s+polygon\(([\s\S]*)\)$/.exec(value);
  if (!match) return reject(refusal(value));
  const parts = splitTopLevel(match[1]!, ',');
  const rule = parts[0] === 'evenodd' ? 'evenodd' : 'nonzero';
  if (parts[0] === 'evenodd' || parts[0] === 'nonzero') parts.shift();
  if (parts.length < 3 || parts.length > LIMITS.polygonVertices) {
    return reject(`clip-path polygon needs 3–${LIMITS.polygonVertices} vertices`);
  }
  const points: ClipPolygon['points'] = [];
  for (const part of parts) {
    const pair = splitTopLevel(part, 'space');
    const x = pair.length === 2 ? coordinate(pair[0]!) : undefined;
    const y = pair.length === 2 ? coordinate(pair[1]!) : undefined;
    if (!x || !y) return reject('clip-path polygon vertices need x and y in px, %, or calc(N% ± Npx)');
    points.push([x, y]);
  }
  return ok({ rule, points });
}

function formatCoordinate({ percent, px }: Coordinate): string {
  if (!percent) return px ? `${px}px` : '0';
  const relative = `${percent}%`;
  return px ? `calc(${relative} ${px < 0 ? '-' : '+'} ${Math.abs(px)}px)` : relative;
}

export function formatClipPath(polygon: ClipPolygon | null): string {
  if (!polygon) return 'none';
  const points = polygon.points.map(([x, y]) => `${formatCoordinate(x)} ${formatCoordinate(y)}`).join(', ');
  return `polygon(${polygon.rule === 'evenodd' ? 'evenodd, ' : ''}${points})`;
}

/** The same vertices in local px for a laid-out element. */
export function clipPathPoints(polygon: ClipPolygon, width: number, height: number): Array<[number, number]> {
  return polygon.points.map(([x, y]) => [width * (x.percent / 100) + x.px, height * (y.percent / 100) + y.px]);
}
