# Tarkov Quest Router

Pick a map, enter a quest name, middle-click where you spawned, and get an
ordered route through that quest's objectives — plus exactly what you need to
bring.

## Running it

As a desktop app (no terminal, no localhost):

```bash
npm run dist
```

That produces `release/TarkovQuestRouter-win32-x64/TarkovQuestRouter.exe`. Keep
the folder together and double-click the .exe; make a desktop shortcut to it if
you like.

The packaged app runs a tiny server on 127.0.0.1 inside its own process. That
gives the page a normal origin, so the same upstream proxying used in
development works unchanged, and nothing is exposed to your network.

For development instead:

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Pinned to Vite 5 for Node 18.

Note: `electron-builder` cannot build here — it needs to unpack a signing bundle
containing macOS symlinks, which Windows refuses without Developer Mode. The
build uses `@electron/packager`, which needs no signing toolchain.

## Maps

Nine maps: Streets of Tarkov, Customs, Woods, Factory, Interchange, Shoreline,
Reserve, Lighthouse, Ground Zero.

The Lab is deliberately absent — tarkov.dev publishes no interactive SVG for it,
and the generator reports that rather than shipping a map it cannot place points on.

## Where the data comes from

| Data | Source | Status |
| --- | --- | --- |
| Quest names, requirements, objectives, prerequisites | [EFT Fandom wiki](https://escapefromtarkov.fandom.com) API | Working |
| PMC spawn points (with coordinates), extract lists | [sp-tarkov/server-csharp](https://github.com/sp-tarkov/server-csharp) | Working |
| Map SVGs, projection config, street labels | [tarkov-dev](https://github.com/the-hideout/tarkov-dev) + `assets.tarkov.dev` | Working |
| Objective coordinates, extract/switch positions, sniper scavs | [json.tarkov.dev](https://json.tarkov.dev/endpoints) | Working |

Remote APIs are called through a Vite dev proxy (`vite.config.ts`) so the browser
never hits a CORS wall. Everything else is generated ahead of time into
`public/data/` and `public/maps/`.

### Regenerating map data

```bash
python scripts/generate_map_data.py
```

Re-run after a game patch to refresh spawns and extracts.

## Why json.tarkov.dev, not the GraphQL API

The GraphQL API at `api.tarkov.dev/graphql` has been returning
`"GraphQL server unavailable"` since roughly 2026-07-21, tracked in
[the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474)
and [tarkov-dev#1312](https://github.com/the-hideout/tarkov-dev/issues/1312),
both still open.

On that first issue a maintainer states the GraphQL API is down but
`https://json.tarkov.dev` is alive, and that **tarkov.dev's own site runs on the
JSON API, not GraphQL**. That is why their website works while the API appears
dead.

So this app uses the JSON API, which supplies everything the router needs:
objective zones with coordinates, extracts with positions and switches, and
spawn points including sniper scavs.

Two details worth knowing:

- The datasets are large (~9.5 MB maps, ~2.2 MB tasks). They are fetched once,
  reduced to the slice a single map needs, and only that slice is cached.
- Names and descriptions come back as *translation keys*. The real strings live
  at `<path>_<language>` (e.g. `/regular/tasks_en`), which is how tarkov.dev's
  own frontend resolves them. Only three of the published JSONPath selectors
  matter here, so they are applied directly instead of adding a JSONPath
  dependency. Quests are still matched by `normalizedName`, which is language
  independent.

Extracts list their switches as *ids* into the map's switch array, so they are
looked up rather than read inline — otherwise switch waypoints never appear.

The old GraphQL client is still in `src/lib/tarkov.ts` if that API returns.

## The projection

Points are placed using tarkov.dev's own Leaflet config. For a game point
`(x, z)` with rotation `r` and transform `[a, b, c, d]`:

```
x' = x*cos(r) - z*sin(r)
y' = x*sin(r) + z*cos(r)
px = a*x' + b
py = -c*y' + d          (Leaflet's scaleY is transform[2] * -1)
```

The SVG is stretched across the pixel rect of the two `bounds` corners, so
normalising against that rect gives a position in the viewBox.

The two bounds numbers are ambiguous — `(x, z)` or `(z, x)`. Rather than assume,
the generator tries both and keeps whichever actually contains that map's real
spawn points, refusing to write a map where neither does. Every shipped map
places at least 94% of its spawns and labels inside the image (eight of nine hit
100%), and `gameToSvg`/`svgToGame` round-trip with zero error.

## Using it

- **Pick your spawn** by middle-clicking anywhere on the map, or choose a spawn
  zone from the list. Spawn zones come from the game files, so they are the
  real infiltration points, and the extracts valid *from that spawn* are
  listed. Plain left-click is left free for panning and clicking markers.
- **Add several quests** and they are routed together as one run, ordered across
  all of their objectives rather than one quest at a time.
- **Each quest gets its own colour**, hashed from its name, so the same quest is
  the same colour in the map dots, the route list and the quest chips.
- **Click any dot** to make it your current objective *and* focus that quest's
  requirements. The panel shows what the stop needs, how far it is, and what
  comes next.
- **Run requirements** collects the keys, items and outstanding prerequisites for
  every selected quest into one pre-raid checklist, each entry tagged with the
  quest that needs it.
- **Sniper scavs** are drawn as red ✕ markers, toggleable in the Map panel.
- **Transits to other maps** (e.g. Woods into Reserve) are drawn as teal `T`
  markers, listed under "Transit to other maps" in the spawn panel, and
  toggleable in the Map panel.
- **Click a quest** to see the wiki's own guide for it: the Related Quest Items
  table, the walkthrough text and the screenshots.
- Markers: `S` spawn, numbered objectives, `⚡` switch, `E` extract, `T` transit.

## Extracts

Only plain PMC exits are listed and used as route endpoints. Scav routes, co-op
exits and conditional ones (no backpack, Red Rebel, train, switch events) are
collected behind a "conditional exits" disclosure with the reason for each,
rather than hidden outright.

The restrictions live in the SPT extract list and the coordinates in the JSON
API, so the two are joined on the **untranslated** extract name — the API's
`name` is the same identifier SPT uses before translation. If filtering ever
removed every option, the unfiltered PMC list is used instead so a route always
has an end.

The same join supplies the display names. SPT only carries the untranslated ids
(`EXFIL_ZB013`, `customs_sniper_exit`, `E8_yard`), which are not what the game
shows on the exit timer, so each one is resolved through the API's translated
name — `ZB-013`, `Railroad Passage (Flare)`, `Courtyard`. When the API is
unavailable the raw id is tidied up instead of shown as-is.

## Sniper scavs

Only Streets tags a `sniper` category in the JSON API, which is why other maps
showed none. They are now derived the same way tarkov.dev derives them: from the
game's `marksman` waves, matching each wave's spawn points to the zone name on
each spawn point.

That yields Streets 9 (exactly matching the API's own count, which validates the
method), Customs 4, Shoreline 4, Lighthouse 2, Woods 1, and none on Factory,
Interchange, Reserve or Ground Zero, which genuinely have no marksman waves.

## The quest guide

The wiki's Guide section is shown as the wiki renders it, because rebuilding the
items table and image galleries from wikitext would lose them. The rendered HTML
comes from `action=parse&prop=text` and is then cleaned up:

- only the Guide section is kept (it begins with the Related Quest Items table)
- scripts, styles, iframes, inline event handlers, edit links and navboxes go
- wiki images are lazy-loaded, so the real URL is moved from `data-src` to `src`
- links are made absolute and open in a browser, not in the app window

## What the requirements panel shows

Pre-raid prep only:

- **Keys to bring** — read off the wiki page.
- **Items to buy or bring** — gear you need to buy or pack before the raid.
- **Found in raid** — quest items you only pick up mid-raid, not something to buy or bring.
- **Finish first** — prerequisite quests.

Rewards, dialogue and flavour text are deliberately omitted.

## Quest list scope

Only quests touching the selected map are searchable (121 on Customs, 100 on
Streets, out of 859 total).

Per-quest map data lives only in each wiki page's infobox, and fetching 859 pages
individually is far too slow. MediaWiki accepts 50 titles per `revisions` query,
so the index builds in ~18 requests on first run and is cached afterwards.

## How the route is built

1. Collect every objective position on the map, across all selected quests.
2. Order them with a nearest-neighbour walk from your spawn.
3. Refine with 2-opt to remove the path crossings nearest-neighbour leaves.
4. Finish at the extract:
   - If the quest names a specific exit, the route ends **there**.
   - If that extract is switch-gated, the switch is inserted as its own waypoint
     before it, so you flip it on the way instead of backtracking.
   - Otherwise the closest extract to the last objective.

Objectives with no published coordinates are listed under "Not on the map"
rather than silently dropped. Distances are straight-line, ignoring walls and
elevation — the *ordering* is the useful output, not the metre count.

## Quest progress

Kept on this machine, by tarkov.dev task id. Finished quests drop out of the
search, one button adds every quest on the map you could actually start, and
quests you add anyway are tagged `done`, `locked` or `level` rather than being
silently routed. **Finish run** closes out a raid: tick what you finished and it
is recorded.

Catching up from a standing start is the part that has to work, or none of it
gets used. Name the last quest you finished in a chain and everything behind it
is marked too, walked through the full prerequisite graph. Ticking a few hundred
boxes by hand is not a feature.

There is no public BSG API for your character, so no tool can read the game
itself — this is your own record, and it is only as current as you keep it.

[TarkovTracker](https://tarkovtracker.io) was the obvious place to keep this
instead, and its REST API does support reading and writing progress. It was
built against and then removed: TarkovTracker's own quest list comes from the
tarkov.dev **GraphQL** API, which has been returning `GraphQL server
unavailable` since 2026-07-21, so the site currently shows no tasks at all.
Nothing to tick off there, nothing to import, and no way to check what was
written. This app's data comes from json.tarkov.dev, which works, so it keeps
its own record.

### Where it is stored

Both in the renderer's `localStorage` and in a JSON file under the app's
user-data folder, whichever is newer winning at startup. Two reasons for the
file:

- **It outlives the app.** Replacing the application folder on an update leaves
  `%APPDATA%` alone, so progress survives.
- **It does not depend on the port.** `localStorage` is keyed by origin, and the
  origin includes the local server's port. That port used to be random per
  launch, which quietly emptied every cache and setting on every start — the
  quest index re-downloaded itself each time. The server now takes a fixed port
  (47821, falling back to any free one if taken) so the origin is stable.

## Running with a friend

Two people on the same raid share one run: the map, the selected quests, the
spawn point, the current objective and the pre-raid checklist. One of you presses
**Start a run**, reads the six-character code out, the other types it in. Pan and
zoom stay your own, so you can look at different corners of the map without
fighting over the view.

Keys and items become a checklist you can put your name against. Claiming one
tells your friend, so you do not both burn a slot on the same key — or both
assume the other packed it. Ticking something as packed shows on both screens.

The state is a flat map of `path -> {value, at, by}`, merged last-write-wins with
ties broken by peer id, applied identically on both clients and on the relay.
Two rules earn their keep:

- **The clock always moves forward per player.** Claiming a key and ticking it
  packed happen in the same millisecond, and a tie-break on peer id cannot
  separate one player's own two writes — the second would lose to the first and
  vanish.
- **A joiner publishes nothing until the room's state arrives.** Otherwise the
  person joining overwrites the host's setup with their own defaults on connect.

It needs the relay in [`relay/`](relay/README.md) deployed and its address in
[`src/lib/syncConfig.ts`](src/lib/syncConfig.ts). Without that the co-op panel
says so and the rest of the app is unaffected.

## Updating a released build

The app is an Electron shell around a local server that serves the built
frontend, so nearly every fix lives in that bundle and can be shipped without
reinstalling anything.

```bash
npm run release:ui
```

That builds the frontend, packs `dist` into `release/ui.zip`, and unpacks it
again with the very reader the app uses, so a bundle cannot ship in a shape the
updater chokes on. Then bump `version` in `package.json`, create a GitHub
release tagged `vX.Y.Z`, and attach `ui.zip`. The release feed is
[Milmurnir/TarkovApp](https://github.com/Milmurnir/TarkovApp), set once in
`electron/update-config.json`; blanking `repo` there switches the updater off.
A repo with no releases yet is a normal state, not an error — the app says so
and stays quiet about it on startup.

Users get a popup on startup (and a `check for updates` button in the header).
Accepting it downloads the bundle into their user-data folder; the next launch
serves that instead of the one the build shipped with, and a fresh install
always wins over a stale download.

**What this cannot update is the shell itself** — `electron/main.cjs`,
`server.cjs`, `preload.cjs`, `updater.cjs`. When one of those changes, bump
`shellVersion` in `package.json`, rebuild the installer with `npm run dist`, and
put a `requires-shell: <n>` line in the release notes. The app reads that line
and tells users to reinstall instead of offering an update that would not take
effect. The line is stripped from the notes shown in the popup.

## Layout

```
scripts/generate_map_data.py   regenerates all map data and SVGs
scripts/package-ui.mjs         packs dist into the release/ui.zip the updater pulls
electron/store.cjs             user-data JSON store, so progress outlives an update
src/lib/progress.ts            quest progress, the prerequisite walk and availability
relay/worker.js                Cloudflare Worker relaying one shared run per code
src/lib/sharedRun.ts           shared-state shape and the merge rule both sides apply
src/lib/sync.ts                relay client: one socket, reconnect, heartbeat
src/lib/useCoopRun.ts          the co-op connection, and mirroring app state onto it
electron/updater.cjs           GitHub release check, bundle download and install
electron/unzip.cjs             dependency-free zip reader used to unpack bundles
src/lib/wiki.ts                MediaWiki client + wikitext parser
src/lib/questIndex.ts          per-map quest index, batched and cached
src/lib/tarkov.ts              GraphQL client, per-map caching, offline fallback
src/lib/mapData.ts             generated per-map spawns, extracts, labels
src/lib/mapgeo.ts              projection, forward and inverse
src/lib/route.ts               nearest-neighbour + 2-opt routing
src/components/                map view, requirements, route list, current objective
```
