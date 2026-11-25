import type { NotCarriedOver } from '@open-artifact/sheets-core';
import { Dialog } from '../kit/dialog.tsx';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import { Icon } from '../kit/icon.tsx';
import type { IconName } from '../kit/icon.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { jsxs } from 'react/jsx-runtime';
import { ExcelFileIcon } from '../import/file-sources.tsx';
import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';
import type { XlsxFileSaved } from '../state/initial-state.ts';
/** Where a saved xlsx file went: downloaded, or copied into another program. */
type XlsxFileWent = XlsxFileSaved['went'];
/** A way the saved file differs from the workbook: its icon, a sentence that says it, and a short name for it. */
export interface ExportDifference {
  icon: IconName;
  sentence: () => string;
  name: () => string;
}
/** A difference of the saved file as it is listed, by what was not carried over. */
export interface ExportDifferenceShown {
  what: NotCarriedOver;
  icon: IconName;
  sentence: string;
  name: string;
}
export interface ExportRowContentsProps {
  mark: React.ReactNode;
  name: React.ReactNode;
  detail: React.ReactNode;
  atEnd: React.ReactNode;
}
export interface ExportReadySummaryProps {
  file: XlsxFileSaved;
  isAtOnce: boolean;
  onListAsked: () => void;
  onShut: () => void;
  rowOfListRef: React.Ref<HTMLButtonElement>;
}
export interface ExportDifferencesListProps {
  file: XlsxFileSaved;
}
export interface ExportReadyContentProps {
  file: XlsxFileSaved;
  onShut: () => void;
}
export interface ExportDoneMarkProps {
  isAtOnce: boolean;
}
export interface ExportReadyDialogProps {
  file: XlsxFileSaved | null;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onShut: () => void;
}
export function ExportRowContents({ mark, name: rowName, detail, atEnd }: ExportRowContentsProps) {
  return <><span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-secondary">{mark}</span><span className="flex min-w-0 flex-1 flex-col"><bdi className="truncate text-body-medium text-primary">{rowName}</bdi><span className="truncate text-footnote text-muted first-letter:uppercase">{detail}</span></span><span aria-hidden className="flex shrink-0 text-secondary">{atEnd}</span></>;
}
export function ExportReadySummary({
  file,
  isAtOnce,
  onListAsked,
  onShut,
  rowOfListRef,
}: ExportReadySummaryProps) {
  let { went, filename } = file;
  let differences = exportDifferences(file.notCarriedOver);
  let differenceNames = differences.map((difference) => difference.name);
  let onDonePressed = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail <= 1) onShut();
    else event.preventDefault();
  };
  let shownName = filename;
  let fileRow = <ExportRowContents mark={<ExcelFileIcon className="size-5" />} name={shownName} detail={exportReadyMessages.kindOfFile(went)} atEnd={<ExportDoneMark isAtOnce={isAtOnce} />} />;
  return <div className="flex flex-col gap-xs"><div className="-mx-[var(--ui-gap-xs)] flex min-w-0 items-center gap-xs px-xs py-1">{fileRow}</div>{differences.length > 0 &&
        <button ref={rowOfListRef} type="button" aria-label={exportReadyMessages.differencesSaid(went, differenceNames)} className="-mx-[var(--ui-gap-xs)] flex min-w-0 items-center gap-xs rounded px-xs py-1 text-start outline-none hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden" onClick={onListAsked}><ExportRowContents mark={<Icon name="Info" size="md" />} name={exportReadyMessages.isDifferent(went, differences.length)} detail={exportReadyMessages.namesOfDifferences(differenceNames)} atEnd={<Icon name="CaretRight" size="sm" />} /></button>}{jsxs(Dialog.Footer, {
        align: 'end',
        children: [
          <Button variant="primary" onClick={onDonePressed}>{exportReadyMessages.done()}</Button>,
        ],
      })}</div>;
}
export function ExportDifferencesList({ file }: ExportDifferencesListProps) {
  return <ul className="flex flex-col gap-xs">{exportDifferences(file.notCarriedOver).map(
      ({ what, icon, sentence }) =>
        <li key={what} className="sheet-listed-row flex items-start gap-xs text-body text-secondary"><span aria-hidden className="flex h-[1lh] flex-none items-center"><Icon name={icon} size="sm" /></span><span className="min-w-0">{sentence}</span></li>,
    )}</ul>;
}
export function ExportReadyContent({ file, onShut }: ExportReadyContentProps) {
  let { went } = file;
  let [isListShown, setListShown] = React.useState(false);
  let [hasSwitched, setSwitched] = React.useState(false);
  let backButtonRef = React.useRef<HTMLButtonElement>(null);
  let listRowRef = React.useRef<HTMLButtonElement>(null);
  let showList = (showsList: boolean) => {
    ReactDOM.flushSync(() => {
      setListShown(showsList);
      setSwitched(true);
    });
    (showsList ? backButtonRef : listRowRef).current?.focus();
  };
  return <>{isListShown
        ? <div className="flex items-start gap-1"><div className="-mt-[var(--ui-pad-sm)]"><Button ref={backButtonRef} variant="ghost" flush="start" iconOnly icon="CaretLeft" aria-label={exportReadyMessages.back()} onClick={() => showList(false)} /></div><div className="min-w-0 flex-1"><Dialog.Header className="ms-0 ps-0">{exportReadyMessages.titleOfDifferences(went)}</Dialog.Header></div></div>
        : <Dialog.Header>{exportReadyMessages.title(went)}</Dialog.Header>}{isListShown
        ? <ExportDifferencesList file={file} />
        : <ExportReadySummary file={file} isAtOnce={hasSwitched} rowOfListRef={listRowRef} onListAsked={() => showList(true)} onShut={onShut} />}</>;
}
export const dropdownOptionsLabel = () =>
  translateMessage({
    defaultMessage: 'Dropdown options',
    id: 'aRfMkoNP+5',
  });
