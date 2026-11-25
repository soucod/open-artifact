/**
 * An open doc on the server: its store, the writing sessions of the pages connected to it, their calls, and the frames
 * every page hears when anyone (a page or the agent) writes.
 */
import {
  type ChipLookup,
  type DateStyle,
  type DocState,
  DecisionJournal,
  Refusal,
  applyOps,
  blockXml,
  chipText,
  committed,
  docToDisk,
  isAtom,
  isChipKind,
  isText,
  proposalIds,
  suggestionAsOf,
  walk,
} from '@open-artifact/docs-core';
import { canEdit, type Viewer } from '@open-artifact/runtime/capabilities';
import { DocPeople } from './people.ts';
import type {
  DocCallAnswer,
  DocCallRequest,
  DocEnum,
  DocFile,
  DocFrame,
  DocHistoryResponse,
  DocJsonObject,
  DocMember,
  DocProject,
  DocRestoreResponse,
  DocSessionResponse,
  DocSuggestion,
  DocTabResponse,
  DocVersionResponse,
} from '@open-artifact/runtime/doc-api';
import { type CallOutcome, type Changes, type DocPerson, rebirth, runCall, runPageBatch, runPageMember } from './calls.ts';
import { DocStore, LOCKED_WORDS, StoreError, docDirOf } from './store.ts';

/** Calls answered again for a page that sends them twice (after a reconnect). */
const MAX_REPLAYS = 500;

export interface DocHostOptions {
  /** The artifact folder (the doc is in its `doc/`). */
  root: string;
  /** The owner: the agent writes for them. */
  owner: DocPerson;
  /** Sends a frame to every connected page (`except`: the page that wrote the tab, which has its answer). Project and dropdown frames go to every page, since a call's answer does not carry them. */
  emit(frame: DocFrame, except?: string): void;
  log(line: string): void;
}

/** A refused request of the page's (a bad request, not a refused write). */
export class DocRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A page's `{locale, timeZone}`, as far as it is strings. */
function dateStyleOf(value: unknown): DateStyle {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.locale === 'string' && value.locale.length <= 64 ? { locale: value.locale } : {}),
    ...(typeof value.timeZone === 'string' && value.timeZone.length <= 64 ? { timeZone: value.timeZone } : {}),
  };
}

const deny = (reason: string, detail: string, extra: { index?: number; data?: DocJsonObject } = {}): DocCallAnswer => ({ verdict: 'deny', reason, detail, ...extra });

/** What a tab's chips show, for {@link chipCount}: the doc's names, and the dates as the asking page writes them. */
export interface ChipReading {
  lookup: ChipLookup;
  dates?: DateStyle;
}

/**
 * How many times `text` is in a tab, counted as the editor's find bar counts the open tab: in each text block, along
 * each run of characters between inline atoms (a match never spans a mention or a line break), without overlaps;
 * without `caseSensitive`, each character lowercased where that keeps its length.
 */
export function findCount(doc: DocState, text: string, caseSensitive: boolean): number {
  const fold = (s: string) => (caseSensitive ? s : Array.from(s, (ch) => (ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch)).join(''));
  const wanted = fold(text);
  if (!wanted) return 0;
  let hits = 0;
  for (const { block } of walk(doc.blocks)) {
    if (!isText(block)) continue;
    const runs = [''];
    for (const item of block.inline ?? []) {
      if (isAtom(item)) runs.push('');
      else runs[runs.length - 1] += item.ch;
    }
    for (const run of runs) {
      const folded = fold(run);
      for (let at = folded.indexOf(wanted); at >= 0; at = folded.indexOf(wanted, at + wanted.length)) hits++;
    }
  }
  return hits;
}

/**
 * How many chips in a tab show `text` among their words, each counted once: the find bar's count adds these to
 * {@link findCount}. Case folds as there.
 */
export function chipCount(doc: DocState, text: string, caseSensitive: boolean, chips: ChipReading): number {
  const sameCase = (s: string) =>
    caseSensitive
      ? s
      : Array.from(s, (ch) => {
          const low = ch.toLowerCase();
          return low.length === ch.length ? low : ch;
        }).join('');
  const needle = sameCase(text);
  let found = 0;
  if (!needle) return found;
  for (const entry of walk(doc.blocks)) {
    if (!isText(entry.block)) continue;
    for (const item of entry.block.inline ?? []) {
      if (!isAtom(item) || !isChipKind(item.atom)) continue;
      const words = chipText(item.atom, item.attrs ?? {}, chips.lookup, chips.dates);
      if (words !== null && sameCase(words).includes(needle)) found++;
    }
  }
  return found;
}

