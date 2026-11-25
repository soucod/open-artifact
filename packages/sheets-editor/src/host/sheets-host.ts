import { connectHost, createShellBridge, type HostCapabilities, type RoleAbilities, type ShellBridge } from '@open-artifact/editor-kit';
import type {
  AgentCapability,
  AgentRequest,
  AgentStatus,
  Peer,
  RoomCapability,
  SheetCapability,
  SheetPerson,
  SheetWalkthrough,
  ShellConnection,
  Viewer,
} from '@open-artifact/runtime';
import { personId } from '@open-artifact/sheets-core/person-ids';
import { isNonNullObject } from '../utils/objects.ts';
import { setAgentName } from '../agent/agent-name.ts';
import { startPageComments, type PageComments } from '../comments/page-comments.ts';

export const SHEETS_CAPABILITIES = ['sheet', 'room', 'comments', 'downloads', 'agent'] as const;

export type SheetsCapabilityName = (typeof SHEETS_CAPABILITIES)[number];

export interface PeerOfRoom {
  peer: string;
  by: string;
  name: string;
  isMe: boolean;
  sameTab: boolean;
  kind: 'viewer' | 'agent';
  presence: Record<string, unknown>;
}

export interface RoomPeersEvent {
  peers: PeerOfRoom[];
}

/** Whether the agent session takes what the page sends: now, once it is opened or summoned, or not at all. */
export type AgentSendState = 'available' | 'available_if_opened' | 'available_if_summoned' | 'rejected';

/** How a payload is sent to the agent session: sent at once or staged for the person to send, with or without presence. */
export interface AgentSendOptions {
  deliver?: 'send' | 'stage';
  attachPresence?: false;
}

export interface PageRoom {
  peers(): PeerOfRoom[];
  presence(patch: Record<string, unknown>): Promise<void>;
  onPeers(listener: (event: RoomPeersEvent) => void, onGone?: () => void): () => void;
  canSendToAgentSession(): Promise<AgentSendState>;
  /** `{ drafted: true }`: put in the agent's conversation for the person to send there. */
  sendToAgentSession(payload: unknown, options?: AgentSendOptions): Promise<void | { drafted: true }>;
}

export interface PersonProfile {
  id: string;
  name: string;
  avatarUrl: string;
  color: string | null;
  isMe: boolean;
}

export interface PageUser {
  me(): Promise<{ id: string; name: string }>;
  profiles(ids: readonly string[]): Promise<Record<string, PersonProfile>>;
  search(query: string): Promise<PersonProfile[]>;
}

export interface PageCapabilities {
  user: PageUser;
  room: PageRoom | null;
  comments: PageComments | null;
}

/** What the page asks for by name; anything else is not to be had. */
export interface PageApi {
  use<K extends keyof PageCapabilities>(name: K): Promise<PageCapabilities[K] | null>;
  use(name: string): Promise<null>;
}

export interface SheetsHost {
  caps: HostCapabilities<SheetsCapabilityName>;
  viewer: Viewer;
  abilities: RoleAbilities;
  shell: ShellConnection | null;
  bridge: ShellBridge;
  page: PageApi;
  agentStatus(): AgentStatus | null;
  onAgentStatus(listener: (status: AgentStatus) => void): () => void;
  /**
   * Hears the walkthroughs the agent sends (only on the owner's page it used last). One that comes while no listener
   * is attached waits for the first to attach, and a newer one takes its place: the page shows the latest only.
   */
  onWalkthrough(listener: (walkthrough: SheetWalkthrough) => void): () => void;
}

export const VIEWER_PRESENCE_KEY = 'person';

export const MAX_REQUEST_TEXT = 10_000;
export const MAX_REQUEST_LABEL = 1_000;
export const MAX_REQUEST_CONTEXT = 4_000;

