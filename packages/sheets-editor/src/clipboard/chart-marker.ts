import type { SheetId } from '@open-artifact/sheets-core';

/** A chart of a sheet, as put on the clipboard. */
export interface ChartOfSheet {
  sheetId: SheetId;
  placementId: string;
}

/**
 * Reads the chart a copy put on the clipboard: `'ofAnotherSheet'` where it was copied from another workbook
 * (or this one's key is not known), `null` where the marker cannot be read.
 */
export function decodeChartFromClipboard(markerText: string, ofSheet: string | null): ChartOfSheet | 'ofAnotherSheet' | null {
  if (markerText === '' || markerText.length > MOST_CHART_MARKER_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(markerText);
  } catch {
    return null;
  }
  const entries = new Map<string, unknown>(typeof parsed === 'object' && parsed !== null ? Object.entries(parsed) : []);
  const [sheetId, placementId] = [entries.get('sheetId'), entries.get('placementId')];
  if (typeof sheetId !== 'string' || typeof placementId !== 'string') return null;
  return ofSheet !== null && entries.get('ofSheet') === ofSheet
    ? {
        sheetId,
        placementId,
      }
    : 'ofAnotherSheet';
}
export const encodeChartForClipboard = ({ sheetId, placementId }: ChartOfSheet, ofSheet: string): string =>
  JSON.stringify({
    ofSheet,
    sheetId,
    placementId,
  });
export const MOST_CHART_MARKER_LENGTH = 1000;
