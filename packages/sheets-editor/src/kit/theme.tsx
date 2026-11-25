import * as React from 'react';
import { useRender } from '@base-ui/react/use-render';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cn } from './cn.ts';
import { ownerWindowOf, useCoarsePointerMedia } from './platform.ts';

export type Density = 'compact' | 'comfortable';
export type ThemeMode = 'light' | 'dark';

export const DensityContext = React.createContext<Density>('compact');
export const RootElementContext = React.createContext<HTMLElement | null>(null);
export const LocaleContext = React.createContext<string | undefined>(undefined);

export function useDensity(): Density {
  return React.useContext(DensityContext);
}

export function useLocale(): string | undefined {
  return React.useContext(LocaleContext);
}

/** The element of the nearest root, where popups portal into. */
export function useRootElement(): HTMLElement | null {
  return React.useContext(RootElementContext);
}

/** The window the nearest root lives in, which may be a frame's rather than the top one; its constructors are that window's own. */
export function useUiWindow(): Window & typeof globalThis {
  return ownerWindowOf(React.useContext(RootElementContext));
}

const readMode = (element: Element): ThemeMode => (element.getAttribute('data-mode') === 'dark' ? 'dark' : 'light');

function subscribeMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
  return () => observer.disconnect();
}

/** Light or dark, as the page root says. */
export function useThemeMode(): ThemeMode {
  return React.useSyncExternalStore(subscribeMode, () => readMode(document.documentElement), () => 'light');
}

export interface UiRootProps {
  density?: Density;
  locale?: string;
  direction?: 'ltr' | 'rtl';
  className?: string;
  /** Element to render as the root, keeping its own props. */
  render?: React.ReactElement<Record<string, unknown>>;
  children?: React.ReactNode;
}

/**
 * Scopes density and locale for the controls inside it. Touch screens always get the
 * roomier density, so targets stay large enough for a finger.
 */
export function UiRoot({ density, locale, direction, className, render, children }: UiRootProps): React.ReactElement {
  const outer = React.useContext(DensityContext);
  const outerLocale = React.useContext(LocaleContext);
  const isCoarse = useCoarsePointerMedia();
  const resolved: Density = isCoarse ? 'comfortable' : (density ?? outer);
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const holdElement = React.useCallback((node: Element | null) => setElement(node as HTMLElement | null), []);
  const rendered = useRender({
    render,
    defaultTagName: 'div',
    ref: holdElement,
    props: {
      className: cn('ui-root text-primary', className),
      'data-density': resolved,
      children,
    },
  });
  const content = direction === undefined ? rendered : <DirectionProvider direction={direction}>{rendered}</DirectionProvider>;
  return (
    <DensityContext.Provider value={resolved}>
      <LocaleContext.Provider value={locale ?? outerLocale}>
        <RootElementContext.Provider value={element}>{content}</RootElementContext.Provider>
      </LocaleContext.Provider>
    </DensityContext.Provider>
  );
}
