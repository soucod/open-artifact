import { foldLabelCase } from '../chips/dropdown-options.ts';
import { toolUnavailableText } from '../i18n/chip-labels.ts';
import { dropdownPaneMessages } from '../i18n/format-labels.ts';
import { insertSearchWords, toolLabelWithValue } from './search-words.ts';
import { shortcutKeysFor } from '../keys/shortcut-list.ts';
import type { DropdownSelectionSummary } from '../chips/dropdown-editor.ts';
import type { InsertOffer } from '../chips/people-list.ts';
import type { LocalizedDropdownPreset } from '../i18n/chip-labels.ts';
import type { AtMenuOffer } from '../i18n/menu-labels.ts';
import type { DropdownCommand } from '../format/format-commands.ts';
import type { IconName } from '../kit/icon.tsx';
import type { PageEvent } from '../state/event-reducer.ts';
import type { ViewOnlyBecause } from '../view/page-view.ts';
/** What a tool costs the cells it acts on: the values it clears or the formulas it replaces. */
export interface ToolCost {
  kind: 'clears' | 'replaces';
  count: number;
}
/** A tool the search menu offers that puts something into cells. */
export interface InsertTool {
  id: string;
  label: string;
  otherWords: string[];
  icon: IconName;
  actsOn: 'activeCell' | 'cells';
  whyNot: string | null;
  isWeighty: boolean;
  keys?: string;
  cost?: ToolCost;
  run(): void;
}
/** A control the cells can be given, as the insert menu offers it. */
export interface InsertChoiceOfTools {
  what: string;
  fits: boolean;
  whyNotNow?: string;
}
/** What the insert tools depend on about the selection. */
export interface SelectionForInsertTools {
  offers: readonly AtMenuOffer[];
  viewOnlyBecause: ViewOnlyBecause | null;
  whyNoToolForCells: string | null;
  inserts: readonly InsertChoiceOfTools[];
  setMeets: DropdownSelectionSummary | null;
}
export interface InsertToolActions {
  onFormatChosen(command: DropdownCommand): void;
  dispatch(event: PageEvent): void;
  onDayChosen: ((day: string) => void) | null;
}
export type DayOfferKey = (typeof DAY_OFFER_KEYS)[number];
export function withDropdownCost(
  set: LocalizedDropdownPreset,
  setMeets: DropdownSelectionSummary | null,
  tool: InsertTool,
): InsertTool {
  if (setMeets === null) return tool;
  let setLabels = new Set(set.options.map(({ label }) => foldLabelCase(label)));
  let otherCount = setMeets.otherCount;
  for (let [said, saidCount] of setMeets.said) if (!setLabels.has(said)) otherCount += saidCount;
  if (otherCount > 0)
    return {
      ...tool,
      cost: {
        kind: 'clears',
        count: otherCount + setMeets.formulaCount,
      },
    };
  return setMeets.formulaCount > 0
    ? {
        ...tool,
        cost: {
          kind: 'replaces',
          count: setMeets.formulaCount,
        },
      }
    : tool;
}
export function insertTools(selectionTools: SelectionForInsertTools, actions: InsertToolActions): InsertTool[] {
  if (selectionTools.viewOnlyBecause !== null) return [];
  let { onDayChosen } = actions;
  let offers = flattenOffers(selectionTools.offers);
  let dropdownInsert = selectionTools.inserts.find(({ what }) => what === 'dropdown');
  let canInsertDropdown = (dropdownInsert?.fits ?? true) && (selectionTools.setMeets?.isTaken ?? true);
  let whyNoDropdown =
    selectionTools.whyNoToolForCells ??
    (canInsertDropdown ? (dropdownInsert?.whyNotNow ?? null) : toolUnavailableText(dropdownPaneMessages.dropdown()));
  return [
    ...offers
      .filter((offer) => offer.kind === 'day')
      .flatMap(({ label, day }, dayIndex): InsertTool[] => {
        let dayKey: DayOfferKey | undefined = DAY_OFFER_KEYS[dayIndex];
        if (dayKey === undefined) return [];
        let dayTool: Omit<InsertTool, 'run'> = {
          id: `at.${dayKey}`,
          label,
          otherWords: insertSearchWords(dayKey),
          icon: 'Calendar',
          actsOn: 'activeCell',
          whyNot: selectionTools.whyNoToolForCells,
          isWeighty: true,
        };

        if (dayKey === 'today')
          return [
            {
              ...dayTool,
              keys: shortcutKeysFor('enterToday'),
              run: () =>
                actions.dispatch({
                  kind: 'keyPressed',
                  key: ';',
                  isShiftHeld: false,
                  isModifierHeld: true,
                  isAltHeld: false,
                  isRepeat: false,
                  today: day,
                }),
            },
          ];
        return onDayChosen === null
          ? []
          : [
              {
                ...dayTool,
                run: () => onDayChosen(day),
              },
            ];
      }),
    ...offers
      .filter((offer) => offer.kind === 'dropdownOfSet')
      .map(
        ({ label, set }) =>
          withDropdownCost(set, selectionTools.setMeets, {
            id: `bar.insert.dropdown.${set.key}`,
            label: toolLabelWithValue(dropdownPaneMessages.dropdown(), label),
            otherWords: [...insertSearchWords(set.key), ...insertSearchWords('dropdownOfSet')],
            icon: 'Dropdown',
            actsOn: 'cells',
            whyNot: whyNoDropdown,
            isWeighty: true,
            run: () =>
              actions.onFormatChosen({
                dropdown: true,
                firstSet: set,
                isReadySetPicked: true,
                replacesFormulas: true,
                thenOpens: 'list',
              }),
          }),
      ),
  ];
}
export const DAY_OFFER_KEYS = ['today', 'tomorrow', 'yesterday'] as const;
export const flattenOffers = (offers: readonly AtMenuOffer[]): InsertOffer[] =>

  offers.flatMap((offer) => (offer.kind === 'several' ? flattenOffers(offer.offers) : [offer]));
