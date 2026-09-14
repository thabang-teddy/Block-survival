# Block Survival

A voxel zombie-survival game (Minecraft-style) in the browser: an infinite, seeded world of
rolling ground with floating islands in the sky (streamed in chunks as you walk), first/third
person, crafting, a 10-minute day/night cycle with zombies that path and break walls, sword and
rifle combat, death and score, four-player peer-to-peer co-op, accounts with a leaderboard and
cloud saves.

One **Laravel 13** application with **Inertia.js + React** as the frontend: the game is an Inertia
page; menu data (signed-in user, leaderboard, cloud save) arrives as props; the running game talks to
`/api/*` with the same session. Laravel serves the page, auth, rooms, scores and saves.

```
app/            controllers (PlayController → Inertia 'Play'; AuthController; Api/*), models
routes/web.php  the page, session auth, and the /api JSON routes
resources/js/   the game (React + three.js via React Three Fiber) — see the layout below
public/assets/  GLB characters, props, blocks (from Design/)
Design/         Blender generators, concept art, the raw assets
GAME_PROMPT.md  the spec the game was built from
```

## Run it

```bash
composer install
cp .env.example .env && php artisan key:generate    # SQLite by default
php artisan migrate
npm install
npm run dev                                          # Vite (HMR) — keep it running
php artisan serve --port=8000                        # open http://localhost:8000
```

Production (cPanel, PHP 8.4): CI builds `deploy/staging` / `deploy/production` from `staging` /
`master` (vendor + Vite bundle committed); on the server run `deploy/cpanel-deploy.sh <app-dir>`,
which migrates only when something is pending. The full plan is [docs/cpanel-go-live.md](docs/cpanel-go-live.md).

Tests: `php artisan test` (page, session auth, every /api endpoint) and `npm test` (70 vitest tests
for the world, mesher, physics, items, zombies, crates, netcode).

## Playing

WASD move · Shift sprint · Space jump · **V** first/third person · mouse look · hold **left** dig /
swing · **right** place, or aim with the rifle · **1–9** hotbar · **Q** drop · **R** reload ·
**E** inventory & crafting · **F** workbench / set respawn at a bed / take loot · **Tab** scoreboard ·
Esc pause.

Punch logs, craft planks → sticks → workbench → pickaxes; mine cobble, coal and iron; craft a sword,
glass, walls, torches, a bed and finally a rifle. The first sunset is at 5:00 — build walls first.
Dying leaves your gear in a crate where you fell; you respawn at your bed after 5 s.
Score = nights survived × 100 + kills × 5.

## Multiplayer

**Host a game** registers a 6-letter room code (the WebRTC handshake goes through a polled
mailbox at `/api/rooms/{code}/signal[s]` — plain HTTP, no socket server — then a direct DataChannel); friends pick it from the lobby's **Join a game** list. The host's browser runs the authoritative world;
clients move locally and mirror everything else from 20 Hz snapshots interpolated 100 ms behind.
Up to 4 players. If the host leaves, the match ends.

## Accounts

The app is sign-in only: an admin creates every account in `/admin/users` (there is no
registration or password reset, and any password is accepted), approves each new PC the first time
it signs in, and can limit sign-in to operating hours. Every player has **one world**: the host's
score is posted at every dawn and on death, the world autosaves at dawn (or from the pause screen),
and both **Play solo** and **Host a game** continue it — block edits, props, clock, inventory and
respawn point. **Start over** in the lobby (or the admin's **Reset world**) wipes it.

## Game source layout (`resources/js`)

```
app.tsx      Inertia bootstrap          Pages/Play.tsx   the page (Scene + Hud)
world/       palette, seeded noise, per-chunk terrain generator (ground heightmap + spawn pad,
             sky-island field, island generator ported from Design/blender_scripts/islands.py),
             16³ chunk store with column streaming, culled mesher with vertex colours + AO, DDA raycast
physics/     swept AABB vs voxels, player controller
entities/    drops, loot crates, A* pathfinding, zombie sim (variants, spawning, AI, block breaking)
items/       registry, recipes + crafting, inventory
game/        Game (the simulation, host-authoritative), Avatar, DayNight, score
net/         protocol (msgpackr), WebRTC transport + polling signaller, Host/ClientSession, SnapshotBuffer, api client
render/      chunk/prop/zombie/remote-player renderers, view-model, lighting, bloom, GLB cache
ui/          HUD, crafting panel, main menu
state/       zustand UI store (React never holds sim state)
```

Dev builds expose `window.__game` (and `__gl`, `__composer`) in the console; `__game.dayNight.time = 299`
jumps to the first sunset.