export function agentRequestOf(payload: unknown): AgentRequest | null {
  if (!isNonNullObject(payload)) return null;
  const { label, request, ...rest } = payload as Record<string, unknown>;
  const asked = typeof request === 'string' ? request.trim() : '';
  const pressed = rest.pressed;
  const text =
    asked ||
    (typeof pressed === 'string' && pressed.trim() !== ''
      ? pressed.trim()
      : rest.isSheetBlank === true
        ? 'Fill this blank sheet.'
        : typeof rest.chartId === 'string'
          ? 'About this chart.'
          : typeof rest.ruleNumber === 'number'
            ? 'About this conditional formatting rule.'
            : typeof rest.range === 'string'
              ? 'About these cells.'
              : '');
  if (text === '') return null;
  let context: Record<string, unknown> = { ...rest };
  let contextText = JSON.stringify(context);
  while (contextText.length > MAX_REQUEST_CONTEXT && Array.isArray(context.errors) && context.errors.length > 0) {
    const leftOut = typeof context.errorsLeftOut === 'number' ? context.errorsLeftOut : 0;
    context = { ...context, errors: context.errors.slice(0, -1), errorsLeftOut: leftOut + 1 };
    contextText = JSON.stringify(context);
  }
  const title = typeof label === 'string' ? label.trim().slice(0, MAX_REQUEST_LABEL) : '';
  return {
    text: text.slice(0, MAX_REQUEST_TEXT),
    ...(title !== '' && { title }),
    ...(contextText.length <= MAX_REQUEST_CONTEXT && contextText !== '{}' && { context }),
  };
}

const personSaidByPeer = (peer: Peer): string | null => {
  const said = peer.state[VIEWER_PRESENCE_KEY];
  return typeof said === 'string' && said !== '' ? said : null;
};

const personOfPeer = (peer: Peer): string => personSaidByPeer(peer) ?? peer.id;

const colorOfPeer = (peer: Peer): string | null => {
  const who = peer.state.who;
  return isNonNullObject(who) && typeof who.c === 'string' ? who.c : null;
};

/** The engine's id for the viewer: the one the server makes their edits under. */
function viewerPersonId(sheet: SheetCapability | null, viewer: Viewer): Promise<string> {
  const fallback = personId(viewer.id);
  if (sheet === null) return Promise.resolve(fallback);
  return sheet.read({ kind: 'snapshot' }).then(
    (answer) => ('viewer' in answer ? answer.viewer.personId : fallback),
    () => fallback,
  );
}

function createPageRoom(room: RoomCapability, agent: AgentCapability | null, meAsked: Promise<string>, peersHeard: (peers: Peer[]) => void): PageRoom {
  let self: string | null = null;
  let current: Peer[] = [];
  const selfAsked = room.self().then((id) => (self = id));
  void meAsked.then((me) => room.presence({ [VIEWER_PRESENCE_KEY]: me })).catch(() => {});
  const peerOfRoom = (peer: Peer): PeerOfRoom => ({
    peer: peer.id,
    by: personOfPeer(peer),
    name: peer.name,
    isMe: peer.id === self,
    sameTab: peer.id === self,
    kind: peer.kind === 'agent' ? 'agent' : 'viewer',
    presence: peer.state,
  });
  return {
    peers: () => current.map(peerOfRoom),
    presence: (patch) => room.presence('context' in patch ? { ...patch, viewContext: patch.context } : patch),
    onPeers(listener) {
      let stopped = false;
      const hear = (peers: Peer[]): void => {
        if (stopped) return;
        current = peers;
        peersHeard(peers);
        listener({ peers: peers.map(peerOfRoom) });
      };
      const stop = room.onPeers((peers) => void selfAsked.then(() => hear(peers), () => hear(peers)));
      void selfAsked.then(() => room.peers()).then(hear, () => {});
      return () => {
        stopped = true;
        stop();
      };
    },
    // As the reference page: the ways to ask the agent (the "Ask Agent" menu, "Ask Agent to fix", a chart's, a rule's,
    // a blank sheet's) show whenever an agent can be reached at all. With none waiting, pressing one is refused
    // (`agent_unavailable`) and the page's toast says the agent isn't listening and to ask it to wait for requests here.
    async canSendToAgentSession() {
      return agent === null ? 'rejected' : 'available';
    },
    async sendToAgentSession(payload) {
      const request = agentRequestOf(payload);
      if (agent === null || request === null || !(await agent.status()).available) throw Object.assign(new Error('No agent takes requests from this page.'), { code: 'agent_unavailable' });
      const sent = await agent.send(request);
      if (sent.status === 'failed')
        throw Object.assign(new Error('The agent could not take the request.'), { code: 'agent_unavailable' });
      return sent.status === 'delivered' && sent.drafted ? { drafted: true } : undefined;
    },
  };
}