export const EXPORT_DIFFERENCES: Record<NotCarriedOver, ExportDifference> = {
  formulasWrittenAsValues: {
    icon: 'Sigma',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Some formulas are saved as their values.',
        id: '+n3e+e7vmU',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'some formulas',
        id: 'ZHi6hkzYff',
      }),
  },
  randomNumbersThatStay: {
    icon: 'Shuffle',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Random numbers change when the file is opened.',
        id: '3B76el8vry',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'random numbers',
        id: 'pBOiYbd8nQ',
      }),
  },
  users: {
    icon: 'User',
    sentence: () =>
      translateMessage({
        defaultMessage: 'People appear as their names.',
        id: 'vWkNiH++g7',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'people',
        id: 'YGR2pgvmJT',
      }),
  },
  checkboxes: {
    icon: 'CheckSquare',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Checkboxes appear as TRUE or FALSE.',
        id: 'JT2iZcFrEx',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'checkboxes',
        id: 'VUvUrYsBT0',
      }),
  },
  colorsOfDropdownOptions: {
    icon: 'Dropdown',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Dropdown options have no colors.',
        id: 'kPD72hapyo',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'dropdown colors',
        id: 'Kf3M9QMQT6',
      }),
  },
  sheetNames: {
    icon: 'TextT',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Some sheet names are shortened or changed.',
        id: 'h7FqlVFI5d',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'sheet names',
        id: 'O4LD9WBbpQ',
      }),
  },
  looksOfSomeBlankCells: {
    icon: 'PaintBucket',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Some empty cells have no formatting.',
        id: 'VnoW7zboYb',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'empty cell formatting',
        id: '34CW96ONEl',
      }),
  },
  linksOfPartsOfTexts: {
    icon: 'Link',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Links on part of a cell’s text become one link for the whole cell.',
        id: 'obuyTd2GF1',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'links on part of a cell',
        id: 'UN/LE6HcnT',
      }),
  },
  linksOfSomeCells: {
    icon: 'Link',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Some links aren’t included.',
        id: 'wL1EQ5oPOG',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'some links',
        id: 'hRFDssCX3B',
      }),
  },
  listsInTexts: {
    icon: 'ListBullet',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Lists in a cell’s text appear as typed characters, like “• item” or “☐ item”.',
        id: 'HhgtVBqRvJ',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'lists in a cell',
        id: 'ccLJDsHNYU',
      }),
  },
  sizesOfTheLargestRowsAndColumns: {
    icon: 'ColumnWidth',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Very tall rows and wide columns are made smaller.',
        id: 'VMeIwtDvD+',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'large rows and columns',
        id: 'VCi5gQwvMj',
      }),
  },
  conditionalFormats: {
    icon: 'ConditionalFormat',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Conditional formatting isn’t included.',
        id: 'uvf+GBAyAU',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'conditional formatting',
        id: 'E+DXShh2hl',
      }),
  },
  namedViews: {
    icon: 'Filter',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Saved views aren’t included.',
        id: 'mk+bWXd/4I',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'saved views',
        id: '+OW7ed+B7o',
      }),
  },
  interactives: {
    icon: 'Sliders',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Interactive sheets are saved empty.',
        id: 'WgNRsxa/uC',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'interactive sheets',
        id: '0y/m+iBQwo',
      }),
  },
  placedViews: {
    icon: 'Chart',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Charts aren’t included.',
        id: 'CW3GC3q8Kb',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'charts',
        id: 'iwCU69jmkh',
      }),
  },
  looksOfCharts: {
    icon: 'Brush',
    sentence: () =>
      translateMessage({
        defaultMessage: 'Included charts look different.',
        id: 'UbOeo8MhnJ',
      }),
    name: () =>
      translateMessage({
        defaultMessage: 'chart styles',
        id: 'PJ4gAUhM0f',
      }),
  },
};
export const SOME_CHARTS_DIFFERENCE: ExportDifference = {
  icon: 'Chart',
  sentence: () =>
    translateMessage({
      defaultMessage: 'Some charts aren’t included.',
      id: 'zCfnVEvy5Z',
    }),
  name: () =>
    translateMessage({
      defaultMessage: 'some charts',
      id: 'C/UUWGH5c1',
    }),
};
export const exportDifferenceTable = EXPORT_DIFFERENCES;
export const exportDifferences = (notCarriedOver: readonly NotCarriedOver[]): ExportDifferenceShown[] =>
  notCarriedOver.flatMap((what) => {
    let difference =
      what === 'placedViews' && notCarriedOver.includes('looksOfCharts') ? SOME_CHARTS_DIFFERENCE : exportDifferenceTable[what];
    if (difference === undefined) return [];
    let { icon, sentence, name: nameOfDifference } = difference;
    return [
      {
        what,
        icon,
        sentence: sentence(),
        name: nameOfDifference(),
      },
    ];
  });
