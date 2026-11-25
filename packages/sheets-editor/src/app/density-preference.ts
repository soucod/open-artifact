import { DEFAULT_CELL_DENSITY, type CellDensity } from '../grid/cell-metrics-values.ts';
export function readStoredDensity(getStorage: () => Storage = defaultDensityStorage) {
  try {
    let stored = getStorage().getItem(DENSITY_STORAGE_KEY);
    return stored === 'comfortable' || stored === 'compact' ? stored : DEFAULT_CELL_DENSITY;
  } catch {
    return DEFAULT_CELL_DENSITY;
  }
}
export function storeDensity(density: CellDensity, getStorage: () => Storage = defaultDensityStorage) {
  try {
    getStorage().setItem(DENSITY_STORAGE_KEY, density);
  } catch {}
}
export const DENSITY_STORAGE_KEY = 'sheets-density';
export const defaultDensityStorage = () => localStorage;
