/**
 * The installed types, with "New" on the ones the home page can create, a switch to turn each on or off, "New type",
 * "Install type", and each known project's types with "Trust this project". Each card says where the type comes from
 * (built in, a folder here, or installed from a package), its version, what its page may use and, for an installed
 * one, which hosts it may reach; an installed one has Update and Uninstall.
 */

import type { TypesProject, TypeView } from '@open-artifact/protocol';
import { Download, Plus, RefreshCw, Shapes, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, SwitchInput } from '@open-artifact/ui';
import { api } from '../../lib/api.ts';
import { t } from '../../lib/i18n.ts';
import { setProjectTrusted, setTypeEnabled, uninstallType } from '../actions.ts';
import { isCreatable } from '../model.ts';
import { useHome } from '../store.ts';
import { Chip } from './ArtifactList.tsx';

/** The type's icon, or a generic one when it has none or it fails to load. */
function TypeIcon({ type }: { type: TypeView }) {
  const [failed, setFailed] = useState(false);
  if (!type.icon || failed) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
        <Shapes className="size-4" />
      </span>
    );
  }
  return <img src={api.typeIconUrl(type.id)} alt="" className="size-8 shrink-0 rounded-lg" onError={() => setFailed(true)} />;
}

function TypeCard({ type }: { type: TypeView }) {
  return (
    <div data-type-id={type.id} data-type-scope={type.scope} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2.5">
        <TypeIcon type={type} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{type.title}</div>
          <div className="truncate text-xs text-fg-muted">{type.id}</div>
        </div>
        <SwitchInput
          checked={type.enabled}
          aria-label={t(type.enabled ? 'turnTypeOff' : 'turnTypeOn', { type: type.title })}
          onChange={(next) => void setTypeEnabled(type, next)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip>{t(type.source === 'installed' ? 'sourceInstalled' : type.source === 'builtin' ? 'sourceBuiltin' : 'sourceLocal')}</Chip>
        {type.source === 'local' || !type.source ? <Chip>{type.scope}</Chip> : null}
        <Chip>{type.runtime}</Chip>
        {type.version ? <Chip>v{type.version}</Chip> : null}
        {type.enabled ? null : <Chip>{t('disabled')}</Chip>}
        {type.shadowedBy ? <Chip>{t('shadowedBy', { root: type.shadowedBy })}</Chip> : null}
      </div>
      {type.description ? <div className="line-clamp-4 text-xs text-fg-muted">{type.description}</div> : null}
      {type.capabilities?.length ? (
        <div data-testid="type-capabilities" className="text-xs text-fg-muted">
          {t('typeCapabilities', { list: type.capabilities.join(', ') })}
        </div>
      ) : null}
      {type.source === 'installed' ? (
        <>
          <div data-testid="type-network" className="text-xs text-fg-muted">
            {type.network?.length ? t('typeNetwork', { list: type.network.join(', ') }) : t('noNetwork')}
          </div>
          {type.installedFrom ? <div className="break-all text-xs text-fg-subtle">{t('installedFrom', { source: type.installedFrom })}</div> : null}
        </>
      ) : null}
      {type.problems.length ? (
        <div className="flex items-start gap-1 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {type.problems.join(' ')}
        </div>
      ) : null}
      {isCreatable(type) || type.source === 'installed' ? (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {isCreatable(type) ? (
            <Button size="sm" variant="primary" icon={<Plus className="size-3" />} onClick={() => useHome.getState().setCreating(type)}>
              {t('newOf', { type: type.title })}
            </Button>
          ) : null}
          {type.source === 'installed' ? (
            <>
              <Button size="sm" icon={<RefreshCw className="size-3" />} data-testid="type-update" onClick={() => useHome.getState().setInstalling({ update: type.id })}>
                {t('updateType')}
              </Button>
              <Button
                size="sm"
                icon={<Trash2 className="size-3" />}
                data-testid="type-uninstall"
                onClick={() => {
                  if (window.confirm(t('uninstallConfirm', { type: type.title }))) void uninstallType(type);
                }}
              >
                {t('uninstallType')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TypeGrid({ types }: { types: readonly TypeView[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
      {types.map((type) => (
        <TypeCard key={`${type.root}:${type.id}`} type={type} />
      ))}
    </div>
  );
}

/** A project's types: used only once the person trusts the project. */
function ProjectTypes({ project }: { project: TypesProject }) {
  return (
    <section data-project={project.dir} className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 min-w-0 break-all text-sm font-semibold">{t('projectTypes', { dir: project.dir })}</h2>
        <Button
          size="sm"
          variant={project.trusted ? 'secondary' : 'primary'}
          icon={project.trusted ? undefined : <ShieldCheck className="size-3" />}
          onClick={() => void setProjectTrusted(project.dir, !project.trusted)}
        >
          {t(project.trusted ? 'untrustProject' : 'trustProject')}
        </Button>
      </div>
      {project.trusted ? null : <p className="mb-2 mt-0 text-xs text-warning">{t('projectUntrusted')}</p>}
      <TypeGrid types={project.types} />
    </section>
  );
}

/** The type grid, where types are looked for, and "New type". */
export function TypeList() {
  const types = useHome((state) => state.types);
  if (types === null) return <p className="py-8 text-fg-muted">{t('loading')}</p>;
  const roots = types.roots.map((root) => `${root.dir} (${root.scope})`).join(', ');
  const user = types.roots.find((root) => root.scope === 'user')?.dir;
  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="m-0 min-w-0 break-words text-xs text-fg-muted">{user ? t('typesExplain', { user }) : t('typesExplainNoUser')}</p>
        <div className="flex shrink-0 gap-2">
          <Button size="md" data-testid="install-type" icon={<Download className="size-3" />} onClick={() => useHome.getState().setInstalling({})}>
            {t('installType')}
          </Button>
          <Button size="md" data-testid="new-type" icon={<Plus className="size-3" />} onClick={() => useHome.getState().setMakingType(true)}>
            {t('newType')}
          </Button>
        </div>
      </div>
      {roots ? <p className="mb-3 mt-0 break-all text-xs text-fg-subtle">{t('typeRoots', { roots })}</p> : null}
      {types.types.length ? <TypeGrid types={types.types} /> : <EmptyState title={t('noTypes')} />}
      {(types.projects ?? []).map((project) => (
        <ProjectTypes key={project.dir} project={project} />
      ))}
    </>
  );
}
