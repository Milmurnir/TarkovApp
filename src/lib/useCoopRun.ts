import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHECK_PREFIX, emptyRunState, makeFields, toRunState,
  type CheckEntry, type Fields, type Peer, type RunState,
} from './sharedRun';
import { RunSync, isSyncConfigured, localPeerId, type SyncStatus } from './sync';
import { makeRunCode, normalizeRunCode } from './syncConfig';

const NAME_KEY = 'tarkov-coop-name';
const CODE_KEY = 'tarkov-coop-code';
const FRIENDS_KEY = 'tarkov-coop-friends';

/** Someone you have run with before, so rejoining is one click. */
export interface Friend {
  id: string;
  name: string;
  code: string;
  lastSeen: number;
}

export interface CoopNotice {
  id: number;
  text: string;
}

export interface CoopRun {
  configured: boolean;
  /** Raw shared fields, so callers can tell "absent" from "set to null". */
  fields: Fields;
  status: SyncStatus;
  /** True once the room's existing state has arrived and it is safe to publish. */
  ready: boolean;
  statusDetail: string | null;
  code: string | null;
  peerId: string;
  name: string;
  peers: Peer[];
  /** The other players, excluding yourself. */
  others: Peer[];
  state: RunState;
  notices: CoopNotice[];
  setName: (name: string) => void;
  host: () => string;
  join: (code: string) => void;
  leave: () => void;
  publish: (values: Record<string, unknown>) => void;
  /** Changes part of a checklist entry; the rest is kept as it currently is. */
  claim: (label: string, patch: Partial<CheckEntry>) => void;
  friends: Friend[];
  forgetFriend: (id: string) => void;
  dismissNotice: (id: number) => void;
}

