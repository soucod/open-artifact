/**
 * The Share button and its panel, laid out like share dialog: a popover with a caret under the button.
 *
 * - **Share**: the people with access (the owner, then each guest who
 *   joined, online first, with a role menu and Remove), general access (this
 *   computer, or anyone on the network with a link) and a link per role to
 *   copy, turn on or off, or reset (`artifact.share`).
 * - **Export**: "send a link instead", the page's formats (`formats`, run
 *   with `export_format`) or a v1 page's downloads (`chrome_exports`), and
 *   last the whole folder as a zip (`artifact.archive`).
 *
 * Escape closes the confirm box, then an open menu, then the panel.
 */

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Popover as BasePopover } from '@base-ui/react/popover';
import type { CloudMember, GeneralAccess, HostDestination, ShareCloudView, ShareGuest, ShareRole, ShareView } from '@open-artifact/protocol';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Code,
  Building2,
  Download,
  ExternalLink,
  Eye,
  Globe,
  File,
  FileText,
  Folder,
  Image,
  Link,
  LoaderCircle,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Network,
  Pencil,
  Presentation,
  Share2,
  Trash2,
  TriangleAlert,
  Users,
  Video,
  X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button, IconButton, Segmented, SelectInput, SwitchInput, TextInput, cn } from '@open-artifact/ui';
import { Avatar } from '../../components/Account.tsx';
import { addMembersRequest, accessRequest, mayExport, memberRoleRequest, parseMembers, roleOf, settingRequest, showsRoleLinks } from '../../lib/cloud.ts';
import { ago, avatarColor, formatKind, initials, type FormatKind } from '../../lib/format.ts';
import {
  autoText,
  autoView,
  checkHostAddress,
  defaultSite,
  hostLabel,
  offersDefaultPicker,
  publishedOf,
  remoteState,
  suggestName,
  syncText,
  syncView,
  type RemoteArtifact,
  type RemoteInfo,
  type RemoteState,
} from '../../lib/publish.ts';
import { t, type MessageKey } from '../../lib/i18n.ts';
import { networkStatus, shareLayout } from '../../lib/share-layout.ts';
import { command, exportFormat, openExternal, requestExports } from '../bridge.ts';
import {
  changeCloudShare,
  closeConnect,
  connectSite,
  copyShareLink,
  downloadArchive,
  sendToDestination,
  openConnect,
  publishPanelClosed,
  publishTo,
  refreshDataHere,
  refreshRemotes,
  refreshShare,
  setAutoPublish,
  setDataPublish,
  setDefaultSite,
  shellLink,
  unpublish,
} from '../actions.ts';
import { useAgentName, useTitle } from '../hooks.ts';
import { whyText } from '../labels.ts';
import { ROLES, exportEntries, givenLink, hasExportTab, isShared, leastRole, offersArchive, shownAddresses, sortedGuests } from '../model.ts';
import { useBoot, useShell } from '../store.ts';

const ROLE_NAME: Record<ShareRole, MessageKey> = { editor: 'roleEditor', commenter: 'roleCommenter', viewer: 'roleViewer' };
const LINK_TITLE: Record<ShareRole, MessageKey> = { editor: 'linkEditor', commenter: 'linkCommenter', viewer: 'linkViewer' };
const ROLE_NOTE: Record<ShareRole, MessageKey> = { editor: 'noteEditor', commenter: 'noteCommenter', viewer: 'noteViewer' };
const ROLE_ICON: Record<ShareRole, ReactNode> = {
  editor: <Pencil className="size-4" />,
  commenter: <MessageCircle className="size-4" />,
  viewer: <Eye className="size-4" />,
};

/** A coloured file tile. */
function FileTile({ color, text, size, y }: { color: string; text: string; size: number; y: number }) {
  return (
    <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
      <rect width="22" height="22" rx="5" fill={color} />
      <text x="11" y={y} textAnchor="middle" fontSize={size} fontWeight="700" fontFamily="ui-sans-serif, system-ui, sans-serif" fill="#fff">
        {text}
      </text>
    </svg>
  );
}

const FORMAT_ICON: Record<FormatKind, ReactNode> = {
  folder: <Folder className="size-[18px]" />,
  pdf: <FileTile color="#e0342b" text="PDF" size={8} y={14.6} />,
  document: <FileTile color="#2b579a" text="W" size={11} y={15.4} />,
  slides: <Presentation className="size-[18px]" />,
  spreadsheet: <FileTile color="#1d7044" text="X" size={11} y={15.4} />,
  image: <Image className="size-[18px]" />,
  html: <Code className="size-[18px]" />,
  video: <Video className="size-[18px]" />,
  text: <FileText className="size-[18px]" />,
  file: <File className="size-[18px]" />,
};

// ---- layers over the panel: menus and the confirm box ----------------------------------------------------------------

/** A confirm box over the panel. */
interface AskSpec {
  title: string;
  body: string;
  ok: string;
  run: () => void;
}

/** What the panel's menus and buttons tell the panel, so Escape closes the top layer only. */
interface Layers {
  /** A menu opened or closed (`reason`: Base UI's). */
  menu(id: string, open: boolean, reason?: string): void;
  ask(spec: AskSpec): void;
}

const LayersContext = createContext<Layers>({ menu: () => {}, ask: (spec) => spec.run() });

