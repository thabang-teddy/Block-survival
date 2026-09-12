# Block Survival — game client

Vite + React 19 + TypeScript, three.js via React Three Fiber. See `../GAME_PROMPT.md` for the full spec and build phases.

```bash
npm install        # uses .npmrc legacy-peer-deps (R3F's optional Expo peers)
npm run dev        # http://localhost:5173
npm test           # vitest unit tests (world, mesher, raycast, physics)
npm run build
```

## Layout

```
src/
  world/     palette (from Design/blender_scripts/blocks.py), seeded noise, island generator
             (port of islands.py), 16³ chunk store, culled mesher with vertex colours + AO, DDA raycast
  physics/   swept AABB vs voxels, player controller (movement, stamina, health)
  input/     pointer-lock mouse + keyboard, edge-triggered event queue
  items/     item registry (blocks, tools, weapons, break times, drops), recipes + crafting, 36-slot inventory
  entities/  dropped items; loot crates; A* pathfinding over standing cells; zombie sim
             (variants, night spawning, chase/attack AI, block breaking)
  game/      Game (the simulation, host-authoritative), Avatar (per-player state), DayNight clock, score
  net/       protocol (msgpackr messages, room codes), PeerJS transport, HostSession / ClientSession,
             SnapshotBuffer (100 ms interpolation)
  render/    ChunkRenderer, PropRenderer (torch/workbench/bed GLBs + torch light pool),
             ZombieRenderer (skinned clones), Lighting (day/night palettes), Effects (bloom),
             CombatFx, first-person ViewModel, third-person PlayerBody, GLB cache, R3F Scene
  game/      Game — the simulation, ticked once per frame; React never holds sim state
  state/     zustand UI store (HUD snapshot only)
  ui/        HUD (React DOM over the canvas)
public/assets/  copies of Design/Characters and Design/Assets
```

## Controls

WASD move · Shift sprint · Space jump · **V** first/third person · mouse look ·
hold **left** dig / swing · **right** place · **1–9** hotbar · **Q** drop · **R** reload ·
**E** inventory & crafting · **F** use workbench / set respawn at a bed / take loot · hold **right** with the
rifle to aim · **Tab** scoreboard · Esc pause (resume by clicking, or Restart).

Dying leaves your inventory in a crate where you fell and respawns you after 5 s at your bed
(or the build pad). Score = nights survived × 100 + kills × 5; the best score is kept in localStorage.

## Accounts, leaderboard, cloud saves (optional)

Run the Laravel API in `../server` (`php artisan serve --port=8000`); Vite proxies `/api` to it.
Sign in from the main menu: your score is posted at every dawn and on death, the world autosaves to
your cloud slot at dawn (or from the pause screen), and **Continue cloud save** restores it — block
edits, props, clock, inventory and respawn point. Hosting also registers the room code with the API.

## Multiplayer

Up to 4 players, peer-to-peer over WebRTC (PeerJS DataChannels, public PeerJS signalling for now).
**Host a game** registers a 6-letter room code; friends **Join** with it. The host's browser runs the
authoritative world (edits, zombies, drops, crates, clock, damage, inventories); clients move their
own player locally and send inputs at 30 Hz, everything else comes from 20 Hz snapshots rendered
100 ms behind. Solo play is just a host with no peers. If the host leaves, the match ends.

Dev console helpers: `__game.dayNight.time = 299` jumps to the first sunset.

Dev builds expose `window.__game` and `window.__gl` for debugging in the console.
