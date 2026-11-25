/**
 * Who has the keyboard: the page, or one of the frames it embeds. An embed is named by an id; `''` stands for a frame
 * the page cannot name (one that is not mounted here, or is out of the tab order).
 */
export type EmbedLookOutcome = 'nothing' | 'wait';

export type EmbedSettleOutcome = 'nothing' | 'excused' | 'take-back' | 'stop';

export interface EmbedKeyboardTurns {
  owner(): string | null;
  pressed(id: string): void;
  /** Whether a press (by an embed, or `null`: by the page) reported `ageMs` after it came at `at` is a fresh one. */
  heard(id: string | null, at: number, ageMs: number, nowMs: number): boolean;
  justPressed(id: string | null, nowMs: number): boolean;
  keyed(id: string, at: number, ageMs: number): boolean;
  released(): void;
  forget(id: string): void;
  reset(): void;
  look(holder: string | null, nowMs: number): EmbedLookOutcome;
  settle(holder: string, nowMs: number): EmbedSettleOutcome;
}

export interface EmbedKeyboardOptions {
  /** Where the caret goes back to when an embed is made to give the keyboard up. */
  home(): HTMLElement | null;
  giveBack(element: HTMLElement | SVGElement): void;
  /** An embed took the keyboard back once too often: it is taken out. */
  onStop(id: string): void;
  onAdrift(): void;
  onPressOutside(): void;
  onLeft(owner: string, to: HTMLElement | SVGElement): void;
  onOwner?(owner: string | null, isPressed: boolean): void;
}

export interface EmbedKeyboard {
  mount(id: string, frame: HTMLIFrameElement, onEnterByKey?: () => void): () => void;
  owner(): string | null;
  holder(): string | null;
  enter(id: string, keyAt?: number): void;
  release(): void;
  reported(id: string, at: number, ageMs: number): boolean;
  keyed(id: string, at: number, ageMs: number): boolean;
  pressedElsewhere(at: number): void;
  blurred(id: string): void;
}

interface FocusWait {
  from: Element | null;
  inPage: boolean;
}

interface EmbedKeyboardWatch {
  ownerBlurred(id: string): void;
  stop(frame: HTMLIFrameElement): void;
}

type Timer = ReturnType<typeof setTimeout>;

export function createEmbedKeyboardTurns(): EmbedKeyboardTurns {
  let owner: string | null = null;
  let takeBacks = new Map<string, number>();
  let looked = new Set<string>();
  let excusedUntil = new Map<string, number>();
  let lastPress: { id: string | null; at: number } = {
    id: null,
    at: -1 / 0,
  };
  return {
    owner: () => owner,
    pressed(id) {
      owner = id;
      takeBacks.delete(id);
      excusedUntil.delete(id);
      looked.delete(id);
      looked.delete('');
    },
    heard(
      id,
      at,
      ageMs,
      nowMs,
    ) {
      let isFresh =
        ageMs <= 1000 &&
        (lastPress.id === id ? !Number.isNaN(at) : at >= lastPress.at);
      if (isFresh && at >= lastPress.at)
        lastPress = {
          id,
          at,
        };
      if (!isFresh && id !== null) excusedUntil.set(id, nowMs + 500);
      return isFresh;
    },
    justPressed: (id, nowMs) =>
      lastPress.id === id && lastPress.at >= nowMs - 250,
    keyed: (id, at, ageMs) =>
      owner === id && ageMs <= 1000 && at >= lastPress.at,
    released() {
      owner = null;
    },
    forget(id) {
      takeBacks.delete(id);
      excusedUntil.delete(id);
      if (owner === id) owner = null;
      if (lastPress.id === id)
        lastPress = {
          id: null,
          at: lastPress.at,
        };
    },
    reset() {
      owner = null;
      lastPress = {
        id: null,
        at: -1 / 0,
      };
      takeBacks.clear();
      excusedUntil.clear();
      looked.clear();
    },
    look(holder, nowMs) {
      if (holder === owner) return 'nothing';
      if (holder === null && owner !== null && this.justPressed(owner, nowMs))
        return 'nothing';
      if (holder === null) owner = null;
      if (holder === null || looked.has(holder)) return 'nothing';
      looked.add(holder);
      return 'wait';
    },
    settle(holder, nowMs) {
      if (!looked.delete(holder)) return 'nothing';
      let excused = excusedUntil.get(holder);
      excusedUntil.delete(holder);
      if (excused !== undefined && nowMs <= excused) return 'excused';
      if (holder === '') return 'take-back';
      let count = (takeBacks.get(holder) ?? 0) + 1;
      if (count < 3) takeBacks.set(holder, count);
      else takeBacks.delete(holder);
      return count < 3 ? 'take-back' : 'stop';
    },
  };
}