/** The ids of the blocks a write changed, added or removed, by tab. */
function touchedBlocks(before: Map<string, DocState>, store: DocStore, tabs: readonly string[]): Map<string, string[]> {
  const touched = new Map<string, string[]>();
  const printed = (doc: DocState): Map<string, string> => {
    const out = new Map<string, string>();
    for (const { block } of walk(doc.blocks)) out.set(block.id, blockXml(block));
    return out;
  };
  for (const tabId of tabs) {
    const prior = before.get(tabId);
    let now: DocState;
    try {
      now = store.doc(tabId);
    } catch {
      continue;
    }
    if (prior === now) continue;
    const was = prior ? printed(prior) : new Map<string, string>();
    const is = printed(now);
    const ids = [...is].filter(([id, xml]) => was.get(id) !== xml).map(([id]) => id);
    for (const id of was.keys()) if (!is.has(id)) ids.push(id);
    touched.set(tabId, ids);
  }
  return touched;
}

export class DocHost {
  readonly store: DocStore;
  private readonly options: DocHostOptions;
  /** Each page connection's writing session, by its event stream's id. */
  private readonly sessions = new Map<string, { sess: string; who: string }>();
  private readonly replays = new Map<string, DocCallAnswer>();
  /** The pages' decisions on suggestions, for their undo to take back (in memory only). */
  private readonly decisions = new DecisionJournal();
  /** Who the ids in versions and suggestions are, by name. */
  readonly people: DocPeople;

  constructor(options: DocHostOptions) {
    this.options = options;
    this.store = DocStore.open(docDirOf(options.root));
    this.people = DocPeople.open(docDirOf(options.root));
  }

  get title(): string {
    return this.store.manifest.name;
  }

  /** Forgets a page connection's session (its stream closed). */
  release(client: string): void {
    this.sessions.delete(client);
  }

  // ---- reads ----

  project(): DocProject {
    const { manifest } = this.store;
    return {
      id: this.store.id,
      name: manifest.name,
      head: manifest.head,
      updated: manifest.updated,
      files: this.store.tabIds().map((id) => this.file(id)),
      enums: this.enums(),
      ...(manifest.display ? { display: manifest.display as DocJsonObject } : {}),
      ...(manifest.locked ? { locked: manifest.locked } : {}),
    };
  }

  private file(tabId: string): DocFile {
    const tab = this.store.tab(tabId);
    return {
      id: tabId,
      name: tab.name,
      order: tab.order,
      ...(tab.subtabOf ? { subtabOf: tab.subtabOf } : {}),
      rev: this.store.doc(tabId).rev,
      content: { kind: 'node', id: tab.node, engine: 'prose' },
    };
  }

  private enums(ids?: readonly string[]): DocEnum[] {
    return Object.entries(this.store.manifest.enums)
      .filter(([id]) => !ids || ids.includes(id))
      .map(([id, def]) => ({
        id,
        name: def.name,
        options: def.options.map((option) => ({ name: option.name, order: option.order, disabled: option.disabled === true, ...(option.color ? { color: option.color } : {}) })),
      }));
  }

  /** A page's session: made once per connection, kept while it holds one (a reader gets none). */
  session(client: string, viewer: Viewer): DocSessionResponse {
    const me = { id: viewer.id, name: viewer.name };
    // A person's name as they go by now, for the versions and suggestions their id is on.
    if (viewer.role !== 'viewer') this.people.remember(viewer.id, viewer.name);
    const base = { me, writable: canEdit(viewer.role), commentable: viewer.role !== 'viewer', project: this.project(), people: this.people.all() };
    if (!canEdit(viewer.role)) return { sess: null, next: 0, ...base };
    const held = this.sessions.get(client);
    if (held && held.who !== viewer.id) throw new DocRequestError(403, 'not_writer', 'The connection belongs to another viewer.');
    const kept = held ? this.store.session(held.sess) : null;
    if (kept) return { sess: kept.sess, next: kept.next, ...base };
    const session = this.store.mintSession();
    this.sessions.set(client, { sess: session.sess, who: viewer.id });
    return { sess: session.sess, next: session.next, ...base };
  }

  private tabOf(key: string): string {
    try {
      return this.store.findTab(key);
    } catch (error) {
      if (error instanceof StoreError) throw new DocRequestError(404, 'not_found', error.message);
      throw error;
    }
  }

