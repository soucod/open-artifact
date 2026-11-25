/**
 * Errors of the artboards on this page:
 *
 * - "N errors" at the top right opens the list of artboards with errors and
 *   "Ask agent to fix" for all of them;
 * - a notice under each artboard with errors (at the foot of the focused
 *   view for its artboard) asks for that one, or closes;
 * - a closed notice leaves a warning mark in the artboard's name strip,
 *   which brings it back. A closed notice comes back by itself when the
 *   artboard's errors change.
 */

import { Copy, TriangleAlert, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react';
import { boardsOnPage, type Canvas } from '@open-artifact/design-core';
import { writeClipboardText } from '@open-artifact/editor-kit';
import { ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, Tip } from '@open-artifact/editor-kit/react';
import { cn, toast } from '@open-artifact/ui';
import { boardProblems, closeNotice, errorCount, errorsLabel, reopenNotice, type BoardProblem } from '../lib/board-errors.ts';
import { askAgentToFix, problemsKey } from '../services/agent.ts';
import { session } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';

/** An artboard's name as the canvas shows it. */
export function boardTitle(canvas: Canvas, path: string): string {
  return canvas.boards[path]?.title || path.replace(/\.dc\.html$/, '');
}

/** The artboards with errors among `paths` (default: the current page's). */
export function useBoardProblems(paths?: readonly string[]): BoardProblem[] {
  const canvas = useDocument((s) => s.canvas);
  const page = useView((s) => s.page);
  const frames = useView((s) => s.frames);
  return useMemo(
    () => boardProblems(paths ?? boardsOnPage(canvas, page), (path) => frames[path]?.errors, (path) => boardTitle(canvas, path)),
    [paths, canvas, page, frames],
  );
}

/** Whether this viewer can ask the agent: the owner, with an agent, on an editable canvas. */
export function useCanAskAgent(): boolean {
  const readOnly = useDocument((s) => s.readOnly);
  return !readOnly && Boolean(session().agent) && session().viewer.role === 'owner';
}

const stop = (event: SyntheticEvent): void => event.stopPropagation();

/** After a key press closed a notice or brought it back, focus what took its place. */
function refocus(event: MouseEvent, selector: string): void {
  if (event.detail !== 0) return;
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  });
}

const noticeButton = (path: string) => `[data-error-notice="${CSS.escape(path)}"] button`;
const markButton = (path: string) => `[data-error-mark="${CSS.escape(path)}"]`;

/* ------------------------------- the list -------------------------------- */

