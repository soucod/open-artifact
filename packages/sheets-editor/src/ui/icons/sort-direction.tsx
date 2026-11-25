import { Icon } from '../../kit/icon.tsx';
import type { CustomIcon } from '../../kit/icon.tsx';
import type { SortDirection } from '@open-artifact/sheets-core';
import type { ReactElement } from 'react';
export interface SortDirectionIconProps {
  direction: SortDirection;
}
export function SortDirectionIcon({ direction }: SortDirectionIconProps) {
  let customIcon = {
    name: direction,
    viewBox: 20,
    paths: SORT_DIRECTION_ICON_PATHS[direction],
  };
  return <Icon customIcon={customIcon} size="auto" />;
}
export const SORT_DIRECTION_ICON_PATHS: Record<SortDirection, CustomIcon['paths']> = {
  ascending: [
    {
      d: 'M6.375 16.375L6.375 3.625M6.375 3.625L3.625 6.375M6.375 3.625L9.125 6.375',
      strokeWidth: 1.25,
    },
    {
      d: 'M11.625 5.625L13.375 5.625M11.625 9.625L14.875 9.625M11.625 13.625L16.375 13.625',
      strokeWidth: 1.25,
    },
  ],
  descending: [
    {
      d: 'M6.375 3.625L6.375 16.375M6.375 16.375L3.625 13.625M6.375 16.375L9.125 13.625',
      strokeWidth: 1.25,
    },
    {
      d: 'M11.625 6.375L16.375 6.375M11.625 10.375L14.875 10.375M11.625 14.375L13.375 14.375',
      strokeWidth: 1.25,
    },
  ],
};
export const SORT_DIRECTION_ICONS: Record<SortDirection, ReactElement> = {
  ascending: <SortDirectionIcon direction="ascending" />,
  descending: <SortDirectionIcon direction="descending" />,
};
