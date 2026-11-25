import { Dialog } from '../kit/dialog.tsx';
import { DropZone, useDropZone } from '../kit/drop-zone.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { noticeText } from '../i18n/notice-labels.ts';
import { ImportGhostGrid, ImportWarningHeadline } from './destination.tsx';
import { csvFileMessages } from './csv-file.tsx';
import { chooseFileLabel } from '../i18n/ui-labels.ts';
import type { DroppedFiles } from '../kit/drop-zone.tsx';
import type { FileAwaited, FileNotImportedNotice, Notice } from '../state/initial-state.ts';
/** What a refused file is told with: what went wrong, and the way on. */
export interface FileRefusalWords {
  headline: string;
  wayOn: string;
}
export interface ChooseFilePaneProps {
  fileAwaited: FileAwaited;
  chooseRef: React.RefObject<HTMLElement | null>;
  onChoose: () => void;
  onDropped: (dropped: File | 'folder' | 'notRead') => void;
}
export function scrollChildIntoBox(box: HTMLElement | null, child: HTMLElement | null) {
  if (box === null || child === null) return;
  let { top: boxTop, bottom: boxBottom } = box.getBoundingClientRect();
  let childBounds = child.getBoundingClientRect();
  if (childBounds.top < boxTop) box.scrollTop += childBounds.top - boxTop;
  else if (childBounds.bottom + CHOOSE_BUTTON_SCROLL_MARGIN_PX > boxBottom)
    box.scrollTop += childBounds.bottom + CHOOSE_BUTTON_SCROLL_MARGIN_PX - boxBottom;
}
export function wordsOfFileRefusal(whyNot: Notice) {
  if (whyNot.kind === 'fileNotImported') return FILE_NOT_IMPORTED_WORDS[whyNot.why]();
  if (whyNot.kind === 'editRefused' && whyNot.why === 'noRoomInWorkbook')
    return {
      headline: fileAwaitedMessages.noRoom(),
      wayOn: fileAwaitedMessages.smallerFile(),
    };
  if (whyNot.kind === 'editRefused' && whyNot.why === 'textTooLong')
    return {
      headline: fileAwaitedMessages.cellTooLong(),
      wayOn: fileAwaitedMessages.shortenText(),
    };
  return {
    headline: noticeText(whyNot),
    wayOn: fileAwaitedMessages.whatToChoose(),
  };
}
export function ChooseFilePane({
  fileAwaited: { whyNot, refusedCount },
  chooseRef,
  onChoose,
  onDropped,
}: ChooseFilePaneProps) {
  let refusalWords = whyNot === null ? null : wordsOfFileRefusal(whyNot);
  let filePicker = useDropZone({
    pickerPath: {
      mode: 'external',
      control: chooseRef,
    },
    onFiles: ({ accepted: [file], notices }: DroppedFiles) => {
      let isFolder = notices.some(({ code }) => code === 'folder-not-allowed');
      onDropped(file ?? (isFolder ? 'folder' : 'notRead'));
    },
  });
  let refusalShown = filePicker.dragState === 'on-target' ? null : refusalWords;
  let paneRef = React.useRef<HTMLDivElement>(null);
  let scrollToChoose = React.useCallback(() => scrollChildIntoBox(paneRef.current, chooseRef.current), [chooseRef]);
  React.useLayoutEffect(scrollToChoose, [scrollToChoose]);
  let scrollToChild = React.useCallback(
    (child: HTMLElement | null) => {
      scrollChildIntoBox(paneRef.current, child);
      scrollToChoose();
    },
    [scrollToChoose],
  );
  return <div {...filePicker.getZoneProps({
      className: 'relative -mx-[var(--ui-pad-xl)] flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[color:var(--ui-border-line,var(--ui-border))]',
    })}><ImportGhostGrid isGray={refusalShown !== null} /><div ref={paneRef} className="relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(min-content,1fr)] justify-items-center overflow-y-auto scroll-fade-y px-xl text-center"><div className="row-start-2 flex flex-col items-center gap-sm">{refusalShown !== null
                ? <Dialog.Description render={<div />} className="m-0 flex flex-col items-center gap-sm"><ImportWarningHeadline>{refusalShown.headline}</ImportWarningHeadline><p className="m-0 text-body text-secondary">{refusalShown.wayOn}</p></Dialog.Description>
                : <><p className="m-0 text-body font-medium text-primary">{filePicker.dragState === 'on-target' ? csvFileMessages.letGo() : csvFileMessages.whatComesHere()}</p><Dialog.Description>{csvFileMessages.whatToChoose()}</Dialog.Description></>}<Button ref={chooseRef} variant="primary" icon="Upload" onClick={onChoose} onFocus={({ currentTarget }) => {
                  if (currentTarget.matches(':focus-visible')) scrollToChoose();
                }}>{chooseFileLabel()}</Button></div><output aria-live="polite" className="row-start-3">{whyNot !== null &&
              <span key={refusedCount} ref={scrollToChild} className="sr-only">{noticeText(whyNot)}</span>}</output></div><DropZone.Overlay dragState={filePicker.dragState} /></div>;
}
export const CHOOSE_BUTTON_SCROLL_MARGIN_PX = 8;
export const fileAwaitedMessages = csvFileMessages;
export const FILE_NOT_IMPORTED_WORDS: Record<FileNotImportedNotice['why'], () => FileRefusalWords> = {
  tooLarge: () => ({
    headline: fileAwaitedMessages.tooLarge(),
    wayOn: fileAwaitedMessages.smallerFile(),
  }),
  notRead: () => ({
    headline: fileAwaitedMessages.notRead(),
    wayOn: fileAwaitedMessages.tryAgain(),
  }),
  folder: () => ({
    headline: fileAwaitedMessages.isFolder(),
    wayOn: fileAwaitedMessages.chooseCsvOrTsv(),
  }),
  notText: () => ({
    headline: fileAwaitedMessages.notCsv(),
    wayOn: fileAwaitedMessages.saveAsCsv(),
  }),
  excelFileDropped: () => ({
    headline: fileAwaitedMessages.excelNotDropped(),
    wayOn: fileAwaitedMessages.useButtonInstead(chooseFileLabel()),
  }),
  empty: () => ({
    headline: fileAwaitedMessages.isEmpty(),
    wayOn: fileAwaitedMessages.whatToChoose(),
  }),
};