/** One row of a panel menu: a label, a note under it, a tick for the current choice. */
interface PanelMenuItem {
  key: string;
  label: string;
  sub?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

/** A menu of the panel: under its trigger, its rows with notes. */
function PanelMenu({ trigger, items, align = 'end' }: { trigger: ReactElement<Record<string, unknown>>; items: PanelMenuItem[]; align?: 'start' | 'end' }) {
  const layers = useContext(LayersContext);
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => () => layers.menu(id, false), [layers, id]);
  const radio = items.some((item) => item.checked !== undefined);
  return (
    <BaseMenu.Root
      open={open}
      modal={false}
      onOpenChange={(next, details) => {
        setOpen(next);
        layers.menu(id, next, details.reason);
      }}
    >
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side="bottom" align={align} sideOffset={6} collisionPadding={12} className="z-[1001]">
          <BaseMenu.Popup
            data-share-menu=""
            className="min-w-[200px] max-w-[min(340px,calc(100vw-24px))] rounded-xl bg-surface p-1.5 text-[13px] text-fg shadow-popup outline-none transition-opacity duration-100 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
          >
            {items.map((item) => (
              <BaseMenu.Item
                key={item.key}
                disabled={item.disabled}
                onClick={item.run}
                {...(radio ? { role: 'menuitemradio', 'aria-checked': !!item.checked } : {})}
                className="flex w-full cursor-default select-none items-center gap-4 rounded-lg py-2 pl-3 pr-2.5 text-left outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-45"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate', item.danger && 'text-danger')}>{item.label}</span>
                  {item.sub ? <span className="text-xs text-fg-muted">{item.sub}</span> : null}
                </span>
                {radio ? <span className="flex w-[18px] shrink-0 justify-center text-accent">{item.checked ? <Check className="size-4" /> : null}</span> : null}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** The confirm box, over the whole panel. */
function Confirm({ spec, onDone }: { spec: AskSpec; onDone: (yes: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  // After the menu that asked hands focus back to its trigger.
  useEffect(() => {
    const frame = requestAnimationFrame(() => cancel.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={spec.title}
      className="absolute inset-0 z-[2] grid place-items-center rounded-2xl bg-surface/85 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDone(false);
      }}
    >
      <div className="w-full max-w-[360px] rounded-xl bg-surface p-[18px] shadow-popup">
        <h3 className="m-0 mb-1.5 text-[15px] font-semibold">{spec.title}</h3>
        <p className="m-0 mb-4 text-fg-muted">{spec.body}</p>
        <div className="flex justify-end gap-2">
          <Button ref={cancel} size="lg" onClick={() => onDone(false)}>
            {t('cancel')}
          </Button>
          <Button size="lg" variant="danger" onClick={() => onDone(true)}>
            {spec.ok}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- small parts ---------------------------------------------------------------------------------------------------

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 mt-[18px] text-[13px] text-fg-muted">{children}</div>;
}

function Circle({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <div className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg', dim && 'opacity-50')}>{children}</div>;
}

const ROW = 'flex min-h-12 items-center gap-3 py-1';
const PILL = 'border-transparent bg-surface-2 px-3 text-[13px] hover:bg-hover';

/** "Copy link", then "Copied" in green for a moment. */
function CopyButton({ which, url }: { which: string; url: string }) {
  const copied = useShell((state) => state.share.copied === which);
  return (
    <Button
      size="lg"
      variant="ghost"
      icon={copied ? <Check className="size-3.5" /> : <Link className="size-3.5" />}
      className={cn(PILL, copied && 'text-success')}
      disabled={!url}
      onClick={() => void copyShareLink(which, url)}
    >
      {copied ? t('copied') : t('copyLink')}
    </Button>
  );
}

/** A select-looking button that opens a panel menu: its value and a chevron. */
function selectTrigger(label: string, props: Record<string, unknown> = {}, wide = false): ReactElement<Record<string, unknown>> {
  return (
    <Button
      size="lg"
      variant="ghost"
      className={cn('gap-1.5 px-2.5 font-normal data-[popup-open]:bg-hover', wide && '-ml-2.5 max-w-full font-medium')}
      {...props}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
    </Button>
  );
}

// ---- the Share tab -------------------------------------------------------------------------------------------------

function OwnerRow() {
  const boot = useBoot();
  const name = boot.userName || t('you');
  return (
    <div className={ROW}>
      <div className="grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white" style={{ background: avatarColor(`local${name}`) }}>
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {name}
          {boot.userName ? <span className="text-fg-muted"> {t('you')}</span> : null}
        </div>
        <div className="truncate text-xs text-fg-muted">{t('thisComputer')}</div>
      </div>
      <span className="inline-flex h-8 items-center gap-1.5 px-2.5 text-fg-subtle">
        {t('owner')}
        <ChevronDown className="size-3.5" />
      </span>
    </div>
  );
}

/** Someone who joined: online or when last seen, their role, Remove. */
function GuestRow({ guest, view }: { guest: ShareGuest; view: ShareView }) {
  const layers = useContext(LayersContext);
  const status = guest.online ? t('online') : guest.active ? t('seenAgo', { when: ago(guest.seen ?? guest.joined) }) : t('guestPaused');
  return (
    <div className={ROW} data-share-guest={guest.id}>
      <div
        className={cn('relative grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white', !guest.active && 'opacity-55 grayscale')}
        style={{ background: avatarColor(guest.id) }}
      >
        {initials(guest.name)}
        {guest.online ? <span aria-hidden className="absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-surface bg-success" /> : null}
      </div>
      <div className={cn('min-w-0 flex-1', !guest.active && 'opacity-70')}>
        <div className="truncate">{guest.name}</div>
        <div className={cn('truncate text-xs', guest.online ? 'text-success' : 'text-fg-muted')}>{status}</div>
      </div>
      <PanelMenu
        trigger={selectTrigger(t(ROLE_NAME[guest.role]), { 'aria-label': t('changeRole', { name: guest.name }) })}
        items={ROLES.map((role) => {
          const on = !!view.links[role]?.on;
          return {
            key: role,
            label: t(ROLE_NAME[role]),
            ...(on ? {} : { sub: t('roleLinkOff') }),
            checked: role === guest.role,
            disabled: !on,
            run: () => {
              if (role !== guest.role) void refreshShare({ guests: { [guest.id]: role } });
            },
          };
        })}
      />
      <IconButton
        label={t('removeGuest', { name: guest.name })}
        title={t('remove')}
        noTooltip
        size="lg"
        icon={<Trash2 className="size-4" />}
        onClick={() =>
          layers.ask({
            title: t('removeTitle', { name: guest.name }),
            body: t('removeBody'),
            ok: t('remove'),
            run: () => void refreshShare({ guests: { [guest.id]: null } }),
          })
        }
      />
    </div>
  );
}

/** General access: this computer only, or anyone on the network with a link; where it can be opened. */
function GeneralAccess({ view }: { view: ShareView }) {
  const addresses = shownAddresses(view);
  const where = view.lan ? (view.addresses?.length ? t('onNetworkAt', { addresses: addresses.join(' · ') }) : t('noAddress')) : t('whereOff');
  const port = view.port ? `:${view.port}` : '';
  return (
    <div className={cn(ROW, 'items-start')}>
      <Circle>{view.lan ? <Network className="size-4" /> : <Lock className="size-4" />}</Circle>
      <div className="min-w-0 flex-1">
        <PanelMenu
          align="start"
          trigger={selectTrigger(view.lan ? t('onLan') : t('onlyThisComputer'), { 'aria-label': t('generalAccess') }, true)}
          items={[
            { key: 'here', label: t('onlyThisComputer'), sub: t('onlyHereSub'), checked: !view.lan, run: () => view.lan && void refreshShare({ lan: false }) },
            { key: 'lan', label: t('onLan'), sub: t('onLanSub'), checked: view.lan, run: () => !view.lan && void refreshShare({ lan: true }) },
          ]}
        />
        <div className="break-words text-xs text-fg-muted">{where}</div>
        {view.lan && view.tailnet ? <div className="mt-0.5 break-words text-xs text-fg-muted">{t('onTailnet', { address: `${view.tailnet.address}${port}` })}</div> : null}
      </div>
    </div>
  );
}

/** A role's link: Copy link when on, Turn on when off, and its ⋯ menu. */
function LinkRow({ role, view }: { role: ShareRole; view: ShareView }) {
  const layers = useContext(LayersContext);
  const link = view.links[role];
  if (!link) return null;
  const tailnet = view.lan && view.tailnet ? view.tailnet.links[role] : undefined;
  const items: PanelMenuItem[] = [
    ...(link.on && tailnet
      ? [{ key: 'tailnet', label: t('copyTailnet'), sub: t('copyTailnetNote', { address: view.tailnet!.address }), run: () => void copyShareLink(role, tailnet) }]
      : []),
    link.on
      ? { key: 'off', label: t('turnOffLink'), sub: t('turnOffNote'), run: () => void refreshShare({ links: { [role]: false } }) }
      : { key: 'on', label: t('turnOnLink'), run: () => void refreshShare({ links: { [role]: true } }) },
    {
      key: 'reset',
      label: t('resetLink'),
      sub: t('resetNote'),
      danger: true,
      run: () =>
        layers.ask({
          title: t('resetTitle', { role: t(LINK_TITLE[role]) }),
          body: t('resetBody'),
          ok: t('resetLink'),
          run: () => void refreshShare({ reset: [role] }),
        }),
    },
  ];
  return (
    <div className={ROW} title={link.on ? link.url : undefined} data-share-link={role}>
      <Circle dim={!link.on}>{ROLE_ICON[role]}</Circle>
      <div className={cn('min-w-0 flex-1', !link.on && 'opacity-50')}>
        <div className="truncate">{t(LINK_TITLE[role])}</div>
        <div className="truncate text-xs text-fg-muted">{link.on ? t(ROLE_NOTE[role]) : t('linkOff')}</div>
      </div>
      {link.on ? (
        <CopyButton which={role} url={link.url ?? ''} />
      ) : (
        <Button size="lg" variant="ghost" className={PILL} onClick={() => void refreshShare({ links: { [role]: true } })}>
          {t('turnOn')}
        </Button>
      )}
      <PanelMenu
        items={items}
        trigger={<IconButton label={t('moreFor', { role: t(LINK_TITLE[role]) })} title={t('more')} noTooltip size="lg" icon={<MoreHorizontal className="size-4" />} />}
      />
    </div>
  );
}

// ---- publishing to the web (local only) -----------------------------------------------------------------------------

const REMOTE_STATE: Record<RemoteState, MessageKey> = {
  connected: 'pubStateConnected',
  connecting: 'pubStateConnecting',
  unreachable: 'pubStateUnreachable',
  signed_out: 'pubStateSignedOut',
};

/** Opens an address outside the Shell (the declared host's way, else a new tab). */
const openTab = (url: string): void => openExternal(url);

/** The connect form: the site's address and a name for it (suggested from the address until typed over). */
function ConnectForm({ host, name, error, taken }: { host: string; name: string; error: string; taken: string[] }) {
  const [address, setAddress] = useState(host);
  const [label, setLabel] = useState(name);
  const [named, setNamed] = useState(!!name);
  const hostId = useId();
  const nameId = useId();
  const checked = checkHostAddress(address);
  const insecure = checked.ok && checked.insecure === true;
  const shownName = named ? label : address.trim() ? suggestName(checked.ok ? checked.host : `https://${address.trim()}`, taken) : '';
  return (
    <form
      data-publish-form=""
      className="mt-2 rounded-xl border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void connectSite(address, shownName);
      }}
    >
      <label htmlFor={hostId} className="mb-1 block text-xs font-medium">
        {t('pubAddress')}
      </label>
      <TextInput
        id={hostId}
        autoFocus
        value={address}
        type="text"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder={t('pubAddressPlaceholder')}
        className="h-8 w-full text-[13px]"
        onChange={(event) => setAddress(event.target.value)}
      />
      <div className="mt-1 text-xs text-fg-muted">{t('pubAddressHint')}</div>
      {insecure ? (
        <div data-publish-insecure="" className="mt-1 flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {t('pubInsecureWarning')}
        </div>
      ) : null}
      <label htmlFor={nameId} className="mb-1 mt-3 block text-xs font-medium">
        {t('pubName')}
      </label>
      <TextInput
        id={nameId}
        value={shownName}
        type="text"
        autoComplete="off"
        spellCheck={false}
        className="h-8 w-40 text-[13px]"
        onChange={(event) => {
          setNamed(true);
          setLabel(event.target.value);
        }}
      />
      <div className="mt-1 text-xs text-fg-muted">{t('pubNameHint')}</div>
      {error ? (
        <div role="alert" className="mt-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="lg" onClick={() => closeConnect()}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="lg" variant="primary" disabled={!address.trim()}>
          {t('pubConnect')}
        </Button>
      </div>
    </form>
  );
}

/** Where connecting a site stands: the form, the code to approve, success, or why it failed. */
function ConnectBox({ taken }: { taken: string[] }) {
  const connect = useShell((state) => state.publish.connect);
  switch (connect.step) {
    case 'closed':
      return null;
    case 'form':
      return <ConnectForm host={connect.host} name={connect.name} error={connect.error} taken={taken} />;
    case 'starting':
      return (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-line p-3 text-fg-muted">
          <LoaderCircle className="size-4 animate-spin" />
          {t('pubConnecting')}
        </div>
      );
    case 'code': {
      const { start } = connect;
      return (
        <div data-publish-code="" className="mt-2 rounded-xl border border-line p-3">
          <div className="font-medium">{t('pubCodeTitle', { host: hostLabel(start.host) })}</div>
          <p className="mb-2 mt-1 text-xs text-fg-muted">{t('pubCodeBody')}</p>
          <div className="mb-2.5 select-all rounded-lg bg-surface-2 py-2 text-center font-mono text-xl font-semibold tracking-[0.2em]">{start.user_code}</div>
          {start.opened ? <p className="mb-2 mt-0 text-xs text-fg-muted">{t('pubCodeOpened')}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" variant="primary" icon={<ExternalLink className="size-3.5" />} onClick={() => openTab(start.verification_uri_complete)}>
              {t('pubOpenApproval')}
            </Button>
            <span className="flex flex-1 items-center gap-1.5 text-xs text-fg-muted">
              <LoaderCircle className="size-3.5 animate-spin" />
              {t('pubWaitingApproval')}
            </span>
            <Button size="lg" variant="ghost" onClick={() => closeConnect()}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      );
    }
    case 'done':
      return (
        <div role="status" className="mt-2 flex items-center gap-2 text-xs text-success">
          <Check className="size-3.5 shrink-0" />
          {t('pubConnected', { host: hostLabel(connect.host), name: connect.user })}
        </div>
      );
    case 'failed':
      return (
        <div className="mt-2 rounded-xl border border-line p-3">
          <div role="alert" className="text-xs text-danger">
            {connect.error}
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="lg" variant="ghost" onClick={() => closeConnect()}>
              {t('cancel')}
            </Button>
            <Button size="lg" onClick={() => openConnect({ host: connect.host, name: connect.name })}>
              {t('pubTryAgain')}
            </Button>
          </div>
        </div>
      );
  }
}

/** A site this computer can publish to: its name, address, account and state, and Publish (or Connect again). */
function RemoteRow({ remote, isDefault }: { remote: RemoteInfo; isDefault: boolean }) {
  const busy = useShell((state) => state.publish.busy);
  const state = remoteState(remote);
  const publishing = busy === `publish:${remote.name}`;
  const sub = [remote.user ? t('pubSignedInAs', { name: remote.user.name || remote.user.email || remote.user.id }) : '', t(REMOTE_STATE[state])].filter(Boolean).join(' · ');
  if (remote.approval) return <ApprovalBox remote={remote} />;
  return (
    <div className={ROW} data-publish-remote={remote.name}>
      <Circle dim={state === 'signed_out'}>{state === 'unreachable' || state === 'signed_out' ? <CloudOff className="size-4" /> : <Cloud className="size-4" />}</Circle>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {remote.name} <span className="text-fg-muted">· {hostLabel(remote.host)}</span>
          {isDefault ? (
            <span data-publish-default="" className="ml-1.5 rounded bg-surface-2 px-1 text-[11px] text-fg-muted">
              {t('pubDefaultMark')}
            </span>
          ) : null}
        </div>
        <div className={cn('truncate text-xs', state === 'connected' ? 'text-success' : 'text-fg-muted')}>{sub}</div>
        {remote.insecure ? <div className="truncate text-xs text-warning">{t('pubInsecureWarning')}</div> : null}
      </div>
      {state === 'signed_out' ? (
        <Button size="lg" variant="ghost" className={PILL} onClick={() => openConnect({ host: remote.host, name: remote.name })}>
          {t('pubReconnect')}
        </Button>
      ) : (
        <Button size="lg" variant="primary" disabled={!!busy} icon={publishing ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined} onClick={() => void publishTo(remote.name)}>
          {publishing ? t('pubPublishing') : t('pubPublish')}
        </Button>
      )}
    </div>
  );
}

/** A preset site waiting for the person to approve this computer: its code and the approval page (no browser opened). */
function ApprovalBox({ remote }: { remote: RemoteInfo }) {
  const approval = remote.approval!;
  const host = hostLabel(remote.host);
  return (
    <div data-publish-approval={remote.name} className="mt-2 rounded-xl border border-line p-3">
      <div className="font-medium">{t('pubApprovalTitle', { host })}</div>
      <p className="mb-2 mt-1 text-xs text-fg-muted">{t('pubApprovalBody', { host })}</p>
      <div className="mb-2.5 select-all rounded-lg bg-surface-2 py-2 text-center font-mono text-xl font-semibold tracking-[0.2em]">{approval.user_code}</div>
      {remote.insecure ? <p className="mb-2 mt-0 text-xs text-warning">{t('pubInsecureWarning')}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" variant="primary" icon={<ExternalLink className="size-3.5" />} onClick={() => openTab(approval.verification_uri_complete)}>
          {t('pubOpenApproval')}
        </Button>
        <span className="flex flex-1 items-center gap-1.5 text-xs text-fg-muted">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t('pubWaitingApproval')}
        </span>
      </div>
    </div>
  );
}

/** Publishing by itself: the switch, and the default site when more than one is connected. A person's choice only. */
function AutoPublishSettings({ remotes }: { remotes: RemoteInfo[] }) {
  const cloud = useShell((state) => state.publish.cloud);
  const busy = useShell((state) => state.publish.busy);
  if (!cloud) return null;
  const site = defaultSite(remotes, cloud);
  const siteHost = remotes.find((r) => r.name === site)?.host;
  const on = cloud.publish === 'auto';
  return (
    <div data-publish-auto={on ? 'on' : 'off'} className="mt-2 border-t border-line pt-2">
      {offersDefaultPicker(remotes) ? (
        <label className="flex min-h-9 items-center gap-3 py-1">
          <span className="min-w-0 flex-1">{t('pubDefaultSite')}</span>
          <SelectInput
            aria-label={t('pubDefaultSite')}
            value={site}
            className="h-8 max-w-60 overflow-hidden whitespace-nowrap text-[13px]"
            options={remotes.map((r) => ({ value: r.name, label: `${r.name} · ${hostLabel(r.host)}` }))}
            onChange={(name) => void setDefaultSite(name)}
          />
        </label>
      ) : null}
      <label className="flex min-h-9 cursor-default items-center gap-3 py-1">
        <span className="min-w-0 flex-1">{t('pubAutoSwitch')}</span>
        <SwitchInput checked={on} disabled={!!busy || (!on && !site)} aria-label={t('pubAutoSwitch')} onChange={(next) => void setAutoPublish(next)} />
      </label>
      <div className="text-xs text-fg-muted">{site && siteHost ? (on ? t('pubAutoHint', { host: hostLabel(siteHost) }) : null) : t('pubAutoNoSite')}</div>
    </div>
  );
}

const SYNC_TONE: Record<ReturnType<typeof syncView>['kind'], string> = {
  in_sync: 'text-success',
  waiting: 'text-fg-muted',
  offline: 'text-warning',
  signed_out: 'text-warning',
  failed: 'text-danger',
};

/** A published artifact: its web address (Copy, Open), how its sync stands, where sharing is managed, Unpublish. */
function Published({ remote, artifact }: { remote: RemoteInfo; artifact: RemoteArtifact }) {
  const layers = useContext(LayersContext);
  const busy = useShell((state) => state.publish.busy);
  const sync = syncView(remote, artifact);
  const text = syncText(sync, remote.host, ago);
  const host = hostLabel(remote.host);
  return (
    <div data-publish-state={sync.kind}>
      <div className={ROW} title={artifact.view_url}>
        <Circle>
          <Globe className="size-4" />
        </Circle>
        <div className="min-w-0 flex-1">
          <div className="truncate">{t('pubPublishedAt', { host })}</div>
          <div className="truncate text-xs text-fg-muted">{artifact.view_url}</div>
        </div>
        <CopyButton which="web" url={artifact.view_url} />
        <IconButton label={t('pubOpen')} size="lg" icon={<ExternalLink className="size-4" />} onClick={() => openTab(artifact.view_url)} />
      </div>
      <div className={cn('mt-0.5 flex items-start gap-1.5 text-xs', SYNC_TONE[sync.kind])} role="status" data-publish-sync="">
        {sync.kind === 'in_sync' ? <Check className="mt-px size-3.5 shrink-0" /> : sync.kind === 'waiting' ? <LoaderCircle className="mt-px size-3.5 shrink-0" /> : <CloudOff className="mt-px size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 break-words">
          {t(text.key, text.vars)}
          {(sync.kind === 'offline' || sync.kind === 'failed') && sync.count ? ` · ${t(sync.count === 1 ? 'pubWaitingOne' : 'pubWaiting', { count: sync.count })}` : ''}
        </span>
        {sync.kind === 'signed_out' ? (
          <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => openConnect({ host: remote.host, name: remote.name })}>
            {t('pubReconnect')}
          </button>
        ) : null}
      </div>
      <p className="mb-0 mt-2.5 text-xs text-fg-muted">
        {t('pubManage')}{' '}
        <a
          href={artifact.view_url}
          target="_blank"
          rel="noopener"
          className="text-accent hover:underline"
          onClick={(event) => {
            event.preventDefault();
            openExternal(artifact.view_url);
          }}
        >
          {t('pubManageLink')}
        </a>
      </p>
      <p className="mb-0 mt-1 text-xs text-fg-muted">{t('pubOpensThere')}</p>
      <PublishedData host={host} />
      <div className="mt-2.5 flex justify-end">
        <Button
          size="lg"
          variant="ghost"
          className="text-danger"
          disabled={!!busy}
          icon={busy === 'unpublish' ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
          onClick={() =>
            layers.ask({
              title: t('unpubTitle'),
              body: t('unpubBody', { host }),
              ok: t('pubUnpublish'),
              run: () => void unpublish(),
            })
          }
        >
          {busy === 'unpublish' ? t('pubUnpublishing') : t('pubUnpublish')}
        </Button>
      </div>
    </div>
  );
}

/**
 * A published dashboard's live data: published with it (when the rows on the site are as of, why the last refresh
 * failed, "Refresh now" and "Stop publishing data", which asks first: the rows leave the site, the dashboard stays),
 * or not yet (an automatic or agent publish), with "Publish its data". Nothing for other artifacts.
 */
function PublishedData({ host }: { host: string }) {
  const layers = useContext(LayersContext);
  const data = useShell((state) => state.publish.data);
  const busy = useShell((state) => state.publish.busy);
  if (!data?.live) return null;
  if (!data.publish)
    return (
      <div data-publish-data="pending" className="mt-2 flex items-start gap-2 text-xs text-fg-muted">
        <span className="min-w-0 flex-1">{t('pubDataPending')}</span>
        <Button size="sm" variant="ghost" className={PILL} disabled={!!busy} data-publish-data-confirm="" onClick={() => void setDataPublish(true)}>
          {t('pubDataConfirm')}
        </Button>
      </div>
    );
  return (
    <div data-publish-data="on" className="mt-2 text-xs text-fg-muted">
      <div>{data.at ? t('pubDataAsOf', { time: new Date(data.at).toLocaleString() }) : t('pubDataNone')}</div>
      {data.lastError ? <div className="text-warning">{t('pubDataFailed', { reason: data.lastError })}</div> : null}
      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          className={PILL}
          disabled={!!busy || data.running}
          data-publish-data-refresh=""
          icon={busy === 'data-refresh' || data.running ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
          onClick={() => void refreshDataHere()}
        >
          {busy === 'data-refresh' || data.running ? t('pubDataRefreshing') : t('pubDataRefresh')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(PILL, 'text-danger')}
          disabled={!!busy}
          data-publish-data-stop=""
          onClick={() =>
            layers.ask({
              title: t('pubDataStopTitle'),
              body: t('pubDataStopBody', { host }),
              ok: t('pubDataStop'),
              run: () => void setDataPublish(false),
            })
          }
        >
          {t('pubDataStop')}
        </Button>
      </div>
    </div>
  );
}

/** "Publish to the web" in the local Share tab: connect a site, publish there, or the published state. */
function PublishSection() {
  const id = useShell((state) => state.boot?.id ?? '');
  const remotes = useShell((state) => state.publish.remotes);
  const missing = useShell((state) => state.publish.missing);
  const step = useShell((state) => state.publish.connect.step);
  const error = useShell((state) => state.publish.error);
  const cloud = useShell((state) => state.publish.cloud);
  const data = useShell((state) => state.publish.data);
  if (missing || remotes === null) return null;
  const published = publishedOf(remotes, id);
  const taken = remotes.map((r) => r.name);
  const auto = published ? null : autoView(cloud, id);
  const autoSaid = auto ? autoText(auto, remotes) : null;
  const site = defaultSite(remotes, cloud);
  return (
    <section data-share-publish="">
      <Label>{t('pubTitle')}</Label>
      {auto && autoSaid ? (
        <div data-publish-auto-state={auto.kind} role="status" className={cn('mb-1 flex items-start gap-1.5 text-xs', auto.kind === 'failed' ? 'text-warning' : 'text-fg-muted')}>
          {auto.kind === 'failed' ? <CloudOff className="mt-px size-3.5 shrink-0" /> : <LoaderCircle className="mt-px size-3.5 shrink-0 animate-spin" />}
          <span className="min-w-0 flex-1 break-words">{t(autoSaid.key, autoSaid.vars)}</span>
        </div>
      ) : null}
      {published ? (
        <Published remote={published.remote} artifact={published.artifact} />
      ) : remotes.length ? (
        <>
          {remotes.map((remote) => (
            <RemoteRow key={remote.name} remote={remote} isDefault={offersDefaultPicker(remotes) && remote.name === site} />
          ))}
          {data?.live ? (
            <p data-publish-data-note="" className="mb-0 mt-1 text-xs text-fg-muted">
              {t('pubDataNote')}
            </p>
          ) : null}
          {step === 'closed' || step === 'done' ? (
            <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => openConnect()}>
              {t('pubConnectAnother')}
            </button>
          ) : null}
        </>
      ) : (
        <div className={cn(ROW, 'items-start')}>
          <Circle>
            <Globe className="size-4" />
          </Circle>
          <div className="min-w-0 flex-1 pt-0.5 text-xs text-fg-muted">{t('pubIntro')}</div>
          {step === 'closed' ? (
            <Button size="lg" variant="ghost" className={PILL} onClick={() => openConnect()}>
              {t('pubConnectSite')}
            </Button>
          ) : null}
        </div>
      )}
      {published && step === 'done' ? null : <ConnectBox taken={taken} />}
      {remotes.length ? <AutoPublishSettings remotes={remotes} /> : null}
      {error ? (
        <div role="alert" className="mt-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
    </section>
  );
}

// ---- the Share tab on a cloud host ----------------------------------------------------------------------------------

const ACCESS_NAME: Record<GeneralAccess, MessageKey> = { restricted: 'accessRestricted', link: 'accessLink', public: 'accessPublic' };
const ACCESS_NOTE: Record<GeneralAccess, MessageKey> = { restricted: 'accessRestrictedSub', link: 'accessLinkSub', public: 'accessPublicSub' };
const ACCESS_ICON: Record<GeneralAccess, ReactNode> = {
  restricted: <Lock className="size-4" />,
  link: <Link className="size-4" />,
  public: <Globe className="size-4" />,
};

/** The owner on a cloud host: their avatar, name and email, "(you)" when it is the person looking. */
function CloudOwnerRow({ cloud }: { cloud: ShareCloudView }) {
  const me = useShell((state) => state.boot?.cloud?.user?.id);
  const owner = cloud.owner;
  return (
    <div className={ROW} data-share-owner="">
      <Avatar id={owner.id} name={owner.name} avatar={owner.avatar} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {owner.name}
          {me === owner.id ? <span className="text-fg-muted"> {t('you')}</span> : null}
        </div>
        {owner.email ? <div className="truncate text-xs text-fg-muted">{owner.email}</div> : null}
      </div>
      <span className="inline-flex h-8 items-center px-2.5 text-fg-subtle">{t('owner')}</span>
    </div>
  );
}

/** One person, address, domain or group the artifact is shared with: their role menu and Remove access. */
function MemberRow({ member, canManage }: { member: CloudMember; canManage: boolean }) {
  const layers = useContext(LayersContext);
  const me = useShell((state) => state.boot?.cloud?.user?.id);
  const label = member.kind === 'domain' ? t('memberDomain', { domain: member.label.replace(/^@/, '') }) : member.label;
  const sub = member.pending ? t('memberPending') : member.kind === 'group' ? t('memberGroup') : member.email && member.email !== member.label ? member.email : '';
  const picture =
    member.kind === 'domain' ? <Circle><Building2 className="size-4" /></Circle>
    : member.kind === 'group' ? <Circle><Users className="size-4" /></Circle>
    : <span className={cn(member.pending && 'opacity-55')}><Avatar id={member.id} name={member.label} avatar={member.avatar} size={36} /></span>;
  return (
    <div className={ROW} data-share-member={member.id}>
      {picture}
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {label}
          {me && member.id === `user:${me}` ? <span className="text-fg-muted"> {t('you')}</span> : null}
        </div>
        {sub ? <div className="truncate text-xs text-fg-muted">{sub}</div> : null}
      </div>
      {canManage ? (
        <PanelMenu
          trigger={selectTrigger(t(ROLE_NAME[member.role]), { 'aria-label': t('changeRole', { name: label }) })}
          items={[
            ...ROLES.map((role) => ({
              key: role,
              label: t(ROLE_NAME[role]),
              sub: t(ROLE_NOTE[role]),
              checked: role === member.role,
              run: () => {
                if (role !== member.role) void changeCloudShare(memberRoleRequest(member.id, role));
              },
            })),
            {
              key: 'remove',
              label: t('removeAccess'),
              danger: true,
              run: () =>
                layers.ask({
                  title: t('removeTitle', { name: label }),
                  body: t('removeMemberBody'),
                  ok: t('remove'),
                  run: () => void changeCloudShare(memberRoleRequest(member.id, null)),
                }),
            },
          ]}
        />
      ) : (
        <span className="inline-flex h-8 items-center px-2.5 text-fg-subtle">{t(ROLE_NAME[member.role])}</span>
      )}
    </div>
  );
}

/** "Add people": email addresses or `@domain`s, the role they get, and Add. */
function AddPeople() {
  const [text, setText] = useState('');
  const [role, setRole] = useState<ShareRole>('editor');
  const [invalid, setInvalid] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const { members, invalid: bad } = parseMembers(text);
    if (bad.length) return setInvalid(t('addInvalid', { entries: bad.join(', ') }));
    if (!members.length || busy) return;
    setInvalid('');
    setBusy(true);
    const ok = await changeCloudShare(addMembersRequest(members, role));
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-1.5">
        <TextInput
          value={text}
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          aria-label={t('addPeople')}
          placeholder={t('addPeoplePlaceholder')}
          className="h-8 min-w-0 flex-1 text-[13px]"
          onChange={(event) => {
            setText(event.target.value);
            if (invalid) setInvalid('');
          }}
        />
        <PanelMenu
          trigger={selectTrigger(t(ROLE_NAME[role]), { 'aria-label': t('roleFor') })}
          items={ROLES.map((r) => ({ key: r, label: t(ROLE_NAME[r]), sub: t(ROLE_NOTE[r]), checked: r === role, run: () => setRole(r) }))}
        />
        <Button type="submit" size="lg" variant="primary" disabled={busy || !text.trim()}>
          {t('add')}
        </Button>
      </div>
      {invalid ? (
        <div role="alert" className="mt-1.5 text-xs text-danger">
          {invalid}
        </div>
      ) : null}
    </form>
  );
}

/** General access on a cloud host: Restricted, anyone with the link, or public (as a viewer). */
function CloudAccess({ cloud }: { cloud: ShareCloudView }) {
  const options: GeneralAccess[] = ['restricted', 'link', 'public'];
  return (
    <div className={cn(ROW, 'items-start')}>
      <Circle>{ACCESS_ICON[cloud.access]}</Circle>
      <div className="min-w-0 flex-1">
        <PanelMenu
          align="start"
          trigger={selectTrigger(t(ACCESS_NAME[cloud.access]), { 'aria-label': t('generalAccess') }, true)}
          items={options.map((access) => ({
            key: access,
            label: t(ACCESS_NAME[access]),
            sub: t(ACCESS_NOTE[access]),
            checked: access === cloud.access,
            run: () => {
              if (access !== cloud.access) void changeCloudShare(accessRequest(access));
            },
          }))}
        />
        <div className="break-words text-xs text-fg-muted">{t(ACCESS_NOTE[cloud.access])}</div>
      </div>
    </div>
  );
}

/** One on/off setting. */
function SettingRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-9 cursor-default items-center gap-3 py-1">
      <span className="min-w-0 flex-1">{label}</span>
      <SwitchInput checked={checked} aria-label={label} onChange={onChange} />
    </label>
  );
}

/** The Share tab when a cloud host shares the artifact: people, general access, role links, settings, Copy link. */
function CloudShareTab({ view, cloud }: { view: ShareView; cloud: ShareCloudView }) {
  const agent = useAgentName();
  const role = useShell((state) => roleOf(state.boot));
  const guests = sortedGuests(view);
  const copy = (
    <div className="mt-4 flex justify-end">
      <CopyButton which="cloud" url={cloud.url} />
    </div>
  );
  if (!cloud.canManage) {
    return (
      <>
        <Label>{t('peopleWithAccess')}</Label>
        <CloudOwnerRow cloud={cloud} />
        <p className="mb-0 mt-2 text-fg-muted">{t('yourRole', { role: role === 'owner' ? t('owner') : t(ROLE_NAME[role]) })}</p>
        <p className="mb-0 mt-1 text-xs text-fg-muted">{t('onlyOwnerShares')}</p>
        {copy}
      </>
    );
  }
  return (
    <>
      <AddPeople />
      <Label>{t('peopleWithAccess')}</Label>
      <CloudOwnerRow cloud={cloud} />
      {cloud.members.map((member) => (
        <MemberRow key={member.id} member={member} canManage />
      ))}
      {!cloud.members.length ? <div className="pb-0.5 pt-1.5 text-xs text-fg-muted">{t('noMembers')}</div> : null}
      {guests.length ? (
        <>
          <Label>{t('joinedPeople')}</Label>
          {guests.map((guest) => (
            <GuestRow key={guest.id} guest={guest} view={view} />
          ))}
        </>
      ) : null}
      <Label>{t('generalAccess')}</Label>
      <CloudAccess cloud={cloud} />
      {showsRoleLinks(cloud.access) ? (
        <>
          <Label>{t('inviteLinks')}</Label>
          {ROLES.map((r) => (
            <LinkRow key={r} role={r} view={view} />
          ))}
        </>
      ) : null}
      <Label>{t('shareSettings')}</Label>
      <SettingRow label={t('viewersCanExport')} checked={cloud.settings.viewersCanExport} onChange={(on) => void changeCloudShare(settingRequest('viewersCanExport', on))} />
      <SettingRow label={t('editorsCanAsk', { agent })} checked={cloud.settings.editorsCanAskAgent} onChange={(on) => void changeCloudShare(settingRequest('editorsCanAskAgent', on))} />
      {copy}
    </>
  );
}

/**
 * Sharing on this computer's network, under "Share on this network instead" for a published artifact: closed at first,
 * with a line saying its links open this computer's copy (and that it is on, while it is).
 */
function NetworkDisclosure({ view, children }: { view: ShareView | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const status = networkStatus(view);
  return (
    <section data-share-network={open ? 'open' : 'closed'} className="mt-4 border-t border-line pt-2">
      <button
        type="button"
        aria-expanded={open}
        className="-mx-2 flex w-[calc(100%+16px)] items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-fg-muted" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-fg-muted" />}
        <span className="min-w-0 flex-1">
          <span className="block">
            {t('shareOnNetwork')}
            {status ? <span className="text-xs text-success"> · {t(status)}</span> : null}
          </span>
          <span className="block text-xs text-fg-muted">{t('shareOnNetworkSub')}</span>
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}

/** Sharing on this computer's network: the owner, who joined, general access and the role links (or why it cannot). */
function LanSharing({ view, unsupported }: { view: ShareView | null; unsupported: boolean }) {
  const boot = useBoot();
  if (!view) {
    return (
      <>
        <Label>{t('peopleWithAccess')}</Label>
        <OwnerRow />
        {unsupported ? (
          <>
            <Label>{t('generalAccess')}</Label>
            <div className={ROW}>
              <Circle>
                <Lock className="size-4" />
              </Circle>
              <div className="min-w-0 flex-1">
                <div>{t('onlyThisComputer')}</div>
                <div className="text-xs text-fg-muted">{t('cannotShare', { type: boot.typeTitle })}</div>
              </div>
              <CopyButton which="page" url={shellLink()} />
            </div>
          </>
        ) : (
          <div className="py-2 text-xs text-fg-muted">{t('loading')}</div>
        )}
      </>
    );
  }
  const guests = sortedGuests(view);
  return (
    <>
      <Label>{t('peopleWithAccess')}</Label>
      <OwnerRow />
      <Label>{t('joinedPeople')}</Label>
      {guests.length ? guests.map((guest) => <GuestRow key={guest.id} guest={guest} view={view} />) : <div className="pb-0.5 pt-1.5 text-xs text-fg-muted">{t('noneJoined')}</div>}
      <Label>{t('generalAccess')}</Label>
      <GeneralAccess view={view} />
      <Label>{t('inviteLinks')}</Label>
      {ROLES.map((role) => (
        <LinkRow key={role} role={role} view={view} />
      ))}
      {view.lan ? (
        <p data-share-security="" className="mb-0 mt-1.5 text-xs text-fg-muted">
          {t('plainHttp')}
        </p>
      ) : null}
    </>
  );
}

function ShareTab() {
  const boot = useBoot();
  const { view, unsupported } = useShell((state) => state.share);
  const remotes = useShell((state) => state.publish.remotes);
  const publishedUrl = useShell((state) => state.artifact?.remote?.url ?? null);
  if (view?.cloud) return <CloudShareTab view={view} cloud={view.cloud} />;
  if (boot.cloud) {
    // A cloud host's sharing, not loaded yet (or the host cannot share this type): no "this computer" here.
    return unsupported ? (
      <div className="mt-3">
        <p className="mb-2 mt-0 text-xs text-fg-muted">{t('cannotShareCloud', { type: boot.typeTitle })}</p>
        <CopyButton which="page" url={shellLink()} />
      </div>
    ) : (
      <div className="py-3 text-xs text-fg-muted">{t('loading')}</div>
    );
  }
  if (boot.typeServer && !boot.typeServer.sharePath) {
    return <>
      <Label>{t(boot.typeServer.role === 'owner' ? 'onlyThisComputer' : 'inviteLinks')}</Label>
      {boot.typeServer.role === 'owner' && <p className="mb-2 text-xs text-fg-muted">{t('standaloneShare')}</p>}
      <CopyButton which="page" url={shellLink()} />
    </>;
  }
  // Published: the web page leads; this network's sharing waits under a disclosure. Otherwise as it always was.
  if (shareLayout({ id: boot.id, remotes, publishedUrl }) === 'published') {
    return (
      <>
        {remotes === null ? <div className="py-3 text-xs text-fg-muted">{t('loading')}</div> : <PublishSection />}
        <NetworkDisclosure view={view}>
          <LanSharing view={view} unsupported={unsupported} />
        </NetworkDisclosure>
      </>
    );
  }
  return (
    <>
      <LanSharing view={view} unsupported={unsupported} />
      <PublishSection />
    </>
  );
}

// ---- the Export tab ------------------------------------------------------------------------------------------------

/** One export row: its tile, name and note, and a download arrow or, when it asks first, a chevron. */
function ExportRow({
  kind,
  label,
  description,
  disabled,
  reason,
  more,
  onPick,
}: {
  kind: FormatKind;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
  reason?: string | undefined;
  more?: boolean | undefined;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? reason : undefined}
      data-export-row={label}
      className="flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45 disabled:hover:bg-transparent"
      onClick={() => {
        useShell.getState().closeShare();
        onPick();
      }}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line">{FORMAT_ICON[kind]}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {description ? <span className="text-xs text-fg-muted">{description}</span> : null}
      </span>
      {more ? <ChevronRight className="size-4 shrink-0 text-fg-muted" /> : <Download className="size-[18px] shrink-0 text-fg-muted" />}
    </button>
  );
}

const NO_DESTINATIONS: HostDestination[] = [];

/** The page's rows, then the folder's zip, then the host's destinations. */
function ExportRows() {
  const standalone = useShell(state => state.boot?.typeServer);
  const report = useShell((state) => state.report);
  const exports = useShell((state) => state.share.exports);
  const agent = useAgentName();
  const boot = useBoot();
  const entries = exportEntries(report);
  const v1 = !entries.length && !!report.exports;
  // A cloud host: the folder's zip only for those who may export.
  const exportable = useShell((state) => !state.boot?.cloud || mayExport(roleOf(state.boot), state.share.view?.cloud?.settings));
  // A declared host's own places to send an export to (never on a cloud host or a type server's own Shell).
  const destinations = useShell((state) => (state.host?.declared && !state.boot?.cloud && !standalone ? state.host.destinations : NO_DESTINATIONS));
  return (
    <div className="-mx-2 mt-2.5">
      {report.hasContent === false ? <div className="px-2 py-2 text-xs text-fg-muted">{t('nothingToExport')}</div> : null}
      {entries.map((entry) => (
        <ExportRow
          key={entry.key}
          kind={formatKind(entry.kind)}
          label={entry.label}
          description={entry.description ?? (entry.interactive ? t('exportOptions') : undefined)}
          disabled={entry.disabled}
          reason={entry.disabledReason ?? whyText(entry.why, agent)}
          more={entry.more}
          onPick={() => exportFormat(entry)}
        />
      ))}
      {v1 && exports === null ? <div className="px-2 py-2 text-xs text-fg-muted">{t('loading')}</div> : null}
      {v1
        ? (exports ?? []).map((item) => (
            <ExportRow
              key={item.label}
              kind={formatKind(item.label)}
              label={item.label}
              description={item.description}
              disabled={item.disabled}
              reason={item.disabledReason}
              more={item.more}
              onPick={() => command({ cmd: 'export', label: item.label })}
            />
          ))
        : null}
      {standalone?.role === 'owner' && boot.type === 'docs' ? (
        <ExportRow kind="folder" label={t('archiveLabel')} description={t('archiveDescription')} onPick={() => {
          const link = document.createElement('a');
          link.href = new URL('_api/frame/archive', location.href).href;
          link.download = '';
          link.click();
        }} />
      ) : null}
      {!standalone && exportable && offersArchive(report) ? (
        <ExportRow kind="folder" label={t('archiveLabel')} description={t('archiveDescription')} onPick={() => void downloadArchive()} />
      ) : null}
      {destinations.map((destination) => (
        <ExportRow
          key={`destination:${destination.id}`}
          kind="file"
          label={destination.label}
          description={t('destinationDescription', { agent })}
          onPick={() => void sendToDestination(destination, agent)}
        />
      ))}
    </div>
  );
}

/** The page's warning about sharing it (`shareNotice`). */
function ShareNotice() {
  const notice = useShell((state) => state.report.shareNotice);
  if (!notice) return null;
  return (
    <div role="note" className="mt-3 flex gap-2.5 rounded-lg border border-line bg-surface-2 p-3 text-xs">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-danger" />
      <p className="m-0 whitespace-pre-wrap break-words">{notice.text}</p>
    </div>
  );
}

function ExportTab() {
  const { view, unsupported } = useShell((state) => state.share);
  const store = useShell.getState();
  if (view?.cloud) {
    const cloud = view.cloud;
    return (
      <>
        <div className="mt-3.5 flex gap-3 rounded-[14px] bg-surface-2 p-4">
          <Users className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold">{t('sendingTitle')}</h3>
            <p className="mb-3 mt-1 text-fg-muted">{t('sendingBody')}</p>
            <div className="flex flex-wrap gap-2">
              {cloud.canManage ? (
                <Button size="lg" variant="primary" icon={<Users className="size-3.5" />} onClick={() => store.setShareTab('share')}>
                  {t('invitePeople')}
                </Button>
              ) : null}
              <CopyButton which="cloud" url={cloud.url} />
            </div>
          </div>
        </div>
        <ExportRows />
      </>
    );
  }
  const role = view ? leastRole(view) : null;
  // The same link as the title menu's Copy link.
  const given = view ? givenLink(view) : null;
  const note = view
    ? !role
      ? t('allLinksOff')
      : view.lan
        ? t('joinsAs', { role: t(ROLE_NAME[role]).toLowerCase() })
        : t('whereOff')
    : unsupported
      ? t('onlyHereLink')
      : '';
  return (
    <>
      <div className="mt-3.5 flex gap-3 rounded-[14px] bg-surface-2 p-4">
        <Users className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold">{t('sendingTitle')}</h3>
          <p className="mb-3 mt-1 text-fg-muted">{t('sendingBody')}</p>
          <div className="flex flex-wrap gap-2">
            {view ? (
              <Button size="lg" variant="primary" icon={<Users className="size-3.5" />} onClick={() => store.setShareTab('share')}>
                {t('invitePeople')}
              </Button>
            ) : null}
            {given ? <CopyButton which={given.which} url={given.url} /> : null}
            {!view ? <CopyButton which="page" url={shellLink()} /> : null}
          </div>
          {note ? <p className="mb-0 mt-2.5 text-xs text-fg-muted">{note}</p> : null}
        </div>
      </div>
      <ExportRows />
    </>
  );
}

/** Loads a v1 page's export items into the panel. */
async function loadExports(): Promise<void> {
  const items = await requestExports();
  if (useShell.getState().shareOpen) useShell.getState().patchShare({ exports: items });
}

// ---- the button and the popover ------------------------------------------------------------------------------------

/** The Share panel's popover and its button: the share icon, "Share", and a green dot while it is shared on the network. */
export function SharePanel() {
  const boot = useBoot();
  const title = useTitle();
  const open = useShell((state) => state.shareOpen);
  const tab = useShell((state) => state.shareTab);
  const error = useShell((state) => state.share.error);
  const unsupported = useShell((state) => state.share.unsupported);
  const view = useShell((state) => state.share.view);
  const artifact = useShell((state) => state.artifact);
  const report = useShell((state) => state.report);
  const store = useShell.getState();
  const shared = isShared(view, report, artifact);
  const webUrl = useShell((state) => (state.boot && !state.boot.cloud ? (state.artifact?.remote?.url ?? null) : null));
  const [asking, setAsking] = useState<AskSpec | null>(null);
  const menus = useRef(new Set<string>());
  const menuEscapedAt = useRef(0);
  const askingRef = useRef<AskSpec | null>(null);
  askingRef.current = asking;

  const layers = useRef<Layers>({
    menu(id, isOpen, reason) {
      if (isOpen) menus.current.add(id);
      else menus.current.delete(id);
      if (!isOpen && reason === 'escape-key') menuEscapedAt.current = performance.now();
    },
    ask: (spec) => setAsking(spec),
  }).current;

  const standalone = useShell(state => state.boot?.typeServer);
  // While open: load, then poll every 4 s (guests come and go), unless the type cannot share.
  useEffect(() => {
    if (!open) {
      setAsking(null);
      return;
    }
    if (standalone && !standalone.sharePath) return;
    void refreshShare();
    if (unsupported) return;
    const timer = setInterval(() => void refreshShare(), 4000);
    return () => clearInterval(timer);
  }, [open, standalone, unsupported]);

  // Publishing (local only: `refreshRemotes` does nothing elsewhere): loaded while open, polled for the sync state.
  useEffect(() => {
    if (!open) return;
    void refreshRemotes();
    const timer = setInterval(() => void refreshRemotes(), 4000);
    return () => {
      clearInterval(timer);
      publishPanelClosed();
    };
  }, [open]);

  // A v1 page's downloads, once it reports it has some (a page with `formats` lists them in its report).
  const v1Exports = !!report.exports && !report.formats?.length;
  useEffect(() => {
    if (open && v1Exports) void loadExports();
  }, [open, v1Exports]);
  const exportTab = standalone ? standalone.role === 'owner' && Boolean(report.formats?.length) : hasExportTab(report);

  const onOpenChange = (next: boolean, details: BasePopover.Root.ChangeEventDetails): void => {
    if (next) return store.openShare('share');
    switch (details.reason) {
      case 'escape-key':
        // The top layer first: the confirm box, then a menu (which closes itself), then the panel.
        if (askingRef.current) return setAsking(null);
        if (menus.current.size || performance.now() - menuEscapedAt.current < 250) return;
        break;
      case 'outside-press': {
        const target = details.event.target;
        if (target instanceof Element && target.closest('[data-share-menu]')) return;
        break;
      }
      case 'focus-out':
        // Focus moves into the panel's menus (outside the popup); a press elsewhere closes it.
        return;
      default:
        break;
    }
    store.closeShare();
  };

  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger
        render={
          <Button
            size="lg"
            variant="ghost"
            title={[t('share'), shared ? t(view?.cloud ? 'sharedWithOthers' : 'sharedOnNetwork') : '', webUrl ? t('pubCloudAt', { url: webUrl }) : ''].filter(Boolean).join(' · ')}
            aria-label={t('share')}
            className="gap-1.5 px-2 font-normal data-[popup-open]:bg-hover"
            icon={<Share2 className="size-4" />}
          >
            <span className={boot.type === 'docs' ? undefined : 'max-sm:hidden'}>{t('share')}</span>
            {shared ? <span aria-hidden data-share-dot="" className="size-1.5 shrink-0 rounded-full bg-success max-sm:absolute max-sm:right-1 max-sm:top-1" /> : null}
            {webUrl ? (
              <span data-share-published="" aria-label={t('pubCloudMark')} className="inline-flex text-accent max-sm:hidden">
                <Cloud className="size-3.5" />
              </span>
            ) : null}
          </Button>
        }
      />
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} className="z-[1000]">
          <BasePopover.Popup
            aria-label={t('shareTitle')}
            className="relative flex max-h-[min(var(--available-height),calc(100vh-24px))] w-[min(460px,calc(100vw-24px))] origin-[var(--transform-origin)] flex-col rounded-2xl bg-surface text-[13px] text-fg shadow-popup outline-none transition-[opacity,transform] duration-100 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          >
            <BasePopover.Arrow className="size-3.5 rotate-45 rounded-tl-[3px] border-l border-t border-line bg-surface data-[side=bottom]:-top-[7px]" />
            <LayersContext.Provider value={layers}>
              <div className="min-h-0 overflow-auto overscroll-contain px-5 pb-5 pt-[18px]">
                <div className="mb-1.5 flex items-center gap-3">
                  <h2 className="m-0 min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{title || t('shareTitle')}</h2>
                  <IconButton label={t('close')} icon={<X className="size-[18px]" />} size="lg" noTooltip onClick={() => store.closeShare()} />
                </div>
                {exportTab ? (
                  <Segmented
                    aria-label={t('share')}
                    className="mt-2.5 h-8"
                    value={tab}
                    onChange={(next) => store.setShareTab(next)}
                    options={[
                      { value: 'share', label: t('share') },
                      { value: 'export', label: t('export') },
                    ]}
                  />
                ) : null}
                <ShareNotice />
                {tab === 'export' && exportTab ? <ExportTab /> : <ShareTab />}
                {error ? (
                  <div role="alert" className="mt-3 text-xs text-danger">
                    {error}
                  </div>
                ) : null}
              </div>
              {asking ? (
                <Confirm
                  spec={asking}
                  onDone={(yes) => {
                    setAsking(null);
                    if (yes) asking.run();
                  }}
                />
              ) : null}
            </LayersContext.Provider>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
