import type { ThemeMode } from '../kit/theme.tsx';
/** A font the viewer can choose for the page. */
export type ViewerFont = 'system';
export function viewerFontOf(element: Element, userAgent: string): ViewerFont {
  let chosenFont = element.getAttribute('data-viewer-font');
  return VIEWER_FONTS.find((font) => font === chosenFont) ?? defaultViewerFont(userAgent);
}
export function setChosenThemeAttribute(element: Element, theme: ThemeMode | null): void {
  if (theme === null) element.removeAttribute('data-theme-chosen');
  else element.setAttribute('data-theme-chosen', theme);
}
export function restoreChosenTheme(element: Element, getStorage: () => Storage = defaultThemeStorage): void {
  try {
    setChosenThemeAttribute(element, asThemeMode(getStorage().getItem('sheets-theme')));
  } catch {}
}
export function chooseSheetsTheme(element: Element, theme: ThemeMode | null, getStorage: () => Storage = defaultThemeStorage): void {
  setChosenThemeAttribute(element, theme);
  try {
    if (theme === null) getStorage().removeItem('sheets-theme');
    else getStorage().setItem('sheets-theme', theme);
  } catch {}
}
export const VIEWER_FONTS: readonly ViewerFont[] = ['system'];
export const VIEWER_FONT_ATTRIBUTE = 'data-viewer-font';
export const defaultViewerFont: (userAgent: string) => ViewerFont = () => 'system';
export const THEME_CHOSEN_ATTRIBUTE = 'data-theme-chosen';
export const asThemeMode = (value: string | null): ThemeMode | null => (value === 'light' || value === 'dark' ? value : null);
export const defaultThemeStorage = (): Storage => localStorage;
