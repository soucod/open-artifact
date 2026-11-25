/**
 * Who is signed in to the cloud host, shared by the Shell's bar and the home page: the person's avatar (or initials)
 * with a small menu (name, email, Sign out), or "Sign in" for a link guest or an anonymous visitor. Only drawn in
 * cloud mode.
 *
 * Behind Cloudflare Access the host's sign-out cannot end Access's own session: the host answers with Access's logout
 * address, and Sign out goes there (the menu says so when `auth.me` names Access among the site's sign-ins).
 */

import { ExternalLink, LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, toast } from '@open-artifact/ui';
import type { HomeCloud } from '../lib/cloud.ts';
import { accessLogoutOf, leavesSite, signInHref, signOutTarget, signsInThroughAccess, siteLinks } from '../lib/cloud.ts';
import { avatarColor, initials } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';

/**
 * Signs out on the cloud host (a same-origin `POST`), then loads the page again as whoever is left, or, behind
 * Cloudflare Access, goes to Access's logout address the host answered with (else the one `auth.me` named).
 */
export async function signOut(signOutUrl: string): Promise<void> {
  try {
    const response = await fetch(signOutUrl, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' });
    // Already signed out counts as done.
    if (!response.ok && response.status !== 401) throw new Error(`HTTP ${response.status}`);
    const target = signOutTarget(await response.json().catch(() => null)) ?? (await whatMeSays()).accessLogout;
    if (target) location.href = target;
    else location.reload();
  } catch (error) {
    toast.add({ title: t('signOutFailed', { error: error instanceof Error ? error.message : String(error) }) });
  }
}

let meAsked: Promise<{ access: boolean; accessLogout: string | null }> | null = null;

/** Whether the site signs people in through Cloudflare Access, and Access's logout address (`auth.me`, asked once per page). */
function whatMeSays(): Promise<{ access: boolean; accessLogout: string | null }> {
  meAsked ??= fetch('/api/open-artifact.auth.me', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((me: unknown) => ({ access: signsInThroughAccess(me), accessLogout: accessLogoutOf(me) }), () => ({ access: false, accessLogout: null }));
  return meAsked;
}

/** A round avatar: the person's picture, else their initials on a colour picked from their id. */
export function Avatar({ id, name, avatar, size = 28 }: { id: string; name: string; avatar?: string | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (avatar && !failed) {
    return <img src={avatar} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full bg-surface-2 object-cover" style={style} onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ ...style, background: avatarColor(`user${id}`) }}>
      {initials(name)}
    </span>
  );
}

/** Opens one of the site's links: a path here in this tab, another site's address in a new one. */
function openSiteLink(href: string): void {
  if (leavesSite(href, location.origin)) window.open(href, '_blank', 'noopener,noreferrer');
  else location.href = href;
}

/** The account control: the signed-in person's menu (with the site's own links), or Sign in. */
export function Account({ cloud }: { cloud: Pick<HomeCloud, 'user' | 'signInUrl' | 'signOutUrl' | 'site'> }) {
  const user = cloud.user;
  const links = siteLinks(cloud.site, 'account-menu');
  const [access, setAccess] = useState(false);
  useEffect(() => {
    if (!user) return;
    let live = true;
    void whatMeSays().then((me) => live && setAccess(me.access));
    return () => {
      live = false;
    };
  }, [user]);
  if (!user) {
    const here = `${location.pathname}${location.search}`;
    return (
      <Button size="lg" variant="ghost" className="gap-1.5 px-2 font-normal" icon={<LogIn className="size-4" />} onClick={() => (location.href = signInHref(cloud.signInUrl, here, location.origin))}>
        <span className="max-sm:hidden">{t('signIn')}</span>
      </Button>
    );
  }
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label={t('accountOf', { name: user.name })}
          title={user.email ? `${user.name} · ${user.email}` : user.name}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent data-[popup-open]:bg-hover"
        >
          <Avatar id={user.id} name={user.name} avatar={user.avatar} size={26} />
        </button>
      }
    >
      <MenuLabel>
        <span className="flex max-w-64 items-center gap-2.5 py-0.5">
          <Avatar id={user.id} name={user.name} avatar={user.avatar} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-fg">{user.name}</span>
            {user.email ? <span className="block truncate text-xs">{user.email}</span> : null}
          </span>
        </span>
      </MenuLabel>
      <MenuSeparator />
      {links.map((link) => (
        <MenuItem key={`${link.label} ${link.href}`} icon={<ExternalLink className="size-3.5" />} onSelect={() => openSiteLink(link.href)}>
          {link.label}
        </MenuItem>
      ))}
      {links.length > 0 ? <MenuSeparator /> : null}
      <MenuItem icon={<LogOut className="size-3.5" />} onSelect={() => void signOut(cloud.signOutUrl)}>
        {access ? t('signOutAccess') : t('signOut')}
      </MenuItem>
    </Menu>
  );
}
