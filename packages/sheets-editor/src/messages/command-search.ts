import { translateMessage } from '../i18n/messages.ts';
export const menuMatchCountWords = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =0 {No matches} one {# match} other {# matches}}',
      id: 'spEc3ohsSH',
    },
    {
      count,
    },
  );
export const menuMatchCountChooseRowWords = (count: number, rowLabel: string): string =>
  translateMessage(
    {
      defaultMessage:
        '{count, plural, =0 {No matches. Press Enter to choose {row}.} one {# match. Press Enter to choose {row}.} other {# matches. Press Enter to choose {row}.}}',
      id: 'ifGhEIViDK',
    },
    {
      count,
      row: rowLabel,
    },
  );
export const pressEnterAgainToConfirmWords = (rowLabel: string): string =>
  translateMessage(
    {
      defaultMessage: 'Press Enter again to confirm {row}.',
      id: '+61OGUoGO2',
    },
    {
      row: rowLabel,
    },
  );
export const COMMAND_SEARCH_SYNONYMS = {
  comment: () =>
    translateMessage({
      defaultMessage:
        'note, remark, feedback, discuss, annotate, reply, thread, comments, sticky note, suggestion, review, conversation, memo, message, mention, tag someone, question, annotation, coment, commnet',
      id: '8rxMNHXNv3',
    }),
  openLink: () =>
    translateMessage({
      defaultMessage:
        'go to, visit, follow, browse, launch, navigate, jump to, url, web address, website, web page, hyperlink, external, click through',
      id: 'g5Uv6hqc/x',
    }),
  copyLinkAddress: () =>
    translateMessage({
      defaultMessage: 'url, web address, website address, hyperlink, href, grab link, get link, clipboard',
      id: 'lK8cUZ4WSY',
    }),
  linkByHand: () =>
    translateMessage({
      defaultMessage:
        'hyperlink, url, web address, website, add link, create link, attach link, link text, rename link, change link, href, linkify, hyper link, lnik',
      id: '/iQDJI7Kt3',
    }),
  cut: () =>
    translateMessage({
      defaultMessage: 'scissors, snip, relocate, transfer, clipboard, cutt',
      id: 'EuEuM8Zxm0',
    }),
  copy: () =>
    translateMessage({
      defaultMessage: 'duplicate, clone, replicate, reproduce, repeat, grab, clipboard, coppy, copie',
      id: '5Fr6SvlLa3',
    }),
  paste: () =>
    translateMessage({
      defaultMessage: 'insert clipboard, from clipboard, put, put here, put back, drop in, stick in, bring in, place here, insert copied, paist',
      id: 'XWzk2lcSut',
    }),
  pasteValuesOnly: () =>
    translateMessage({
      defaultMessage:
        'paste without formatting, paste options, paste special, plain, unformatted, text only, numbers only, data only, results only, no formulas, without formulas, as text, raw, hard code, hardcode, flatten, keep values, no style',
      id: 'AcrmdQxdBE',
    }),
  insertRowAbove: () =>
    translateMessage({
      defaultMessage:
        'add row, add rows, add more rows, new row, blank row, extra row, create row, row before, on top, prepend, add record, push down',
      id: 'soZX2Rw5dS',
    }),
  insertRowBelow: () =>
    translateMessage({
      defaultMessage:
        'add row, add rows, add more rows, new row, blank row, extra row, create row, row after, next row, underneath, beneath, append, add record',
      id: 'q7T/7EKtQb',
    }),
  insertColumnLeft: () =>
    translateMessage({
      defaultMessage:
        'add column, add columns, add more columns, add col, new column, blank column, extra column, create column, column before, prepend, add field, new field, coloumn, colum',
      id: '0b8q7zDb6O',
    }),
  insertColumnRight: () =>
    translateMessage({
      defaultMessage:
        'add column, add columns, add more columns, add col, new column, blank column, extra column, create column, column after, next column, append, add field, new field, coloumn, colum',
      id: 'hSPJV2ahbv',
    }),
  moveRowsUp: () =>
    translateMessage({
      defaultMessage: 'shift up, nudge up, bump up, drag up, raise, lift, higher, earlier, upward, swap above, reorder rows, rearrange rows, promote',
      id: 'Exm3f/oip/',
    }),
  moveRowsDown: () =>
    translateMessage({
      defaultMessage: 'shift down, nudge down, bump down, drag down, lower, later, downward, swap below, reorder rows, rearrange rows, demote',
      id: '2j3tG25Y4M',
    }),
  moveColumnsLeft: () =>
    translateMessage({
      defaultMessage: 'shift left, nudge left, slide left, drag left, earlier, back, swap left, reorder columns, rearrange columns',
      id: 'ARvDC2XImw',
    }),
  moveColumnsRight: () =>
    translateMessage({
      defaultMessage: 'shift right, nudge right, slide right, drag right, later, forward, swap right, reorder columns, rearrange columns',
      id: 'iU6daeoPxL',
    }),
  clearContents: () =>
    translateMessage({
      defaultMessage:
        'empty, erase, wipe, blank out, delete text, delete values, delete data, delete cells, remove data, remove text, clean, purge, backspace, clear cells, clear data',
      id: 'JC9D7vePyd',
    }),
  deleteRows: () =>
    translateMessage({
      defaultMessage: 'remove row, erase row, drop row, trash, get rid of, discard, eliminate, delete record, remove record, delte',
      id: 'xM10DSLyZN',
    }),
  deleteColumns: () =>
    translateMessage({
      defaultMessage:
        'remove column, erase column, drop column, trash, get rid of, discard, eliminate, delete field, remove field, delete col, delte, coloumn',
      id: 'GJ3T5lstc9',
    }),
  resizeRows: () =>
    translateMessage({
      defaultMessage:
        'row height, taller, shorter, bigger rows, smaller rows, stretch, shrink, expand, fit, fit the content, autofit, auto fit, line height, set height, adjust height, size',
      id: 'zmAik2m0ai',
    }),
  resizeColumns: () =>
    translateMessage({
      defaultMessage:
        'column width, wider, narrower, widen, bigger column, smaller column, stretch, shrink, expand, fit, fit the content, autofit, auto fit, set width, adjust width, size',
      id: 'zut9zdcXHs',
    }),
  groupLines: () =>
    translateMessage({
      defaultMessage: 'hide, hiding, hide row, hide rows, hide column, hide columns, conceal, tuck away, bundle, fold',
      id: '7Tk6yGziwy',
    }),
  ungroupLines: () =>
    translateMessage({
      defaultMessage: 'remove group, delete group, unbundle',
      id: '1+jOTWZQh9',
    }),
  collapseGroups: () =>
    translateMessage({
      defaultMessage:
        'hide, hiding, hide row, hide rows, hide column, hide columns, conceal, tuck away, invisible, out of sight, disappear, fold, close group',
      id: 'eUbPamosQz',
    }),
  expandGroups: () =>
    translateMessage({
      defaultMessage: 'unhide, show, show rows, show columns, reveal, unfold, open group',
      id: 'tFUPGh09NX',
    }),
  sortAscending: () =>
    translateMessage({
      defaultMessage:
        'a to z, a-z, az, abc, alphabetical, alphabetize, alphabetise, order, arrange, organize, rank, smallest first, lowest first, low to high, increasing, oldest first, earliest first, ascnding',
      id: 'QXOIY5EQMW',
    }),
  sortDescending: () =>
    translateMessage({
      defaultMessage:
        'z to a, z-a, za, reverse alphabetical, reverse order, backwards, order, arrange, organize, rank, largest first, biggest first, highest first, high to low, decreasing, newest first, latest first, decending',
      id: '60+hSc/h2h',
    }),
  customSort: () =>
    translateMessage({
      defaultMessage:
        'order, arrange, organize, advanced sort, sort by column, several columns, multiple columns, multi-column sort, multi level, sort options, sort settings, then by, secondary sort, sort levels',
      id: 'EdGwmksS77',
    }),
  sortAndFilter: () =>
    translateMessage({
      defaultMessage: 'sort and filter, sort, sorting, filters, filtering, add filter, new filter, narrow down',
      id: 'sJWzUfooT2',
    }),
  freezeRows: () =>
    translateMessage({
      defaultMessage:
        'pin, stick, sticky header, keep in view, keep visible, stay on screen, anchor, header row, top row, first row, title row, freeze panes, frozen rows, freez, frezze',
      id: '9ovCcyebGh',
    }),
  freezeColumns: () =>
    translateMessage({
      defaultMessage:
        'pin, stick, sticky column, keep in view, keep visible, stay on screen, anchor, first column, left column, label column, freeze panes, frozen columns, freez, frezze',
      id: 'dK/54j11iz',
    }),
  unfreezeRows: () =>
    translateMessage({
      defaultMessage: 'unfreeze, unpin, unstick, thaw, release, remove freeze, stop freezing, scroll freely, unfreeze panes, unfrozen',
      id: 'Cw2JK5rOZc',
    }),
  unfreezeColumns: () =>
    translateMessage({
      defaultMessage: 'unfreeze, unpin, unstick, thaw, release, remove freeze, stop freezing, scroll freely, unfreeze panes, unfrozen',
      id: 'SPQncKFLa9',
    }),
  mergeCells: () =>
    translateMessage({
      defaultMessage:
        'combine, join, unite, fuse, blend, connect, one cell, single cell, big cell, span, stretch across, center across, merge and center, consolidate, merged cells, mearge, mege',
      id: 'JQ2rz4NQML',
    }),
  unmergeCells: () =>
    translateMessage({
      defaultMessage: 'split, separate, remove merge, break apart, divide, unjoin, uncombine, pull apart, un-merge, demerge, unmearge',
      id: 'YrEbdgnSPV',
    }),
  convertTexts: () =>
    translateMessage({
      defaultMessage:
        'text to number, text to date, numbers stored as text, number stored as text, apostrophe, fix numbers, make numbers, as number, to number, to date, parse, value, sum is 0, not adding up, left aligned, clean up',
      id: 'al+qwLPQtT',
    }),
  clearFormatting: () =>
    translateMessage({
      defaultMessage:
        'reset, plain, normal, remove style, remove styles, remove formatting, strip, unstyle, no format, wipe format, erase formatting, clean, formating',
      id: 'dEGZGyY7VF',
    }),
  formatAsTable: () =>
    translateMessage({
      defaultMessage: 'not a table, treat as a table, table formatting, table style, table look, detect table, gray header, pinned header',
      id: 'TKyjd8yVqK',
    }),
  conditionalFormatting: () =>
    translateMessage({
      defaultMessage:
        'rule, rules, highlight, color scale, color by value, by value, by formula, colour, heat map, heatmap, gradient, traffic light, color code, color coding, flag, threshold, if then, format if, format when, duplicates, greater than, less than, data bars, conditonal, contitional',
      id: 'C+kgun//jE',
    }),
  pivotTable: () =>
    translateMessage({
      defaultMessage:
        'pivot, pivottable, summarize, summary, summary table, group by, totals by, subtotals, breakdown, crosstab, cross tab, roll up, rollup, aggregate',
      id: 'juVz+WyTiT',
    }),
  cellHistory: () =>
    translateMessage({
      defaultMessage:
        'edit history, cell history, row history, who changed, who edited, versions, version history, revision history, revisions, changes, change log, changelog, track changes, audit trail, last edited, modified by, previous values, old values, log',
      id: 'T6Cf4SKHRd',
    }),
};
export type CommandWithSynonyms = keyof typeof COMMAND_SEARCH_SYNONYMS;
export const commandSearchSynonyms = (command: CommandWithSynonyms): string[] =>
  COMMAND_SEARCH_SYNONYMS[command]()
    .split(/[,،、，]/)
    .map((synonym) => synonym.trim())
    .filter((synonym) => synonym !== '');
