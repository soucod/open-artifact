import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { asThemeMode, VIEWER_FONT_ATTRIBUTE } from '../shell/root-theme.ts';
import { useDocumentElementAttribute } from '../dom/use-document-element-attribute.ts';
import { holdFocusLeftChecksForATick } from '../grid/focus-left.ts';
import type { ChartInputs, FrameToPage, PageToFrame, PointAt } from '../chart-frame/messages.ts';
import { parseChartFrameReply, CHART_FRAME_PORT_MESSAGE, pressedAtMessage, type ChartFrameFault } from './frame-messages.ts';
/** What a chart's frame is told of the pointer: where it is over the chart, and where it pressed. */
export interface PointerToChartFrame {
  isAt: (at: PointAt | null) => void;
  hasPressedAt: (at: PointAt) => void;
}
/** Tells what a chart's frame answered, with the inputs it was drawing then. */
export type ChartFrameTold = (outcome: FrameToPage, inputsOfOutcome: ChartInputs) => void;
interface ChartFrameProps {
  frameDocument: string;
  artifact: string;
  inputs: ChartInputs;
  name: string;
  isOnShow: boolean;
  tellsOfPointer: React.Ref<PointerToChartFrame>;
  onTold: ChartFrameTold;
  onLeaving: () => void;
  onCaretTaken: () => void;
}
export function ChartFrame({
  frameDocument,
  artifact,
  inputs,
  name,
  isOnShow,
  tellsOfPointer,
  onTold,
  onLeaving,
  onCaretTaken,
}: ChartFrameProps) {
  let [theme, viewerFont] = [asThemeMode(useDocumentElementAttribute('data-mode')), useDocumentElementAttribute(VIEWER_FONT_ATTRIBUTE)];
  let look = React.useMemo(
    () => ({
      theme,
      viewerFont,
    }),
    [theme, viewerFont],
  );
  let portRef = React.useRef<MessagePort | null>(null);
  let wasLoadedRef = React.useRef(false);
  let frameRef = React.useRef<HTMLIFrameElement>(null);
  let isWindowBlurringRef = React.useRef(false);
  let finishLeavingRef = React.useRef<(() => void) | null>(null);
  let tellTold = React.useEffectEvent(onTold);
  let tellLeaving = React.useEffectEvent(onLeaving);
  let post = React.useCallback((message: PageToFrame) => portRef.current?.postMessage(message), []);
  let currentInputs = React.useEffectEvent(() => inputs);
  let closePort = React.useEffectEvent((outcome: FrameToPage | null, inputsOfOutcome: ChartInputs = inputs) => {
    if (portRef.current === null) return;
    portRef.current.close();
    portRef.current = null;
    if (outcome !== null) ReactDOM.flushSync(() => tellTold(outcome, inputsOfOutcome));
  });
  let drawMessage = React.useEffectEvent(
    (): PageToFrame => ({
      kind: 'draw',
      artifact,
      inputs,
      look,
    }),
  );
  let checkCaretTaken = React.useEffectEvent(() => {
    if (frameRef.current === null || frameRef.current.ownerDocument.activeElement !== frameRef.current) return false;
    holdFocusLeftChecksForATick();
    closePort({
      kind: 'failed',
      fault: 'tookCaret',
    });
    if (isWindowBlurringRef.current) onCaretTaken();
    return true;
  });
  let leave = (fault: ChartFrameFault, inputsOfOutcome: ChartInputs = currentInputs()) => {
    if (checkCaretTaken() || portRef.current === null || finishLeavingRef.current !== null) return;
    let caretWatch = setInterval(() => checkCaretTaken() && clearInterval(caretWatch), CHART_FRAME_CARET_CHECK_MS);
    let finish = (finalFault: ChartFrameFault) => {
      clearInterval(caretWatch);
      if (!checkCaretTaken())
        closePort(
          {
            kind: 'failed',
            fault: finalFault,
          },
          inputsOfOutcome,
        );
    };
    setTimeout(() => finish('tookCaret'), CHART_FRAME_LEAVE_TIMEOUT_MS * (1 + Math.random()));
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    finishLeavingRef.current = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => finish(fault), CHART_FRAME_CARET_CHECK_MS);
    };
    post({
      kind: 'leave',
    });
    tellLeaving();
  };
  let connect = (frame: HTMLIFrameElement) => {
    if (wasLoadedRef.current) {
      leave('threw');
      return finishLeavingRef.current?.();
    }
    wasLoadedRef.current = true;
    let { port1: port, port2: framePort } = new MessageChannel();
    portRef.current = port;
    let replyTimer = setTimeout(() => portRef.current === port && leave('threw'), CHART_FRAME_REPLY_TIMEOUT_MS);
    port.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
      let reply = parseChartFrameReply(data);
      if (reply === null || portRef.current !== port) return;
      clearTimeout(replyTimer);
      if (checkCaretTaken() || finishLeavingRef.current !== null) return;
      let inputsNow = currentInputs();
      if (reply.kind === 'drawn') return tellTold(reply, inputsNow);
      return leave(reply.fault, inputsNow);
    });
    port.start();
    frame.contentWindow?.postMessage(CHART_FRAME_PORT_MESSAGE, '*', [framePort]);
    return post(drawMessage());
  };
  React.useEffect(() => () => closePort(null), []);
  React.useEffect(() => {
    let frameWindow = frameRef.current?.ownerDocument.defaultView;
    let onBlur = () => {
      isWindowBlurringRef.current = true;
      checkCaretTaken();
      frameWindow?.setTimeout(() => {
        checkCaretTaken();
        isWindowBlurringRef.current = false;
      });
    };
    frameWindow?.addEventListener('blur', onBlur);
    return () => frameWindow?.removeEventListener('blur', onBlur);
  }, []);
  React.useEffect(
    () =>
      post({
        kind: 'inputsChanged',
        inputs,
      }),
    [post, inputs],
  );
  React.useEffect(
    () =>
      post({
        kind: 'lookChanged',
        look,
      }),
    [post, look],
  );
  React.useImperativeHandle(
    tellsOfPointer,
    () => ({
      isAt: (at: PointAt | null) =>
        post({
          kind: 'pointerAt',
          at,
        }),
      hasPressedAt(at: PointAt) {
        if (!isOnShow || finishLeavingRef.current !== null) return;
        let { clientWidth: width = 0, clientHeight: height = 0 }: Partial<Pick<HTMLIFrameElement, 'clientWidth' | 'clientHeight'>> =
          frameRef.current ?? {};
        let message = pressedAtMessage(at, {
          width,
          height,
        });
        if (message !== null) post(message);
      },
    }),
    [post, isOnShow],
  );
  return <figure className="sheet-figure-of-chart size-full"><iframe className="sheet-chart-frame" sandbox="allow-scripts" srcDoc={frameDocument} title={name} aria-hidden ref={frameRef} tabIndex={-1} data-is-on-show={isOnShow} onLoad={({ currentTarget }) => connect(currentTarget)} /></figure>;
}
export const CHART_FRAME_REPLY_TIMEOUT_MS = 40000;
export const CHART_FRAME_CARET_CHECK_MS = 100;
export const CHART_FRAME_LEAVE_TIMEOUT_MS = 1e4;
