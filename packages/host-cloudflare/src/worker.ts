/**
 * The product Worker: the entry `deploy/cloudflare` bundles (`dist/site/worker.js`). `src/dev-worker.ts` stays the
 * foundation tests' Worker.
 *
 * - The default export's `fetch` is `site.ts` (one {@link Site} per isolate); `scheduled` is its hourly upkeep.
 * - {@link ArtifactObject} (binding `ROOMS`): one artifact's room, with the product {@link RoomHost} over D1, and the
 *   Worker's calls (`room-calls.ts`).
 * - {@link SiteHubObject} (binding `HUB`, one instance named `hub`): the site's events, the Library streams and the
 *   presence registry (`hub.ts`).
 *
 * `open-artifact:build` is made by the build: the version, the type table and skills from `artifact-types/*`, and the
 * Shell's and home page's templates. `open-artifact:plugins` is `deploy/cloudflare/plugins.mjs` (or the file
 * `OA_PLUGINS_MODULE` names when building): the plugin modules `OA_PLUGINS` may use, started in the Worker and in each
 * object (`plugins.ts`).
 */

import BUILD from 'open-artifact:build';
import PLUGINS from 'open-artifact:plugins';
import { Catalog, type HostConfig, type Plugins } from '@open-artifact/host';
import type { ExecutionContext, ProductEnv } from './bindings.ts';
import { parseCloudflareConfig, parseRoomTimings, stringVars } from './config.ts';
import { d1Driver, ensureMigrated, type D1Driver } from './d1.ts';
import { HubClient, SiteHub } from './hub.ts';
import { handleRoomCall, isRoomCall, RoomClient } from './room-calls.ts';
import { createProductRoomHost, type ProductRoomHost } from './room-host.ts';
import { ArtifactRoom, type RoomState } from './room.ts';
import { Site } from './site.ts';
import { startCloudflarePlugins } from './plugins.ts';
import { bundledFrameTypes, sitePagesOf } from './frames.ts';

/** Most an uploaded archive may unpack to in an object (the whole folder), bytes. (Not exported: an entry module exports only handlers.) */
const ROOM_IMPORT_MAX_BYTES = 256 * 1024 * 1024;
/** Most files an uploaded archive may hold. */
const ROOM_IMPORT_MAX_FILES = 20_000;

let site: Site | null = null;

function configOrError(env: ProductEnv): { config: HostConfig } | { error: Error } {
  try {
    return { config: parseCloudflareConfig(env) };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function misconfigured(error: Error): Response {
  return new Response(`Open Artifact is not configured: ${error.message}\n`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** One artifact's object. */
export class ArtifactObject {
  readonly #env: ProductEnv;
  readonly #driver: D1Driver;
  readonly #room: ArtifactRoom | null = null;
  readonly #host: ProductRoomHost | null = null;
  readonly #error: Error | null = null;

  constructor(state: RoomState, env: ProductEnv) {
    this.#env = env;
    this.#driver = d1Driver(env.DB);
    const parsed = configOrError(env);
    if ('error' in parsed) {
      this.#error = parsed.error;
      return;
    }
    const catalog = new Catalog(this.#driver, { signingKeys: parsed.config.signingKeys });
    const hub = new HubClient(() => env.HUB.get(env.HUB.idFromName('hub')));
    let room: ArtifactRoom | null = null;
    const vars = stringVars(env);
    let host: ProductRoomHost | null = null;
    let plugins: Plugins | undefined;
    try {
      plugins = startCloudflarePlugins({
        vars,
        modules: PLUGINS,
        ...(BUILD.pluginsModule ? { modulesFile: BUILD.pluginsModule } : {}),
        catalog,
        config: parsed.config,
        version: BUILD.version,
        log: (line) => console.log(line),
        forgetHere: (id) => {
          if (id) host?.invalidate(id);
          else host?.access.invalidate();
        },
        refresh: async (id) => {
          if (id) await new RoomClient(env.ROOMS.get(env.ROOMS.idFromName(id)), id).refresh();
          else await hub.refreshRooms();
        },
      }).active;
    } catch (error) {
      this.#error = error instanceof Error ? error : new Error(String(error));
      return;
    }
    // Page artifacts, unless one origin serves both (the build's `page` type; its browser files from static assets).
    const pages = sitePagesOf(parsed.config, vars, BUILD.frames);
    host = createProductRoomHost({
      config: parsed.config,
      catalog,
      hub,
      rootOf: (id) => room!.rootOf(id),
      ...(plugins ? { plugins } : {}),
      ...(pages ? { pages: { types: bundledFrameTypes(pages.build, (request) => env.ASSETS.fetch(request)), network: pages.network } } : {}),
    });
    this.#host = host;
    room = new ArtifactRoom(state, env, { host: this.#host.host, ...parseRoomTimings(vars), trackTimers: vars.OA_DEBUG_STATS === '1' });
    this.#room = room;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.#error || !this.#room || !this.#host) return misconfigured(this.#error ?? new Error('no room'));
    await ensureMigrated(this.#driver, this.#env.DB);
    if (isRoomCall(request)) {
      const host = this.#host;
      return handleRoomCall(this.#room, {
        refresh: (room, id) => host.refresh(room, id),
        limits: { maxBytes: ROOM_IMPORT_MAX_BYTES, maxFiles: ROOM_IMPORT_MAX_FILES },
        extraStats: () => ({ d1: this.#driver.counters() }),
      }, request);
    }
    return this.#room.fetch(request);
  }
}

/** The site hub. */
export class SiteHubObject {
  readonly #hub: SiteHub | null = null;
  readonly #error: Error | null = null;

  constructor(_state: unknown, env: ProductEnv) {
    const parsed = configOrError(env);
    if ('error' in parsed) {
      this.#error = parsed.error;
      return;
    }
    const driver = d1Driver(env.DB);
    const catalog = new Catalog(driver, { signingKeys: parsed.config.signingKeys });
    this.#hub = new SiteHub({
      config: parsed.config,
      catalog: async () => {
        await ensureMigrated(driver, env.DB);
        return catalog;
      },
      // Only rooms that asked about the user and have not closed their artifact since (see `hub.ts`).
      notifyRoom: (id) => new RoomClient(env.ROOMS.get(env.ROOMS.idFromName(id)), id).agentChanged(),
      // A plugin forgot every role: the awake rooms work their pages' roles out again.
      refreshRoom: (id) => new RoomClient(env.ROOMS.get(env.ROOMS.idFromName(id)), id).refresh(),
    });
  }

  fetch(request: Request): Promise<Response> {
    if (!this.#hub) return Promise.resolve(misconfigured(this.#error ?? new Error('no hub')));
    return this.#hub.fetch(request);
  }
}

export default {
  fetch(request: Request, env: ProductEnv, ctx: ExecutionContext): Promise<Response> {
    site ??= new Site(env, BUILD, { pluginModules: PLUGINS });
    return site.fetch(request, ctx);
  },
  async scheduled(_event: unknown, env: ProductEnv, ctx: ExecutionContext): Promise<void> {
    site ??= new Site(env, BUILD, { pluginModules: PLUGINS });
    ctx.waitUntil(site.scheduled());
  },
};
