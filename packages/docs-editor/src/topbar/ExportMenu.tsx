/** The top bar's Export menu: Word, PDF (Letter or A4), Markdown or HTML, of the open tab or the whole doc. */
import { ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator, ChromeSubmenu } from '@open-artifact/editor-kit/react';
import type { DocExportFormat } from '@open-artifact/runtime/doc-api';
import { Download } from 'lucide-react';
import { type ReactNode } from 'react';
import { maybeSession } from '../app/session.ts';
import { useDocs } from '../app/store.ts';
import { type ExportChoice, exportDoc, exportKey, mayExportDoc } from './export.ts';
import { FORMAT_NAMES, defaultPaper } from './words.ts';
import { useTopBar } from './store.ts';

const DESCRIBED: Record<DocExportFormat, string> = {
  docx: 'as a Word document',
  pdf: 'as a PDF to read or print',
  markdown: 'as plain text',
  html: 'as a web page',
};

const FILE_LABEL: Record<DocExportFormat, string> = { docx: 'Word (.docx)', pdf: 'PDF (.pdf)', markdown: 'Markdown (.md)', html: 'HTML (.html)' };

function Item({ choice, label, description }: { choice: ExportChoice; label: string; description?: string }): ReactNode {
  const exporting = useTopBar(state => state.exporting);
  const busy = exporting === exportKey(choice);
  return (
    <ChromeMenuItem disabled={exporting !== null} description={description} onSelect={() => void exportDoc(choice)}>
      {busy ? `Exporting to ${FORMAT_NAMES[choice.format]}…` : label}
    </ChromeMenuItem>
  );
}

function Formats({ scope, several }: { scope: ExportChoice['scope']; several: boolean }): ReactNode {
  const whose = scope === 'tab' ? 'This tab' : several ? 'Every tab' : 'The document';
  const paper = defaultPaper();
  return (
    <>
      <Item choice={{ format: 'docx', scope }} label={FILE_LABEL.docx} description={`${whose} ${DESCRIBED.docx}`} />
      <ChromeSubmenu label={FILE_LABEL.pdf}>
        <Item choice={{ format: 'pdf', scope, paper: 'letter' }} label={paper === 'letter' ? 'Letter (default)' : 'Letter'} description="8.5 × 11 in" />
        <Item choice={{ format: 'pdf', scope, paper: 'a4' }} label={paper === 'a4' ? 'A4 (default)' : 'A4'} description="210 × 297 mm" />
      </ChromeSubmenu>
      <Item choice={{ format: 'markdown', scope }} label={FILE_LABEL.markdown} description={`${whose} ${DESCRIBED.markdown}`} />
      <Item choice={{ format: 'html', scope }} label={FILE_LABEL.html} description={`${whose} ${DESCRIBED.html}`} />
    </>
  );
}

export function ExportMenu(): ReactNode {
  const ready = useDocs(state => state.phase.kind === 'ready');
  const tabs = useDocs(state => state.project?.files.length ?? 0);
  if (!ready || !maybeSession() || !mayExportDoc()) return null;
  return (
    <ChromeMenu
      align="end"
      tip={{ label: 'Export' }}
      trigger={
        <ChromeButton square aria-label="Export">
          <Download className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      {tabs > 1 ? (
        <>
          <ChromeMenuLabel>This tab</ChromeMenuLabel>
          <Formats scope="tab" several />
          <ChromeMenuSeparator />
          <ChromeMenuLabel>Whole document</ChromeMenuLabel>
          <Formats scope="doc" several />
        </>
      ) : (
        <Formats scope="doc" several={false} />
      )}
    </ChromeMenu>
  );
}
