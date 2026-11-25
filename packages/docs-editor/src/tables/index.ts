/**
 * Tables: the row and column grips, the cell menu (right-click or the Menu key), the cell-selection bar, cell colours,
 * and the scrollbar held at the foot of the window for a wide, tall table.
 */
import { fillSlot } from '../app/slots.ts';
import { addEditorExtension } from '../editor/DocEditor.tsx';
import { CellBar } from './CellBar.tsx';
import { CellContextMenu } from './CellContextMenu.tsx';
import { DockedScrollbar } from './DockedScrollbar.tsx';
import { TableGrips } from './TableGrips.tsx';
import { tablePlugins } from './plugin.ts';
import './tables.css';

addEditorExtension({ plugins: tablePlugins });
fillSlot('layer', 'table-grips', TableGrips, 20);
fillSlot('layer', 'table-cell-bar', CellBar, 21);
fillSlot('layer', 'table-context-menu', CellContextMenu, 22);
fillSlot('float', 'table-dock', DockedScrollbar, 10);