function readFriends(): Friend[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FRIENDS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Owns the co-op connection and the shared state it carries.
 *
 * Deliberately does not touch the app's own state: mirroring is a separate
 * concern, handled by useMirroredField, so the rules for who wins stay in one
 * readable place.
 */
export function useCoopRun(): CoopRun {
  const peerId = useMemo(() => localPeerId(), []);
  const [name, setNameState] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>('off');
  const [ready, setReady] = useState(false);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [fields, setFields] = useState<Fields>({});
  const [notices, setNotices] = useState<CoopNotice[]>([]);
  const [friends, setFriends] = useState<Friend[]>(readFriends);

  const sync = useRef<RunSync | null>(null);
  const noticeId = useRef(1);
  /** Names by peer id, so a notice can say who did something. */
  const peerNames = useRef(new Map<string, string>());
  /** Peers already announced, so presence updates do not repeat themselves. */
  const announced = useRef(new Set<string>());

  const state = useMemo(() => toRunState(fields), [fields]);

  const notice = useCallback((text: string) => {
    setNotices((current) => [...current, { id: noticeId.current++, text }].slice(-4));
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  // Notices are a nudge, not a log; they clear themselves.
  useEffect(() => {
    if (notices.length === 0) return;
    const timer = setTimeout(() => setNotices((current) => current.slice(1)), 6000);
    return () => clearTimeout(timer);
  }, [notices]);

  const start = useCallback((runCode: string) => {
    sync.current?.close();
    setFields({});
    setPeers([]);
    setReady(false);
    setStatusDetail(null);
    announced.current = new Set();

    const client = new RunSync(runCode, peerId, name, {
      onReady: () => setReady(true),
      onStatus: (next, detail) => {
        setStatus(next);
        setStatusDetail(detail ?? null);
      },
      onPeers: (list) => {
        for (const peer of list) peerNames.current.set(peer.id, peer.name);
        // Presence is re-sent whenever anyone's name changes, so "joined" has
        // to mean the first time we see them, not every time we hear about them.
        for (const peer of list) {
          if (peer.id === peerId || announced.current.has(peer.id)) continue;
          announced.current.add(peer.id);
          notice(`${peer.name || 'A friend'} joined the run.`);
        }
        announced.current = new Set(
          [...announced.current].filter((id) => list.some((peer) => peer.id === id)),
        );
        setPeers(list);
      },
      onFields: (next, changed, initial) => {
        setFields({ ...next });
        // Catching up on a run in progress is not a stream of announcements.
        if (initial) return;
        for (const path of changed) {
          const field = next[path];
          // Only somebody else's changes are worth announcing.
          if (!field || field.by === peerId) continue;
          const who = peerNames.current.get(field.by) || 'Your friend';

          if (path.startsWith(CHECK_PREFIX)) {
            const label = path.slice(CHECK_PREFIX.length);
            const entry = field.value as CheckEntry | null;
            if (entry?.claimedBy && entry.claimedBy !== peerId) {
              notice(`${entry.claimedName || who} brings ${label}.`);
            }
            continue;
          }
          if (path === 'spawn' && field.value) notice(`${who} set the spawn point.`);
          if (path === 'map') notice(`${who} switched to a different map.`);
        }
      },
    });

    sync.current = client;
    client.connect();
    setCode(runCode);
    localStorage.setItem(CODE_KEY, runCode);
  }, [name, notice, peerId]);

  const host = useCallback(() => {
    // A run code is generated fresh; there is nothing to reserve up front.
    const runCode = makeRunCode();
    start(runCode);
    return runCode;
  }, [start]);

  const join = useCallback((raw: string) => {
    const runCode = normalizeRunCode(raw);
    if (runCode.length < 4) {
      setStatus('error');
      setStatusDetail('That run code looks too short.');
      return;
    }
    start(runCode);
  }, [start]);

  const leave = useCallback(() => {
    sync.current?.close();
    sync.current = null;
    setCode(null);
    setFields({});
    setPeers([]);
    setReady(false);
    setStatus('off');
    setStatusDetail(null);
    localStorage.removeItem(CODE_KEY);
  }, []);

  const publish = useCallback((values: Record<string, unknown>) => {
    const client = sync.current;
    if (!client) return;
    const outgoing = makeFields(peerId, values);
    client.push(outgoing);
    setFields({ ...client.fields });
  }, [peerId]);

  const claim = useCallback((label: string, patch: Partial<CheckEntry>) => {
    // Read the entry that exists right now, not the one the button was
    // rendered from: claiming a key and ticking it packed happen in the same
    // tick, and the second click would otherwise undo the first.
    const path = `${CHECK_PREFIX}${label}`;
    const current = (sync.current?.fields[path]?.value ?? null) as CheckEntry | null;
    const merged: CheckEntry = {
      claimedBy: current?.claimedBy ?? null,
      claimedName: current?.claimedName ?? null,
      packed: current?.packed ?? false,
      ...patch,
    };
    publish({ [path]: merged });
  }, [publish]);

  const setName = useCallback((next: string) => {
    const trimmed = next.slice(0, 40);
    setNameState(trimmed);
    localStorage.setItem(NAME_KEY, trimmed);
    sync.current?.setName(trimmed);
  }, []);

  // Anyone you have actually shared a run with is worth remembering.
  useEffect(() => {
    if (!code) return;
    const others = peers.filter((p) => p.id !== peerId && p.name);
    if (others.length === 0) return;

    setFriends((current) => {
      const byId = new Map(current.map((f) => [f.id, f]));
      for (const peer of others) {
        byId.set(peer.id, { id: peer.id, name: peer.name, code, lastSeen: Date.now() });
      }
      const next = Array.from(byId.values()).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 10);
      localStorage.setItem(FRIENDS_KEY, JSON.stringify(next));
      return next;
    });
  }, [peers, code, peerId]);

  const forgetFriend = useCallback((id: string) => {
    setFriends((current) => {
      const next = current.filter((f) => f.id !== id);
      localStorage.setItem(FRIENDS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => () => sync.current?.close(), []);

  const others = useMemo(() => peers.filter((p) => p.id !== peerId), [peers, peerId]);

  return {
    configured: isSyncConfigured(),
    fields: code ? fields : {},
    status, ready, statusDetail, code, peerId, name, peers, others,
    state: code ? state : emptyRunState(),
    notices, setName, host, join, leave, publish, claim,
    friends, forgetFriend, dismissNotice,
  };
}

/**
 * Keeps one piece of the app's state in step with the shared run.
 *
 * The rule that stops the two sides fighting: a shared value that differs from
 * what we last took from the run is somebody else's change, so we adopt it.
 * Anything else that differs is our own change, so we publish it. Once both
 * sides agree, neither writes again.
 */
export function useMirroredField<T>(
  run: CoopRun,
  path: string,
  local: T,
  apply: (value: T) => void,
  options: { enabled?: boolean } = {},
): void {
  // Publishing before the room's state has arrived is how a joiner wipes the
  // host's setup, so mirroring waits for the snapshot.
  const enabled = options.enabled !== false && Boolean(run.code) && run.ready;
  const lastAdopted = useRef<string | null>(null);

  // The run object is rebuilt every render; refs keep it out of the dependency
  // list so this effect only runs when a value actually moves.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const publishRef = useRef(run.publish);
  publishRef.current = run.publish;

  // Leaving a run must not make the next one adopt stale values.
  useEffect(() => {
    if (!enabled) lastAdopted.current = null;
  }, [enabled]);

  // Reading the raw field rather than the derived state is what lets "nobody
  // has set this yet" differ from "somebody deliberately cleared it" — the
  // first must never be adopted over a local value, the second must.
  const field = run.fields[path];
  const present = field !== undefined;
  const sharedJson = present ? JSON.stringify(field.value ?? null) : '';
  const localJson = JSON.stringify(local ?? null);

  useEffect(() => {
    if (!enabled) return;

    if (present && sharedJson === localJson) {
      lastAdopted.current = sharedJson;
      return;
    }
    if (present && sharedJson !== lastAdopted.current) {
      lastAdopted.current = sharedJson;
      applyRef.current(JSON.parse(sharedJson) as T);
      return;
    }
    if (!present || sharedJson !== localJson) {
      publishRef.current({ [path]: JSON.parse(localJson) });
    }
  }, [enabled, present, sharedJson, localJson, path]);
}
