/**
 * Types shared by the frame core (core.ts, local.ts), the inner shell
 * (client/shell.ts) and the Frame Runtime injected into the page
 * (client/runtime.ts). Types only: the client scripts are plain scripts with
 * no imports at run time.
 *
 * Page ⇄ inner shell messages follow the frame protocol (the
 * `__frame_*` envelope). Inner shell ⇄ server is this host's own HTTP API.
 */

/** The Frame Runtime contract this host reports in `__frame_init`. */
export type Contract = string;

/** What the server writes into the page as `window.__OPEN_ARTIFACT_FRAME`, before the runtime loads. */
export interface FrameBoot {
  /** The inner shell's origin: the only window the runtime talks to. */
  shellOrigin: string;
  /** The artifact id. */
  id: string;
  /** The type key from the declaration. */
  key: string | null;
  /** Capabilities the page may use (backed here). */
  grants: string[];
  /** Declared capabilities this host cannot serve: they answer with an error code. */
  stubs: string[];
  contract: Contract;
  /** Relay the page's console errors to the inner shell (OPEN_ARTIFACT_FRAME_DEBUG). */
  debug?: boolean;
}

/** What `window.__FRAME_PREAMBLE` carries. */
export interface FramePreamble {
  origins: string[];
}

/** A capability's config, as `__frame_init.capabilities[cap]` or a grant carries it. */
export interface CapGrant {
  config?: Record<string, unknown>;
}

/** `GET /api/frame/session`: what the inner shell needs to start. */
export interface FrameSession {
  id: string;
  title: string;
  key: string | null;
  /** The artifact files' manifest version (the `/_f/<ver>/` segment). */
  ver: string;
  contract: Contract;
  /** The page's origin for this viewer (on a site, it carries the page's read-only token). */
  contentOrigin: string;
  shellOrigin: string;
  /** The outer Shells besides a loopback one the inner shell may speak to (`FrameOrigins.outer`); absent: none. */
  outerOrigins?: string[];
  /** The broker generation: calls stamped with another one are not run. */
  brokerGen: number;
  grants: string[];
  /** cap → error code. */
  stubs: Record<string, string>;
  /** cap → config, for `__frame_init.capabilities` and grants. */
  configs: Record<string, Record<string, unknown>>;
  /** The declaration's capabilities block, as written. */
  capabilities: Record<string, unknown>;
  flags: Record<string, boolean>;
  readyTimeoutS: number;
  /** The page frame's `sandbox`, for a restricted type (installed, or a project not trusted yet); absent: none. */
  sandbox?: string;
  me: LocalUser;
  comments: { available: boolean; count: number };
  /** wakesIdle false: an idle agent is not woken; what is sent waits for its next turn. */
  agent: { available: boolean; name: string | null; wakesIdle?: boolean };
  /**
   * The view of a `snapshot` on this computer (frame-host's headless Chrome): it reads only, shows no toast, and does
   * not wait out the usual deadlines before it says what it shows is final. Absent: an ordinary view.
   */
  snapshot?: boolean;
}

export interface LocalUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  email: string | null;
  isOwner: boolean;
  canEdit: boolean;
}


export interface CapRequest {
  cap: string;
  method: string;
  args: unknown[];
  /** The inner shell's client id (room sender, own-publish echo). */
  client: string;
  brokerGen?: number;
}

export interface CapErrorBody {
  code: string;
  message: string;
  [extra: string]: unknown;
}

/** `POST /api/frame/cap` answer (always HTTP 200 once the request was understood). */
export type CapReply = { result: unknown; error?: undefined } | { error: CapErrorBody; result?: undefined };

/** Events of the inner shell's stream (`/api/frame/events`). */
export type FrameEvent =
  | { t: 'hello'; ver: string; brokerGen: number; peers: Peer[]; count: number }
  | { t: 'db'; paths: string[] }
  | { t: 'room'; topic: string; data: unknown; from: string; by: string | null }
  | { t: 'peers'; peers: Peer[] }
  | { t: 'files'; ver: string; paths: string[]; from?: string }
  | { t: 'comments'; count: number }
  /** The broker was rewired: a new generation, and the caps it now serves. */
  | { t: 'rewired'; brokerGen: number; caps: string[]; reason: 'type' | 'files' };

export interface Peer {
  peer: string;
  /** The viewer's id, when the declaration has `user`; else null. */
  by: string | null;
  /** The viewer's name under the `profile` scope; else ''. */
  name: string;
  presence: Record<string, unknown>;
  kind: 'user';
}

// ---- page ⇄ inner shell -------------------------------------------------------------------------

export interface CapCall {
  __frame_cap: true;
  cap: string;
  id: string;
  method: string;
  args: unknown[];
  brokerGen?: number;
  holds?: boolean;
}

export interface CapResult {
  __frame_cap_r: true;
  id: string;
  result?: unknown;
  error?: CapErrorBody;
}

export interface FrameInit {
  contract: Contract;
  changes: string[];
  flags: Record<string, boolean>;
  capabilities: Record<string, CapGrant>;
  usable: string[];
  theme: 'light' | 'dark' | 'system';
  hostVisible: boolean;
  hostOverlays: unknown[];
  hostSides: Record<string, unknown>;
  hostKeys: unknown[];
  hot: { gen: number; phase: 'final' | 'pending'; from: string | null };
  capBudgets: Record<string, Record<string, number>>;
  capWants: true;
  brokerGen: number;
  /** This host's: the inner shell's client id, so room events can tell "me". */
  client: string;
}


export const DEFAULT_CAP_BUDGETS: Record<string, Record<string, number>> = {
  mcp: { callTool: 130_000 },
  sample: { sample: 330_000 },
  endpoints: { fetch: 130_000 },
  assets: { upload: 270_000 },
};

/** Message of a call refused because it was stamped with an older broker generation. */
export const STALE_GEN_MESSAGE = 'not run: the artifact was updated';
/** Message of a pending call cut by `__frame_cap_rewired`. */
export const REWIRED_CUT_MESSAGE = 'may not have run: the artifact was updated before this call was answered';
/** Message of a call to a capability the running version does not declare. */
export const UNDECLARED_MESSAGE = 'the version this view runs does not declare it';
