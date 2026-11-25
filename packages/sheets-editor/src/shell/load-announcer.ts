import { sheetLoadedText } from './sheet-status.ts';
/** What the announcer asks of the page. */
export interface PageOfLoad {
  doCellsHaveKeyboard(): boolean;
  isLoadUnseen(): boolean;
}
/** Says to screen readers that the sheet is loading, then that it has loaded. */
export interface WordsOfLoad {
  /** Words about the load are yet to be said or are being said. */
  areWordsToCome(): boolean;
  onChanged(listener: () => void): () => void;
  loadIsOnItsWay(inWords: string): void;
  loadHasStopped(): void;
  cellsAreDrawn(): void;
  cellsTakeKeyboard(): void;
}
export function createWordsOfLoad(announce: (words: string) => void, page: PageOfLoad, clock: Pick<Window, 'setTimeout'>): WordsOfLoad {
  let load: { inWords: string; isInLine: boolean } | null = null;
  let generation = 0;
  let areWordsToCome = false;
  let listeners = new Set<() => void>();
  let setWordsToCome = (next: boolean) => {
    if (next === areWordsToCome) return;
    areWordsToCome = next;
    for (let listener of listeners) listener();
  };
  let clearWords = () => {
    announce('');
    setWordsToCome(false);
  };
  let after = (delayMs: number, then: () => void) => {
    let generationAtStart = generation;
    clock.setTimeout(() => {
      if (generation === generationAtStart) then();
    }, delayMs);
  };
  return {
    areWordsToCome: () => areWordsToCome,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loadIsOnItsWay(inWords) {
      if (load !== null) {
        if (load.isInLine && load.inWords !== inWords) announce(inWords);
        load.inWords = inWords;
        return;
      }
      let nextLoad = {
        inWords,
        isInLine: false,
      };
      load = nextLoad;
      generation += 1;
      setWordsToCome(true);
      after(LOAD_WORDS_DELAY_MS, () => {
        if (page.isLoadUnseen()) return;
        nextLoad.isInLine = true;
        announce(nextLoad.inWords);
      });
    },
    loadHasStopped() {
      load = null;
      generation += 1;
      clearWords();
    },
    cellsAreDrawn() {
      if (load === null) return;
      load = null;
      generation += 1;
      if (page.isLoadUnseen()) return clearWords();
      after(LOADED_WORDS_DELAY_MS, () => {
        if (page.doCellsHaveKeyboard()) return clearWords();
        announce(sheetLoadedText());
        after(WORDS_TO_COME_END_MS, () => setWordsToCome(false));
        after(LOADED_WORDS_CLEAR_MS, () => announce(''));
      });
    },
    cellsTakeKeyboard() {
      if (load !== null) return;
      generation += 1;
      clearWords();
    },
  };
}
export const LOAD_WORDS_DELAY_MS = 2000;
export const LOADED_WORDS_DELAY_MS = 1000;
export const LOADED_WORDS_CLEAR_MS = 5000;
export const WORDS_TO_COME_END_MS = 1500;
export const NO_WORDS_OF_LOAD: Pick<WordsOfLoad, 'areWordsToCome' | 'onChanged'> = {
  areWordsToCome: () => false,
  onChanged: () => () => {},
};
