/**
 * What an interactive's code is handed: `sheet` with its <sheet.Visualize>, React that makes only the elements an
 * interactive may hold, and the parts of the design system it may use. Nothing here touches the document.
 */
import * as React from 'react';
import type { ChartFrameFault } from '../charts/frame-messages.ts';
import { ChartFault, isObject } from '../chart-frame/chart-runtime.ts';
import { rowsOfSource, type WhatTheCodeIsTold } from './cells.ts';
import { checkTypeOfInteractive, propsOfInteractive } from './elements.ts';

export type InteractiveFault = Extract<ChartFrameFault, 'notAModule' | 'threw' | 'inputMissing' | 'tooManyRows' | 'notDrawnInSheets'>;

export const faultOf = (error: unknown): InteractiveFault =>
  error instanceof ChartFault ? error.fault : error instanceof ReferenceError ? 'notDrawnInSheets' : 'threw';

export const notDrawnInSheets = (): never => {
  throw new ChartFault('notDrawnInSheets');
};

export const ToldContext = React.createContext<WhatTheCodeIsTold | null>(null);

/** <sheet.Visualize>: its one child, a function of its sources, drawn with them. */
export function Visualize({ sources, definition, children }: { sources?: unknown; definition?: unknown; children?: unknown }): React.ReactNode {
  const told = React.useContext(ToldContext);
  if (told === null || definition !== undefined || typeof children !== 'function' || !isObject(sources)) throw new ChartFault('notDrawnInSheets');
  const rows: Record<string, readonly unknown[]> = {};
  for (const [name, source] of Object.entries(sources)) rows[name] = rowsOfSource(name, source, told);
  const drawn: unknown = children(rows);
  if (!isDrawable(drawn)) throw new TypeError('<sheet.Visualize> draws elements, texts and numbers');
  return drawn;
}

const isDrawable = (value: unknown): value is React.ReactNode =>
  value === null || value === undefined || typeof value !== 'object' || React.isValidElement(value) || Array.isArray(value);

/** The parts of the design system an interactive may use; each of the others ends it. */
export interface DesignSystemOfInteractive {
  Tooltip: React.ElementType;
  Button: React.ElementType;
  Menu: Readonly<Record<string, React.ElementType>>;
  Popover: Readonly<Record<string, React.ElementType>>;
}

export interface CodeOfInteractiveIsHanded {
  sheet: { Visualize: typeof Visualize; Embed: () => never };
  react: object;
  designSystem: object;
}

/** What the code is handed as React: React itself, but making only the elements an interactive may hold. */
export function handedToCode(parts: DesignSystemOfInteractive): CodeOfInteractiveIsHanded {
  const designSystem = {
    ...parts,
    Dialog: notDrawnInSheets,
    Combobox: notDrawnInSheets,
    useToast: notDrawnInSheets,
  };
  const ownParts = new Set<unknown>([React.Fragment, Visualize, parts.Tooltip, parts.Button, ...Object.values(parts.Menu), ...Object.values(parts.Popover)]);
  const memos = new WeakSet<object>();
  const isOwn = (type: unknown): boolean => typeof type === 'function' || ownParts.has(type) || (isObject(type) && memos.has(type));
  const createElement = (type: unknown, props: unknown, ...children: unknown[]): React.ReactElement => {
    checkTypeOfInteractive(type, isOwn);
    const given = typeof type === 'string' ? propsOfInteractive(type, props) : isObject(props) ? props : null;
    return Reflect.apply(React.createElement, React, [type, given, ...children]);
  };
  const memo = (component: unknown): unknown => {
    const made: unknown = Reflect.apply(React.memo, React, [component]);
    if (isObject(made)) memos.add(made);
    return made;
  };
  return {
    sheet: Object.freeze({ Visualize, Embed: notDrawnInSheets }),
    react: { ...React, createElement, memo, createPortal: notDrawnInSheets },
    designSystem,
  };
}

/** Runs the module's `init` with what the code is handed: the component it gives, or the fault it ends with. */
export function componentOfCode(init: unknown, handed: CodeOfInteractiveIsHanded): React.ComponentType | InteractiveFault {
  if (typeof init !== 'function') return 'notAModule';
  let component: unknown;
  try {
    component = Reflect.apply(init, undefined, [handed.sheet, handed.react, handed.react, handed.designSystem]);
  } catch (error) {
    return faultOf(error);
  }
  return isComponent(component) ? component : 'notAModule';
}

const isComponent = (value: unknown): value is React.ComponentType => typeof value === 'function';
