/** Draws one workbook into the page; `onFailed` hears of a failure that comes after drawing began. Returns the clean-up. */
export type DrawWorkbookInPage<Workbook> = (workbook: Workbook, onFailed: (error: unknown) => void) => () => void;

/** Marks one drawing; compared by identity. */
type DrawAttempt = object;

export type PainterState = 'empty' | 'drawn' | 'failed';

export interface WorkbookPainterDeps<Workbook> {
  draw: DrawWorkbookInPage<Workbook>;
  report: (error: unknown) => void;
  onFailedLater: () => void;
}

export function createWorkbookPainter<Workbook>(deps: WorkbookPainterDeps<Workbook>) {
  let { draw, report, onFailedLater } = deps;
  let own: Workbook | null = null;
  let cleanUp = noDrawingCleanup;
  let drawing: DrawAttempt | null = null;
  let state: PainterState = 'empty';
  let drawAfresh = () => {
    cleanUp();
    cleanUp = noDrawingCleanup;
    state = 'empty';
    if (own === null) return;
    let attempt = {};
    drawing = attempt;
    try {
      cleanUp = draw(own, (error) => {
        if (drawing !== attempt) return;
        drawing = null;
        cleanUp();
        cleanUp = noDrawingCleanup;
        state = 'failed';
        report(error);
        onFailedLater();
      });
      state = 'drawn';
    } catch (error) {
      state = 'failed';
      report(error);
    }
  };
  return {
    ownIs(nextOwn: Workbook | null) {
      if (nextOwn === own) return;
      own = nextOwn;
      drawAfresh();
    },
    drawAfresh,
    state: () => state,
  };
}
export const noDrawingCleanup = () => {};

export type WorkbookPainter<Workbook> = ReturnType<typeof createWorkbookPainter<Workbook>>;
