/**
 * The interactive frame: a sandboxed document that runs one interactive sheet. The page hands it a port and the
 * code's module; the module runs here, with React, and draws plain controls the person uses in the frame itself.
 * What the controls write goes to the page, which writes the cells when it knows a person pressed; until it answers,
 * the frame shows the written values over the inputs.
 */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button } from '../kit/button.tsx';
import { Menu } from '../kit/menu.tsx';
import { Popover } from '../kit/popover.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import { CHART_FRAME_PORT_MESSAGE } from '../charts/frame-messages.ts';
import { VIEWER_FONT_ATTRIBUTE } from '../shell/root-theme.ts';
import { isObject } from '../chart-frame/chart-runtime.ts';
import type { ChartInputs, ChartLook } from '../chart-frame/messages.ts';
import { cellsAskedFor, inputsWithWritesAwaited, type ControlsOfInteractive, type WriteAwaited } from './cells.ts';
import { componentOfCode, faultOf, handedToCode, ToldContext, type InteractiveFault } from './code.ts';
import type { InteractiveToPage, PageToInteractive } from './messages.ts';
import './frame.css';

type Fault = InteractiveFault;

/** The names a frame could reach the network with past its policy. */
const GLOBALS_TAKEN_AWAY = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate'];

/** The controls the frame hands the person's caret to when they come in by key. */
const FIRST_CONTROL = 'button, input, select, textarea, [tabindex="0"]';
/** What, while open, takes Escape for itself. */
const OPEN_LAYER = '[role="menu"], [role="dialog"]';

interface NavigationEvents {
  addEventListener(type: 'navigate', listener: (event: Event) => void): void;
}

const isNavigationEvents = (value: unknown): value is NavigationEvents => isObject(value) && typeof value.addEventListener === 'function';

/** Keeps the frame where it is: no link, form or script takes it to another address. */
function stayInPlace(): void {
  for (const name of GLOBALS_TAKEN_AWAY)
    try {
      Reflect.deleteProperty(window, name);
    } catch {
      // A name that stays is still behind the frame's policy.
    }
  const navigation: unknown = Reflect.get(window, 'navigation');
  if (isNavigationEvents(navigation))
    navigation.addEventListener('navigate', (event) => {
      if (event.cancelable) event.preventDefault();
    });
  window.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a, area') !== null) event.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener('submit', (event) => event.preventDefault(), { capture: true });
}

function applyLook({ theme, viewerFont }: ChartLook): void {
  const root = document.documentElement;
  for (const [name, value] of [
    ['data-mode', theme],
    [VIEWER_FONT_ATTRIBUTE, viewerFont],
  ] as const)
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
}

class FailsOnThrow extends React.Component<{ onThrown: (error: unknown) => void; children: React.ReactNode }, { hasThrown: boolean }> {
  override state = { hasThrown: false };
  static getDerivedStateFromError(): { hasThrown: boolean } {
    return { hasThrown: true };
  }
  override componentDidCatch(error: unknown): void {
    this.props.onThrown(error);
  }
  override render(): React.ReactNode {
    return this.state.hasThrown ? null : this.props.children;
  }
}

interface RunningInteractive {
  told: (inputs: ChartInputs, answered: number | null) => void;
  canWrite: (canWrite: boolean) => void;
  end: () => void;
}