export function focusEmbedFrame(frame: HTMLIFrameElement): void {
  let active = document.activeElement;
  if (
    (active instanceof HTMLElement || active instanceof SVGElement) &&
    active.tagName !== 'IFRAME'
  )
    active.blur();
  frame.contentWindow?.focus();
}

export function isFrameOutOfTabOrder(frame: HTMLElement): boolean {
  if (frame.closest('[inert]') !== null) return true;
  if (frame.tabIndex >= 0) return false;
  let { width, height } =
    frame.getBoundingClientRect();
  return width === 0 || height === 0;
}

export function addKeyboardDecoyFrame(): HTMLDivElement {
  let holder = Object.assign(document.createElement('div'), {
    hidden: true,
  });
  holder.setAttribute(EMBED_KEYBOARD_FRAME_ATTRIBUTE, '');
  holder
    .attachShadow({
      mode: 'open',
    })
    .appendChild(
      Object.assign(document.createElement('iframe'), {
        srcdoc: '',
        tabIndex: -1,
      }),
    )
    .setAttribute('sandbox', '');
  return document.body.appendChild(holder);
}

export function createEmbedKeyboard(options: EmbedKeyboardOptions): EmbedKeyboard {
  let turns = createEmbedKeyboardTurns();
  let frames = new Map<string, HTMLIFrameElement>();
  let idsOfFrames = new Map<Element, string>();
  let onEnteredByKey = new Map<string, () => void>();
  let windowsOfFrames = new Map<string, Window | null>();
  let holder = (): string | null => {
    let active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      active.tagName !== 'IFRAME' &&
      document.hasFocus() &&
      !active.matches(':focus')
    )
      return '';
    return (
      (active && idsOfFrames.get(active)) ??
      (active instanceof HTMLElement &&
      active.tagName === 'IFRAME' &&
      document.hasFocus() &&
      isFrameOutOfTabOrder(active)
        ? ''
        : null)
    );
  };
  let goHome = () =>
    options.home()?.focus({
      preventScroll: true,
    });
  let noteWindow = (id: string): void =>
    void windowsOfFrames.set(id, frames.get(id)?.contentWindow ?? null);
  let [ownerTold, wasPressTold, wasPressed, depth]: [string | null, boolean, boolean, number] = [
    null,
    false,
    false,
    0,
  ];
  let tellOwner = (): void => {
    depth++;
    try {
      for (let round = 0; round < 3; round++) {
        let [nextOwner, isPressed] = [
          turns.owner(),
          turns.owner() !== null && wasPressed,
        ];
        if (nextOwner === ownerTold && isPressed === wasPressTold) return;
        [ownerTold, wasPressTold] = [nextOwner, isPressed];
        try {
          options.onOwner?.(nextOwner, isPressed);
        } catch (error) {
          if (typeof reportError === 'function') reportError(error);
        }
      }
    } finally {
      depth--;
    }
  };
  let batched =
    <Args extends unknown[]>(act: (...args: Args) => void) =>
    (...args: Args): void => {
      depth++;
      try {
        act(...args);
      } finally {
        if (--depth === 0) tellOwner();
      }
    };
  let watch: EmbedKeyboardWatch | null = null;
  let startWatching = (): EmbedKeyboardWatch => {
    let decoy = addKeyboardDecoyFrame();
    let leftFrom: Element | null = null;
    let isPageFocused = document.hasFocus();
    let waits = new Map<Timer, FocusWait>();
    let blurWaits = new Map<string, Timer>();
    let takeBack = (
      id: string | null,
      from: Element | null,
      wasInPage: boolean,
    ): void => {
      turns.released();
      let isUnnamedFrameOut =
        id === '' && document.activeElement?.tagName !== 'IFRAME';
      if (
        wasInPage &&
        !isUnnamedFrameOut &&
        (from instanceof HTMLElement || from instanceof SVGElement) &&
        from.isConnected
      ) {
        options.giveBack(from);
        if (holder() === null && document.activeElement?.tagName !== 'IFRAME')
          return;
      }
      options.onAdrift();
      if (!wasInPage && window.top !== null && window.top !== window) {
        window.top.focus();
        isPageFocused = false;
        for (let wait of waits.values()) wait.inPage = false;
      } else {
        if (id === '' && document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        goHome();
      }
    };
    let settle = (
      id: string,
      from: Element | null,
      wasInPage: boolean,
    ): void => {
      let outcome = turns.settle(id, performance.now());
      if (outcome === 'nothing') return;
      let holderNow = holder();
      if (outcome === 'excused' && holderNow !== id) return;
      if (outcome === 'stop') {
        options.onStop(id);
        frames.get(id)?.remove();
      }
      if (
        holderNow !== null
          ? holderNow === turns.owner()
          : !wasInPage || document.hasFocus()
      )
        return;
      takeBack(holderNow, from, wasInPage);
    };
    let check = (): void => {
      let holderNow = holder();
      let active = document.activeElement;
      let frameWindow =
        holderNow !== null && holderNow !== ''
          ? frames.get(holderNow)?.contentWindow
          : undefined;
      if (
        holderNow !== null &&
        frameWindow !== undefined &&
        windowsOfFrames.get(holderNow) !== frameWindow
      ) {
        windowsOfFrames.set(holderNow, frameWindow);
        turns.forget(holderNow);
      }
      if (
        holderNow === null &&
        turns.owner() !== null &&
        active === document.body &&
        document.hasFocus()
      )
        options.onAdrift();
      if (
        turns.look(holderNow, performance.now()) === 'wait' &&
        holderNow !== null
      ) {
        let wait: FocusWait = {
          from: leftFrom,
          inPage: isPageFocused,
        };
        let timer = setTimeout(
          batched(
            () => (
              waits.delete(timer),
              settle(holderNow, wait.from, wait.inPage)
            ),
          ),
          50,
        );
        waits.set(timer, wait);
      } else if (leftFrom !== null)
        for (let wait of waits.values()) wait.from = leftFrom;
      leftFrom = null;
      if (waits.size === 0) isPageFocused = document.hasFocus();
    };
    let checkBatched = batched(check);
    let pollTimer = setTimeout(function poll() {
      pollTimer = setTimeout(poll, Math.random() * 50);
      checkBatched();
    }, 0);
    let blurTimer: Timer | undefined;
    let onWindowBlur = (): void => {
      isPageFocused = true;
      clearTimeout(blurTimer);
      if (holder() !== null) checkBatched();
      else blurTimer = setTimeout(checkBatched, 0);
    };
    let onPointerDown = batched((event: PointerEvent) => {
      turns.heard(null, event.timeStamp, 0, performance.now());
      turns.released();
      options.onPressOutside();
      let active = document.activeElement;
      if (active !== null && idsOfFrames.has(active)) goHome();
    });
    let onFocusIn = batched((event: FocusEvent) => {
      let ownerNow = turns.owner();
      if (
        ownerNow === null ||
        !(
          event.target instanceof HTMLElement ||
          event.target instanceof SVGElement
        ) ||
        event.target.tagName === 'IFRAME'
      )
        return;
      turns.released();
      options.onLeft(ownerNow, event.target);
    });
    let onVisibilityChange = (): void => {
      if (document.visibilityState !== 'hidden') return;
      for (let timer of blurWaits.values()) clearTimeout(timer);
      blurWaits.clear();
    };
    let onFocusOut = (event: FocusEvent): void =>
      void (leftFrom =
        event.target instanceof Element && event.target.tagName !== 'IFRAME'
          ? event.target
          : null);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return {
      ownerBlurred(id) {
        if (blurWaits.has(id) || document.visibilityState === 'hidden')
          return;
        let afterBlur = (): void => {
          blurWaits.delete(id);
          if (
            turns.owner() !== id ||
            turns.justPressed(id, performance.now())
          )
            return;
          let holderNow = holder();
          if (holderNow === id && !document.hasFocus()) return;
          if (holderNow === id) return takeBack(id, null, false);
          check();
          turns.released();
        };
        blurWaits.set(id, setTimeout(batched(afterBlur), 50));
      },
      stop(frame) {
        let waiting = [...waits.values()];
        let last = waiting.findLast(
          (wait) => wait.from !== null,
        ) ??
          waiting.at(-1) ?? {
            from: leftFrom,
            inPage: isPageFocused,
          };
        if (document.activeElement?.tagName === 'IFRAME') {
          if (
            (waiting.length > 0 && document.activeElement === frame) ||
            holder() === ''
          )
            takeBack('', last.from, last.inPage);
        } else if (waiting.length > 0 && last.inPage && !document.hasFocus())
          takeBack(null, last.from, true);
        decoy.remove();
        clearTimeout(pollTimer);
        clearTimeout(blurTimer);
        for (let timer of [...waits.keys(), ...blurWaits.values()])
          clearTimeout(timer);
        turns.reset();
        windowsOfFrames.clear();
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('focusout', onFocusOut, true);
        document.removeEventListener('focusin', onFocusIn, true);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      },
    };
  };
  return {
    mount(id, frame, onEnterByKey) {
      if (id === '')
        throw Error(
          "Give this embed an id that is not empty: under the keyboard rule, '' means a frame that holder() cannot name.",
        );
      frames.set(id, frame);
      if (onEnterByKey) onEnteredByKey.set(id, onEnterByKey);
      else onEnteredByKey.delete(id);
      idsOfFrames.set(frame, id);
      watch ??= startWatching();
      return batched(() => {
        idsOfFrames.delete(frame);
        if (frames.get(id) === frame) {
          frames.delete(id);
          onEnteredByKey.delete(id);
        }
        if (idsOfFrames.size === 0) {
          watch?.stop(frame);
          watch = null;
        }
      });
    },
    owner: turns.owner,
    holder,
    enter: batched((id: string, keyAt?: number) => {
      let frame = frames.get(id);
      if (keyAt !== undefined) {
        turns.heard(id, keyAt, 0, performance.now());
        onEnteredByKey.get(id)?.();
      }
      if (keyAt !== undefined || turns.owner() !== id)
        wasPressed = keyAt !== undefined;
      turns.pressed(id);
      noteWindow(id);
      if (frame && holder() !== id) focusEmbedFrame(frame);
    }),
    release: batched(turns.released),
    reported(id, at, ageMs) {
      noteWindow(id);
      return turns.heard(id, at, ageMs, performance.now());
    },
    keyed: turns.keyed,
    pressedElsewhere: (at) =>
      void turns.heard(null, at, 0, performance.now()),
    blurred(id) {
      if (turns.owner() === id) watch?.ownerBlurred(id);
    },
  };
}

export const EMBED_KEYBOARD_FRAME_ATTRIBUTE = 'data-embed-keyboard-frame';