  private suggestions(doc: DocState, me: string, ids?: ReadonlySet<string>): DocSuggestion[] {
    return proposalIds(doc.blocks)
      .filter((id) => !ids || ids.has(id))
      .map((id) => {
        const info = doc.suggestions?.[id];
        const name = info?.via === 'agent' ? undefined : this.people.nameOf(info?.by);
        return { id, by: info?.by ?? '', at: info?.at ?? '', ...(name ? { name } : {}), ...(info?.via ? { via: info.via } : {}), mine: !!info?.by && info.by === me, asOf: suggestionAsOf(doc.blocks, id) };
      });
  }

  read(tab: string, viewer: Viewer): DocTabResponse {
    const tabId = this.tabOf(tab);
    const doc = this.store.doc(tabId);
    return { tab: tabId, rev: doc.rev, doc: docToDisk(doc) as unknown as DocJsonObject, suggestions: this.suggestions(doc, viewer.id) };
  }

  history(tab: string): DocHistoryResponse {
    const tabId = this.tabOf(tab);
    const versions = [...(this.store.history(tabId)?.versions ?? [])].reverse().map((version) => ({
      rev: version.rev,
      by: version.by,
      ...(version.by === 'human' ? { user: version.user, ...(this.people.nameOf(version.user) ? { name: this.people.nameOf(version.user) } : {}) } : {}),
      at: version.at,
      ...(version.restoredFrom !== undefined ? { restoredFrom: version.restoredFrom } : {}),
    }));
    return { tab: tabId, rev: this.store.doc(tabId).rev, versions };
  }

  version(tab: string, rev: number): DocVersionResponse {
    const tabId = this.tabOf(tab);
    const doc = this.store.snapshot(tabId, rev);
    if (!doc) throw new DocRequestError(404, 'not_found', `This tab keeps no version at rev ${rev}.`);
    return { tab: tabId, rev: doc.rev, doc: docToDisk(committed(doc)) as unknown as DocJsonObject };
  }

  restore(tab: string, rev: number, ifRev: number | undefined, viewer: Viewer): DocRestoreResponse {
    if (!canEdit(viewer.role)) throw new DocRequestError(403, 'not_writer', 'Only editors can restore a version.');
    if (this.store.manifest.locked) throw new DocRequestError(409, 'locked', LOCKED_WORDS);
    const tabId = this.tabOf(tab);
    const before = this.store.doc(tabId).rev;
    if (ifRev !== undefined && ifRev !== before) throw new DocRequestError(409, 'guard_mismatch', `The tab changed since: it is at rev ${before}, not ${ifRev}.`);
    let result: { restored: boolean; rev: number };
    try {
      result = this.store.restoreTab(tabId, rev, { by: 'human', user: viewer.id, sess: 'restore' });
    } catch (error) {
      if (error instanceof StoreError && (error.code === 'DOC_TOO_LARGE' || error.code === 'LOCKED')) throw new DocRequestError(409, error.code.toLowerCase(), error.message);
      if (error instanceof StoreError) throw new DocRequestError(404, 'not_found', error.message);
      throw error;
    }
    if (result.restored) this.announce({ tabs: [tabId] }, { by: 'person' });
    return { ...result, before };
  }

  // ---- the page's calls ----

  /** A page's call. A call sent again with the same `opId` gets the first answer back when that one was allowed. */
  call(request: DocCallRequest, client: string, viewer: Viewer): DocCallAnswer {
    const opId = typeof request.opId === 'string' && request.opId ? request.opId : '';
    const replayKey = JSON.stringify([viewer.id, viewer.role, opId]);
    if (opId && canEdit(viewer.role)) {
      const first = this.replays.get(replayKey);
      if (first) return { ...first, replayed: true } as DocCallAnswer;
    }
    const answer = this.callOnce(request, client, viewer, opId);
    const reads = 'member' in request && request.member?.verb === 'read';
    if (opId && !reads && answer.verdict === 'allow') {
      this.replays.set(replayKey, answer);
      if (this.replays.size > MAX_REPLAYS) this.replays.delete(this.replays.keys().next().value!);
    }
    return answer;
  }