export const exportReadyMessages = {
  title: (went: XlsxFileWent) =>
    went === 'downloaded'
      ? translateMessage({
          defaultMessage: 'Your Excel file is ready',
          id: 'pj5c0eNv9T',
        })
      : translateMessage({
          defaultMessage: 'Your copy in Google Sheets is ready',
          id: 'X/QVStNB3y',
        }),
  kindOfFile: (went: XlsxFileWent) =>
    went === 'downloaded'
      ? translateMessage({
          defaultMessage: 'Editable .xlsx spreadsheet',
          id: 'kExKdN/QFN',
        })
      : translateMessage({
          defaultMessage: 'Editable copy in your Google Drive',
          id: 'e4rkg0Uz9b',
        }),
  isDifferent: (went: XlsxFileWent, count: number) =>
    went === 'downloaded'
      ? translateMessage(
          {
            defaultMessage: '{count, plural, one {# thing is different in Excel} other {# things are different in Excel}}',
            id: 'u3PpkQ98CK',
          },
          {
            count,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{count, plural, one {# thing is different in Google Sheets} other {# things are different in Google Sheets}}',
            id: '0H3JhBPxcM',
          },
          {
            count,
          },
        ),
  titleOfDifferences: (went: XlsxFileWent) =>
    went === 'downloaded'
      ? translateMessage({
          defaultMessage: 'What’s different in Excel',
          id: '2u5onSQwK/',
        })
      : translateMessage({
          defaultMessage: 'What’s different in Google Sheets',
          id: '5+CuFP6955',
        }),
  namesOfDifferences: (names: readonly string[]) =>
    new Intl.ListFormat(MESSAGE_LOCALE, {
      type: 'unit',
    }).format(names),
  differencesSaid: (went: XlsxFileWent, differenceNames: readonly string[]) =>
    translateMessage(
      {
        defaultMessage: '{line}: {names}',
        id: 'XSINOPZGKT',
      },
      {
        line: exportReadyMessages.isDifferent(went, differenceNames.length),
        names: exportReadyMessages.namesOfDifferences(differenceNames),
      },
    ),
  openNamed: (fileName: string) =>
    translateMessage(
      {
        defaultMessage: 'Open {name} in Google Sheets',
        id: 'NjaeuKEoXt',
      },
      {
        name: fileName,
      },
    ),
  back: () =>
    translateMessage({
      defaultMessage: 'Back',
      id: 'JK9HjYXqNQ',
    }),
  done: () =>
    translateMessage({
      defaultMessage: 'Done',
      id: 'ZjPnurAt9s',
    }),
};
export const ExportDoneMark = ({ isAtOnce }: ExportDoneMarkProps) =>
  <span className={`flex text-success ${isAtOnce ? '' : 'transition-[clip-path] delay-[450ms] duration-base ease-out motion-reduce:transition-none starting:[clip-path:inset(0_100%_0_0)]'} [clip-path:inset(0)]`}><Icon name="CheckCircleFilled" size="md" /></span>;
export const ExportReadyDialog = React.memo(function ({
  file,
  whatHasCaretAfter,
  onShut,
}: ExportReadyDialogProps) {
  let [keptFile, setKeptFile] = React.useState({
    file,
    count: 0,
  });
  if (file !== null && file !== keptFile.file)
    setKeptFile({
      file,
      count: keptFile.count + 1,
    });
  let shownFile = file ?? keptFile.file;
  let notCarriedOverSentences = exportDifferences(shownFile?.notCarriedOver ?? []).map(
    ({ sentence }) => sentence,
  );
  let popupRef = React.useRef<HTMLDivElement>(null);

  let [isAlertNeeded, setAlertNeeded] = React.useState(false);
  if (file === null && isAlertNeeded) setAlertNeeded(false);
  let openedAtRef = React.useRef(0);
  let lastFileRef = React.useRef(file);
  React.useLayoutEffect(() => {
    let [popup, wasOpen] = [popupRef.current, lastFileRef.current !== null];
    lastFileRef.current = file;
    openedAtRef.current = performance.now();
    if (file === null || !wasOpen || popup === null) return;
    let ownerDocument = popup.ownerDocument;
    if (ownerDocument.activeElement === ownerDocument.body && ownerDocument.hasFocus()) popup.focus();
    setAlertNeeded(!popup.contains(ownerDocument.activeElement));
  }, [file]);
  return <Dialog.Root open={file !== null} disablePointerDismissal onOpenChange={(isOpen, { event }) => {
      let isMultiClick = event instanceof UIEvent && event.detail > 1;
      if (!isOpen && event.timeStamp > openedAtRef.current && !isMultiClick) onShut();
    }}><Dialog.Popup ref={popupRef} size="sm" initialFocus={() => {
        let isPageFocused = popupRef.current?.ownerDocument.hasFocus() === true;
        setAlertNeeded(!isPageFocused);
        return isPageFocused && popupRef.current;
      }} finalFocus={whatHasCaretAfter} onFocus={() => setAlertNeeded(false)}>{shownFile !== null &&
          <ExportReadyContent key={keptFile.count} file={shownFile} onShut={onShut} />}{notCarriedOverSentences.length > 0 &&
          (<Dialog.Description className="sr-only" render={<div />}>{notCarriedOverSentences.map(
              (sentence) =>
                <p key={sentence}>{sentence}</p>,
            )}</Dialog.Description>)}{isAlertNeeded &&
          shownFile !== null &&
          (<div key={`said ${keptFile.count}`} role="alert" className="sr-only"><p>{exportReadyMessages.title(shownFile.went)}</p>{notCarriedOverSentences.map(
                  (sentence) =>
                    <p key={sentence}>{sentence}</p>,
                )}</div>)}</Dialog.Popup></Dialog.Root>;
});
