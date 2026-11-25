/**
 * The agent's tools: `Artifact`, `ArtifactData` and `ArtifactComments`.
 *
 * The daemon implements them once; MCP (`POST /mcp`), the Harness API's
 * `tools.call`, the HTTP polling API and the `open-artifact` command line all land
 * there. Adapters that register the tools in their harness themselves use
 * {@link TOOL_SCHEMAS} and {@link TOOL_DESCRIPTIONS}.
 */

import type { ActionKind } from './harness.ts';
import type { TypeSourceKind } from './type-package.ts';

/** A JSON Schema property, the subset the tool schemas use. */
export interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  additionalProperties?: boolean;
}

/** A tool's input schema. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

/** Tool names. */
export type ToolName = 'Artifact' | 'ArtifactData' | 'ArtifactComments';

/** A tool as MCP `tools/list` and `tools.list` describe it. */
export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: ToolInputSchema;
  /** MCP tool annotations: hints an app's approval check reads. */
  annotations?: ToolAnnotations;
  /**
   * What each action does, by action name, for the harness's own approval check (`list` is `read`, `delete` is
   * `remove`). Left out by daemons without the `tools.actions` feature.
   */
  actions?: Record<string, ActionKind>;
  /**
   * The actions that send the artifact's data (its id and title, the arguments, documents or comments) off this
   * computer when the artifact's type is remote (`remote: true` where types are listed): to the type's own address.
   * A harness asks about those by `remote`, never by the action's kind or a type action's self-declared `effect`.
   * Left out by daemons without the `types.remote` feature.
   */
  remoteActions?: string[];
}

/** MCP tool annotations (hints, not guarantees). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  /**
   * false: the tool works only on this computer's artifacts, not with an outside service. true while a remote type is
   * installed and enabled: its artifacts' calls reach its own address.
   */
  openWorldHint?: boolean;
}

/** `Artifact` actions. */
export const ARTIFACT_ACTIONS = ['quickstart', 'list', 'publish', 'read', 'open', 'call', 'adopt', 'delete', 'share'] as const;
/** `ArtifactData` actions. */
export const DATA_ACTIONS = ['get', 'list', 'query', 'set', 'update', 'delete', 'str_replace', 'batch'] as const;
/** `ArtifactComments` actions. */
export const COMMENTS_ACTIONS = ['read', 'reply', 'resolve', 'reopen', 'wait'] as const;

export type ArtifactAction = (typeof ARTIFACT_ACTIONS)[number];
export type DataAction = (typeof DATA_ACTIONS)[number];
export type CommentsAction = (typeof COMMENTS_ACTIONS)[number];

/** A file to write with `publish`: text, or base64 bytes; `null` deletes. */
export type PublishFile = string | { content: string; encoding?: 'utf8' | 'base64' } | null;

/** `Artifact` arguments. */
export interface ArtifactArgs {
  action?: ArtifactAction;
  intent?: string;
  scope?: 'types' | 'mine' | 'all';
  type_url?: string;
  title?: string;
  folder?: string;
  url?: string;
  files?: Record<string, PublishFile>;
  path?: string;
  /** read: several files at once. */
  paths?: string[];
  /** list: only artifacts of this type (id or type_url). quickstart: the type already chosen; no matching. */
  type?: string;
  /** list: only artifacts whose title contains it. quickstart: same as intent. */
  query?: string;
  /** list: page size (default 50, at most 200). */
  limit?: number;
  /** list: `next_cursor` of the previous page. */
  cursor?: string;
  /** publish with url: per file, the sha256 it must still have, `null` (must not exist) or `"*"` (any). */
  if_match?: Record<string, string | null>;
  /** publish with url: run the type's `check` action after writing. */
  check?: boolean;
  /**
   * publish, `page` artifacts only: the runtime capabilities the page may use, as `{name: true | config}`. Omitted: kept
   * as they are; `{}`: none (only `artifact` and `permissions` remain); otherwise the whole set. Kept in the record and in
   * `.artifact.json`, never in the page, so a page cannot grant itself more.
   */
  capabilities?: Record<string, unknown>;
  /** publish without url: open the page after the first write (`after_first_write`, the default), right away (`now`) or not (`never`). */
  open?: 'after_first_write' | 'now' | 'never';
  /** quickstart: list existing artifacts the recommended type can use (default true). */
  related?: boolean;
  name?: string;
  args?: Record<string, unknown>;
  /** open: the Shell panel to show the person, `share` (its Share panel) or `export` (its Export tab). */
  panel?: ArtifactPanel;
  /**
   * Refused: only the person changes sharing, in the Shell's Share panel.
   * Kept here so an agent that still sends them gets an answer that says so.
   */
  lan?: boolean;
  links?: { editor?: boolean; commenter?: boolean; viewer?: boolean };
  /** share: publish to this cloud remote (by its name), where the person allowed the agent to (`remotes.<name>.agentMayPublish`). */
  cloud?: string;
}

