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
  entities/  dropped items; A* pathfinding over standing cells; zombie sim (variants, night
             spawning, chase/attack AI, block breaking)
  game/      Game (the simulation) and the DayNight clock
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
**E** inventory & crafting · **F** use workbench / set respawn at a bed · hold **right** with the rifle to aim ·
Esc release mouse.

Dev console helpers: `__game.dayNight.time = 299` jumps to the first sunset.

Dev builds expose `window.__game` and `window.__gl` for debugging in the console.
