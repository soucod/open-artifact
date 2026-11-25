import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from './button.tsx';
import { guardWhileClosing } from './closing-guard.ts';
import { cn } from './cn.ts';
import { useKitLabel } from './labels.tsx';
import { LayerBaseContext, OVERLAY_ATTRIBUTE, useOverlayLayer } from './layers.tsx';
import { PopupScope } from './popup.tsx';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type DialogFooterAlign = 'start' | 'center' | 'end' | 'between';

const SIZE_CLASSES: Readonly<Record<DialogSize, string>> = {
  sm: 'max-w-[400px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[880px]',
  '2xl': 'max-w-[1024px]',
  '3xl': 'max-w-[1152px]',
};

const FOOTER_ALIGN_CLASSES: Readonly<Record<DialogFooterAlign, string>> = {
  start: 'sm:justify-start',
  center: 'sm:justify-center',
  end: 'sm:justify-end',
  between: 'sm:justify-between',
};

const POPUP_CLASSES =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] rounded-panel bg-surface-popover shadow-popover [--ui-page-bg:var(--ui-surface-popover)] ui-reset text-body font-normal text-primary outline-none focus-visible:outline-hidden forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText]';
const POPUP_TRANSITION_CLASSES =
  'transition-[opacity,scale] duration-base ease-out motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] motion-reduce:data-[starting-style]:scale-100 data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]';
/** Dims a dialog while a dialog opened from it is on top. */
const NESTED_DIM_CLASSES =
  'after:pointer-events-none after:absolute after:inset-0 after:z-50 after:rounded-[inherit] after:bg-backdrop after:opacity-0 after:transition-opacity after:duration-base after:ease-out data-[nested-dialog-open]:after:opacity-100';
const BACKDROP_CLASSES =
  'fixed inset-0 bg-backdrop transition-opacity duration-base ease-out motion-reduce:transition-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 has-[~[data-nested]]:bg-transparent';
const BODY_CLASSES = 'isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] p-xl break-words';
const CLOSE_FLUSH_CLASSES = '-me-[var(--ui-pad-sm)] -mt-[var(--ui-pad-sm)]';

/** True inside an alert dialog, whose title is set quieter. */
const AlertContext = React.createContext(false);

const keepSelection = (event: React.MouseEvent<HTMLDivElement>): void => event.preventDefault();

/**
 * The rest of a double click that opened a dialog lands on its backdrop, which would close it
 * again. From the moment the backdrop appears, presses that continue a multi-click on it or on the
 * page root are swallowed, until a fresh single press or the window regaining focus.
 */
function useSwallowRepeatClicksOnBackdrop(backdrop: HTMLDivElement | null): void {
  React.useLayoutEffect(() => {
    const win = backdrop?.ownerDocument.defaultView;
    if (!backdrop || !win) return undefined;
    const root = win.document.documentElement;
    const watching = new win.AbortController();
    const onPress = (event: MouseEvent): void => {
      if (event.detail > 1) {
        if (event.target !== backdrop && event.target !== root) return;
        event.preventDefault();
        event.stopPropagation();
      } else if (event.type === 'mousedown') watching.abort();
    };
    win.addEventListener('mousedown', onPress, { capture: true, signal: watching.signal });
    win.addEventListener('click', onPress, { capture: true, signal: watching.signal });
    win.addEventListener('focus', () => watching.abort(), { signal: watching.signal });
    return () => watching.abort();
  }, [backdrop]);
}

export type DialogRootProps = BaseDialog.Root.Props;
export type AlertDialogRootProps = BaseAlertDialog.Root.Props;

function DialogRoot(props: DialogRootProps): React.ReactElement {
  return (
    <AlertContext.Provider value={false}>
      <BaseDialog.Root {...props} />
    </AlertContext.Provider>
  );
}

function AlertDialogRoot(props: AlertDialogRootProps): React.ReactElement {
  return (
    <AlertContext.Provider value={true}>
      <BaseAlertDialog.Root {...props} />
    </AlertContext.Provider>
  );
}

export interface DialogPopupProps extends Omit<BaseDialog.Popup.Props, 'className'> {
  /** The widest the dialog grows; it narrows to fit small windows. */
  size?: DialogSize;
  className?: string;
}

