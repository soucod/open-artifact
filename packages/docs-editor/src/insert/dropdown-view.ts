/** A dropdown chip that redraws when its list changes (an option renamed, recoloured or retired), not only when it does. */
import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';
import { useDocs } from '../app/store.ts';
import { dropdownOption, setOwnClasses } from '../editor/node-views.ts';
import { colorOf } from './dropdown-model.ts';

export class DropdownChipView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private selected = false;
  private own: string[] = [];
  private readonly stop: () => void;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement('span');
    this.draw();
    this.stop = useDocs.subscribe((state, before) => {
      if (state.project?.enums !== before.project?.enums) this.draw();
    });
  }

  private draw(): void {
    const { enum: enumId, index } = this.node.attrs as { enum: string; index: number | null };
    const option = dropdownOption(enumId, index);
    const own = ['doc-chip', 'doc-dropdown', option ? '' : 'doc-dropdown-unset', this.selected ? 'doc-selected' : ''].filter(Boolean);
    setOwnClasses(this.dom, this.own, own);
    this.own = own;
    this.dom.textContent = option?.name ?? 'Select';
    this.dom.dataset.color = colorOf(option ?? undefined, typeof index === 'number' ? index : 0);
    this.dom.dataset.dropdown = '';
    this.dom.setAttribute('role', 'button');
    this.dom.setAttribute('aria-haspopup', 'listbox');
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.draw();
    return true;
  }

  selectNode(): void {
    this.selected = true;
    this.dom.classList.add('doc-selected');
  }

  deselectNode(): void {
    this.selected = false;
    this.dom.classList.remove('doc-selected');
  }

  destroy(): void {
    this.stop();
  }
}
