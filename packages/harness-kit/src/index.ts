/**
 * `@open-artifact/harness-kit`: how an agent app connects to Open Artifact.
 *
 * `createHarness` is the whole adapter for most apps: it finds or starts the daemon, keeps the Harness API
 * connection, hands messages to sessions and pages to the app's UI. `HarnessClient` is the connection under it, for an
 * app that wants the calls themselves; `ensureDaemon`, `readDaemon` and `api` find the daemon and call its Library API.
 *
 * Entry points: `.` (this file), `./testing` (a fake daemon for an adapter's tests) and `./embed` (browser code that
 * puts a Shell page or the home page into the app's own UI: `embedArtifact`, `embedLibrary`).
 */

export { api, daemonStartPlan, defaultDaemonBin, ensureDaemon, isOlderVersion, openArtifactHome, readDaemon, startDaemonProcess, type ApiOptions, type DaemonExitSource, type DaemonSpawn, type DaemonStart, type DaemonStartPlan, type EnsureDaemonOptions } from './daemon.ts';
export {
  LEGACY_PROTOCOLS,
  RUNTIME_ENTRY,
  compareVersions,
  isPrerelease,
  missingRuntimes,
  parseVersion,
  protocolRangeOf,
  rangesMeet,
  rankRuntimes,
  readRuntimePin,
  readRuntimesFile,
  runtimeCandidates,
  runtimeEnv,
  runtimeInfo,
  runtimesFileOf,
  satisfies,
  selectRuntime,
  sharedRuntimes,
  sharedRuntimesOf,
  validRange,
  type OwnRuntime,
  type RuntimeCandidate,
  type RuntimeRecord,
  type RuntimesFile,
} from './runtimes.ts';
export { HarnessClient, type HarnessClientOptions, type HarnessConnectionState, type HelloExtras } from './client.ts';
export {
  KIT,
  createHarness,
  ownsCall,
  type ArtifactChange,
  type ArtifactReport,
  type Harness,
  type HarnessArtifact,
  type HarnessOptions,
  type HarnessRuntimeCalls,
  type OpenRequest,
  type WakeAnswer,
} from './harness.ts';
export type { RuntimeStatus, RuntimeUpdateResult } from '@open-artifact/protocol';
export { remoteGate, remotePolicyOf, type AllowRemote, type RemotePage, type RemotePagePolicy, type RemotePageRequest } from './embed/remote.ts';
export { CONTEXT_HEADER, MAX_CONTEXT_CHARS, contextBlock, readContext, type ArtifactContext } from './context.ts';
export { commands, installSkill, keepSkillInstalled, localSkill, renderSkill, type InstallSkillOptions, type InstallSkillResult } from './skill.ts';
