import { useToasts } from '../kit/toast.tsx';
import type { ToastCloseInfo, ToastOptions } from '../kit/toast.tsx';
import * as React from 'react';
import { UncommentableToastText } from '../shell/ui-root.tsx';
export interface MountedToastProps {
  words: React.ReactNode;
  icon?: ToastOptions['icon'];
  action?: ToastOptions['action'];
  staysUntilClosed: boolean;
  /** Called when the toast closes while this is still mounted. */
  onOver: (closeInfo: ToastCloseInfo) => void;
  /** Called when this is unmounted and the toast is taken down with it. */
  onTakenDown: () => void;
}
/** Shows a toast while mounted, and takes it down when unmounted. */
export function MountedToast({
  words,
  icon,
  action,
  staysUntilClosed,
  onOver,
  onTakenDown,
}: MountedToastProps) {
  const toasts = useToasts();
  const addToast = React.useEffectEvent(
    (mounted: { current: boolean }) =>
      toasts.add({
        title: <UncommentableToastText>{words}</UncommentableToastText>,
        icon,
        action,
        ...(staysUntilClosed && {
          timeout: 0,
        }),
        onClose: (closeInfo: ToastCloseInfo) => {
          if (mounted.current) onOver(closeInfo);
        },
      }),
  );
  const takeDownToast = React.useEffectEvent((toastId: string) => {
    toasts.close(toastId);
    onTakenDown();
  });
  React.useEffect(() => {
    const mounted = {
      current: true,
    };
    const toastId = addToast(mounted);
    return () => {
      mounted.current = false;
      takeDownToast(toastId);
    };
  }, []);
  return null;
}
