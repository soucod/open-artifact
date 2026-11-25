/** The daemon's home page: the artifact library and the installed types. */

import { Plus, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Button, Tabs, Tooltip } from '@open-artifact/ui';
import { t } from '../lib/i18n.ts';
import { loadArtifacts, loadTypes, startEvents } from './actions.ts';
import { ArtifactList } from './components/ArtifactList.tsx';
import { CloudLibrary, PurgeDialog, UploadButton } from './components/CloudHome.tsx';
import { CreateDialog, RenameDialog, UndoBar } from './components/Dialogs.tsx';
import { InstallTypeDialog } from './components/InstallTypeDialog.tsx';
import { NewTypeDialog } from './components/NewTypeDialog.tsx';
import { TypeList } from './components/TypeList.tsx';
import { Account } from '../components/Account.tsx';
import { SiteBrand, SiteHomeLinks } from '../components/SiteBrand.tsx';
import { homeBoot, startHost } from './host.ts';
import { defaultCreatable } from './model.ts';
import { useHome, type HomeTab } from './store.ts';

/** "New artifact": the create dialog for the type the home page can make. */
function NewButton() {
  const types = useHome((state) => state.types);
  const type = types ? defaultCreatable(types.types) : null;
  const button = (
    <Button size="lg" variant="primary" icon={<Plus className="size-3.5" />} disabled={!type} onClick={() => type && useHome.getState().setCreating(type)}>
      {t('newArtifact')}
    </Button>
  );
  if (type || !types) return button;
  // A disabled button gets no pointer events: the tooltip goes on a wrapper.
  return (
    <Tooltip label={t('cannotCreateYet')}>
      <span tabIndex={0}>{button}</span>
    </Tooltip>
  );
}

/** The home page. */
export function App() {
  const tab = useHome((state) => state.tab);
  const error = useHome((state) => state.error);
  // A cloud host lists the person's artifacts and nothing a local daemon does (types, creating one).
  const cloud = homeBoot.cloud;
  const brandName = cloud?.site?.brand?.name;
  useEffect(() => {
    // The site's own name (its plugins' brand) in the tab's title too.
    if (brandName) document.title = brandName;
  }, [brandName]);
  useEffect(() => {
    void loadArtifacts();
    if (!cloud) void loadTypes();
    const stopHost = startHost();
    const stopEvents = startEvents();
    return () => {
      stopHost();
      stopEvents();
    };
  }, []);
  return (
    <div className="h-full overflow-auto bg-canvas text-fg">
      <div className="mx-auto max-w-[1040px] px-4 pb-12 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mb-1 mt-0 text-xl font-semibold">{cloud?.site?.brand ? <SiteBrand site={cloud.site} /> : t('homeTitle')}</h1>
            <p className="mb-5 mt-0 text-fg-muted">{t(cloud ? 'homeSubCloud' : 'homeSub')}</p>
            {cloud ? <SiteHomeLinks site={cloud.site} /> : null}
          </div>
          {cloud ? (
            <div className="flex shrink-0 items-center gap-2">
              {cloud.user ? <UploadButton /> : null}
              <Account cloud={cloud} />
            </div>
          ) : (
            <NewButton />
          )}
        </div>
        {error ? (
          <p role="alert" className="mb-3 flex items-center gap-1.5 text-xs text-danger">
            <TriangleAlert className="size-3.5" />
            {error}
          </p>
        ) : null}
        {cloud ? (
          cloud.user ? <CloudLibrary /> : <ArtifactList />
        ) : (
          <Tabs<HomeTab>
            value={tab}
            onChange={(next) => useHome.getState().setTab(next)}
            // The kit's tabs style `data-[selected]`, which Base UI does not set: mark the active tab by aria here.
            className="[&>[role=tabpanel]]:overflow-visible [&>[role=tabpanel]]:pt-4 [&_[role=tab][aria-selected=true]]:bg-hover [&_[role=tab][aria-selected=true]]:text-fg"
            items={[
              { value: 'artifacts', label: t('artifacts'), content: <ArtifactList /> },
              { value: 'types', label: t('types'), content: <TypeList /> },
            ]}
          />
        )}
      </div>
      <CreateDialog />
      {cloud ? null : <NewTypeDialog />}
      {cloud ? null : <InstallTypeDialog />}
      <RenameDialog />
      <UndoBar />
      {cloud ? <PurgeDialog /> : null}
    </div>
  );
}
