import { translateMessage } from '../i18n/messages.ts';
/** Words besides a tool's label that find it, by the key the tool is told by. */
type SearchWordsByKey = Partial<Record<string, () => string>>;
export const INSERT_SEARCH_WORDS = {
  today: () =>
    translateMessage({
      defaultMessage: 'now, current date',
      id: 'OfzeoaAOAX',
    }),
  tomorrow: () =>
    translateMessage({
      defaultMessage: 'next day, day after',
      id: 'zwWRacAcde',
    }),
  yesterday: () =>
    translateMessage({
      defaultMessage: 'day before',
      id: 'KIrb9Qm7kp',
    }),
  dropdownOfSet: () =>
    translateMessage({
      defaultMessage: 'preset, options, list, select, picker',
      id: 'woedz+QrOX',
    }),
  status: () =>
    translateMessage({
      defaultMessage: 'progress, state, stage, to do, in progress, blocked, done',
      id: 'XR0vh+pnL4',
    }),
  priority: () =>
    translateMessage({
      defaultMessage: 'importance, urgency',
      id: 'yKuFVuUfIM',
    }),
  yesNo: () =>
    translateMessage({
      defaultMessage: 'boolean, answer',
      id: 'rEzgQ/LhRi',
    }),
  approval: () =>
    translateMessage({
      defaultMessage: 'sign-off, pending, approved, rejected',
      id: 'RvV6O5fwRQ',
    }),
  health: () =>
    translateMessage({
      defaultMessage: 'rag status, red amber green, at risk',
      id: 'fZaKDg5P9Z',
    }),
  size: () =>
    translateMessage({
      defaultMessage: 't-shirt, effort, estimate',
      id: 'Fg/vfI+xh1',
    }),
};
export type InsertSearchWordsKey = keyof typeof INSERT_SEARCH_WORDS;
export const insertSearchWords = (key: InsertSearchWordsKey): string[] =>
  INSERT_SEARCH_WORDS[key]()
    .split(/[,،、，]/)
    .map((word) => word.trim())
    .filter((word) => word !== '');
export const toolLabelWithValue = (tool: string, value: string | undefined): string =>
  translateMessage(
    {
      defaultMessage: '{tool}: {value}',
      id: 'slPKCQLVQ1',
    },
    {
      tool,
      value,
    },
  );
