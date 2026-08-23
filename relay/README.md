# Co-op relay

A Cloudflare Worker that lets two copies of the app share one run. It exists
because the app has no backend: everything else runs locally on each machine.

## What it does

`wss://<your-worker>/run/<CODE>` is a room. Everyone connected to the same code
sees the same shared state — the map, the selected quests, the spawn point, the
current objective, and the pre-raid checklist.

The state is a flat map of `path -> {value, at, by}`, merged last-write-wins with
ties broken by peer id. The relay applies that one rule to everything, so it
never needs to know what any particular field means. It keeps the latest state
per room so someone joining mid-raid catches up immediately.

No accounts, no history, no personal data. A room is a code, one run's state, and
whoever currently has it open. Rooms delete themselves after 12 idle hours.

## Deploying

Needs a free Cloudflare account. From this directory:

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

Wrangler prints the deployed URL, something like
`https://tarkov-run-sync.<your-subdomain>.workers.dev`. Put it in
[`src/lib/syncConfig.ts`](../src/lib/syncConfig.ts) as a `wss://` URL:

```ts
export const RELAY_URL = 'wss://tarkov-run-sync.<your-subdomain>.workers.dev';
```

Then `npm run release:ui` and publish a release — the relay address travels in
the frontend bundle, so your friend gets it through the update button.

Until that constant is set, the co-op panel says co-op is not configured and the
rest of the app works exactly as before.

## Running it locally

```bash
npx wrangler dev
```

That serves the relay at `http://127.0.0.1:8787` with local Durable Objects and
no Cloudflare account. Point `RELAY_URL` at `ws://127.0.0.1:8787` to test two
windows against it.

## Cost

Two players exchanging a few small messages per minute sits far inside the free
plan. The Durable Object uses the SQLite storage backend, which is the one
included for free accounts — that is what `new_sqlite_classes` in
`wrangler.toml` selects.
