export function readStoredSidePaneWidth(minWidth: number, maxWidth: number, getStorage: () => Storage = getLocalStorage): number | null {
  try {
    let storedWidth = Number(getStorage().getItem('sheets-side-pane-width') ?? Number.NaN);
    return storedWidth >= minWidth && storedWidth <= maxWidth ? storedWidth : null;
  } catch {
    return null;
  }
}
export function storeSidePaneWidth(width: number, getStorage: () => Storage = getLocalStorage): void {
  try {
    getStorage().setItem('sheets-side-pane-width', String(width));
  } catch {}
}
export const getLocalStorage = (): Storage => localStorage;
