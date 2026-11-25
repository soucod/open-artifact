import { withNoEffects } from '../state/transitions.ts';
import { pasteIntoSelection } from '../state/copy-paste.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { areaOfPosition, isSameSelection } from '../selection/model.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { withCalendarShut } from '../chips/calendar.ts';
import { closeDropdownList } from '../chips/dropdowns.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState, PasteThatWaits } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PasteThatWaitsAnswered } from '../state/event-reducer.ts';
import type { CharactersNotSeen } from '../i18n/sheet-messages.ts';
/** A run of characters in a text, and where it starts. */
export interface RunInText {
  index: number;
  run: string;
}
/** A part of a pasted text that a cell shows as it is. */
export interface SeenPiece {
  from: number;
  seen: string;
}
/** Characters of a pasted text that no cell shows, told by what they are. */
export interface UnseenPiece {
  from: number;
  unseen: CharactersNotSeen;
}
export type PieceOfPastedText = SeenPiece | UnseenPiece;
/** A cell of a paste that waits, with its pasted text cut into what is seen and what is not. */
export interface RowOfPasteThatWaits {
  key: string;
  address: string | null;
  written: PieceOfPastedText[];
}
/** A paste that waits on the person, as its dialog shows it. */
export interface PasteThatWaitsShown {
  nth: number;
  rows: RowOfPasteThatWaits[];
}
export function settlePasteThatWaits(
  state: PageState,
  reads: WorkbookReads,
  { nth, isToBePasted }: PasteThatWaitsAnswered,
): PageTransition {
  let pasteThatWaits = state.pasteThatWaits;
  if (pasteThatWaits?.nth !== nth) return withNoEffects(state);
  let stateFreed = {
    ...state,
    pasteThatWaits: null,
  };
  return isToBePasted ? pasteIntoSelection(stateFreed, reads, pasteThatWaits.chosen, pasteThatWaits.toBeShown) : withNoEffects(stateFreed);
}
export function unseenPiecesMatching(runs: RunInText[], pattern: RegExp, spelled: string | null): UnseenPiece[] {
  let matches = runs.flatMap(
    ({ index, run }) =>
      Array.from(
        run.matchAll(pattern),
        (match) => ({
          from: index + match.index,
          characters: match[0],
        }),
      ),
  );
  return matches[0] === undefined
    ? []
    : [unseenPiece(matches[0].from, matches.map(({ characters }) => characters).join(''), spelled)];
}
export function sortPiecesByFrom<Piece extends PieceOfPastedText>(pieces: Piece[]): Piece[] {
  pieces.sort((pieceA, pieceB) => pieceA.from - pieceB.from);
  return pieces;
}
export function piecesOfUnseenRun({ index, run }: RunInText): UnseenPiece[] {
  let sameCharacterRuns = [...run.matchAll(SAME_CHARACTER_RUN_PATTERN)];
  if (sameCharacterRuns.length <= MAX_UNSEEN_PIECES_IN_RUN && run.search(TAG_CHARACTERS_PATTERN) === -1)
    return sameCharacterRuns.map((sameRun) => unseenPiece(index + sameRun.index, sameRun[0]));
  let spelled = spellTagCharacters(run).replaceAll(/^¦|¦$/g, '');
  return piecesOfTagRuns(
    [
      {
        index,
        run,
      },
    ],
    /[^“”¦ ]/.test(spelled) ? spelled : null,
  );
}
export function splitSeenAndUnseen(text: string): PieceOfPastedText[] {
  let unseenRuns = unseenRunsIn(text, UNSEEN_RUN_PATTERN);
  let unseenPieces = unseenRuns.flatMap(piecesOfUnseenRun);
  if (unseenPieces.length > MAX_UNSEEN_PIECES) {
    let shownText = text.replaceAll(
      UNSEEN_OR_MARK_RUN_PATTERN,
      (run: string, index: number) =>
        isPlainSpacingRun(
          {
            index,
            run,
          },
          text,
        )
          ? run
          : spellTagCharacters(run),
    );
    return [
      ...piecesOfTagRuns(unseenRunsIn(text, UNSEEN_OR_MARK_RUN_PATTERN), null),
      {
        from: 0,
        seen: shownText,
      },
    ];
  }
  let seenPieces = [0, ...unseenRuns.map(({ index, run }) => index + run.length)].map(
    (from, nth) => ({
      from,
      seen: text.slice(from, unseenRuns[nth]?.index),
    }),
  );
  return sortPiecesByFrom([...seenPieces.filter((piece) => piece.seen !== ''), ...unseenPieces]);
}
export function shownPasteThatWaits({ pasteThatWaits }: Pick<PageState, 'pasteThatWaits'>, reads: WorkbookReads): PasteThatWaitsShown | null {
  if (pasteThatWaits === null) return null;
  let cached = shownPasteThatWaitsCache.get(pasteThatWaits);
  if (cached?.reads === reads) return cached.shown;
  let { sheetId, toBeShown, nth } = pasteThatWaits;
  let rows = toBeShown.map(({ r: rowId, c: columnId, written }, index) => {
    let position = reads.positionOfCell({
      sheetId,
      rowId,
      columnId,
    });
    return {
      key: `${index} ${rowId} ${columnId}`,
      address: position === null ? null : areaToA1AsStored(areaOfPosition(position), ownRowOrderOfSheet(reads, sheetId)),
      written: cached?.shown.rows[index]?.written ?? splitSeenAndUnseen(written),
    };
  });
  let shown = {
    nth,
    rows,
  };
  shownPasteThatWaitsCache.set(pasteThatWaits, {
    reads,
    shown,
  });
  return shown;
}
export const holdPasteThatWaits = (state: PageState, paste: Omit<PasteThatWaits, 'nth'>): PageState => ({
  ...withCalendarShut(closeDropdownList(state)),
  peopleList: null,
  lastDone: null,
  notice: null,
  pasteThatWaits: {
    ...paste,
    nth: state.changesAskedFor,
  },
});
export const dropStalePasteThatWaits = (before: PageState, state: PageState): PageState =>
  state.pasteThatWaits !== null &&
  state.pasteThatWaits === before.pasteThatWaits &&
  (state.sheetId !== before.sheetId || !isSameSelection(before, state))
    ? {
        ...state,
        pasteThatWaits: null,
      }
    : state;
