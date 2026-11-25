import type { DownloadsCapability } from '@open-artifact/runtime';
import { saveFile } from '@open-artifact/editor-kit';
import type { ExportFormat, FrameChrome } from '../shell/frame-chrome.ts';
import { isNonNullObject } from '../utils/objects.ts';

export interface MadeFile {
  filename: string;
  data: ArrayBuffer | Uint8Array<ArrayBuffer>;
  onSaved?: () => void;
}

export type MakeFile = (title: string | null) => Promise<MadeFile | null | 'threw'>;

export interface FileExportDeps {
  shell: Pick<FrameChrome, 'offerExport' | 'declineExport' | 'exportIsDone'>;
  downloads: () => DownloadsCapability | null;
  report: (error: unknown) => void;
}

export interface FileExport {
  isFileOnItsWay(): boolean;
  offer(makeFile: MakeFile | null): void;
}

const MEDIA_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function createFileExport(format: ExportFormat, { shell, downloads, report }: FileExportDeps): FileExport {
  let filesOnTheirWay = 0;
  const exportFile = async (makeFile: MakeFile, request: string, title: string | null): Promise<void> => {
    filesOnTheirWay += 1;
    let onSaved: (() => void) | undefined;
    try {
      const made = await makeFile(title);
      if (made === 'threw' || made === null) {
        shell.declineExport(request);
        return;
      }
      await saveFile(downloads(), made.filename, new Blob([made.data],
 { type: MEDIA_TYPES[format] }));
      shell.exportIsDone(request);
      onSaved = made.onSaved;
    } catch (error) {
      if (!isErrorWithCode(error)) report(error);
      shell.declineExport(request);
    } finally {
      filesOnTheirWay -= 1;
    }
    try {
      onSaved?.();
    } catch (error) {
      report(error);
    }
  };
  return {
    isFileOnItsWay: () => filesOnTheirWay > 0,
    offer: (makeFile) => shell.offerExport(format, makeFile === null ? null : (request, title) => void exportFile(makeFile, request, title)),
  };
}

export interface CsvFile {
  filename: string;
  csv: string;
}

export interface CsvExport {
  isFileOnItsWay(): boolean;
  offer(makeCsv: ((title: string | null) => Promise<CsvFile | null>) | null): void;
}

export function createCsvExport(deps: FileExportDeps): CsvExport {
  const { offer, isFileOnItsWay } = createFileExport('csv', deps);
  return {
    isFileOnItsWay,
    offer: (makeCsv) =>
      offer(
        makeCsv === null
          ? null
          : async (title) => {
              const csvFile = await makeCsv(title);
              if (csvFile === null) return null;
              return { filename: csvFile.filename, data: new TextEncoder().encode(UTF8_BOM + csvFile.csv) };
            },
      ),
  };
}

export const isErrorWithCode = (error: unknown): error is { code: string } => isNonNullObject(error) && typeof error.code === 'string';

export const UTF8_BOM = '﻿';
