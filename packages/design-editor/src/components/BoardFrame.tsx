/**
 * One artboard rendered in an iframe by the board runtime.
 *
 * The frame is created once per artboard; later source changes go through
 * `window.__dc.setSource` inside the frame, so state of interactive boards
 * survives template edits and nothing flashes.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { BoardBoot, BoardEvent, BoardMode } from '@open-artifact/dc';
import { frameDocument } from '../lib/frame.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { boardApi, registerFrame } from '../services/frames.ts';
import { textEditEvent } from '../services/text-edit.ts';
import { artifactPath, session } from '../services/session.ts';
import { handleFrameKey } from '../keyboard.ts';
import { liveAll } from '../services/live.ts';

export interface BoardFrameProps {
  path: string;
  mode: BoardMode;
  width: number;
  height: number;
  /** Let the pointer reach the frame (Play, text editing). */
  interactive: boolean;
  /** Called when a link to another artboard is followed in Play. */
  onNavigate?: (path: string) => void;
  /** Keep the frame transparent until its board boots (a snapshot is drawn under it). */
  hideUntilBooted?: boolean;
  /** Keep the frame running but out of sight (a resting artboard, drawn from its snapshot). */
  hidden?: boolean;
}

/** Absolute URLs the frame document needs. */
const urls = () => ({ runtime: new URL('support.js', location.href).toString(), project: new URL('project/', location.href).toString() });

export function BoardFrame({ path, mode, width, height, interactive, onNavigate, hideUntilBooted = false, hidden = false }: BoardFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const sent = useRef<string | null>(null);
  const liveMode = useRef(mode);
  liveMode.current = mode;
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const source = useDocument((s) => s.boards[path]?.source ?? null);
  const overrides = useView((s) => s.overrides[path]);
  const hasSource = source !== null;
  const booted = useView((s) => s.frames[path]?.booted ?? false);

  // Boot once the source is known; never reboot for later changes.
  useLayoutEffect(() => {
    const iframe = ref.current;
    const initial = useDocument.getState().boards[path]?.source;
    if (!iframe || initial == null) return;
    const view = useView.getState();
    const report = (event: BoardEvent): void => {
      const v = useView.getState();
      if (textEditEvent(path, event)) return;
      switch (event.type) {
        case 'booted': {
          boardApi(path)?.setMode(liveMode.current);
          iframe.contentDocument?.documentElement.toggleAttribute('data-dc-canvas', liveMode.current === 'edit');
          v.frame(path, { booted: true, size: event.size, errors: boardApi(path)?.errors() ?? [] });
          // Catch up with edits made while the frame was loading.
          const latest = useDocument.getState().boards[path]?.source;
          if (latest && latest !== sent.current) {
            sent.current = latest;
            boardApi(path)?.setSource(latest);
          }
          break;
        }
        case 'resized':
          v.frame(path, { size: event.size });
          break;
        case 'errors':
          v.frame(path, { errors: event.errors });
          break;
        case 'navigate':
          navigate.current?.(event.path);
          break;
        case 'key':
          handleFrameKey(event);
          break;
      }
    };
    const boot: BoardBoot = {
      path,
      source: initial,
      mode,
      props: view.overrides[path] ?? {},
      load: async (target) => {
        const known = useDocument.getState().boards[target]?.source;
        return known ?? session().artifact.readText(artifactPath(target));
      },
      report,
    };
    sent.current = initial;
    iframe.__dcBoot = boot;
    iframe.srcdoc = frameDocument(path, initial, urls(), { canvas: mode === 'edit' });
    const unregister = registerFrame(path, iframe);
    return () => {
      unregister();
      // An artboard that stays on the canvas keeps its errors while it has no frame (services/live.ts).
      if (!liveAll && useDocument.getState().canvas.boards[path]) useView.getState().parkFrame(path);
      else useView.getState().dropFrame(path);
    };
    // `mode` and props are applied by the effects below; booting again would lose state.
  }, [path, hasSource]);

  // Push source changes into the running board.
  useEffect(() => {
    if (source === null || source === sent.current) return;
    const api = boardApi(path);
    if (!api) return; // the 'booted' handler catches up
    sent.current = source;
    api.setSource(source);
    // Element boxes move once the board re-renders; React commits within a frame or two.
    requestAnimationFrame(() => useView.getState().tick());
    const late = setTimeout(() => useView.getState().tick(), 120);
    return () => clearTimeout(late);
  }, [path, source]);

  useEffect(() => {
    boardApi(path)?.setMode(mode);
    // Canvas frames clip instead of scrolling (see frameDocument).
    ref.current?.contentDocument?.documentElement.toggleAttribute('data-dc-canvas', mode === 'edit');
  }, [path, mode]);

  useEffect(() => {
    boardApi(path)?.setProps(overrides ?? {});
  }, [path, overrides]);

  if (!hasSource) {
    return (
      <div className="flex size-full items-center justify-center bg-surface text-xs text-fg-subtle" style={{ width, height }}>
        Waiting for the artboard…
      </div>
    );
  }
  return (
    <iframe
      ref={ref}
      title={path}
      data-board={path}
      sandbox="allow-scripts allow-same-origin allow-popups"
      className="block border-0 bg-white"
      style={{ width, height, pointerEvents: interactive ? 'auto' : 'none', ...(hideUntilBooted && !booted ? { opacity: 0 } : {}), ...(hidden ? { visibility: 'hidden' } : {}) }}
    />
  );
}
