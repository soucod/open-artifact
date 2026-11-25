import { Icon } from '../../kit/icon.tsx';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
export const wrapTextIcon = (size: number) =>
  <Icon name="TextWrap" size={size < 20 ? 'sm' : 'md'} />;
export const wrapTextTool = () => ({
  id: 'wrapText',
  icon: wrapTextIcon,
  label: sheetMessages.wrapText(),
  canAct: true,
  whyNot: null,
});
