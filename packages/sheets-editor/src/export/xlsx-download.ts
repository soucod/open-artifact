import type { XlsxFileOutcome } from '../state/controller.ts';
import { createFileExport } from './file-export.ts';
import type { FileExport, FileExportDeps, MadeFile } from './file-export.ts';
import { zipXlsxParts } from './zip.ts';
import type { ZipCompressor } from './zip.ts';
/** Writes the workbook's xlsx file, with or without its charts, named after the title given. */
export type MakeXlsxFile = (withCharts: boolean, fileTitle: string | null) => Promise<XlsxFileOutcome>;
export interface XlsxDownload extends Pick<FileExport, 'isFileOnItsWay'> {
  offer(makeXlsx: MakeXlsxFile | null): void;
}
export function createXlsxDownload(exportDeps: FileExportDeps, compress: ZipCompressor | null): XlsxDownload {
  let { offer: offerFile, isFileOnItsWay } = createFileExport('xlsx', exportDeps);
  return {
    isFileOnItsWay,
    offer: (makeXlsx) =>
      offerFile(
        makeXlsx === null
          ? null
          : async (title): Promise<MadeFile | 'threw' | null> => {
              let made = await makeXlsx(true, title);
              if (made === null || made === 'threw') return made;
              let { filename, onSaved } = made;
              let zipped = await zipXlsxParts(made, compress);
              return {
                filename,
                data: zipped,
                onSaved: () => onSaved('downloaded', null),
              };
            },
      ),
  };
}