/** The people the page names, by the engine's ids for them: the viewer, those here now, and those the server knows. */
function createPageUser(viewer: Viewer, meAsked: Promise<string>, peers: () => Peer[], sheet: SheetCapability | null): PageUser {
  const peopleNamed = async (): Promise<Map<string, SheetPerson>> => {
    const answer = sheet === null ? null : await sheet.read({ kind: 'people' }).catch(() => null);
    return new Map(answer !== null && 'people' in answer ? answer.people.map((person) => [person.personId, person]) : []);
  };
  const profileOf = (id: string, me: string, people: Map<string, SheetPerson>): PersonProfile => {
    const peer = peers().find((candidate) => personOfPeer(candidate) === id);
    const person = people.get(id);
    const isMe = id === me;
    const color = peer === undefined ? (person?.color ?? null) : colorOfPeer(peer);
    return { id, name: isMe ? viewer.name : (peer?.name ?? person?.name ?? id), avatarUrl: '', color, isMe };
  };
  return {
    me: async () => ({ id: await meAsked, name: viewer.name }),
    async profiles(ids) {
      const [me, people] = await Promise.all([meAsked, peopleNamed()]);
      return Object.fromEntries(ids.map((id) => [id, profileOf(id, me, people)]));
    },
    async search(query) {
      const wanted = query.trim().toLowerCase();
      const [me, people] = await Promise.all([meAsked, peopleNamed()]);
      const ids = new Set([me, ...peers().flatMap((peer) => (peer.kind === 'person' ? (personSaidByPeer(peer) ?? []) : [])), ...people.keys()]);
      return [...ids].map((id) => profileOf(id, me, people)).filter((profile) => profile.name.toLowerCase().includes(wanted));
    },
  };
}

export async function connectSheetsHost(): Promise<SheetsHost> {
  const { caps, viewer, abilities, shell } = await connectHost(SHEETS_CAPABILITIES);
  const bridge = createShellBridge(() => shell);
  let peersNow: Peer[] = [];
  const meAsked = viewerPersonId(caps.sheet, viewer);
  const user = createPageUser(viewer, meAsked, () => peersNow, caps.sheet);
  const room =
    caps.room === null
      ? null
      : createPageRoom(caps.room, caps.agent, meAsked, (peers) => {
          peersNow = peers;
        });
  const capabilities: PageCapabilities = { user, room, comments: null };
  const page: PageApi = {
    use: async (name: string) => (name in capabilities ? capabilities[name as keyof PageCapabilities] : null),
  } as PageApi;
  let status: AgentStatus | null = null;
  const statusListeners = new Set<(status: AgentStatus) => void>();
  const hearStatus = (next: AgentStatus): void => {
    status = next;
    setAgentName(next.name);
    for (const listener of statusListeners) listener(next);
  };
  if (caps.agent !== null) {
    caps.agent.onStatus(hearStatus);
    await caps.agent.status().then(hearStatus, () => {});
  }
  const onAgentStatus = (listener: (status: AgentStatus) => void): (() => void) => {
    statusListeners.add(listener);
    return () => void statusListeners.delete(listener);
  };
  if (caps.comments !== null)
    capabilities.comments = startPageComments({ capability: caps.comments, abilities, bridge, agentStatus: status, onAgentStatus, window });
  const onWalkthrough = hearWalkthroughs(caps.sheet);
  return {
    caps,
    viewer,
    abilities,
    shell,
    bridge,
    page,
    agentStatus: () => status,
    onAgentStatus,
    onWalkthrough,
  };
}

/**
 * Listens for walkthroughs from the start, so one sent before the page has mounted its listener is not lost: it is
 * kept (the latest only) and handed to the first listener that attaches.
 */
function hearWalkthroughs(sheet: SheetCapability | null): SheetsHost['onWalkthrough'] {
  const listeners = new Set<(walkthrough: SheetWalkthrough) => void>();
  let waiting: SheetWalkthrough | null = null;
  sheet?.onWalkthrough((walkthrough) => {
    if (listeners.size === 0) {
      waiting = walkthrough;
      return;
    }
    for (const listener of listeners) listener(walkthrough);
  });
  return (listener) => {
    listeners.add(listener);
    if (waiting !== null) {
      const kept = waiting;
      waiting = null;
      listener(kept);
    }
    return () => void listeners.delete(listener);
  };
}
