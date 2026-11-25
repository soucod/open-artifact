import type { FontMark } from '../state/initial-state.ts';
import { translateMessage } from './messages.ts';
/** A run of characters a cell holds but does not show: the first one, how many, and how they read when spelled out. */
export interface CharactersNotSeen {
  codePoint: number;
  count: number;
  spelled: string | null;
}
export function textStyleLabel(textStyle: FontMark): string {
  switch (textStyle) {
    case 'bold':
      return translateMessage({
        defaultMessage: 'Bold',
        id: 'MkFnHIam8T',
      });
    case 'italic':
      return translateMessage({
        defaultMessage: 'Italic',
        id: 'YRGOAmYxWe',
      });
    case 'underline':
      return translateMessage({
        defaultMessage: 'Underline',
        id: 'ypOMSPBv5h',
      });
    case 'strikethrough':
      return translateMessage({
        defaultMessage: 'Strikethrough',
        id: 'GjOtF2zrW5',
      });
  }
}
export const sheetMessages = {
  comments: (count: number): string =>
    translateMessage(
      {
        defaultMessage: '{count, plural, =0 {Comment} one {Comment (#)} other {Comment (#)}}',
        id: 'UAqKP0k5te',
      },
      {
        count,
      },
    ),
  openComments: (count: number): string =>
    translateMessage(
      {
        defaultMessage: '{count, plural, one {Comment, # open} other {Comment, # open}}',
        id: 'IoEOsPCMVh',
      },
      {
        count,
      },
    ),
  barOfReader: () =>
    translateMessage({
      defaultMessage: 'Comments',
      id: 'rTs6g1aJiG',
    }),
  cancel: () =>
    translateMessage({
      defaultMessage: 'Cancel',
      id: '5BMTdkyyxk',
    }),
  pasteCellsWithHiddenText: () =>
    translateMessage({
      defaultMessage: 'Paste cells with hidden text?',
      id: 'F0OgNvAO+j',
    }),
  cellsContainTextNotShown: () =>
    translateMessage({
      defaultMessage: 'Some cells you’re pasting contain text they don’t show, which Agent can still read.',
      id: 'bnMD1Cd2h4',
    }),
  charactersNotSeen: ({ codePoint, count, spelled }: CharactersNotSeen): string => {
    let character = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    if (spelled !== null)
      return translateMessage(
        {
          defaultMessage: '{character} ×{count, number} = {spelled}',
          id: '6yJrZKUeES',
        },
        {
          character,
          count,
          spelled,
        },
      );
    return count === 1
      ? character
      : translateMessage(
          {
            defaultMessage: '{character} ×{count, number}',
            id: 'daxGotp6m2',
          },
          {
            character,
            count,
          },
        );
  },
  pasteAnyway: () =>
    translateMessage({
      defaultMessage: 'Paste anyway',
      id: 'uSjb4r1Ero',
    }),
  close: () =>
    translateMessage({
      defaultMessage: 'Close',
      id: 'MNsH3CNWHf',
    }),
  resizePane: () =>
    translateMessage({
      defaultMessage: 'Resize panel',
      id: 'WSuLv26dRn',
    }),
  customFormat: () =>
    translateMessage({
      defaultMessage: 'Custom format',
      id: 'qAQQ2itY1t',
    }),
  phoneNumber: () =>
    translateMessage({
      defaultMessage: 'US phone number',
      id: 'SEqrWEd4fR',
    }),
  findNumberFormat: () =>
    translateMessage({
      defaultMessage: 'Find a type or format, or describe one',
      id: 'fhYdFphSU5',
    }),
  otherCurrencies: () =>
    translateMessage({
      defaultMessage: 'Other currencies',
      id: 'ASv+O+O/4q',
    }),
  sheetSettings: () =>
    translateMessage({
      defaultMessage: 'Sheet settings',
      id: 'ro/k/465hO',
    }),
  decreaseDecimalPlaces: () =>
    translateMessage({
      defaultMessage: 'Decrease decimal places',
      id: 'yp/2WlutyP',
    }),
  increaseDecimalPlaces: () =>
    translateMessage({
      defaultMessage: 'Increase decimal places',
      id: 'q3Jek0wH6S',
    }),
  decimalPlacesOfNoNumbers: () =>
    translateMessage({
      defaultMessage: 'Select cells with numbers.',
      id: 'WmkpdIcJiW',
    }),
  decimalPlacesOfFormatsThatDiffer: () =>
    translateMessage({
      defaultMessage: 'Select cells in one number format.',
      id: 'KYGBKmlsUw',
    }),
  decimalPlacesOfDropdownsAndCheckboxes: () =>
    translateMessage({
      defaultMessage: 'Not for dropdowns or checkboxes.',
      id: 'xgTZ5kOSZo',
    }),
  decimalPlacesOfFormatWithNone: () =>
    translateMessage({
      defaultMessage: 'Choose another number format.',
      id: 'Yslj3ev2ss',
    }),
  noDecimalPlacesToRemove: () =>
    translateMessage({
      defaultMessage: 'The lowest is 0 decimal places.',
      id: 'DDTlbqcR74',
    }),
  apply: () =>
    translateMessage({
      defaultMessage: 'Apply',
      id: 'tFQnZI2rKe',
    }),
  widthInPixels: () =>
    translateMessage({
      defaultMessage: 'Width in pixels',
      id: '5hCAqXpjE9',
    }),
  heightInPixels: () =>
    translateMessage({
      defaultMessage: 'Height in pixels',
      id: 'P+K/iyRvhY',
    }),
  columnWidth: () =>
    translateMessage({
      defaultMessage: 'Column width',
      id: 'AnwZjshCNV',
    }),
  setWidth: () =>
    translateMessage({
      defaultMessage: 'Set width',
      id: 'A4bhHxw+wO',
    }),
  fitColumnToText: () =>
    translateMessage({
      defaultMessage: 'Fit to text',
      id: 'ofze9XGaI0',
    }),
  rowHeight: () =>
    translateMessage({
      defaultMessage: 'Row height',
      id: 'li4Swl4luj',
    }),
  setHeight: () =>
    translateMessage({
      defaultMessage: 'Set height',
      id: 'SqztRoGF0u',
    }),
  fitToText: () =>
    translateMessage({
      defaultMessage: 'Fit to text',
      id: 'ipqFlo6/Gl',
    }),
  fontSize: () =>
    translateMessage({
      defaultMessage: 'Font size',
      id: 'VNysLluajg',
    }),
  sheetTheme: () =>
    translateMessage({
      defaultMessage: 'Sheet theme',
      id: 'qPCUSw/4qx',
    }),
  themeAutomatic: () =>
    translateMessage({
      defaultMessage: 'Automatic',
      id: 'Lk0FVFsu4Y',
    }),
  themeLight: () =>
    translateMessage({
      defaultMessage: 'Light',
      id: 'rh+nepm1VK',
    }),
  themeDark: () =>
    translateMessage({
      defaultMessage: 'Dark',
      id: 'hGmCyGhtuL',
    }),
  zoomPercent: (percent: number): string =>
    translateMessage(
      {
        defaultMessage: '{percent}%',
        id: 'eBqb+3H9qP',
      },
      {
        percent,
      },
    ),
  zoomButton: (percent: number): string =>
    translateMessage(
      {
        defaultMessage: '{percent}%, Zoom',
        id: 'mvdhKnhzUj',
      },
      {
        percent,
      },
    ),
  zoom: () =>
    translateMessage({
      defaultMessage: 'Zoom',
      id: 'NxrMp7vtyE',
    }),
  zoomIn: () =>
    translateMessage({
      defaultMessage: 'Zoom in',
      id: 'iGycxXAin1',
    }),
  zoomOut: () =>
    translateMessage({
      defaultMessage: 'Zoom out',
      id: 'M1v4IFNTa2',
    }),
  zoomReset: () =>
    translateMessage({
      defaultMessage: 'Reset to 100%',
      id: 'JECccUP6rV',
    }),
  zoomToChart: () =>
    translateMessage({
      defaultMessage: 'Zoom to chart',
      id: 'Y4bcJ60ZC9',
    }),
  zoomNow: (percent: number): string =>
    translateMessage(
      {
        defaultMessage: 'Now {percent}%',
        id: 'i6l9Psr7s3',
      },
      {
        percent,
      },
    ),
  zoomSaid: (percent: number): string =>
    translateMessage(
      {
        defaultMessage: 'Zoom {percent}%',
        id: '479HjoGpJ8',
      },
      {
        percent,
      },
    ),
  signOfMixedFontSizes: () =>
    translateMessage({
      defaultMessage: '–',
      id: '2uvZvawEIU',
    }),
  signOfMixedTextWrappings: () =>
    translateMessage({
      defaultMessage: '–',
      id: 'qY8NFW0ADL',
    }),
  insert: () =>
    translateMessage({
      defaultMessage: 'Insert',
      id: 'khl0YP8a4D',
    }),
  personCells: () =>
    translateMessage({
      defaultMessage: 'Person',
      id: 'X57wu8ePX4',
    }),
  dateCells: () =>
    translateMessage({
      defaultMessage: 'Date',
      id: 'jrDTRhARyA',
    }),
  checkboxCells: () =>
    translateMessage({
      defaultMessage: 'Checkbox',
      id: '1tWBmKyazs',
    }),
  borders: () =>
    translateMessage({
      defaultMessage: 'Borders',
      id: 'RvRq4AV6bU',
    }),
  openLink: () =>
    translateMessage({
      defaultMessage: 'Open link',
      id: 'IOVR2N7po2',
    }),
  copyLinkAddress: () =>
    translateMessage({
      defaultMessage: 'Copy link address',
      id: '6Rk6tYRbs9',
    }),
  wholeLinkAddress: () =>
    translateMessage({
      defaultMessage: 'Full address',
      id: 'qtUCqg7HeC',
    }),
  linkAddressIsBuilt: () =>
    translateMessage({
      defaultMessage: 'Address built by a formula',
      id: 'OTHJKU7Rv+',
    }),
  aboutBuiltLinkAddress: () =>
    translateMessage({
      defaultMessage: 'About this address',
      id: 'hiCPAEqV1C',
    }),
  whyBuiltLinkAddressIsMarked: () =>
    translateMessage({
      defaultMessage: 'A formula sets this address. Check the formula before you open the link.',
      id: 'bQUawoiSbj',
    }),
  whyLinkIsKeptBack: () =>
    translateMessage({
      defaultMessage: 'There isn’t room to show the address. Make the window larger.',
      id: '1K+JTURCaD',
    }),
  editLink: () =>
    translateMessage({
      defaultMessage: 'Edit link',
      id: '1/Gk4DwI2P',
    }),
  blankCell: () =>
    translateMessage({
      defaultMessage: 'blank',
      id: '1+NAtGScXr',
    }),
  link: () =>
    translateMessage({
      defaultMessage: 'Link',
      id: '5voBHf5em2',
    }),
  errorInThisCell: () =>
    translateMessage({
      defaultMessage: 'Error in this cell',
      id: 'qW1YY3q1OE',
    }),
  moreActions: () =>
    translateMessage({
      defaultMessage: 'More actions',
      id: 'zmJ3puCXtN',
    }),
  errorsOnThisSheet: () =>
    translateMessage({
      defaultMessage: 'Errors on this sheet',
      id: 'fa1wl+levy',
    }),
  dismissErrorsOffer: () =>
    translateMessage({
      defaultMessage: 'Dismiss',
      id: 'MhIWGGaCmg',
    }),
  more: () =>
    translateMessage({
      defaultMessage: 'More',
      id: 'xVUBuyeJAk',
    }),
  addSheet: () =>
    translateMessage({
      defaultMessage: 'Add sheet',
      id: 'AnZWS/yOy0',
    }),
  blankSheet: () =>
    translateMessage({
      defaultMessage: 'Blank sheet',
      id: 'W6IOUp+/9V',
    }),
  importCsv: () =>
    translateMessage({
      defaultMessage: 'Import CSV',
      id: 'Wj0xCCfet1',
    }),
  importFromExcel: () =>
    translateMessage({
      defaultMessage: 'Import from Excel',
      id: '1JcbLhlHrv',
    }),
  importFile: () =>
    translateMessage({
      defaultMessage: 'Import file',
      id: '0XxjLmEIyu',
    }),
  addedToYourMessage: () =>
    translateMessage({
      defaultMessage: 'Added to your message to Agent. Send it when you’re ready.',
      id: 'ftipgkBB0M',
    }),
  agentNotToBeHad: () =>
    translateMessage({
      defaultMessage: 'Agent isn’t available in this Sheet.',
      id: 'b+qj7pApJ1',
    }),
  askAgent: () =>
    translateMessage({
      defaultMessage: 'Ask Agent',
      id: 'NsQEeoePI5',
    }),
  searchInCellsMenu: () =>
    translateMessage({
      defaultMessage: 'Search',
      id: 'PXH+QxSfsq',
    }),
  askAgentAboutCells: () =>
    translateMessage({
      defaultMessage: 'Ask Agent',
      id: 'Va/Llzj+5I',
    }),
  fixWithAgent: () =>
    translateMessage({
      defaultMessage: 'Fix with Agent',
      id: 'ChA1CyITKc',
    }),
  fixErrors: () =>
    translateMessage({
      defaultMessage: 'Fix with Agent',
      id: 'z+L809Qnvn',
    }),
  discardFix: () =>
    translateMessage({
      defaultMessage: 'Discard',
      id: 'PvtO/T37LZ',
    }),
  keepThisFix: () =>
    translateMessage({
      defaultMessage: 'Keep',
      id: 'RFRKD/2gob',
    }),
  discardThisFix: () =>
    translateMessage({
      defaultMessage: 'Discard',
      id: 'LoFweD8s0E',
    }),
  discardAllFixes: () =>
    translateMessage({
      defaultMessage: 'Discard all',
      id: 'sCtLB1SKxG',
    }),
  askAgentToFix: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to fix',
      id: 'y8rk0YFJqh',
    }),
  agentOrImportOffered: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to fill this sheet, or import a file.',
      id: 'IRa3lCvosS',
    }),
  importOffered: () =>
    translateMessage({
      defaultMessage: 'Import a file to get started.',
      id: 'kZ0uHXC8NK',
    }),
  allSheets: () =>
    translateMessage({
      defaultMessage: 'All sheets',
      id: 'Xe2u3X3uH/',
    }),
  showEarlierTabs: () =>
    translateMessage({
      defaultMessage: 'Show earlier tabs',
      id: 'YeZFHTLvls',
    }),
  showLaterTabs: () =>
    translateMessage({
      defaultMessage: 'Show later tabs',
      id: '8fwXN62cYR',
    }),
  optionsOfDropdown: () =>
    translateMessage({
      defaultMessage: 'Options',
      id: 'RAYde0tcxm',
    }),
  calculations: () =>
    translateMessage({
      defaultMessage: 'Calculations',
      id: '5ApnZESqwr',
    }),
  moreCalculations: () =>
    translateMessage({
      defaultMessage: 'More calculations',
      id: 'YzijLm2/yz',
    }),
  noRoomForFigure: () =>
    translateMessage({
      defaultMessage: 'Needs an empty cell below',
      id: 'WMkz0FAXQL',
    }),
  oneColumnNeededForFigure: () =>
    translateMessage({
      defaultMessage: 'Select one column',
      id: 'p7B5nzgsG6',
    }),
  checkAll: () =>
    translateMessage({
      defaultMessage: 'Check all',
      id: 'O8Y2Rsua6Q',
    }),
  uncheckAll: () =>
    translateMessage({
      defaultMessage: 'Uncheck all',
      id: 'XAC3iBne+3',
    }),
  nothingToCheck: () =>
    translateMessage({
      defaultMessage: 'Nothing to check',
      id: 'YyJdi2kxMk',
    }),
  nothingToUncheck: () =>
    translateMessage({
      defaultMessage: 'Nothing to uncheck',
      id: 'TyyqiIeSC8',
    }),
  formulasSetWhatIsLeft: () =>
    translateMessage({
      defaultMessage: 'Formulas set what’s left.',
      id: 'ekZj6zEV/S',
    }),
  optionsOfDropdownInFull: () =>
    translateMessage({
      defaultMessage: 'Dropdown options',
      id: '5sc53ji60v',
    }),
  underlineOrStrikethrough: () =>
    translateMessage({
      defaultMessage: 'Underline or strikethrough',
      id: '8VrC6IJhKg',
    }),
  align: () =>
    translateMessage({
      defaultMessage: 'Align',
      id: 'otwZE+RClT',
    }),
  alignedByWhatCellHolds: () =>
    translateMessage({
      defaultMessage: 'By what each cell holds',
      id: 'F+GEkGUgi3',
    }),
  alignVertically: () =>
    translateMessage({
      defaultMessage: 'Align vertically',
      id: 'LEFv/4mym9',
    }),
  backToTools: () =>
    translateMessage({
      defaultMessage: 'Back',
      id: 'DS+UnjVquj',
    }),
  hideKeyboard: () =>
    translateMessage({
      defaultMessage: 'Hide keyboard',
      id: 'BJtodAxgW+',
    }),
  allChoices: () =>
    translateMessage({
      defaultMessage: 'More',
      id: 'ZTDn2PdhMI',
    }),
  allNumberFormats: () =>
    translateMessage({
      defaultMessage: 'More cell types',
      id: 'a/W/ysctBI',
    }),
  allTextColors: () =>
    translateMessage({
      defaultMessage: 'More text colors',
      id: 'EYy9ralp28',
    }),
  allCellColors: () =>
    translateMessage({
      defaultMessage: 'More cell colors',
      id: '65Sm1Z6rA8',
    }),
  wrapText: () =>
    translateMessage({
      defaultMessage: 'Wrap text',
      id: '5A/Vo44OYq',
    }),
  textWrapping: () =>
    translateMessage({
      defaultMessage: 'Text wrapping',
      id: 'VqF4bcyLXB',
    }),
  cellColor: () =>
    translateMessage({
      defaultMessage: 'Cell color',
      id: 'wg6MNQ6Oj+',
    }),
  textColor: () =>
    translateMessage({
      defaultMessage: 'Text color',
      id: 'BqJsJAgjhn',
    }),
  standardColors: () =>
    translateMessage({
      defaultMessage: 'Standard',
      id: 'gt2L6c7nEh',
    }),
  customColor: () =>
    translateMessage({
      defaultMessage: 'Custom',
      id: 'PJGMc/K1aq',
    }),
  kindsOfColor: () =>
    translateMessage({
      defaultMessage: 'Kind of color',
      id: 'Wu//ZdDTUb',
    }),
  neutrals: () =>
    translateMessage({
      defaultMessage: 'Neutrals',
      id: 'dxdjvn400k',
    }),
  colors: () =>
    translateMessage({
      defaultMessage: 'Colors',
      id: 'NzvB6uDMUj',
    }),
  colorsInThisSheet: () =>
    translateMessage({
      defaultMessage: 'In this sheet',
      id: 'HfA5ngJY25',
    }),
  hue: () =>
    translateMessage({
      defaultMessage: 'Hue',
      id: 'ViDnlwrJiv',
    }),
  saturation: () =>
    translateMessage({
      defaultMessage: 'Saturation',
      id: 'v65E6BCKa5',
    }),
  brightness: () =>
    translateMessage({
      defaultMessage: 'Brightness',
      id: 'vQMo+GvUYn',
    }),
  hex: () =>
    translateMessage({
      defaultMessage: 'Hex color',
      id: 'Hr4xPp4pM1',
    }),
  onLightSheet: () =>
    translateMessage({
      defaultMessage: 'Light',
      id: 'R5dISPlL1I',
    }),
  onDarkSheet: () =>
    translateMessage({
      defaultMessage: 'Dark',
      id: 'zVYCpSI4dh',
    }),
  renameSheet: () =>
    translateMessage({
      defaultMessage: 'Rename',
      id: 'SknDst9Vje',
    }),
  duplicateSheet: () =>
    translateMessage({
      defaultMessage: 'Duplicate',
      id: 'R2TjjQI5X/',
    }),
  comment: () =>
    translateMessage({
      defaultMessage: 'Comment',
      id: 'sKQr8cTwma',
    }),
  hasComment: () =>
    translateMessage({
      defaultMessage: 'Has a comment',
      id: 'a+M3zr1eYp',
    }),
  copyLinkToSheet: () =>
    translateMessage({
      defaultMessage: 'Copy link',
      id: 'JTnEMXzeud',
    }),
  moveSheetLeft: () =>
    translateMessage({
      defaultMessage: 'Move left',
      id: 'ixdYAhk70E',
    }),
  moveSheetRight: () =>
    translateMessage({
      defaultMessage: 'Move right',
      id: 'BkEdn+X07e',
    }),
  sheetName: () =>
    translateMessage({
      defaultMessage: 'Sheet name',
      id: 'cNhlaEZzoi',
    }),
  dateToPick: () =>
    translateMessage({
      defaultMessage: 'Date',
      id: 'u1IiELqxAz',
    }),
  deleteSheet: () =>
    translateMessage({
      defaultMessage: 'Delete',
      id: 'qcNVm1Qk1N',
    }),
  onlySheet: () =>
    translateMessage({
      defaultMessage: 'This is the only sheet, so it can’t be deleted.',
      id: 'SblI/UGTs2',
    }),
  figures: () =>
    translateMessage({
      defaultMessage: 'Sum, average and more',
      id: '0R9xWEN5Ev',
    }),
  formatting: () =>
    translateMessage({
      defaultMessage: 'Formatting',
      id: 'gC7N91a3b4',
    }),
  nextTool: () =>
    translateMessage({
      defaultMessage: 'Next tool',
      id: 'Sr9nOubbu/',
    }),
  arrowKeysMoveBetweenTools: () =>
    translateMessage({
      defaultMessage: 'Use the Left and Right arrow keys to move between tools.',
      id: 'TFOl+SY4ZF',
    }),
  clearFormatting: () =>
    translateMessage({
      defaultMessage: 'Clear formatting',
      id: 'CvytzZXVPL',
    }),
  formatAsTable: () =>
    translateMessage({
      defaultMessage: 'Format as table',
      id: 'rqXHHFycqJ',
    }),
  removeTableFormat: () =>
    translateMessage({
      defaultMessage: 'Remove table format',
      id: 'jvEm1+4Ce7',
    }),
  formulaBar: () =>
    translateMessage({
      defaultMessage: 'Formula bar',
      id: 'U+IiKziORG',
    }),
  menu: () =>
    translateMessage({
      defaultMessage: 'Rows, columns and cells',
      id: 'ntua3mLOwr',
    }),
  menuOfTable: () =>
    translateMessage({
      defaultMessage: 'Table actions',
      id: 'NpBfJPJM20',
    }),
  cut: () =>
    translateMessage({
      defaultMessage: 'Cut',
      id: '6NAU/0KroM',
    }),
  copy: () =>
    translateMessage({
      defaultMessage: 'Copy',
      id: 'hP7hAW9n1q',
    }),
  paste: () =>
    translateMessage({
      defaultMessage: 'Paste',
      id: 'f2lR6bPAGE',
    }),
  pasteValuesOnly: () =>
    translateMessage({
      defaultMessage: 'Paste values only',
      id: 'uZZPf/dukh',
    }),
  clearContents: () =>
    translateMessage({
      defaultMessage: 'Clear contents',
      id: 'zoR/AXdFnQ',
    }),
  clear: () =>
    translateMessage({
      defaultMessage: 'Clear',
      id: 'rLTKvi95cd',
    }),
  contentsToClear: () =>
    translateMessage({
      defaultMessage: 'Contents',
      id: 'f2MRY4vf4k',
    }),
  formattingToClear: () =>
    translateMessage({
      defaultMessage: 'Formatting',
      id: '129BZggmlh',
    }),
  removeDropdown: () =>
    translateMessage({
      defaultMessage: 'Remove dropdown',
      id: 'bs3tOquKTr',
    }),
  insertRows: () =>
    translateMessage({
      defaultMessage: 'Insert rows',
      id: 'N4GE+1em9+',
    }),
  insertColumns: () =>
    translateMessage({
      defaultMessage: 'Insert columns',
      id: 'zXESP0AP68',
    }),
  cellType: () =>
    translateMessage({
      defaultMessage: 'Cell type',
      id: 'WsDA8ILZS7',
    }),
  numberFormatFormerly: () =>
    translateMessage({
      defaultMessage: 'Number format',
      id: 'NucKwmuHHD',
    }),
  pickADate: () =>
    translateMessage({
      defaultMessage: 'Pick a date',
      id: '8XPX7M2TBY',
    }),
  editOptionsOfDropdown: () =>
    translateMessage({
      defaultMessage: 'Edit options',
      id: 'obRYDIXhAz',
    }),
  noPersonInDropdown: () =>
    translateMessage({
      defaultMessage: 'Remove dropdown to add a person.',
      id: '/OkhRmgqsu',
    }),
  deleteLines: () =>
    translateMessage({
      defaultMessage: 'Delete rows or columns',
      id: 'D9ogVphciA',
    }),
  mergeCells: () =>
    translateMessage({
      defaultMessage: 'Merge cells',
      id: '7N6BFMRyBe',
    }),
  convertTextToNumbers: () =>
    translateMessage({
      defaultMessage: 'Convert text to numbers',
      id: '2biWjH4LmV',
    }),
  moreCellsNeededToMerge: () =>
    translateMessage({
      defaultMessage: 'Select 2 or more cells to merge.',
      id: 'V0W65x1SLD',
    }),
  oneRangeNeededToDeleteLines: () =>
    translateMessage({
      defaultMessage: 'Select just one group of cells to delete rows or columns.',
      id: '1Sm67qhGFP',
    }),
  sheetNeedsARowAndAColumn: () =>
    translateMessage({
      defaultMessage: 'A sheet needs at least one row and one column.',
      id: '43n8QMhrJK',
    }),
  mergedCellsDoNotWrap: () =>
    translateMessage({
      defaultMessage: 'Text in merged cells can’t wrap.',
      id: 'XBi7daQdyQ',
    }),
  sheetNeedsARow: () =>
    translateMessage({
      defaultMessage: 'A sheet needs at least one row.',
      id: '/aqGDHWdzw',
    }),
  sheetNeedsAColumn: () =>
    translateMessage({
      defaultMessage: 'A sheet needs at least one column.',
      id: '7dobgReEr+',
    }),
  showFormulas: () =>
    translateMessage({
      defaultMessage: 'Show formulas',
      id: 'zxjM0rCYfN',
    }),
  layout: () =>
    translateMessage({
      defaultMessage: 'Layout',
      id: 'JqmkMyjjR2',
    }),
  onlyForYou: () =>
    translateMessage({
      defaultMessage: 'Only for you',
      id: 'cuqp2MFqEu',
    }),
  comfortable: () =>
    translateMessage({
      defaultMessage: 'Comfortable',
      id: 'FKnLKpU52B',
    }),
  compact: () =>
    translateMessage({
      defaultMessage: 'Compact',
      id: 'Cd7rwTLoft',
    }),
  undoInZoomMenu: () =>
    translateMessage({
      defaultMessage: 'Undo',
      id: 'jrTDOe9UhT',
    }),
  nothingToUndoYet: () =>
    translateMessage({
      defaultMessage: 'Nothing to undo yet',
      id: 'E2fYyxxabB',
    }),
  redoInZoomMenu: () =>
    translateMessage({
      defaultMessage: 'Redo',
      id: 'z+uKT/qSq4',
    }),
  nothingToRedo: () =>
    translateMessage({
      defaultMessage: 'Nothing to redo',
      id: 'zxfGCZmogi',
    }),
  finishTypingFirst: () =>
    translateMessage({
      defaultMessage: 'Finish or cancel what you’re typing first.',
      id: 'wlqnTCAI4x',
    }),
  cancelTypingFirst: () =>
    translateMessage({
      defaultMessage: 'Cancel what you’re typing first.',
      id: 'VQgU7jVClF',
    }),
  reload: () =>
    translateMessage({
      defaultMessage: 'Reload',
      id: 'nTJl1JZ9YX',
    }),
  rowNumbers: () =>
    translateMessage({
      defaultMessage: 'Row numbers',
      id: 'CuYK9/IlN1',
    }),
  sheet: () =>
    translateMessage({
      defaultMessage: 'Sheet',
      id: 'uOxg6ojTSQ',
    }),
  time: () =>
    translateMessage({
      defaultMessage: 'Time',
      id: 'KkMvFApqxe',
    }),
  today: () =>
    translateMessage({
      defaultMessage: 'Today',
      id: '3cJDQ+MQRi',
    }),
  undo: () =>
    translateMessage({
      defaultMessage: 'Undo',
      id: '5VuY1lAeP5',
    }),
  unmergeCells: () =>
    translateMessage({
      defaultMessage: 'Unmerge cells',
      id: 'lv0A7QCX5r',
    }),
  tooManyRowsToFreeze: () =>
    translateMessage({
      defaultMessage: 'Too many rows to fit in the window',
      id: 'Hl4c30yLEr',
    }),
  tooManyColumnsToFreeze: () =>
    translateMessage({
      defaultMessage: 'Too many columns to fit in the window',
      id: 'hIWe7dhgfL',
    }),
  freeze: () =>
    translateMessage({
      defaultMessage: 'Freeze',
      id: 'L0UrgvAPGu',
    }),
  addRowsAtFoot: (count: number): string =>
    translateMessage(
      {
        defaultMessage: '{count, plural, one {Add # row} other {Add # rows}}',
        id: '+szT/KeuWL',
      },
      {
        count,
      },
    ),
  add: () =>
    translateMessage({
      defaultMessage: 'Add',
      id: 'RyPdKrhPzv',
    }),
  rowsToAdd: () =>
    translateMessage({
      defaultMessage: 'Number of rows',
      id: 'jiNZ/YyOSv',
    }),
  addColumn: () =>
    translateMessage({
      defaultMessage: 'Add column',
      id: 'I+bIC47tgS',
    }),
  addMoreColumns: () =>
    translateMessage({
      defaultMessage: 'Add more columns',
      id: 'EYULHVHyzM',
    }),
  columnsToAdd: () =>
    translateMessage({
      defaultMessage: 'Number of columns',
      id: 'egMFcafMW6',
    }),
  dragToSetFrozenRows: () =>
    translateMessage({
      defaultMessage: 'Drag to set frozen rows',
      id: '5S87lQs3yX',
    }),
  dragToSetFrozenColumns: () =>
    translateMessage({
      defaultMessage: 'Drag to set frozen columns',
      id: 'x3/i1xo1fC',
    }),
  sheets: () =>
    translateMessage({
      defaultMessage: 'Sheets',
      id: 'oD8rWNa3wF',
    }),
};
export const moreOptionsForSheetLabel = (sheetName: string): string =>
  translateMessage(
    {
      defaultMessage: 'More options for {name}',
      id: 'JJS23GlbI6',
    },
    {
      name: sheetName,
    },
  );