/** The Shell panels `open` can show: the Share panel, or its Export tab. */
export const ARTIFACT_PANELS = ['share', 'export'] as const;
export type ArtifactPanel = (typeof ARTIFACT_PANELS)[number];

/** One write of an `ArtifactData` batch. */
export interface DataWrite {
  op: 'set' | 'update' | 'delete' | 'str_replace';
  path?: string;
  collection?: string;
  doc_id?: string;
  data?: Record<string, unknown>;
  file_path?: string;
  /** The sha256 read returned: write only while the document still has it. `null`: only while it does not exist. `"*"`: whatever it is. */
  if_match?: string | null;
  /** str_replace: the text field, as a dot path. */
  field?: string;
  /** str_replace: the passage to replace; it must occur once. */
  old?: string;
  /** str_replace: what replaces it. */
  new?: string;
}

/** A `query` condition, as pages give it. */
export interface DataWhere {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';
  value: unknown;
}

/** `ArtifactData` arguments. */
export interface ArtifactDataArgs {
  action: DataAction;
  url: string;
  collection?: string;
  doc_id?: string;
  path?: string;
  data?: Record<string, unknown>;
  file_path?: string;
  writes?: DataWrite[];
  /** query: conditions that all hold. */
  where?: DataWhere[];
  /** query: one sort. */
  order_by?: { field: string; dir?: 'asc' | 'desc' };
  /** list / query: page size (default 100, at most 1000). */
  limit?: number;
  /** list / query: the `next_cursor` of the previous page. */
  cursor?: string;
  /** set / update / delete / str_replace: the sha256 read returned, `null` or `"*"` (see {@link DataWrite.if_match}). */
  if_match?: string | null;
  field?: string;
  old?: string;
  new?: string;
  /** get / list / query: write the result to this JSON file and return only its path and counts. */
  out_file?: string;
}

/** `ArtifactComments` arguments. */
export interface ArtifactCommentsArgs {
  action: CommentsAction;
  url?: string;
  thread_id?: string;
  text?: string;
  resolve?: boolean;
  all?: boolean;
  timeout_ms?: number;
  /** read: only threads with a message at or after this time (ISO 8601 or ms since 1970). */
  since?: string | number;
  /** reply: send the same text as your last reply in the thread again. */
  acknowledge_duplicate?: boolean;
}

/** Arguments by tool name. */
export interface ToolArgs {
  Artifact: ArtifactArgs;
  ArtifactData: ArtifactDataArgs;
  ArtifactComments: ArtifactCommentsArgs;
}

/**
 * A tool's result: the action's own fields, or `error`. `messages` carries
 * wake messages that waited for the calling session, as plain text the
 * agent reads after the result.
 */
export type ToolCallResult = Record<string, unknown> & {
  error?: { code: string; message: string; fix?: string };
  /** The obvious next call. */
  next?: string;
  /** A fixed remark about this kind of result. */
  note?: string;
  /** Remarks about this call. */
  notes?: string[];
  /** For a conflict: what the conflicting files or documents are now. */
  current?: unknown;
  messages?: string[];
};

