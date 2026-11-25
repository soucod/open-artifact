/**
 * What a cloud host's plugins add to its pages (`cloud.site`): the site's name and logo, and its links on the home
 * page. Plain text and checked addresses only (see `siteUiOf`); nothing is drawn when the site adds nothing.
 */

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { CloudSiteUi } from '@open-artifact/protocol';
import { leavesSite, siteLinks, siteUiOf } from '../lib/cloud.ts';

/** The site's logo (when it loads) and name; `compact` for the Shell's bar. Null without a brand. */
export function SiteBrand({ site, compact = false }: { site: CloudSiteUi | undefined; compact?: boolean }) {
  const brand = siteUiOf(site)?.brand;
  const [failed, setFailed] = useState(false);
  if (!brand) return null;
  const logo = brand.logoUrl && !failed ? (
    <img src={brand.logoUrl} alt={brand.name ? '' : 'logo'} referrerPolicy="no-referrer" className={compact ? 'h-5 w-auto shrink-0' : 'h-6 w-auto shrink-0'} onError={() => setFailed(true)} />
  ) : null;
  return (
    <span data-site-brand="" className="inline-flex min-w-0 items-center gap-1.5">
      {logo}
      {brand.name ? <span className={compact ? 'truncate text-[13px] font-medium text-fg-muted max-sm:hidden' : 'truncate'}>{brand.name}</span> : null}
    </span>
  );
}

/** The site's links meant for the home page, as a row under its heading. */
export function SiteHomeLinks({ site }: { site: CloudSiteUi | undefined }) {
  const links = siteLinks(site, 'home');
  if (links.length === 0) return null;
  return (
    <nav aria-label="Site links" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
      {links.map((link) => {
        const away = leavesSite(link.href, location.origin);
        return (
          <a key={`${link.label} ${link.href}`} href={link.href} {...(away ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="inline-flex items-center gap-1 text-accent hover:underline">
            {link.label}
            {away ? <ExternalLink aria-hidden className="size-3" /> : null}
          </a>
        );
      })}
    </nav>
  );
}
