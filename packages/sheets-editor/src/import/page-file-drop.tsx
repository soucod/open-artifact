import { DropZone, useDropZone } from '../kit/drop-zone.tsx';
import { useUiWindow } from '../kit/theme.tsx';
import { GLOBAL_LAYER_BASE } from '../kit/layers.tsx';
import type { DroppedFiles } from '../kit/drop-zone.tsx';
import * as React from 'react';
import { isModalOpen } from '../ui/find.ts';
import type { PageView } from '../view/page-view.ts';
import type { FileOrWhyNotRead } from './csv-file.tsx';
interface PageFileDropProps {
  isTaken: boolean;
  /** The control the keyboard reaches the page's file picker through. */
  wayInByKeyboard: React.RefObject<HTMLElement | null>;
  onDropped: (fileOrWhy: FileOrWhyNotRead) => void;
}
export function useIsDraggingInPage() {
  let [isDraggingInPage, setDraggingInPage] = React.useState(false);
  let pageWindow = useUiWindow();
  React.useEffect(() => {
    if (pageWindow === undefined) return;
    let controller = new AbortController();
    let listenerOptions = {
      capture: true,
      signal: controller.signal,
    };
    pageWindow.addEventListener('dragstart', () => setDraggingInPage(true), listenerOptions);
    for (let eventType of ['dragend', 'drop', 'pointerdown'])
      pageWindow.addEventListener(eventType, () => setDraggingInPage(false), listenerOptions);
    return () => controller.abort();
  }, [pageWindow]);
  return isDraggingInPage;
}
export function PageFileDrop({ isTaken, wayInByKeyboard, onDropped }: PageFileDropProps) {
  let isDraggingInPage = useIsDraggingInPage();
  let { dragState } = useDropZone({
    scope: 'page',
    disabled: !isTaken || isDraggingInPage,
    pickerPath: {
      mode: 'external',
      control: wayInByKeyboard,
    },
    onFiles: ({ accepted: [file], notices }: DroppedFiles) => {
      let isFolder = notices.some(({ code }) => code === 'folder-not-allowed');
      onDropped(file ?? (isFolder ? 'folder' : 'notRead'));
    },
  });
  return <div className="pointer-events-none fixed inset-0" style={{
      zIndex: GLOBAL_LAYER_BASE,
    }}><DropZone.Overlay dragState={dragState} /></div>;
}
export const isExcelFileName = ({ name }: Pick<File, 'name'>) => /\.(?:xlsx|xlsm|xls)$/i.test(name);
export const canTakeDroppedFile = (state: PageView) =>
  state.viewOnlyBecause === null && !isModalOpen(state) && state.menu === null && state.ownFilterList === null && !state.isUnfinishedFormulaOpen;