  private callOnce(request: DocCallRequest, client: string, viewer: Viewer, opId: string): DocCallAnswer {
    const person: DocPerson = { id: viewer.id, name: viewer.name };
    if ('batch' in request) {
      if (!Array.isArray(request.batch)) return deny('bad_request', 'batch is a list of members');
      if (!canEdit(viewer.role)) return deny('not_writer', 'This link cannot edit the doc.');
      const session = this.sessionFor(request.sess, client, viewer);
      if (!session) return deny('not_your_session', 'Take a session first.');
      const outcome = runPageBatch(this.store, request.batch, person, session, { owner: viewer.role === 'owner' });
      if (outcome.changes) this.announce(outcome.changes, { by: 'person', except: client });
      return outcome.body as DocCallAnswer;
    }
    const member = request.member;
    if (!isRecord(member)) return deny('bad_request', 'member is an object: {verb, object | ref, payload}');
    const object = member.ref?.object ?? member.object;
    const id = typeof member.ref?.id === 'string' ? member.ref.id : '';
    const payload = isRecord(member.payload) ? member.payload : {};
    if (member.verb === 'read' && object === 'node') return this.readNode(id, payload, viewer);
    // The deleted tabs (`payload.kind: 'deleted'`) are for those who can restore them.
    if (member.verb === 'read' && object === 'project' && payload.kind === 'deleted' && !canEdit(viewer.role)) return deny('not_writer', 'Only editors can see and restore deleted tabs.');
    if (member.verb === 'read' && object === 'project' && payload.kind !== 'deleted') return { verdict: 'allow', value: this.project() as unknown as DocJsonObject };
    if (member.verb === 'update' && object === 'node') return this.writeNode(id, payload, request.sess, client, viewer, opId);
    if (!canEdit(viewer.role) && member.verb !== 'read') return deny('not_writer', 'This link cannot edit the doc.');
    const session = this.sessionFor(request.sess, client, viewer) ?? (member.verb === 'read' ? { sess: 'read', next: 0 } : null);
    if (!session) return deny('not_your_session', 'Take a session first.');
    const { $lid: _alias, ...rest } = member as DocMember;
    const outcome = runPageMember(this.store, rest, person, session, { owner: viewer.role === 'owner' });
    if (outcome.changes) this.announce(outcome.changes, { by: 'person', except: client });
    return outcome.body as DocCallAnswer;
  }

  /** The session a page names, when it is the one this connection holds. */
  private sessionFor(sess: string, client: string, viewer: Viewer) {
    const held = this.sessions.get(client);
    if (!held || held.who !== viewer.id || held.sess !== sess) return null;
    return this.store.session(sess);
  }

  private readNode(node: string, payload: Record<string, unknown>, viewer: Viewer): DocCallAnswer {
    const tabId = this.store.tabOfNode(node);
    if (!tabId) return deny('node_gone', 'no such node');
    const doc = this.store.doc(tabId);
    const asked = payload.kind === 'search' && typeof payload.text === 'string' ? payload.text : null;
    // The find bar's count for a tab that is not open, its chips' words included.
    if (asked !== null) {
      const exact = payload.caseSensitive === true;
      const chips = chipCount(doc, asked, exact, { lookup: this.chipLookup(), dates: dateStyleOf(payload.dates) });
      return { verdict: 'allow', rev: doc.rev, hits: findCount(doc, asked, exact) + chips };
    }
    if (payload.kind === 'suggestions') {
      const ids = Array.isArray(payload.ids) ? new Set(payload.ids.filter((item): item is string => typeof item === 'string')) : undefined;
      return { verdict: 'allow', rev: doc.rev, suggestions: this.suggestions(doc, viewer.id, ids) as unknown as DocJsonObject[] };
    }
    return { verdict: 'allow', rev: doc.rev, doc: docToDisk(doc) as unknown as DocJsonObject };
  }

  /** What the doc's chips name: its dropdown options, its tabs, and the people it knows (the names its pages get too). */
  private chipLookup(): ChipLookup {
    const { enums, tabs } = this.store.manifest;
    return {
      option: (list, index) => (Object.hasOwn(enums, list) ? (enums[list]!.options[index]?.name ?? null) : null),
      tab: id => (Object.hasOwn(tabs, id) ? tabs[id]!.name : null),
      person: id => this.people.nameOf(id) ?? null,
    };
  }