/** A type as `quickstart` and `list scope: "types"` show it. */
export interface QuickstartType {
  type_url: string;
  id: string;
  title: string;
  description: string;
  intents: string[];
  when?: string;
  exports?: string[];
  uses?: string[];
  scope: string;
  runnable: boolean;
  problems?: string[];
  /**
   * The type's page and actions are on another computer (a URL entry that is not loopback): opening its artifacts,
   * their actions, documents and comments send data to {@link origin}. Left out by daemons without `types.remote`.
   */
  remote?: boolean;
  /** With `remote`: where (`https://slides.example.com`). */
  origin?: string;
  /**
   * Where the type comes from: `builtin`, `local` (a folder on this computer) or `installed` (a package installed with
   * `types install`). Left out by daemons without the `types.source` feature.
   */
  source?: TypeSourceKind;
  /** An installed type: the file or `https://` address it was installed from. */
  installed_from?: string;
  /**
   * A type of an untrusted root: `THIRD_PARTY_NOTICE` (installed) or `UNTRUSTED_PROJECT_NOTICE` (a project not trusted
   * yet), a fixed note that its title, description and instructions were written by its publisher, apply only to the
   * artifact's own content, and grant nothing. The same field sits next to `instructions` in the results of `publish`
   * (create), `adopt` and `read {type_url}`. On reads of such an artifact it is `PAGE_CONTENT_NOTICE` (an `Artifact`
   * `path`/`paths` read, `ArtifactData` and `ArtifactComments` reads: the type's page may have written what is read),
   * or both sentences joined on a full `Artifact` read.
   */
  third_party_notice?: string;
}

/** An artifact `quickstart` names: one the new one can build on (`related`), or one that may be the same (`existing`). */
export interface QuickstartArtifact {
  url: string;
  title: string;
  type: string;
  updatedAt: string;
  root?: string;
  /** The calling session owns it. */
  mine?: boolean;
}

/**
 * What `Artifact {action: "quickstart"}` answers. `steps`, `existing`, `rules` and `replaces` come from daemons with
 * the `quickstart.steps` feature.
 */
export interface QuickstartResult {
  recommended: QuickstartType | null;
  alternatives: QuickstartType[];
  /** The exact call that creates the recommended type. */
  create?: { action: 'publish'; type_url: string; title: string; open?: ArtifactArgs['open'] };
  related?: QuickstartArtifact[];
  types: QuickstartType[];
  next: string;
  note: string;
  /** What to do from creating to handing over, written for the calling harness: who opens the page, how comments come back. */
  steps?: string;
  /** Artifacts of the same type with a similar title, in the reach of the harness's `policy.reuse`: ask before making another. */
  existing?: QuickstartArtifact[];
  /** The harness's own rules; they win over everything else the agent was told. */
  rules?: string;
  /** Calls this answer stands in for (listing types, listing design systems, reading the default one): do not make them. */
  replaces?: string[];
}