/** The dialog's card, centred over a backdrop; its children scroll inside a padded body. */
const DialogPopup = React.forwardRef<HTMLDivElement, DialogPopupProps>(function DialogPopup(
  {
    size = 'md',
    className,
    children,
    onPointerDownCapture,
    onMouseDownCapture,
    onClickCapture,
    onAuxClickCapture,
    onKeyDownCapture,
    onSubmitCapture,
    ...rest
  },
  ref,
) {
  const layer = useOverlayLayer('modal');
  const guards = guardWhileClosing(
    { onPointerDownCapture, onMouseDownCapture, onClickCapture, onAuxClickCapture, onKeyDownCapture, onSubmitCapture },
    'data-closed',
  );
  const [backdrop, setBackdrop] = React.useState<HTMLDivElement | null>(null);
  useSwallowRepeatClicksOnBackdrop(backdrop);
  return (
    <BaseDialog.Portal>
      <PopupScope className="relative" style={layer.style}>
        <LayerBaseContext.Provider value={layer.base}>
          <BaseDialog.Backdrop ref={setBackdrop} forceRender className={BACKDROP_CLASSES} onMouseDown={keepSelection} />
          <BaseDialog.Popup
            ref={ref}
            data-ui="Dialog"
            {...{ [OVERLAY_ATTRIBUTE]: '' }}
            {...rest}
            {...guards}
            className={cn(POPUP_CLASSES, POPUP_TRANSITION_CLASSES, NESTED_DIM_CLASSES, SIZE_CLASSES[size], className)}
          >
            <div className={BODY_CLASSES}>{children}</div>
          </BaseDialog.Popup>
        </LayerBaseContext.Provider>
      </PopupScope>
    </BaseDialog.Portal>
  );
});

export interface DialogTitleProps extends Omit<BaseDialog.Title.Props, 'className'> {
  className?: string;
}

const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(function DialogTitle({ className, ...rest }, ref) {
  const isAlert = React.useContext(AlertContext);
  return (
    <BaseDialog.Title
      ref={ref}
      {...rest}
      className={cn('text-primary text-heading break-words', isAlert && 'font-medium', className)}
    />
  );
});

export interface DialogDescriptionProps extends Omit<BaseDialog.Description.Props, 'className'> {
  className?: string;
}

const DialogDescription = React.forwardRef<HTMLParagraphElement, DialogDescriptionProps>(function DialogDescription(
  { className, ...rest },
  ref,
) {
  return <BaseDialog.Description ref={ref} {...rest} className={cn('mt-1 text-body font-normal text-secondary break-words', className)} />;
});

export interface DialogCloseButtonProps extends Omit<BaseDialog.Close.Props, 'className' | 'render' | 'children'> {
  /** Names the button; "Close" when left out. */
  label?: string;
  className?: string;
}

/** A ghost button with a cross that closes the dialog. */
const DialogCloseButton = React.forwardRef<HTMLButtonElement, DialogCloseButtonProps>(function DialogCloseButton(
  { label, className, ...rest },
  ref,
) {
  const closeLabel = useKitLabel('close');
  return (
    <BaseDialog.Close
      ref={ref}
      {...rest}
      render={<Button variant="ghost" icon="X" iconOnly tooltip={false} aria-label={label ?? closeLabel} className={className} />}
    />
  );
});

export interface DialogHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The title; it names the dialog. */
  children?: React.ReactNode;
  /** A line under the title; it describes the dialog. */
  description?: React.ReactNode;
  /** Shows a close button beside the title. */
  showClose?: boolean;
  closeLabel?: string;
}

/** The dialog's title row: the title, an optional description and a close button. */
const DialogHeader = React.forwardRef<HTMLDivElement, DialogHeaderProps>(function DialogHeader(
  { children, description, showClose = true, closeLabel, className, ...rest },
  ref,
) {
  const isAlert = React.useContext(AlertContext);
  return (
    <div ref={ref} {...rest} className={cn('mb-pad-md flex items-start gap-2', className)}>
      <div className={cn('min-w-0 flex-1', isAlert ? '-mt-0.5' : '-mt-1')}>
        <DialogTitle>{children}</DialogTitle>
        {description !== undefined && description !== null && description !== false && (
          <DialogDescription>{description}</DialogDescription>
        )}
      </div>
      {showClose && <DialogCloseButton label={closeLabel} className={CLOSE_FLUSH_CLASSES} />}
    </div>
  );
});

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** How the buttons line up once there is room for them in a row; stacked on narrow windows. */
  align?: DialogFooterAlign;
}

const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(function DialogFooter(
  { align = 'end', className, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cn('mt-pad-lg flex flex-col-reverse gap-2 sm:flex-row', FOOTER_ALIGN_CLASSES[align], className)} />
  );
});

/** A modal dialog: Root holds the open state, Popup the card with Header, body and Footer. */
export const Dialog = {
  Root: DialogRoot,
  Trigger: BaseDialog.Trigger,
  Popup: DialogPopup,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Footer: DialogFooter,
  Close: BaseDialog.Close,
  CloseButton: DialogCloseButton,
} as const;

/** A dialog that asks for a decision; it closes only through its own buttons or Escape. */
export const AlertDialog = {
  Root: AlertDialogRoot,
  Trigger: BaseAlertDialog.Trigger,
  Popup: DialogPopup,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Footer: DialogFooter,
  Close: BaseAlertDialog.Close,
  CloseButton: DialogCloseButton,
} as const;
