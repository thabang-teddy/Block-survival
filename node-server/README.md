# Block Survival — node-server

A Node.js duplicate of the Laravel site in `../server`, built on **AdonisJS 7**
(Inertia + React, Lucid on SQLite, VineJS). Same pages, same sign-in gates, same
admin section, same JSON API — with one difference that matters: **the server hosts
the game**. In the Laravel app one player's browser runs the world and the others
join it over WebRTC; here every world runs on the server and every player is a
client on a WebSocket.

## Run it

```bash
cd node-server
npm install
cp .env.example .env && node ace generate:key
node ace migration:run
node ace admin:sync            # optional: creates ADMIN_EMAIL / ADMIN_PASSWORD from .env
npm run dev                    # http://localhost:3333 (Vite runs inside the server)
```

In development the sign-in page offers a one-click guest account (approved on the
spot). Tests: `npm test` runs the server's Japa suite and the game's Vitest suite;
`npm run typecheck` checks both halves.

Production: `node ace build`, then in `build/`: `npm ci --omit=dev`, copy a `.env`,
`node ace migration:run --force`, `node ace admin:sync`, `node bin/server.js`.

## How the game is hosted

```
browser ──POST /api/play { world }──────────────▶ RoomRegistry.openOwn / openGlobal
        ◀─{ room, ticket }──────────────────────  (loads the save, starts a HostSim)
        ──WS /ws?ticket=…──▶ socket_server ──▶ GameRoom.connect
        ──hello────────────▶                     ──▶ HostSim.addPlayer
        ◀─welcome (seed, world diff, spawn)──────
        ──input 30 Hz, break / place / craft / fire…──▶ validate ──▶ HostSim.apply
        ◀─snapshots 20 Hz, block edits, private state─ GameRoom.tick (30 Hz)
```

- `inertia/sim/HostSim.ts` — the authoritative simulation of one room: the host half
  of the Laravel client's `Game.ts`, with every player remote. No DOM, no three.js;
  it imports the same world / items / physics / entities code the browser runs.
- `inertia/sim/validate.ts` — every client message is checked before the sim sees it.
- `app/game/game_room.ts` — ticks a HostSim, fans out snapshots, re-checks each
  player's access every 30 s, rate-limits sockets, and saves the world: on the
  autosave clock when something changed, at dawn, when a player leaves, when the
  owner asks, and when the room closes.
- `app/game/registry.ts` — the running rooms: one per player's own world, one global
  world. An empty room saves and closes after a minute. Tickets are single-use and
  expire after 30 s. Every world is saved when the process shuts down.
- `inertia/game/Game.ts` — the browser side: moves its own player, renders, and
  mirrors everything else from the server.

A player's own world keeps running while their invited friends are in it, even after
the owner leaves. The owner resumes where they stood; other players come back with
their gear at their spawn point (as in the Laravel app).

## What is the same as the Laravel app

- The database schema (tables and columns of `server/database/migrations`, collapsed
  into one migration per table; `auth_access_tokens` replaces Sanctum's
  `personal_access_tokens`). Saves are the same gzipped v3 JSON.
- Every page URL and API route, and their JSON shapes (`{ message }`, and
  `errors: { field: [...] }` on a 422), so the Flutter client can talk to it.
- Rate limits, CSRF (the `XSRF-TOKEN` cookie; bearer-token calls without a session
  are exempt), the three access gates, `admin:sync` and `user:make-admin`.

## What is different

- `POST /api/play` and `POST /api/rooms/:code/join` hand out socket tickets; `/ws`
  is the game socket. Protocol version 2 (the peer-to-peer hosts spoke 1).
- The global world is a server room, so its peer-to-peer queue (`/api/global/join`,
  `claim`) answers 409 — the Flutter client can still host its own world
  peer-to-peer (rooms, signalling and world uploads work as before), but cannot enter
  the global world until it learns the socket protocol. Uploading the global world,
  or an own world while it runs on the server, is refused.
- Scores are recorded by the server for every player (at dawn and on death); the web
  client no longer posts them.
- Sessions live in an encrypted cookie for 30 days instead of Laravel's database
  sessions with "remember me".

## Hosting

This needs a long-running Node 24 process that can accept WebSockets — a VPS or a
platform such as Fly.io, Render or Railway, behind a proxy that passes `Upgrade`
headers. It does not run on the cPanel shared plan the Laravel app deploys to
(`docs/cpanel-go-live.md`). All rooms live in one process's memory, so run a single
instance.

Known limits:

- Movement is client-authoritative (as it was with a browser host): a modified
  client can teleport. Actions are range-checked on the server.
- Existing Laravel accounts are not imported: passwords are hashed with scrypt here
  and bcrypt there. Saves can be copied row for row.
