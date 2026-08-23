/**
 * Relay for co-op runs.
 *
 * One Durable Object per run code. It keeps the latest shared state so someone
 * joining late catches up mid-raid, and forwards every change to the others in
 * the room. It stores no accounts and no history: a room is a code, the state of
 * one run, and whoever currently has it open.
 *
 * The shared state is deliberately a flat map of path -> {value, at, by}. That
 * makes merging one rule applied everywhere — last write wins, ties broken by
 * peer id — so the relay never needs to know what a "spawn" or a "checklist
 * item" actually is.
 */

/** Rooms idle longer than this are dropped; a run does not outlive a session. */
const ROOM_TTL_MS = 1000 * 60 * 60 * 12;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_FIELDS = 500;
const MAX_PEERS = 8;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }

    const match = /^\/run\/([A-Za-z0-9]{4,16})$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });

    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('This endpoint speaks WebSocket only.', { status: 426 });
    }

    // Room codes are case-insensitive: people read them out loud to each other.
    const id = env.ROOMS.idFromName(match[1].toUpperCase());
    return env.ROOMS.get(id).fetch(request);
  },
};

export class RunRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const peers = this.ctx.getWebSockets();
    if (peers.length >= MAX_PEERS) {
      return new Response('This run already has the maximum number of players.', { status: 409 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    // Hibernation: the room survives eviction between messages, which matters
    // when two people leave the app open through a long raid.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null, name: null });

    const snapshot = (await this.ctx.storage.get('fields')) ?? {};
    server.send(JSON.stringify({ type: 'snapshot', fields: snapshot }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) {
      ws.send(JSON.stringify({ type: 'error', message: 'Message rejected: too large.' }));
      return;
    }

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (message.type === 'hello') {
      ws.serializeAttachment({
        id: String(message.id ?? '').slice(0, 64),
        name: String(message.name ?? '').slice(0, 40),
      });
      await this.announcePresence();
      return;
    }

    if (message.type === 'patch') {
      const accepted = await this.merge(message.fields);
      if (Object.keys(accepted).length === 0) return;

      const payload = JSON.stringify({ type: 'patch', fields: accepted });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer !== ws) peer.send(payload);
      }
    }
  }

  async webSocketClose(_ws, _code, _reason, _clean) {
    await this.announcePresence();
  }

  async webSocketError() {
    await this.announcePresence();
  }

  /**
   * Applies incoming fields to the stored state, returning only those that
   * actually won. Echoing back a rejected field would fight the sender's own
   * newer value.
   */
  async merge(incoming) {
    if (!incoming || typeof incoming !== 'object') return {};

    const fields = (await this.ctx.storage.get('fields')) ?? {};
    const accepted = {};

    for (const [path, field] of Object.entries(incoming)) {
      if (typeof path !== 'string' || path.length > 200) continue;
      if (!field || typeof field !== 'object' || typeof field.at !== 'number') continue;
      if (!(path in fields) && Object.keys(fields).length >= MAX_FIELDS) continue;

      const current = fields[path];
      const wins = !current
        || field.at > current.at
        || (field.at === current.at && String(field.by) > String(current.by));

      if (wins) {
        fields[path] = { value: field.value, at: field.at, by: String(field.by ?? '') };
        accepted[path] = fields[path];
      }
    }

    if (Object.keys(accepted).length > 0) {
      await this.ctx.storage.put('fields', fields);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
    return accepted;
  }

  async announcePresence() {
    const peers = this.ctx.getWebSockets()
      .map((peer) => peer.deserializeAttachment())
      .filter((peer) => peer && peer.id);

    const payload = JSON.stringify({ type: 'presence', peers });
    for (const peer of this.ctx.getWebSockets()) peer.send(payload);
  }

  /** Nothing here is worth keeping once a run has gone quiet for half a day. */
  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}
