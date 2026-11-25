import { Icon } from '../kit/icon.tsx';
import type { IconSizeChoice } from '../kit/icon.tsx';
export interface DangerWarningIconProps {
  size?: IconSizeChoice;
}
export const DangerWarningIcon = ({ size = 'sm' }: DangerWarningIconProps) =>
  <Icon name="WarningFilled" size={size} className="text-fill-danger" />;