const ARTIFACT_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ARTIFACT_ACTIONS,
      description: 'What to do: quickstart, list, publish, read, open, call, adopt, delete or share. Omitted: publish.',
    },
    intent: {
      type: 'string',
      description: 'quickstart: what is being made (design, design-system, slides, whiteboard, document, data, sheets, motion, page, other), or a few words about it.',
    },
    scope: {
      type: 'string',
      enum: ['types', 'mine', 'all'],
      description: "list: types (the installed types), mine (this session's and this workspace's artifacts; the default) or all (every artifact).",
    },
    type: {
      type: 'string',
      description: 'list: only artifacts of this type (an id, or open-artifact://type/<id>). quickstart: the type already chosen (an id), to get its create call and steps without matching.',
    },
    query: { type: 'string', description: 'list: only artifacts whose title contains this text.' },
    limit: { type: 'integer', description: 'list: how many to return (default 50, at most 200).' },
    cursor: { type: 'string', description: 'list: the next_cursor of the previous page.' },
    type_url: {
      type: 'string',
      description: 'publish without url: the type to create from (open-artifact://type/<id>, from quickstart). read without url: the type to describe.',
    },
    title: { type: 'string', description: "publish without url: the new artifact's name. quickstart: the name it will have, to find similar ones." },
    folder: {
      type: 'string',
      description: "publish without url, or adopt: where the artifact's folder goes (absolute, or relative to the workspace). Default <workspace>/artifacts/<slug>.",
    },
    url: { type: 'string', description: 'An artifact: open-artifact://artifact/<id>, as publish returned it.' },
    files: {
      type: 'object',
      additionalProperties: true,
      description: 'publish with url: files to write under the artifact root, as {"rel/path": "text"} or {"rel/path": {"content": "...", "encoding": "base64"}}; null deletes.',
    },
    if_match: {
      type: 'object',
      additionalProperties: true,
      description:
        'publish with url: {"rel/path": sha256 | null | "*"}. Write only while the file still has the sha256 you read, does not exist (null), or anyway ("*"). One mismatch writes nothing and returns the current versions.',
    },
    check: { type: 'boolean', description: "publish with url: run the type's check action after writing; its result comes back as check." },
    capabilities: {
      type: 'object',
      additionalProperties: true,
      description:
        'publish, page artifacts only: the runtime capabilities the page may use, as {"db": true, "assets": true, ...}. Omitted: kept; {}: none; otherwise the whole set. With url it may be given without files.',
    },
    open: {
      type: 'string',
      enum: ['after_first_write', 'now', 'never'],
      description: "publish without url: after_first_write (the default) opens the page in your app once your first write lands; now opens it at once; never leaves it closed. Where your app cannot show pages by itself the result says so: open view_url in your app's built-in browser, if you have one.",
    },
    related: { type: 'boolean', description: 'quickstart: list existing artifacts the recommended type can build on, such as design systems (default true).' },
    path: { type: 'string', description: 'read: one file or folder under the root (omitted: the record and the file list).' },
    paths: { type: 'array', items: { type: 'string' }, description: 'read: several files under the root at once.' },
    name: { type: 'string', description: "call: the action's name (check, upload, ...; read with url lists them)." },
    args: { type: 'object', additionalProperties: true, description: "call: the action's arguments. upload: {file: absolute path, name?, group?}." },
    panel: {
      type: 'string',
      enum: ARTIFACT_PANELS,
      description: 'open: also open the page\'s Share panel (share), for the person to share it on the network, or its Export tab (export), for them to download a file.',
    },
    cloud: {
      type: 'string',
      description:
        "share: publish the artifact to this cloud remote (its name, as `open-artifact remote list` shows it). It works only on a remote the person set up and let agents publish to (agentMayPublish); otherwise the person publishes it, from the Share panel or with `open-artifact publish <id> --remote <name>`.",
    },
  },
};

const DATA_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: DATA_ACTIONS, description: 'What to do: get, list, query, set, update, delete, str_replace or batch.' },
    url: { type: 'string', description: 'The artifact (open-artifact://artifact/<id>).' },
    collection: { type: 'string', description: 'The collection: alone for list / query (query needs it), with doc_id for one document.' },
    doc_id: { type: 'string', description: 'With collection: the document to get / set / update / delete / str_replace.' },
    path: { type: 'string', description: 'collection/doc_id, instead of the two.' },
    data: { type: 'object', additionalProperties: true, description: "set / update: the document's fields." },
    file_path: { type: 'string', description: 'set / update: a JSON file holding the fields, instead of data.' },
    // No type: a sha256 string, or null.
    if_match: {
      description: 'set / update / delete / str_replace: the sha256 get returned (write only if unchanged), null (only if it does not exist) or "*" (replace whatever is there).',
    },
    field: { type: 'string', description: 'str_replace: the text field, as a dot path (body, notes.text).' },
    old: { type: 'string', description: 'str_replace: the passage to replace; it must occur exactly once.' },
    new: { type: 'string', description: 'str_replace: the passage that replaces it.' },
    where: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'query: [{field, op, value}], all must hold. op: ==, !=, <, <=, >, >=, in, not-in (up to 30 values), array-contains.',
    },
    order_by: { type: 'object', additionalProperties: true, description: 'query: {field, dir: "asc" | "desc"}.' },
    limit: { type: 'integer', description: 'list / query: how many documents (default 100, at most 1000).' },
    cursor: { type: 'string', description: 'list / query: the next_cursor of the previous page.' },
    out_file: { type: 'string', description: 'get / list / query: write the result to this JSON file (absolute, or relative to the workspace) and return only its path and counts.' },
    writes: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'batch: [{op: set|update|delete|str_replace, path | collection+doc_id, data | file_path, if_match?, field?, old?, new?}], at most 500.',
    },
  },
  required: ['action', 'url'],
};

