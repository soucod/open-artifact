import { create } from 'zustand';
import { MODIFIER_KEYS } from '../state/escape.ts';
import { isBrowserReservedKey } from '../keys/key-press.ts';
export let keptOffCount: number;

/** When to tell the person that a key was kept off the cells: not at all, after a short wait, or now. */
export type KeptOffNotice = 'never' | 'later' | 'now';

/** What the guard asks of the page around it. */
export interface KeysOffCellsPage {
  /** The target is a text field of the page's own, which keys may reach. */
  isField(target: EventTarget | null): boolean;
  isOfCells(target: EventTarget | null): boolean;
  cellsTakeNoText(takeNoText: boolean, hasKeyboardLeft: boolean): void;
  somethingWasKeptOff(when: KeptOffNotice): void;
  noticeNeedNotWait(): void;
  hasKeyboard(): boolean;
  isBoxInSight(): boolean;
}

/** An element found by `closest` that may be a label pointing at its field. */
type LabelOrTextInput = Element & Partial<Pick<HTMLLabelElement, 'control'>>;
export function createKeysOffCellsGuard(
  pageWindow: Window,
  page: KeysOffCellsPage,
  setTimer: (run: () => void, delayMs: number) => void = (run, delayMs) => setTimeout(run, delayMs),
) {
  let areKeysOff = false;
  let isNoticeHeld = false;
  let isForAMove = false;
  let letsMovesThrough = false;
  let generation = 0;
  let leftByBlur = false;
  let setKeysOff = (areOff: boolean, byBlur: boolean = false) => {
    if (areOff === areKeysOff) return;
    areKeysOff = areOff;
    page.cellsTakeNoText(areOff, byBlur);
  };
  let letKeysBackOn = () => setKeysOff(false);
  let keepOff = (event: Event, isShortcut: boolean = false, mayNotice: boolean = true) => {
    if (!areKeysOff || page.isField(event.target)) return;
    event.stopImmediatePropagation();
    if (!isShortcut) event.preventDefault();
    let shouldNotice = mayNotice && !isShortcut && !isForAMove;
    page.somethingWasKeptOff(!shouldNotice ? 'never' : isNoticeHeld ? 'later' : 'now');
  };
  pageWindow.addEventListener(
    'keydown',
    (event) => {
      if (LEAVE_KEYS_PATTERN.test(event.key)) {
        if (event.key === 'Escape' && page.isOfCells(event.target)) keepOff(event, false, false);
        letKeysBackOn();
      } else if (letsMovesThrough && MOVE_KEYS_PATTERN.test(event.key)) letKeysBackOn();
      else if (!MODIFIER_KEYS.has(event.key)) keepOff(event, isBrowserReservedKey(event));
    },
    true,
  );
  pageWindow.addEventListener(
    'keyup',
    (event) => {
      if (areKeysOff && event.key === ' ' && !page.isField(event.target)) event.preventDefault();
    },
    true,
  );
  for (let eventType of ['beforeinput', 'paste', 'cut'])
    pageWindow.addEventListener(eventType, (event) => keepOff(event), true);
  for (let eventType of ['pointerdown', 'mousedown', 'click'])
    pageWindow.addEventListener(
      eventType,
      () => {
        leftByBlur = false;
        letKeysBackOn();
      },
      true,
    );
  pageWindow.addEventListener(
    'blur',
    (event) => {
      if (event.target !== pageWindow) return;
      leftByBlur = true;
      setKeysOff(false, true);
    },
    true,
  );
  pageWindow.addEventListener(
    'focus',
    (event) => {
      if (event.target === pageWindow) leftByBlur = false;
    },
    true,
  );
  return (isForAMoveNow: boolean = false, letsMovesThroughNow: boolean = false) => {
    letKeysBackOn();
    if (leftByBlur && !page.hasKeyboard()) return () => false;
    isForAMove = isForAMoveNow;
    letsMovesThrough = letsMovesThroughNow;
    setKeysOff(true);
    generation += 1;
    let generationNow = generation;
    let releaseIfCurrent = () => {
      if (generationNow === generation) letKeysBackOn();
    };
    isNoticeHeld = !isForAMoveNow;
    if (isForAMoveNow) setTimer(releaseIfCurrent, KEYS_OFF_CELLS_MS);
    else
      setTimer(() => {
        if (generationNow !== generation) return;
        isNoticeHeld = false;
        if (areKeysOff) page.noticeNeedNotWait();
      }, KEPT_OFF_NOTICE_DELAY_MS);
    return (isDone: boolean = false): boolean => {
      let wasKeptOff = generationNow === generation && areKeysOff;
      if (isForAMoveNow || isDone || !page.isBoxInSight()) releaseIfCurrent();
      return wasKeptOff;
    };
  };
}
export function closestTextField(element: Element): Element | null {
  let field = element.closest(
    'input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=color],[type=file],[type=image],[type=hidden],[readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  );
  if (field !== null) return field;
  let labelOrInput = element.closest<LabelOrTextInput>('[data-ui="TextInput"], label');
  let control = labelOrInput?.control ?? null;
  return control?.matches(
    'input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=color],[type=file],[type=image],[type=hidden],[readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  ) === true
    ? control
    : (labelOrInput?.querySelector(
        'input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=color],[type=file],[type=image],[type=hidden],[readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
      ) ?? null);
}
export function keepSheetFieldTapsInside(doc: Document) {
  doc.addEventListener(
    'pointerdown',
    (event) => {
      let { target } = event;
      if (!(target instanceof Element) || !isSheetPresentationField(target)) return;
      let stopOwnPointerdown = (sameEvent: Event) => {
        if (sameEvent === event) sameEvent.stopPropagation();
      };
      target.addEventListener('pointerdown', stopOwnPointerdown, {
        once: true,
      });
    },
    {
      capture: true,
    },
  );
}
export function noteSomethingKeptOff(when: KeptOffNotice) {
  keptOffCount += 1;
  if (when === 'now' && !getKeysOffCellsState().wasSomethingKeptOff)
    setKeysOffCellsState({
      ...getKeysOffCellsState(),
      wasSomethingKeptOff: true,
    });
  if (when === 'later' && !getKeysOffCellsState().isNoticeOwed)
    setKeysOffCellsState({
      ...getKeysOffCellsState(),
      isNoticeOwed: true,
    });
}
export function releaseOwedKeptOffNotice() {
  if (getKeysOffCellsState().isNoticeOwed)
    setKeysOffCellsState({
      ...getKeysOffCellsState(),
      isNoticeOwed: false,
      wasSomethingKeptOff: true,
    });
}
export function onceKeysBackOnCells(then: (hasKeyboardLeft: boolean) => void) {
  let stopListening = subscribeKeysOffCells(() => {
    if (getKeysOffCellsState().doCellsTakeNoText) return;
    stopListening();
    then(getKeysOffCellsState().hasKeyboardLeft);
  });
  return stopListening;
}
export const KEYS_OFF_CELLS_MS = 2500;
export const KEPT_OFF_NOTICE_DELAY_MS = 1000;
export const LEAVE_KEYS_PATTERN = /^(?:Escape|Tab|F6)$/;
export const MOVE_KEYS_PATTERN = /^(?:Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End)$/;
export const isSheetPresentationField = (element: Element) =>
  element.closest('[data-presentation="sheet"]') !== null && closestTextField(element) !== null;
export interface KeysOffCellsState {
  /** Typing goes elsewhere for now, so keys pressed on the cells are kept off them. */
  doCellsTakeNoText: boolean;
  wasSomethingKeptOff: boolean;
  isNoticeOwed: boolean;
  hasKeyboardLeft: boolean;
}
export const KEYS_OFF_CELLS_IDLE: KeysOffCellsState = {
  doCellsTakeNoText: false,
  wasSomethingKeptOff: false,
  isNoticeOwed: false,
  hasKeyboardLeft: false,
};
export const useKeysOffCellsStore = create<KeysOffCellsState>()(() => KEYS_OFF_CELLS_IDLE);
export const setKeysOffCellsState = (next: KeysOffCellsState): void => useKeysOffCellsStore.setState(next, true);
keptOffCount = 0;
export const getKeptOffCount = () => keptOffCount;
export const setCellsTakeNoText = (takeNoText: boolean, hasKeyboardLeft: boolean) =>
  setKeysOffCellsState({
    ...KEYS_OFF_CELLS_IDLE,
    doCellsTakeNoText: takeNoText,
    hasKeyboardLeft,
  });
export const getKeysOffCellsState = (): KeysOffCellsState => useKeysOffCellsStore.getState();
export const doCellsTakeNoText = () => getKeysOffCellsState().doCellsTakeNoText;
export const subscribeKeysOffCells = (listener: () => void): (() => void) => useKeysOffCellsStore.subscribe(() => listener());
export const makeKeepKeysOffCells =
  (keepOff: () => () => void) =>
  (onBack: () => void): (() => void) => {
    let release = keepOff();
    let stopWaiting = onceKeysBackOnCells((hasKeyboardLeft) => {
      if (!hasKeyboardLeft) onBack();
    });
    return () => {
      stopWaiting();
      release();
    };
  };
export const useKeysOffCells = (): KeysOffCellsState => useKeysOffCellsStore();

/** Keeps keys off the cells for a while; the release it returns says whether something was kept off. */
export type KeysOffCellsGuard = ReturnType<typeof createKeysOffCellsGuard>;
