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
  physics/   swept AABB vs voxels, first-person controller
  input/     pointer-lock mouse + keyboard, edge-triggered event queue
  render/    ChunkRenderer (imperative three.js), R3F Scene, Survivor model
  game/      Game — the simulation, ticked once per frame; React never holds sim state
  state/     zustand UI store (HUD snapshot only)
  ui/        HUD (React DOM over the canvas)
public/assets/  copies of Design/Characters and Design/Assets
```

Dev builds expose `window.__game` and `window.__gl` for debugging in the console.