const COMMENTS_SCHEMA: ToolInputSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: COMMENTS_ACTIONS, description: 'What to do: read, reply, resolve, reopen or wait.' },
    url: { type: 'string', description: 'The artifact (open-artifact://artifact/<id>). wait: optional.' },
    thread_id: { type: 'string', description: 'reply / resolve / reopen: the thread (after ";thread=" in the message).' },
    text: { type: 'string', description: 'reply: the answer.' },
    resolve: { type: 'boolean', description: 'reply: resolve the thread too.' },
    all: { type: 'boolean', description: 'read: resolved threads too.' },
    since: { type: 'string', description: 'read: only threads with a message at or after this time (ISO 8601).' },
    acknowledge_duplicate: { type: 'boolean', description: 'reply: send the same text as your last reply in this thread again, on purpose.' },
    timeout_ms: { type: 'number', description: 'wait: how long (default 600000).' },
  },
  required: ['action'],
};

/** The tools' argument schemas (JSON Schema). */
export const TOOL_SCHEMAS: Record<ToolName, ToolInputSchema> = {
  Artifact: ARTIFACT_SCHEMA,
  ArtifactData: DATA_SCHEMA,
  ArtifactComments: COMMENTS_SCHEMA,
};

/** The tools' descriptions: what each action does and when to use it. Argument details are in the schemas. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  Artifact: [
    'Make and change artifacts: typed folders of files that open as live pages the person can view, edit, comment on and export. Actions:',
    '- quickstart {intent, type?}: call first for a new artifact; recommends a type (or takes the one given) and returns the call that creates it, the steps for this app and similar artifacts that already exist.',
    '- list {scope: "mine" | "all" | "types", type?, query?}: find existing artifacts, or the installed types.',
    "- publish {type_url, title, folder?, open?}: create an artifact; the result carries its root folder and the type's instructions. publish {url, files, if_match?, check?}: write files when you have no file tools of your own. A page artifact also takes capabilities (on create or write): the runtime capabilities its page may use.",
    "- read {url, path? | paths?}: the artifact's record, files and actions, or some of its files with their sha256. read {type_url}: a type's instructions, before creating.",
    '- open {url, panel?}: show it to the person in the computer\'s browser (or the app, when it shows pages), once its content is written. When your app has a built-in browser, open view_url there instead. panel "share" or "export" opens its Share panel or Export tab for them.',
    "- call {url, name, args?}: run one of the type's actions (check, upload, ...). A long one answers {task, pending: true}; its result comes later as a message.",
    '- adopt {url | folder}: take over an artifact, or add an existing folder. Only when the person asks.',
    "- share {url}: whether it is shared on the local network, and its links. Only the person changes that, in the page's Share panel.",
    '- delete {url}: forget an artifact; its folder stays. Only when the person asks.',
  ].join('\n'),
  ArtifactData:
    'Read and write the document store of an artifact whose type keeps one (its instructions say so). get, list and query read documents with their sha256; set, update, delete, str_replace and batch write them. update merges fields, and {"__delete__": true} removes one; str_replace changes one passage of a long text field. Replacing or deleting an existing document needs if_match: the sha256 you read, or "*". Your writes show live on open pages.',
  ArtifactComments:
    'Comments the person leaves on their artifact\'s page, kept in the artifact\'s own folder on this computer (no outside service). read lists the threads; reply answers one (thread_id is after ";thread=" in the message), with resolve: true when it is done; resolve and reopen change a thread\'s state. A thread sent to you is the person asking for your answer in it, so replying there is what they asked for. Answer only threads sent to you, in one or two lines. wait blocks until the next message for this session: use it only when nothing else can wake you.',
};

/**
 * The tools' MCP annotations while every type is on this computer. All three then work only on this computer's
 * artifact folders, so none is open-world: an app's approval check (Cursor's auto-review) would otherwise take a
 * comment reply for a write to an outside service. With a remote type installed, {@link toolDefinitions} says
 * `openWorldHint: true` for the tools whose calls reach it.
 */
