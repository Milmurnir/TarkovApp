import { mergeFields, type Fields, type Peer } from './sharedRun';
import { RELAY_URL } from './syncConfig';

/**
 * Client for the co-op relay.
 *
 * Deliberately small: one socket, one room, reconnect with backoff, and a
 * heartbeat so a dead connection is noticed rather than silently swallowing
 * everything the other player does. State merging lives in sharedRun.ts and is
 * shared with the relay's own rule.
 */

export type SyncStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface SyncEvents {
  /** `initial` marks the room's existing state, which is not news. */
  onFields: (fields: Fields, changed: string[], initial: boolean) => void;
  onPeers: (peers: Peer[]) => void;
  onStatus: (status: SyncStatus, detail?: string) => void;
  /** The room's existing state has arrived; local values may now be published. */
  onReady: () => void;
}

const HEARTBEAT_MS = 25000;
/** Two missed heartbeats and the socket is treated as dead. */
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_MS * 2 + 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function isSyncConfigured(): boolean {
  return RELAY_URL.trim().length > 0;
}

export class RunSync {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;

  /** Everything known about the run, merged from both sides. */
  fields: Fields = {};

  constructor(
    readonly code: string,
    readonly peerId: string,
    private name: string,
    private readonly events: SyncEvents,
  ) {}

  connect(): void {
    if (!isSyncConfigured()) {
      this.events.onStatus('error', 'No relay is configured for this build.');
      return;
    }
    this.closed = false;
    this.open();
  }

  private open(): void {
    this.events.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(`${RELAY_URL.replace(/\/$/, '')}/run/${this.code}`);
    } catch (error) {
      this.scheduleReconnect(String(error));
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.events.onStatus('connected');
      this.send({ type: 'hello', id: this.peerId, name: this.name });
      this.startHeartbeat();
      // Anything changed while disconnected still has to reach the other side.
      if (Object.keys(this.fields).length > 0) this.send({ type: 'patch', fields: this.fields });
    };

    socket.onmessage = (event) => {
      this.touch();
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.type === 'snapshot' || message.type === 'patch') {
        const { fields, changed } = mergeFields(this.fields, message.fields ?? {});
        this.fields = fields;
        if (changed.length > 0) this.events.onFields(fields, changed, message.type === 'snapshot');
        // Until the room's own state has arrived there is nothing to compare
        // against, and publishing local defaults would wipe whatever the person
        // who started the run had already set up.
        if (message.type === 'snapshot') this.events.onReady();
        return;
      }
      if (message.type === 'presence') {
        this.events.onPeers(Array.isArray(message.peers) ? message.peers : []);
        return;
      }
      if (message.type === 'error') {
        this.events.onStatus('error', String(message.message ?? ''));
      }
    };

    socket.onclose = (event) => {
      // 4xx-style closes are the relay refusing us; retrying would just loop.
      if (event.code === 1008 || event.code === 4409) {
        this.events.onStatus('error', event.reason || 'The relay refused the connection.');
        this.closed = true;
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose always follows, and carries the useful information.
    };
  }

  /** Publishes local changes. They are applied locally first, so the UI never waits. */
  push(fields: Fields): void {
    const { fields: merged, changed } = mergeFields(this.fields, fields);
    this.fields = merged;
    if (changed.length === 0) return;

    const payload: Fields = {};
    for (const path of changed) payload[path] = merged[path];
    this.send({ type: 'patch', fields: payload });
  }

  setName(name: string): void {
    this.name = name;
    this.send({ type: 'hello', id: this.peerId, name });
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.socket?.close();
    this.socket = null;
    this.events.onStatus('off');
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), HEARTBEAT_MS);
    this.touch();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.heartbeat = null;
    this.watchdog = null;
  }

  /** Restarts the silence timer; a socket that stops answering is a dead one. */
  private touch(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.socket?.close(), HEARTBEAT_TIMEOUT_MS);
  }

  private scheduleReconnect(detail?: string): void {
    this.stopHeartbeat();
    this.socket = null;
    if (this.closed) return;

    this.events.onStatus('reconnecting', detail);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;
    this.retry = setTimeout(() => this.open(), delay);
  }
}

/** Stable id for this installation, so tie-breaks and claims survive restarts. */
export function localPeerId(): string {
  const KEY = 'tarkov-peer-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(KEY, id);
  }
  return id;
}