export const TOOL_SEARCH_WORDS: SearchWordsByKey = {
  strikethrough: () =>
    translateMessage({
      defaultMessage:
        'strike, cross out, line through, strikeout, strike out, strike through, struck, struck out, crossed out, crossing out, cross off, crossed off, cross through, score out, scratch out, strikethru, strikthrough, struck through',
      id: '2OvQv15P1D',
    }),
  textColor: () =>
    translateMessage({
      defaultMessage:
        'font color, color of text, colour, font colour, text colour, letter color, letter colour, lettering, ink, recolor, recolour, colored text, coloured text, foreground',
      id: 'C3AE/L5/ea',
    }),
  fillColor: () =>
    translateMessage({
      defaultMessage:
        'fill, background, highlight, shade, colour, fill color, fill colour, background color, background colour, bg, backdrop, shading, shaded, highlighted, highlighter, highlighting, paint, paint bucket, bucket, tint, cell background, cell shading, color in, colour in, cell colour, colour cells, fills, highlights',
      id: 'opcCvWllVO',
    }),
  borders: () =>
    translateMessage({
      defaultMessage: 'lines, outline, frame, edge, edges, cell lines, boarder, boarders, edging, cell edges, draw lines, cell borders',
      id: 'NFpcvjKhcM',
    }),
  conditionalFormatting: () =>
    translateMessage({
      defaultMessage:
        'rules, highlight, color scale, conditional format, condition, conditions, rule, highlight rules, highlight if, color if, color by value, heat map, heatmap, gradient, data bars, if then, auto color, traffic light, flag values, formatting rules, icon sets, threshold, color rules',
      id: 'La4AP3GS9c',
    }),
  chart: () =>
    translateMessage({
      defaultMessage:
        'graph, plot, bar chart, line chart, pie chart, column chart, area chart, scatter plot, stacked column, stacked bar, donut, quick chart, new chart, create chart, make chart, charts, graphs, diagram, visualize, visualise',
      id: 'r214p3lov4',
    }),
  wrapText: () =>
    translateMessage({
      defaultMessage:
        'line break, fit text, text wrap, word wrap, wrapping, wrapped, wraps, multi line, multiline, long text, clipped, truncated, see all text, fit in cell, text too long, too long, multi-line, text wrapping, fit content, expand rows, newline, new line, multi-line text, cut off, cutoff, unwrap',
      id: 'vAo/XX/8Jp',
    }),
  fontSize: () =>
    translateMessage({
      defaultMessage: 'text size, letter size, type size, point size, points, pt, fontsize, size of text',
      id: '9GmokdiWvM',
    }),
  sum: () =>
    translateMessage({
      defaultMessage:
        'total, add up, totals, totaled, totalled, adding, addition, add together, plus, subtotal, grand total, sigma, summation, how much, altogether, sume, aggregate, add numbers, sums',
      id: 'z1V9zrr73h',
    }),
  average: () =>
    translateMessage({
      defaultMessage: 'mean, avg, averages, averaging, typical, on average, averge, avarage, arithmetic mean, mean value, typical value',
      id: 'OI8h07R7xC',
    }),
  min: () =>
    translateMessage({
      defaultMessage:
        'minimum, smallest, lowest, least, fewest, bottom value, earliest, minimun, minimal, lowest value, smallest value, smallest number, low point',
      id: 'Szvv5aVU/4',
    }),
  max: () =>
    translateMessage({
      defaultMessage:
        'maximum, largest, highest, biggest, greatest, top value, peak, latest, maximun, maximal, largest value, highest value, biggest number, upper limit, high point',
      id: 'c4qRaPyTtm',
    }),
  insertColumns: () =>
    translateMessage({
      defaultMessage: 'add column, new column, insert columns, add columns, more columns, another column, extra column, create column, blank column',
      id: '0u6JLVk3uS',
    }),
  insertRows: () =>
    translateMessage({
      defaultMessage: 'add row, new row, insert rows, add rows, more rows, another row, extra row, create row, blank row, a bunch of rows',
      id: 'Cd/LTGgnnx',
    }),
  customSort: () =>
    translateMessage({
      defaultMessage:
        'order, arrange, sort by, sort by column, several columns, advanced sort, sort options, reorder, rearrange, organize, organise, rank, ranking, multi-level sort, sort dialog, secondary sort, sort criteria, sort levels, multi-column sort, chronological',
      id: '0K54SVnGyl',
    }),
  showGridlines: () =>
    translateMessage({
      defaultMessage:
        'grid, grid lines, gridline, faint lines, toggle grid, sheet lines, gridlnes, hide gridlines, remove gridlines, no gridlines, turn off grid, gridlines off',
      id: '1fo+ZTG3ta',
    }),
  time: () =>
    translateMessage({
      defaultMessage: 'hours, clock, times, time of day, hour, minutes, hh mm, am pm, 12 hour, time only',
      id: 'UypxR6RyIa',
    }),
  mergeCells: () =>
    translateMessage({
      defaultMessage:
        'combine, join, merged, merging, merge and center, span, spanning, across, unite, fuse, make one cell, mege, single cell, center across, merge across, stretch across, blend',
      id: 'w8X/Ec6W/D',
    }),
  unmergeCells: () =>
    translateMessage({
      defaultMessage: 'split, separate, unmerged, unmerging, undo merge, break apart, split cells, separate cells, unjoin, uncombine',
      id: 'ZtP5SPqHZQ',
    }),
  general: () =>
    translateMessage({
      defaultMessage: 'general, default, auto, clear number format',
      id: '77DgQRcnvt',
    }),
  currency: () =>
    translateMessage({
      defaultMessage: 'money, dollar, price, currency symbol, dollars, prices, usd, cents, monetary, dollar sign, curency',
      id: 'pd1owLtnJ0',
    }),
  percent: () =>
    translateMessage({
      defaultMessage:
        'percentage, percentages, percents, per cent, pct, ratio, proportion, precent, persent, percent sign, growth rate, interest rate, percantage',
      id: 'yDdSdK/6ZO',
    }),
  roundedPercent: () =>
    translateMessage({
      defaultMessage: 'whole percent, round percent, nearest percent, percent no decimals',
      id: 'e/x1GBhHGK',
    }),
  scientific: () =>
    translateMessage({
      defaultMessage: 'exponent, scientific notation, notation, exponential, exponents, e notation, powers of ten, power of 10, sci, mantissa',
      id: 'notT1jiJPU',
    }),
  duration: () =>
    translateMessage({
      defaultMessage:
        'elapsed, hours, minutes, seconds, time spent, time taken, length of time, hours worked, timesheet, hh mm ss, runtime, running time, interval, durations, hours and minutes',
      id: 'htMrYlGZJf',
    }),
  zoom: () =>
    translateMessage({
      defaultMessage: 'scale, magnify, size',
      id: 'PdeN2FbXAT',
    }),
  zoomToFullSize: () =>
    translateMessage({
      defaultMessage:
        'scale, reset zoom, full size, actual size, normal size, default zoom, normal zoom, original size, unzoom, 100 percent, regular size, zoom reset',
      id: 'pmEhZ2AiDb',
    }),
  zoomIn: () =>
    translateMessage({
      defaultMessage: 'bigger, larger, enlarge, magnify, make bigger, see bigger, hard to read, plus, scale up, enlarge view, expand view, zoomin',
      id: 'oEAsCfG4xK',
    }),
  zoomOut: () =>
    translateMessage({
      defaultMessage:
        'smaller, shrink, further, farther, see more, fit more, overview, minus, pull back, wider view, shrink view, make smaller, scale down, zoomout, further away',
      id: 'T2p9pDucL5',
    }),
  showFormulas: () =>
    translateMessage({
      defaultMessage:
        'see formulas, view formulas, formula view, reveal formulas, display formulas, equations, toggle formulas, audit, hide formulas',
      id: '93w+1LSnWm',
    }),
  themeAutomatic: () =>
    translateMessage({
      defaultMessage: 'system, appearance, color scheme, colour scheme, auto theme, follow system, device theme, default theme',
      id: 'bSMabQqmnR',
    }),
  themeLight: () =>
    translateMessage({
      defaultMessage: 'light mode, appearance, bright, daytime, light theme, bright mode, white theme, day theme',
      id: '5dY48wajog',
    }),
  themeDark: () =>
    translateMessage({
      defaultMessage:
        'dark mode, night mode, appearance, dark theme, night time, dim, easy on the eyes, lights off, darker, night theme, black theme, eye strain, low light, midnight, dimmed',
      id: 'PdjbMlEUK0',
    }),
  layout: () =>
    translateMessage({
      defaultMessage: 'density, spacing, row height',
      id: 'TuclclAJJZ',
    }),
  undo: () =>
    translateMessage({
      defaultMessage: 'revert, go back, take back, undo last, mistake, step back, backtrack, reverse, cancel last, rollback, roll back, restore',
      id: 'Sgdr/hOtf/',
    }),
  redo: () =>
    translateMessage({
      defaultMessage: 'do again, repeat, redo last, step forward, bring back, reapply, put back, forward',
      id: 'Uh9ErQMHZV',
    }),
  find: () =>
    translateMessage({
      defaultMessage: 'search, look for, find text, find word, locate, where is, lookup, look up, seek, searching, hunt',
      id: 'xTLUQZI2UX',
    }),
  findAndReplace: () =>
    translateMessage({
      defaultMessage:
        'search, substitute, swap text, replace all, replace text, replace word, search and replace, change all, swap, swap words, bulk edit, substitution',
      id: 'RRPc//sqcA',
    }),
  keyboardShortcuts: () =>
    translateMessage({
      defaultMessage:
        'hotkeys, keys, key bindings, help, shortcut, shortcut keys, hot keys, keybindings, key combos, cheat sheet, cheatsheet, keyboard help, list of keys, navigation shortcuts',
      id: 'ZgXGBTWj26',
    }),
  number: () =>
    translateMessage({
      defaultMessage:
        'comma, thousands, delimiter, separator, digits, numbers, numeric, decimals, two decimals, 2 decimals, 2 dp, thousands separator, thousand separator, commas, comma style, figures, separators, delimiters, comma separators, plain number, two decimal places, 2 decimal places, places after the point',
      id: 'o4kzPjyrOk',
    }),
  numberInParentheses: () =>
    translateMessage({
      defaultMessage:
        'negative, accounting, brackets, negatives, negative numbers, parenthesis, parens, bracketed, bracket, round brackets, negatives in brackets',
      id: 'R+W9hdqB3/',
    }),
  'align.center': () =>
    translateMessage({
      defaultMessage: 'centre, middle, centered, centred, centering, centring, in the middle, cetner, centr, central, centralize, centralise',
      id: 'fmYcRBab4d',
    }),
  insertCheckbox: () =>
    translateMessage({
      defaultMessage:
        'tick box, tickbox, check box, todo, checkboxes, check boxes, tick boxes, checkmark, check mark, tick, ticks, checklist, check list, to do, todos, task, tasks, done, complete, completed, yes no, true false, boolean, chekbox, task list, checked',
      id: 'ud+Bb+ta2d',
    }),
  insertDropdown: () =>
    translateMessage({
      defaultMessage:
        'drop down, list, options, choices, pick list, dropdowns, drop downs, picker, picklist, selector, pull down, combo box, data validation, validation, multiple choice, status, category, categories, tags, labels, dropdwon, dropdown list, choice list, options list, dropdown menu, choose from list',
      id: 'ektCNn9c/O',
    }),
  insertPerson: () =>
    translateMessage({
      defaultMessage:
        'people, mention, assign, assignee, persons, contact, member, teammate, colleague, collaborator, assigned to, assignees, tag someone, at mention, staff, add person, tag person, people chip',
      id: 'pjMEHZ6JXy',
    }),
  insertDate: () =>
    translateMessage({
      defaultMessage:
        'calendar, day, date picker, dates, datepicker, today, deadline, due date, due, schedule, calender, choose date, add date, calendar picker',
      id: 'QvML3NqEzh',
    }),
  bold: () =>
    translateMessage({
      defaultMessage:
        'strong, stronger, heavy, heavier, emphasis, emphasize, emphasise, bolded, bolder, boldface, embolden, unbold, font weight, blod, bolding',
      id: 'r6H3sK7+hz',
    }),
  italic: () =>
    translateMessage({
      defaultMessage:
        'italics, italicize, italicise, italicized, italicised, slant, slanted, slanting, oblique, tilt, tilted, lean, leaning, sloped, itallic, italc',
      id: 'NdS0GRosAF',
    }),
  underline: () =>
    translateMessage({
      defaultMessage: 'underlined, underlining, underscore, underscored, undeline, underlne, underlines, underscoring, line under text',
      id: 'F49Ij+knmJ',
    }),
  align: () =>
    translateMessage({
      defaultMessage: 'alignment, aligned, aligning, justify, justified, justification, horizontal, horizontally, text position, allign',
      id: 'X9FR114tJu',
    }),
  'align.left': () =>
    translateMessage({
      defaultMessage: 'left aligned, flush left, to the left, push left, lft',
      id: 'GPlLJHukT+',
    }),
  'align.right': () =>
    translateMessage({
      defaultMessage: 'right aligned, flush right, to the right, push right, rigth',
      id: 'LnbysHCTWE',
    }),
  'align.general': () =>
    translateMessage({
      defaultMessage: 'auto, unaligned, natural, natural alignment, no alignment',
      id: '3gXzeJ22Bx',
    }),
  alignVertically: () =>
    translateMessage({
      defaultMessage: 'vertical alignment, valign, up and down',
      id: '1jEMrL4lED',
    }),
  'alignVertically.top': () =>
    translateMessage({
      defaultMessage: 'at the top, stick to top, anchor top',
      id: 'F1D8MIJeLt',
    }),
  'alignVertically.center': () =>
    translateMessage({
      defaultMessage: 'center, centre, centered, centred, halfway, vertical center, vertical centre, midway, mid cell',
      id: 'NVMUb12OOb',
    }),
  'alignVertically.bottom': () =>
    translateMessage({
      defaultMessage: 'at the bottom, baseline, stick to bottom, anchor bottom',
      id: '1egUG8CAIb',
    }),
  'fontSize.6': () =>
    translateMessage({
      defaultMessage: 'tiniest, microscopic, teeny, 6pt, 6 point',
      id: 'ps5yOujEPm',
    }),
  'fontSize.7': () =>
    translateMessage({
      defaultMessage: 'footnotes, 7pt, 7 point',
      id: 'ayIdNrewL5',
    }),
  'fontSize.8': () =>
    translateMessage({
      defaultMessage: 'tiny, footnote, 8pt, 8 point',
      id: 'D4XTmAYNA4',
    }),
  'fontSize.9': () =>
    translateMessage({
      defaultMessage: '9pt, 9 point',
      id: 'Uu2R3kL/rv',
    }),
  'fontSize.10': () =>
    translateMessage({
      defaultMessage: 'body text, usual size, 10pt, 10 point',
      id: 'fRwAqD8Lg5',
    }),
  'fontSize.12': () =>
    translateMessage({
      defaultMessage: '12pt, 12 point',
      id: 'wNZNxoIrgA',
    }),
  'fontSize.14': () =>
    translateMessage({
      defaultMessage: '14pt, 14 point',
      id: 'cBh4R1gl1T',
    }),
  'fontSize.18': () =>
    translateMessage({
      defaultMessage: 'big, 18pt, 18 point',
      id: 'Tw/HBPC0TH',
    }),
  'fontSize.24': () =>
    translateMessage({
      defaultMessage: 'very big, oversized, 24pt, 24 point',
      id: 'nPq+qCHEXJ',
    }),
  'fontSize.36': () =>
    translateMessage({
      defaultMessage: 'huge, giant, gigantic, enormous, massive, biggest, colossal, 36pt, 36 point',
      id: 'CLQiDXJ6YJ',
    }),
  'textColor.none': () =>
    translateMessage({
      defaultMessage: 'auto',
      id: '+6Q9gm3vQ0',
    }),
  'fillColor.none': () =>
    translateMessage({
      defaultMessage: 'unfill, unhighlight, transparent',
      id: '9shAcfWIdH',
    }),
  'color.red': () =>
    translateMessage({
      defaultMessage: 'crimson, scarlet, ruby, cherry',
      id: 'nDQ37+Q5gG',
    }),
  'color.orange': () =>
    translateMessage({
      defaultMessage: 'amber, tangerine, pumpkin, apricot, peach',
      id: 'vjkaSp5Cd7',
    }),
  'color.yellow': () =>
    translateMessage({
      defaultMessage: 'lemon, mustard, sunny, yelow',
      id: 'soOb4hJbyr',
    }),
  'color.green': () =>
    translateMessage({
      defaultMessage: 'lime, emerald, mint, olive, forest, gren',
      id: 'bAIxRLhpzp',
    }),
  'color.teal': () =>
    translateMessage({
      defaultMessage: 'turquoise, aqua, cyan, aquamarine',
      id: '3w1+Ar3Vps',
    }),
  'color.blue': () =>
    translateMessage({
      defaultMessage: 'navy, azure, sky, sky blue, cobalt, royal blue, ocean',
      id: 'LM87Lv3WWo',
    }),
  'color.purple': () =>
    translateMessage({
      defaultMessage: 'violet, lavender, plum, indigo, mauve, grape, purpel',
      id: '+/cgcHNzZ9',
    }),
  'color.magenta': () =>
    translateMessage({
      defaultMessage: 'pink, hot pink, fuchsia, fuschia, rose, raspberry, cerise',
      id: 'nfkNusIFqx',
    }),
  'color.gray': () =>
    translateMessage({
      defaultMessage: 'grey, silver, slate, ash, charcoal, muted, dim, dimmed, subtle, neutral, faded, greyed out, grayed out, deemphasize',
      id: 'p96o6+1ndS',
    }),
  'color.white': () =>
    translateMessage({
      defaultMessage: 'whiten, snow',
      id: 'KNBr45qKl3',
    }),
  'color.black': () =>
    translateMessage({
      defaultMessage: 'jet black, ebony',
      id: 'S9/24JgKet',
    }),
  'borders.all': () =>
    translateMessage({
      defaultMessage: 'every side, all sides, lattice, every border, all edges',
      id: 'hK+h1qOHhC',
    }),
  'borders.inner': () =>
    translateMessage({
      defaultMessage: 'inside, between cells, in between, inside lines, dividers, inside edges',
      id: 'oM6kV+RuRF',
    }),
  'borders.innerHorizontal': () =>
    translateMessage({
      defaultMessage:
        'between rows, row lines, horizontal lines, row dividers, lines between rows, horizontal dividers, horizontal rules, row borders',
      id: '41BnY56znn',
    }),
  'borders.innerVertical': () =>
    translateMessage({
      defaultMessage:
        'between columns, column lines, vertical lines, column dividers, lines between columns, vertical dividers, vertical rules, divide columns, column borders',
      id: 'YXG4bFfC+K',
    }),
  'borders.outer': () =>
    translateMessage({
      defaultMessage:
        'box, boxed, box in, around, outside, surround, surrounding, perimeter, exterior, rectangle, enclose, box around, boundary, outer edge, outter',
      id: '5Yb7kCkbJf',
    }),
  'borders.left': () =>
    translateMessage({
      defaultMessage: 'left side, left edge, left line, line on the left',
      id: '7pszS8Mghv',
    }),
  'borders.top': () =>
    translateMessage({
      defaultMessage: 'above, over, overline, top line, top edge, line above, line on top, top side, top rule',
      id: 'yF39FYjJjq',
    }),
  'borders.right': () =>
    translateMessage({
      defaultMessage: 'right side, right edge, right line, line on the right',
      id: 'LVnT9+PT1j',
    }),
  'borders.bottom': () =>
    translateMessage({
      defaultMessage: 'under, below, beneath, underneath, bottom line, bottom edge, line under, line below, bottom side, bottom rule',
      id: 'kUxWBm0825',
    }),
  'borders.clear': () =>
    translateMessage({
      defaultMessage: 'no borders, remove borders, delete borders, borderless, unborder, remove lines, strip borders',
      id: 'Ejagi+E1Fx',
    }),
  insertColumnLeft: () =>
    translateMessage({
      defaultMessage: 'before, to the left, column before, insert before, prepend',
      id: 'IbAnRBl1oY',
    }),
  insertColumnRight: () =>
    translateMessage({
      defaultMessage: 'after, to the right, column after, insert after, append',
      id: '+GsZOXLZnS',
    }),
  insertRowAbove: () =>
    translateMessage({
      defaultMessage: 'before, over, on top, row before',
      id: 'fshheNb8qM',
    }),
  insertRowBelow: () =>
    translateMessage({
      defaultMessage: 'after, under, underneath, beneath, row after, row underneath, append',
      id: 'k+DgaGL3DK',
    }),
  calculations: () =>
    translateMessage({
      defaultMessage: 'calculate, calculation, compute, work out, formula, function, math, maths, stats, statistics',
      id: 'JwDe4ERv2R',
    }),
  count: () =>
    translateMessage({
      defaultMessage: 'how many, tally, quantity, qty, entries, items, counting, counted, counts, cuont, item count, enumerate',
      id: 'OYfKCwng7B',
    }),
  numberFormat: () =>
    translateMessage({
      defaultMessage: 'format as, show as, display as, formatting, number format, number style, cell format, data type',
      id: 'gQLZNkemKz',
    }),
  roundedNumber: () =>
    translateMessage({
      defaultMessage:
        'whole, whole number, whole numbers, integer, integers, no decimals, no decimal places, zero decimals, 0 decimals, round, rounding, round off, nearest whole, without decimals, drop decimals, nothing after the point',
      id: 'jikji3oZGm',
    }),
  roundedCurrency: () =>
    translateMessage({
      defaultMessage: 'whole dollars, no cents, round dollars, whole amounts, nearest dollar, money, dollars, without cents, round money, drop cents',
      id: 'vviirkAR4z',
    }),
  text: () =>
    translateMessage({
      defaultMessage: 'text, keep zeros, string',
      id: 'uCNuULe68I',
    }),
  date: () =>
    translateMessage({
      defaultMessage: 'dates, short date, numeric date, mm dd yyyy, dd mm yyyy, slashes, daet, slash date',
      id: '/Plsd5QPDW',
    }),
  mediumDate: () =>
    translateMessage({
      defaultMessage: 'medium date, abbreviated month, month abbreviation, abbreviated date, three letter month, short month name, mar 15 2026',
      id: 'qOI35+Mbbh',
    }),
  longDate: () =>
    translateMessage({
      defaultMessage: 'long date, full date, month name, written out, full month name, month spelled out, formal date, march 15 2026',
      id: '84ga77gQLb',
    }),
  monthAndDay: () =>
    translateMessage({
      defaultMessage: 'date, day and month, month day, day month, mar 15',
      id: 'd4IYgSVjNa',
    }),
  monthAndYear: () =>
    translateMessage({
      defaultMessage: 'date, monthly, month year, year month, billing month, mar 2026',
      id: '5MjribPi/C',
    }),
  dateAndTime: () =>
    translateMessage({
      defaultMessage: 'datetime, timestamp, time stamp, date with time, day and hour, timestamps, with time, time too',
      id: 'tNu4+HD3jX',
    }),
  phoneNumber: () =>
    translateMessage({
      defaultMessage: 'phone number, telephone, tel, mobile, fax',
      id: 'S92heMvjeU',
    }),
  customFormat: () =>
    translateMessage({
      defaultMessage:
        'custom number format, own format, pattern, format code, format string, mask, make my own, advanced format, units, suffix, prefix, leading zeros, phone number, zip code, fraction, number pattern, create format, define format, special format, custom number formatting, decimal places, 1 decimal, 3 decimals, 4 decimals, 5 decimals, one decimal, three decimals, four decimals, five decimals, 1 dp, 3 dp, weekday, day of the week, year only, just the year, quarter, seconds',
      id: '6CeJAQibMA',
    }),
  fewerDecimalPlaces: () =>
    translateMessage({
      defaultMessage:
        'fewer decimals, less decimals, remove decimal, remove decimals, reduce decimals, less precise, less precision, round, round off, shorten number, drop a decimal, fewer digits, drop decimals, trim decimals, lower precision, hide decimals, adjust decimals, one less decimal, one fewer decimal',
      id: 'vbpbgPqQXZ',
    }),
  moreDecimalPlaces: () =>
    translateMessage({
      defaultMessage:
        'more decimals, add decimal, add decimals, extra decimal, more precise, precision, more digits, extra decimals, show decimals, greater precision, higher precision, add digits, more precision, longer number, adjust decimals, one more decimal',
      id: 'Uxdjdqfl9s',
    }),
  checkAll: () =>
    translateMessage({
      defaultMessage: 'tick all, check every box, check boxes, mark all done, complete all, all done, all true',
      id: 'wi17xC1fhA',
    }),
  uncheckAll: () =>
    translateMessage({
      defaultMessage: 'clear all, untick all, uncheck boxes, unmark all, reset checkboxes, none done, all false',
      id: '99LnGVhI1P',
    }),
  optionsOfDropdown: () =>
    translateMessage({
      defaultMessage:
        'edit dropdown, edit options, edit list, edit choices, change options, change choices, dropdown settings, manage options, list items, add option, values',
      id: 'IldXBpVeTq',
    }),
  insert: () =>
    translateMessage({
      defaultMessage: 'insert, add, new, create, make, put in',
      id: '1FzsHtPHVV',
    }),
  zoomToChart: () =>
    translateMessage({
      defaultMessage:
        'fit chart, fit to chart, focus chart, whole chart, center chart, graph, chart view, zoom graph, enlarge chart, show chart, focus graph, expand chart',
      id: 'fBSOsXxnQi',
    }),
  'layout.comfortable': () =>
    translateMessage({
      defaultMessage: 'spacious, relaxed, airy, more space, taller rows, loose, cozy, cosy, padding, comfy, spread out, wide spacing, roomy',
      id: 'N/g+a+2TSc',
    }),
  'layout.compact': () =>
    translateMessage({
      defaultMessage:
        'dense, condensed, narrow rows, smaller rows, shorter rows, fit more rows, less space, squeeze, cramped, less padding, narrow spacing, tight',
      id: 'P+RGQCMeuZ',
    }),
  textColorPicker: () =>
    translateMessage({
      defaultMessage: 'custom color, custom colour, more colors, more colours, hex, rgb, eyedropper, color picker, colour picker, palette, swatches',
      id: 'Sqbji6NnWa',
    }),
  fillColorPicker: () =>
    translateMessage({
      defaultMessage: 'custom color, custom colour, more colors, more colours, hex, rgb, eyedropper, color picker, colour picker, palette, swatches',
      id: 'eXBgGJy7Is',
    }),
  'fontSize.11': () =>
    translateMessage({
      defaultMessage: '11pt, 11 point',
      id: 'fNQzh8tPGF',
    }),
  locale: () =>
    translateMessage({
      defaultMessage:
        'language, region, country, regional settings, regional format, decimal point, international, localization, localisation, locales, decimal separator',
      id: 'lOfZMJlUHj',
    }),
  timeZone: () =>
    translateMessage({
      defaultMessage: 'timezone, clock, UTC, time zones, gmt, local time, offset, daylight saving, tz, world time, hour offset, greenwich',
      id: 'kmVjZQe1po',
    }),
  borderInTheSingular: () =>
    translateMessage({
      defaultMessage: 'border',
      id: 'BudGsflN1X',
    }),
  bordersPanel: () =>
    translateMessage({
      defaultMessage: 'line style, line weight, thickness, border thickness',
      id: '1APNcrpo5P',
    }),
  borderColor: () =>
    translateMessage({
      defaultMessage: 'colour',
      id: 'gXoXcjHyvd',
    }),
};
export const toolSearchWords = (...keys: string[]): string[] =>
  keys.flatMap(
    (key) =>
      (TOOL_SEARCH_WORDS[key]?.() ?? '')
        .split(/[,،、，]/)
        .map((word) => word.trim())
        .filter((word) => word !== ''),

  );
