import { fetchAssetWithRetry, reportErrorSoftly, type AssetFetcher } from '../engine/loader.ts';
/** The page a chart is drawn in: its text once fetched, null while on its way, or 'notFetched' when it could not be. */
export type ChartFrameDocument = { text: string } | 'notFetched' | null;
export interface ChartFrameDocumentSource {
  now(): ChartFrameDocument;
  follow(listener: () => void): () => void;
  askAgainIfItDidNotCome(): void;
}
export function forbidFramesInDocument(pageDocument: Document) {
  const meta = {
    httpEquiv: 'Content-Security-Policy',
    content: "frame-src 'none'",
  };
  pageDocument.head.append(Object.assign(pageDocument.createElement('meta'), meta));
}
export function createChartFrameDocumentSource(fetcher?: AssetFetcher, filename: string = CHART_FRAME_FILE): ChartFrameDocumentSource {
  let documentNow: ChartFrameDocument = null;
  let isFetching = false;
  const listeners = new Set<() => void>();
  const setDocument = (next: ChartFrameDocument) => {
    documentNow = next;
    for (const listener of listeners) listener();
  };
  const fetchDocument = async (): Promise<void> => {
    if (isFetching) return;
    isFetching = true;
    setDocument(null);
    try {
      setDocument({
        text: new TextDecoder().decode(await fetchAssetWithRetry(filename, fetcher)),
      });
    } catch (error) {
      reportErrorSoftly(error, 'charts');
      isFetching = false;
      setDocument('notFetched');
    }
  };
  return {
    now: () => documentNow,
    follow(listener) {
      listeners.add(listener);
      fetchDocument();
      return () => void listeners.delete(listener);
    },
    askAgainIfItDidNotCome() {
      if (documentNow === 'notFetched') fetchDocument();
    },
  };
}
export const CHART_FRAME_FILE = 'chart-frame.txt';
export const INTERACTIVE_FRAME_FILE = 'interactive-frame.txt';
