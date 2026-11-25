/**
 * `settings.json`: settings shared by every harness on this computer. Only
 * what the person changed is saved; {@link loadSettings} merges the file over
 * the protocol's defaults.
 */

import { DEFAULT_SETTINGS, type CloudSettings, type OpenArtifactSettings } from '@open-artifact/protocol';
import { expandHome, files, readJson, writeJson } from './paths.ts';
import type { CloudPreset } from './preset.ts';

/**
 * The settings in effect: the saved file over {@link DEFAULT_SETTINGS}, with
 * `~` expanded. `$OPEN_ARTIFACT_USER_TYPES`, `$OPEN_ARTIFACT_EXTRA_TYPES` (colon separated) and
 * `$OPEN_ARTIFACT_PORT` move the type roots and the port without touching the file
 * (tests, dev checkouts). `preset` (the environment's and `preset.json`'s cloud presets, `preset.ts`) fills
 * `cloud.publish` when the file does not set it: what the person saved wins.
 */
export function loadSettings(preset: Pick<CloudPreset, 'publish'> = {}): OpenArtifactSettings {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const merged: OpenArtifactSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    typeRoots: { ...DEFAULT_SETTINGS.typeRoots, ...(saved.typeRoots ?? {}) },
    wake: { ...DEFAULT_SETTINGS.wake, ...(saved.wake ?? {}) },
  };
  if (process.env.OPEN_ARTIFACT_USER_TYPES) merged.typeRoots.user = process.env.OPEN_ARTIFACT_USER_TYPES;
  if (process.env.OPEN_ARTIFACT_EXTRA_TYPES) {
    merged.typeRoots.extra = [...merged.typeRoots.extra, ...process.env.OPEN_ARTIFACT_EXTRA_TYPES.split(':').filter(Boolean)];
  }
  merged.typeRoots.user = expandHome(merged.typeRoots.user);
  merged.typeRoots.extra = merged.typeRoots.extra.map(expandHome);
  merged.homeWorkspace = expandHome(merged.homeWorkspace);
  merged.trustedProjects = (merged.trustedProjects ?? []).map(expandHome);
  if (process.env.OPEN_ARTIFACT_PORT) merged.serverPort = Number(process.env.OPEN_ARTIFACT_PORT);
  const cloud: CloudSettings = {};
  const savedCloud = saved.cloud && typeof saved.cloud === 'object' ? saved.cloud : {};
  if (typeof savedCloud.default === 'string' && savedCloud.default) cloud.default = savedCloud.default;
  const publish = savedCloud.publish === 'auto' || savedCloud.publish === 'manual' ? savedCloud.publish : preset.publish;
  if (publish) cloud.publish = publish;
  const refresh = savedCloud.dataRefresh;
  if (typeof refresh === 'number' && Number.isFinite(refresh) && refresh >= 0) cloud.dataRefresh = refresh;
  if (Object.keys(cloud).length) merged.cloud = cloud;
  else delete merged.cloud;
  return merged;
}

/** Changes `cloud` in the saved file: a value sets its key, `null` removes it (the default or the preset applies again). */
export function saveCloudSettings(patch: { [K in keyof CloudSettings]?: CloudSettings[K] | null }): void {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const cloud: Record<string, unknown> = { ...(saved.cloud ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete cloud[key];
    else if (value !== undefined) cloud[key] = value;
  }
  const next: Partial<OpenArtifactSettings> = { ...saved, cloud: cloud as CloudSettings };
  if (!Object.keys(cloud).length) delete next.cloud;
  writeJson(files.settings(), next);
}

/** Merges `patch` into the saved file (only what the person set is kept there). */
export function saveSettings(patch: Partial<OpenArtifactSettings>): void {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  writeJson(files.settings(), { ...saved, ...patch });
}