export const TOOL_ANNOTATIONS: Record<ToolName, ToolAnnotations> = {
  Artifact: { title: 'Artifact', openWorldHint: false },
  ArtifactData: { title: 'Artifact data', openWorldHint: false },
  ArtifactComments: { title: 'Artifact comments', destructiveHint: false, openWorldHint: false },
};

/**
 * What each action of each tool does (design 6.3): `read` only looks, `write` changes an artifact, `ui` changes what
 * the person sees, `remove` deletes or takes over, `person` is the person's own decision (sharing). A harness's
 * approval check and its profile's `policy.confirm` go by this table; a type's own actions (`Artifact call`) carry
 * their `effect` instead, wherever they are listed.
 */
export const TOOL_ACTION_KINDS: Record<ToolName, Record<string, ActionKind>> = {
  Artifact: { quickstart: 'read', list: 'read', read: 'read', publish: 'write', call: 'write', open: 'ui', delete: 'remove', adopt: 'remove', share: 'person' },
  // `delete` removes one document inside the artifact (an element of a board): an edit, not removing the artifact.
  ArtifactData: { get: 'read', list: 'read', query: 'read', set: 'write', update: 'write', str_replace: 'write', batch: 'write', delete: 'write' },
  ArtifactComments: { read: 'read', wait: 'read', reply: 'write', resolve: 'write', reopen: 'write' },
};

/** The kind of one tool call (`Artifact {action: "list"}` is `read`); `publish` when the action is left out. */
export function actionKindOf(tool: ToolName, action: string | undefined): ActionKind | null {
  return TOOL_ACTION_KINDS[tool]?.[action || (tool === 'Artifact' ? 'publish' : '')] ?? null;
}

/**
 * The actions of each tool that send an artifact's data to its type's address when that type is remote (design 18.2):
 * `Artifact` `open` (the open request: id, title, language) and `publish` creating one (it opens the page), `call`
 * (the arguments) and `share`; every `ArtifactData` action (the type's server keeps the documents); the
 * `ArtifactComments` actions but `wait`. Reading a type's action list (`read`, `adopt`) asks the type's address but
 * sends nothing about an artifact.
 */
export const TOOL_REMOTE_ACTIONS: Record<ToolName, readonly string[]> = {
  Artifact: ['publish', 'open', 'call', 'share'],
  ArtifactData: ['get', 'list', 'query', 'set', 'update', 'str_replace', 'batch', 'delete'],
  ArtifactComments: ['read', 'reply', 'resolve', 'reopen'],
};

/**
 * Tool definitions in MCP shape, with each action's kind and the actions that leave this computer for a remote type.
 * `remote`: which installed, enabled types are remote: `any` (some type is), `actions` (one of them answers actions,
 * so its documents and comments are there too). Without it, as when every type is local.
 */
export function toolDefinitions(remote: { any: boolean; actions: boolean } = { any: false, actions: false }): ToolDefinition[] {
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => {
    const open = name === 'Artifact' ? remote.any : remote.actions;
    return {
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: TOOL_SCHEMAS[name],
      annotations: open ? { ...TOOL_ANNOTATIONS[name], openWorldHint: true } : TOOL_ANNOTATIONS[name],
      actions: TOOL_ACTION_KINDS[name],
      remoteActions: [...TOOL_REMOTE_ACTIONS[name]],
    };
  });
}

/** Tool definitions in MCP shape, with each action's kind, as when every installed type is on this computer. */
export const TOOL_DEFINITIONS: ToolDefinition[] = toolDefinitions();
