import { Avatar, AvatarStack } from '../../kit/avatar.tsx';
import { Icon } from '../../kit/icon.tsx';
import { Badge } from '../../kit/badge.tsx';
import type { FocusEvent } from 'react';
import type { SheetId } from '@open-artifact/sheets-core';
import type { ListedSheet } from '../../view/page-view.ts';
import { peopleOnSheetText, sheetTabCommentsLabel } from '../../i18n/menu-labels.ts';
import { translateMessage } from '../../i18n/messages.ts';
/** The faces of the others on a sheet. */
export type FacesOnSheet = ListedSheet['facesOfOthers'];
/** What a sheet's tab is named by: the sheet's name, its open comments, and whether it shows an interactive. */
export type SheetOfTabLabel = Pick<ListedSheet, 'name' | 'openCommentCount' | 'isInteractive'>;
export interface TabFacesProps {
  faces: FacesOnSheet;
}
export function BetaBadge() {
  return <Badge variant="neutral" size="xxs" className="flex-none">{translateMessage({
      defaultMessage: 'Beta',
      id: 'mEZQcCanHD',
    })}</Badge>;
}
export function sheetTabLabel(sheet: SheetOfTabLabel): string | undefined {
  if (!sheet.isInteractive) return sheetTabCommentsLabel(sheet.name, sheet.openCommentCount);
  let label = translateMessage(
    {
      defaultMessage: '{name}, Interactive sheet, Beta',
      id: 'FPYkrFXdQm',
    },
    {
      name: sheet.name,
    },
  );
  return sheetTabCommentsLabel(label, sheet.openCommentCount) ?? label;
}
export function TabFaces({ faces }: TabFacesProps) {
  return <span aria-hidden className="flex"><AvatarStack aria-label="" max={MAX_FACES_ON_TAB} size="xs" surplusTooltip={false}>{faces.map(
        ({ userId, name, avatarUrl, color, inkColor }) =>
          (<Avatar key={userId} name={name} src={avatarUrl} style={{
                backgroundColor: color,
                color: inkColor,
              }} />),
      )}</AvatarStack></span>;
}
export interface OthersOnSheetTextProps {
  sheetId: SheetId;
  faces: FacesOnSheet;
}
export function OthersOnSheetText({ sheetId, faces }: OthersOnSheetTextProps) {
  return <span id={othersOnSheetId(sheetId)} aria-hidden data-find-omitted className="sr-only select-none">{peopleOnSheetText(faces.map(({ name }) => name))}</span>;
}
export interface TabCommentCountProps {
  count: number;
}
export function TabCommentCount({ count }: TabCommentCountProps) {
  if (count === 0) return null;
  return <span aria-hidden className="flex items-center gap-1 text-secondary"><Icon name="Chat" customSize={14} /><span className="text-caption font-medium">{count}</span></span>;
}
export const MAX_FACES_ON_TAB = 3;
export const othersOnSheetId = (sheetId: SheetId) => `others-on-${sheetId}`;
export const othersOnSheetDescription = (sheetId: SheetId, faces: FacesOnSheet) =>
  faces.length === 0
    ? {}
    : {
        'aria-describedby': othersOnSheetId(sheetId),
      };
export const isSheetNameLeftForWindow = ({ target, relatedTarget }: FocusEvent<Element>, isLeaving: boolean) =>
  relatedTarget === null && target.isConnected && target.classList.contains('sheet-name-field') && !isLeaving;