/** "N errors" and the list it opens; nothing while no artboard on the page has errors. */
export function ErrorsList() {
  const problems = useBoardProblems();
  const open = useView((s) => s.errorsOpen);
  const unsent = useView((s) => s.unsentFix);
  const canAsk = useCanAskAgent();
  const empty = problems.length === 0;

  useEffect(() => {
    if (empty) useView.getState().setErrorsOpen(false);
  }, [empty]);

  if (empty) return null;
  const count = errorCount(problems);
  const request = unsent?.key === problemsKey(problems) ? unsent.text : null;
  const guest = session().viewer.role !== 'owner';
  const boards = `${problems.length} ${problems.length === 1 ? 'artboard' : 'artboards'}`;
  return (
    <>
      <ChromeMenu
        align="end"
        open={open}
        onOpenChange={(next) => useView.getState().setErrorsOpen(next)}
        className="w-80 max-w-[calc(100vw-24px)]"
        tip={{ label: `Show errors on ${boards}` }}
        trigger={
          <ChromeButton className="mx-0.5 gap-1.5 pl-1.5 pr-2" aria-label={`${errorsLabel(count)} on ${boards}`}>
            <TriangleAlert className="size-4 text-danger" strokeWidth={1.75} />
            <span>{errorsLabel(count)}</span>
          </ChromeButton>
        }
      >
        <div className="px-2.5 pb-2 pt-1.5 whitespace-normal">
          <div className="font-medium">Artboards with errors</div>
          <ul className="m-0 mt-1 flex max-h-64 list-none flex-col gap-1.5 overflow-y-auto p-0">
            {problems.map((problem) => (
              <li key={problem.path}>
                <div className="break-words">{problem.title}</div>
                {problem.errors.map((error, index) => (
                  <div key={index} className="select-text break-words font-mono text-[11px] leading-snug text-chrome-muted">
                    {error.message}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {guest ? <p className="m-0 mt-2 text-[13px] text-chrome-muted">The owner of this canvas can ask the agent to fix them.</p> : null}
          {request ? (
            <div className="mt-2">
              <p className="m-0 text-[12px] leading-4 text-chrome-muted">The agent could not be reached. Copy this request and paste it into its conversation:</p>
              <pre className="m-0 mt-1 max-h-32 select-text overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-chrome-hover p-2 font-mono text-[11px] leading-snug text-chrome-muted">
                {request}
              </pre>
            </div>
          ) : null}
        </div>
        {canAsk || request ? <ChromeMenuSeparator /> : null}
        {request ? (
          <ChromeMenuItem icon={<Copy className="size-4" />} onSelect={() => void copyRequest(request)}>
            Copy the request
          </ChromeMenuItem>
        ) : null}
        {canAsk ? (
          <ChromeMenuItem icon={<Wand2 className="size-4" />} onSelect={() => void askAgentToFix(problems)}>
            Ask agent to fix
          </ChromeMenuItem>
        ) : null}
      </ChromeMenu>
      <ChromeDivider />
    </>
  );
}

async function copyRequest(text: string): Promise<void> {
  try {
    await writeClipboardText(text, session().shell);
    toast.add({ title: 'Copied the request' });
  } catch {
    toast.add({ title: 'Couldn’t copy the request', description: 'Select it in the list and copy it.' });
  }
}

/* ------------------------------- a notice -------------------------------- */

export interface ErrorNoticeProps {
  problem: BoardProblem;
  canAsk: boolean;
  /** Opens the list of artboards with errors (none: the warning sign only shows the first message). */
  onShowAll?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * One artboard's errors: the warning sign, how many, "Ask agent to fix" and
 * close. It sizes itself to its box: in a narrow one the count, then the
 * button, then the close button give way.
 */
export function ErrorNotice({ problem, canAsk, onShowAll, className, style }: ErrorNoticeProps) {
  const sending = useRef(false);
  const first = problem.errors[0]?.message ?? '';
  const ask = async (): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    try {
      await askAgentToFix([problem]);
    } finally {
      sending.current = false;
    }
  };
  const close = (event: MouseEvent): void => {
    const view = useView.getState();
    view.setClosedNotices(closeNotice(view.closedNotices, problem));
    refocus(event, markButton(problem.path));
  };
  const sign = <TriangleAlert className="size-4" strokeWidth={1.75} />;
  return (
    <div data-error-notice={problem.path} className={cn('@container/notice pointer-events-none flex', className)} style={style}>
      <div
        role="group"
        aria-label={`Errors on artboard ${problem.title}`}
        className="pointer-events-auto inline-flex h-[34px] max-w-full select-none items-center gap-1 rounded-[12px] bg-chrome px-[3px] text-[13px] text-chrome-fg shadow-chrome"
        onPointerDown={stop}
        onClick={stop}
        onDoubleClick={stop}
      >
        {onShowAll ? (
          <Tip label={first}>
            <ChromeButton square aria-label="Show all artboards with errors" className="text-danger hover:text-danger" onClick={onShowAll}>
              {sign}
            </ChromeButton>
          </Tip>
        ) : (
          <Tip label={first}>
            <span className="flex size-7 shrink-0 items-center justify-center text-danger">{sign}</span>
          </Tip>
        )}
        <span className="whitespace-nowrap pr-1 @max-[14rem]/notice:hidden">{errorsLabel(problem.errors.length)}</span>
        {canAsk ? (
          <ChromeButton className="h-6 rounded-[6px] bg-chrome-hover px-2 text-[13px] @max-[10.5rem]/notice:hidden" onClick={() => void ask()}>
            Ask agent to fix
          </ChromeButton>
        ) : null}
        <Tip label="Dismiss">
          <ChromeButton square aria-label={`Dismiss error notice on artboard ${problem.title}`} className="text-chrome-muted @max-[4rem]/notice:hidden" onClick={close}>
            <X className="size-4" strokeWidth={1.75} />
          </ChromeButton>
        </Tip>
      </div>
    </div>
  );
}

/* --------------------------------- a mark --------------------------------- */

/** The warning mark a closed notice leaves in its artboard's name strip; it brings the notice back. */
export function ErrorMark({ problem }: { problem: BoardProblem }) {
  const reopen = (event: MouseEvent): void => {
    event.stopPropagation();
    const view = useView.getState();
    view.setClosedNotices(reopenNotice(view.closedNotices, problem.path));
    refocus(event, noticeButton(problem.path));
  };
  return (
    <Tip label={problem.errors[0]?.message ?? ''}>
      <button
        type="button"
        data-error-mark={problem.path}
        aria-label={`Show error notice on artboard ${problem.title}`}
        onPointerDown={stop}
        onClick={reopen}
        className="flex size-4 shrink-0 items-center justify-center rounded text-danger hover:bg-hover"
      >
        <TriangleAlert className="size-3" />
      </button>
    </Tip>
  );
}