export const UNSEEN_RUN_PATTERN = /(?:[ \t\n\p{Zs}\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]|\p{M}{5,})+/gu;
export const UNSEEN_OR_MARK_RUN_PATTERN = /(?:[ \t\n\p{Zs}\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800“”¦]|\p{M}{5,})+/gu;
export const PLAIN_SPACING_PATTERN = /^(?: |\n{1,2} {0,16})$/;
export const NOT_SPACE_OR_LINE_PATTERN = /[^ \n]/u;
export const SAME_CHARACTER_RUN_PATTERN = /(.)\1*/gsu;
export const MAX_UNSEEN_PIECES_IN_RUN = 4;
export const MAX_UNSEEN_PIECES = 20;
export const TAG_CHARACTERS_PATTERN = /[\u{E0020}-\u{E007E}]+/gu;
export const NOT_TAG_CHARACTERS_PATTERN = /[^\u{E0020}-\u{E007E}]+/gu;
export const TAG_CHARACTER_OFFSET = 917504;
export const isPlainSpacingRun = ({ index, run }: RunInText, text: string): boolean =>
  PLAIN_SPACING_PATTERN.test(run) && index > 0 && index + run.length < text.length;
export const unseenPiece = (from: number, characters: string, spelled: string | null = null): UnseenPiece => ({
  from,
  unseen: {
    codePoint: (NOT_SPACE_OR_LINE_PATTERN.exec(characters)?.[0] ?? characters).codePointAt(0) ?? 0,
    count: characters.match(/./gsu)?.length ?? 0,
    spelled,
  },
});
export const spellTagCharacters = (text: string): string =>
  text
    .replaceAll(NOT_TAG_CHARACTERS_PATTERN, '¦')
    .replaceAll(
      TAG_CHARACTERS_PATTERN,
      (tagRun) =>
        `“${tagRun.replaceAll(/./gsu, (character) => String.fromCodePoint((character.codePointAt(0) ?? 0) - TAG_CHARACTER_OFFSET))}”`,
    )
    .replaceAll('”¦“', '¦')
    .replaceAll(/[¦ ]{2,}/g, ' ');
export const piecesOfTagRuns = (runs: RunInText[], spelled: string | null): UnseenPiece[] =>
  sortPiecesByFrom([...unseenPiecesMatching(runs, TAG_CHARACTERS_PATTERN, spelled), ...unseenPiecesMatching(runs, NOT_TAG_CHARACTERS_PATTERN, null)]);
export const unseenRunsIn = (text: string, pattern: RegExp): RunInText[] =>
  Array.from(
    text.matchAll(pattern),
    ({ 0: run, index }) => ({
      index,
      run,
    }),
  ).filter((run) => !isPlainSpacingRun(run, text));
export const shownPasteThatWaitsCache = new WeakMap<PasteThatWaits, { reads: WorkbookReads; shown: PasteThatWaitsShown }>();