  /** The page's edit of a tab's prose: ops on the rev it holds, no hash guards, with its decisions kept for undo. */
  private writeNode(node: string, payload: Record<string, unknown>, sess: string, client: string, viewer: Viewer, opId: string): DocCallAnswer {
    const tabId = this.store.tabOfNode(node);
    if (!tabId) return deny('node_gone', 'no such node');
    if (!canEdit(viewer.role)) return deny('not_writer', 'This link cannot edit the doc.');
    const session = this.sessionFor(sess, client, viewer);
    if (!session) return deny('not_your_session', 'Take a session first.');
    const ops = Array.isArray(payload.ops) ? payload.ops : null;
    if (!ops) return deny('bad_request', 'payload.ops is the list of ops');
    const lock = this.store.manifest.locked;
    if (lock) return deny('locked', LOCKED_WORDS, { data: { lockedBy: lock.by, lockedAt: lock.at } as unknown as DocJsonObject });
    const doc = this.store.doc(tabId);
    const startNext = session.next;
    // `strict`: the write is meant for the tab at `ifRev` and no other (the page making the tab match what it shows).
    if (payload.strict === true && payload.ifRev !== doc.rev)
      return deny('guard_mismatch', `the tab changed since: it is at rev ${doc.rev}, not ${String(payload.ifRev)}`, { data: { rev: doc.rev } });
    let result;
    try {
      result = applyOps(doc, ops, session, {
        ...(typeof payload.ifRev === 'number' ? { ifRev: payload.ifRev } : {}),
        decisions: (suggestId) => this.decisions.get(tabId, suggestId),
        // What the person suggests in Suggesting mode is recorded as theirs.
        author: viewer.id,
      });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      this.options.log(`refused ${error.code} at op ${error.opIndex ?? 0}: ${error.message}`);
      return deny(error.code, error.message, { index: error.opIndex ?? 0, data: error.extra as DocJsonObject });
    }
    if (result.changed) {
      try {
        this.store.putDoc(tabId, result.doc, { by: 'human', user: viewer.id, sess: session.sess });
      } catch (error) {
        if (!(error instanceof StoreError) || (error.code !== 'DOC_TOO_LARGE' && error.code !== 'LOCKED')) throw error;
        // Nothing of the write stays: the ids it took are given back.
        session.next = startNext;
        this.options.log(`refused ${error.code.toLowerCase()}: ${error.message}`);
        return deny(error.code.toLowerCase(), error.message, { data: error.data as DocJsonObject });
      }
    } else this.store.saveSessions();
    for (const decision of result.decisions) this.decisions.put(tabId, { ...decision, ...(opId ? { opId } : {}) });
    const rev = result.doc.rev;
    if (result.changed) this.announce({ tabs: [tabId] }, { by: 'person', except: client, sess: session.sess, ...(opId ? { opId } : {}) });
    const decided = result.results.find((op) => op.decided)?.decided;
    const found = result.results.find((op) => op.undecided)?.undecided;
    const undecided = found ? { ...found, rev } : undefined;
    if (undecided?.outcome === 'restored') this.decisions.drop(tabId, undecided.suggestId);
    return {
      verdict: 'allow',
      rev,
      ...(result.changed ? {} : { noop: true }),
      results: result.results as unknown as DocJsonObject[],
      ...(result.notices.length ? { notices: result.notices as DocJsonObject[] } : {}),
      ...(decided ? { decided } : {}),
      ...(undecided ? { undecided: undecided as DocJsonObject } : {}),
    };
  }

  // ---- the agent's calls ----

  /** A call by the agent (the CLI's while the doc is open): the open pages hear its edits as the agent's. */
  agentCall(call: unknown): CallOutcome {
    const before = new Map(this.store.tabIds().map((tabId) => [tabId, this.store.doc(tabId)] as const));
    const outcome = runCall(this.store, call, this.options.owner);
    if (outcome.changes) this.announce(outcome.changes, { by: 'agent', touched: touchedBlocks(before, this.store, outcome.changes.tabs ?? []) });
    return outcome;
  }

  /** The agent's birth of the doc on the blank one opening its folder made: the pages see it at once. */
  agentBirth(call: unknown): CallOutcome {
    const before = new Map(this.store.tabIds().map((tabId) => [tabId, this.store.doc(tabId)] as const));
    const outcome = rebirth(this.store, call, this.options.owner);
    if (outcome.changes) this.announce(outcome.changes, { by: 'agent', touched: touchedBlocks(before, this.store, outcome.changes.tabs ?? []) });
    return outcome;
  }

  /** Tells the open pages what changed (an import, an agent's call, a restore, a page's write). */
  announce(changes: Changes, source: { by: 'person' | 'agent'; except?: string; sess?: string; opId?: string; touched?: Map<string, string[]> }): void {
    for (const tabId of changes.tabs ?? []) {
      let rev: number;
      try {
        rev = this.store.doc(tabId).rev;
      } catch {
        continue;
      }
      const blocks = source.touched?.get(tabId);
      this.options.emit(
        {
          kind: 'tab',
          tab: tabId,
          rev,
          by: source.by,
          ...(source.sess ? { sess: source.sess } : {}),
          ...(source.opId ? { opId: source.opId } : {}),
          ...(blocks?.length ? { blocks } : {}),
        },
        source.except,
      );
    }
    if (changes.enums?.length) this.options.emit({ kind: 'enums', enums: this.enums(changes.enums) });
    if (changes.project) this.options.emit({ kind: 'project', project: this.project() });
  }
}
