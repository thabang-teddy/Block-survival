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

Punch logs, craft planks → sticks → workbench → a wooden pickaxe by hand; everything else (stone and
iron pickaxes, sword, glass, walls, torches, a bed and finally a rifle) needs the workbench. The first sunset is at 5:00 — build walls first.
Every floating island has a glowing **updraft** beside its rim: stand in it and hold **Space** to rise,
**Shift** to sink, or hover — then step off onto the island and put a bed there to respawn up high.
Dying leaves your gear in a crate where you fell; you respawn at your bed after 5 s.
Score = nights survived × 100 + kills × 5.

## Multiplayer

**Host for friends** registers a 6-letter room code (the WebRTC handshake goes through a polled
mailbox at `/api/rooms/{code}/signal[s]` — plain HTTP, no socket server — then a direct DataChannel).
Rooms are **invite-only**: the host opens the pause screen, picks players by name and invites them;
the invitation shows up in their lobby within a few seconds and **Accept** drops them into the game.
Nobody else can resolve the code or use the mailbox — not even with the code in hand. The host's
browser runs the authoritative world; clients move locally and mirror everything else from 20 Hz
snapshots interpolated 100 ms behind. Up to 4 players. If the host leaves, the match ends.

## Accounts

The app is sign-in only: an admin creates every account in `/admin/users` (there is no
registration or password reset, and any password is accepted), approves each new PC the first time
it signs in, and can limit sign-in to operating hours. Every player has **two worlds** — **My world**, generated
from a random seed the first time they play, and their own copy of the **Global world**, the classic
seed-11 map everyone shares (same terrain for all, builds are per player). The host's
score is posted at every dawn and on death, and both **Play solo** and **Host for friends** continue the
chosen world — block edits, props, clock, where you stood, health, ammo, inventory, respawn point, live
zombies, drops and loot crates, plus the gear of every friend who has played in it (they get it
back when they rejoin). It saves itself every minute when something changed, at dawn, from the
pause screen, when you go back to the menu and when the tab closes (a beacon carries the last
packed copy). **Start over** on a world card (or the admin's **Reset both worlds**) wipes it — a new own world gets a new seed.

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
