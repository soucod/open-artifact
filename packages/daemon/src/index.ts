/**
 * `@open-artifact/daemon`: the `open-artifact` daemon and the modules it is made of.
 * Harness plugins import `@open-artifact/daemon/client` instead.
 */

export { BOOT_PLACEHOLDER, Daemon, UI_PATHS, VERSION, defaultUiDir, startDaemon, takeOverPrompt, type DaemonOptions } from './daemon.ts';
export { ArtifactStore, hashWorkspace, newArtifactId, sessionKeyOf, slugify, type CreateRecord, type StoreChange } from './store.ts';
export { Inbox, type InboxItem } from './inbox.ts';
export { UNOWNED_KEY, WakeRouter, type LiveDelivery, type WakeItem, type WakeResult, type WakeRouterOptions } from './wake.ts';
export {
  HarnessHub,
  defaultProfile,
  harnessProfile,
  shippedProfilesDir,
  type AdapterConnection,
  type HarnessHubOptions,
  type LiveSession,
  type PollParams,
  type ToolRunner,
} from './harness.ts';
export {
  addUserProfile,
  homeProfileFile,
  listProfiles,
  removeProfile,
  sanitizeAdapterProfile,
  saveAdapterProfile,
  type ProfileListing,
} from './harness-profiles.ts';
export { HARNESS_FEATURES, negotiateProtocol } from './harness-features.ts';
export { TypeServers, fillTemplate, serverFiles, type TypeServersOptions } from './servers.ts';
export {
  BUILTIN_TYPE_IDS,
  TypeRegistry,
  defaultBuiltinTypesDir,
  entryOf,
  isLoopbackUrl,
  readFrontmatter,
  readTypeFolder,
  skillBody,
  type ListedType,
  type TypeInfo,
  type TypeRegistryOptions,
  type TypeRoot,
} from './types.ts';
export { Tools, type ShareAccess, type ToolsOptions } from './tools.ts';
export { MCP_HEADERS, MCP_PROTOCOL, callerFromRequest, handleMcp, type McpMessage, type McpMeta, type McpReply, type McpTools, type PidLookup } from './mcp.ts';
export { loadSettings, saveSettings } from './settings.ts';
export { WebSocketConnection, acceptWebSocket } from './ws.ts';
export { ensureDir, expandHome, files, inside, openArtifactHome, readJson, writeFileAtomic, writeJson } from './paths.ts';
export { HarnessClient, api, defaultDaemonBin, ensureDaemon, readDaemon, type ApiOptions, type EnsureDaemonOptions, type HarnessClientOptions, type HarnessConnectionState } from './client.ts';