async function runInteractive(
  artifact: string,
  given: { inputs: ChartInputs; canWrite: boolean },
  container: HTMLElement,
  tell: (message: InteractiveToPage) => void,
  fail: (fault: Fault) => void,
): Promise<RunningInteractive | null> {
  const address = URL.createObjectURL(new Blob([artifact], { type: 'text/javascript' }));
  let module: unknown;
  try {
    if (artifact.includes('sourceMappingURL')) throw SyntaxError();
    module = await import(/* @vite-ignore */ address);
  } catch (error) {
    fail(error instanceof SyntaxError ? 'notAModule' : faultOf(error));
    return null;
  } finally {
    URL.revokeObjectURL(address);
  }
  const init: unknown = isObject(module) && 'init' in module ? module.init : undefined;
  const made = componentOfCode(init, handedToCode({ Tooltip, Button, Menu, Popover }));
  if (typeof made === 'string') {
    fail(made);
    return null;
  }
  const Code = made;
  let [inputs, canWrite, writesMade, isEnded] = [given.inputs, given.canWrite, 0, false];
  let awaited: WriteAwaited[] = [];
  let root: Root | null = createRoot(container);
  const size = (): { width: number; height: number } => ({ width: window.innerWidth, height: window.innerHeight });
  let hasToldDrawn = false;
  const drawn = (): void => {
    if (hasToldDrawn || isEnded) return;
    hasToldDrawn = true;
    tell({ kind: 'drawn' });
  };
  const setCells = (asked: unknown): void => {
    if (!canWrite || isEnded) return;
    const cells = cellsAskedFor(asked, inputs);
    if (cells.length === 0) return;
    writesMade += 1;
    awaited = [...awaited, { nth: writesMade, cells }];
    tell({ kind: 'write', cells, nth: writesMade });
    draw();
  };
  let controls: ControlsOfInteractive = Object.freeze({ canWrite, setCells });
  function Shown(): React.ReactNode {
    React.useEffect(drawn, []);
    return null;
  }
  function draw(): void {
    root?.render(
      <FailsOnThrow onThrown={(error) => fail(faultOf(error))}>
        <TooltipGroup delay={0}>
          <ToldContext.Provider value={{ inputs: inputsWithWritesAwaited(inputs, awaited), controls, size: size() }}>
            <div className="interactive-root">
              <Code />
            </div>
            <Shown />
          </ToldContext.Provider>
        </TooltipGroup>
      </FailsOnThrow>,
    );
  }
  window.addEventListener('resize', draw);
  draw();
  return {
    told(next, answered) {
      inputs = next;
      if (answered !== null) awaited = awaited.filter(({ nth }) => nth > answered);
      draw();
    },
    canWrite(next) {
      if (next === canWrite) return;
      canWrite = next;
      controls = Object.freeze({ canWrite, setCells });
      draw();
    },
    end() {
      isEnded = true;
      window.removeEventListener('resize', draw);
      root?.unmount();
      root = null;
    },
  };
}

/** The keys the frame hands back to the page, and the person's own presses, told before the write they may make. */
function listenToPerson(tell: (message: InteractiveToPage) => void): void {
  const pressed = (event: Event): void => {
    if (event.isTrusted) tell({ kind: 'pressed', at: Date.now() });
  };
  for (const type of ['pointerdown', 'pointerup', 'click']) window.addEventListener(type, pressed, { capture: true });
  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    if (event.key === 'F6') {
      event.preventDefault();
      tell({ kind: 'keyForPage', key: event.shiftKey ? 'previousPart' : 'nextPart' });
    } else if (event.key === 'Escape' && !event.defaultPrevented && document.querySelector(OPEN_LAYER) === null)
      tell({ kind: 'keyForPage', key: 'leave' });
  });
  window.addEventListener('blur', () => tell({ kind: 'keyboardLost' }));
}

const isEnabled = (element: Element): boolean => !element.matches(':disabled') && element.closest('[inert]') === null;

function listenToPage(port: MessagePort): void {
  const tell = (message: InteractiveToPage): void => port.postMessage(message);
  let [hasBegun, hasFailed] = [false, false];
  let running: RunningInteractive | null = null;
  const fail = (fault: Fault): void => {
    if (hasFailed) return;
    hasFailed = true;
    tell({ kind: 'failed', fault });
    running?.end();
  };
  window.addEventListener('error', ({ error }: ErrorEvent) => {
    if (error !== null && error !== undefined) fail('threw');
  });
  window.addEventListener('unhandledrejection', () => fail('threw'));
  listenToPerson(tell);
  const container = document.getElementById('interactive');
  port.addEventListener('message', ({ data }: MessageEvent<PageToInteractive>) => {
    switch (data.kind) {
      case 'draw': {
        if (hasBegun || hasFailed || container === null) return;
        hasBegun = true;
        applyLook(data.look);
        void runInteractive(data.artifact, data, container, tell, fail).then((made) => {
          if (hasFailed) made?.end();
          else running = made;
        });
        return;
      }
      case 'areYouThere':
        tell({ kind: 'here' });
        return;
      case 'inputsChanged':
        running?.told(data.inputs, data.answered);
        return;
      case 'lookChanged':
        applyLook(data.look);
        return;
      case 'canWriteChanged':
        running?.canWrite(data.canWrite);
        return;
      case 'enteredByKey': {
        const first = [...document.querySelectorAll(FIRST_CONTROL)].find(isEnabled);
        if (first instanceof HTMLElement || first instanceof SVGElement) first.focus();
        return;
      }
      case 'left': {
        const active = document.activeElement;
        if (active instanceof HTMLElement || active instanceof SVGElement) active.blur();
      }
    }
  });
  port.start();
}

const takePort = ({ source, data, ports: [port] }: MessageEvent<unknown>): void => {
  if (source !== window.parent || data !== CHART_FRAME_PORT_MESSAGE || port === undefined) return;
  window.removeEventListener('message', takePort);
  listenToPage(port);
};

if (window.origin === 'null') {
  stayInPlace();
  window.addEventListener('message', takePort);
}
