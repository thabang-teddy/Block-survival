# Ticket #11 — Make an infinite world

> Paste everything below this line into Claude Code (or another coding agent) from the
> repository root.

---

You are working in the Block Survival repo (Laravel + Inertia/React + three.js, plain-TS sim).
Read `CLAUDE.md` first and follow its branch flow: commit on `dev`, never push to `staging`/`master`.
`npm test`, `npm run typecheck` and `php artisan test` must pass before you open a PR.

Before writing code, read these files end to end — the design must fit them:
- `resources/js/world/chunkStore.ts` (World, 16³ Uint8 chunks, `bounds`, `edits`, `trackEdits`)
- `resources/js/world/islandGen.ts` (current single-island generator, ported from `Design/blender_scripts/islands.py`)
- `resources/js/world/noise.ts`, `mesher.ts`, `palette.ts`
- `resources/js/render/ChunkRenderer.ts`, `PropRenderer.ts`
- `resources/js/game/Game.ts` (constructor, `applyBlockEdits`, `worldEdits`, the `bounds.minY + 1` bedrock checks ~L534 and ~L825, `IslandInfo.spawn`/`padHeight` usage)
- `resources/js/entities/zombies.ts` (`grassTop` walks `bounds.maxY → minY`), `pathfinding.ts`
- `resources/js/net/protocol.ts` (`welcome` carries `seed` + `spawn` + `edits`), `HostSession.ts`, `ClientSession.ts`
- `resources/js/net/api.ts` (`SaveData` v1 = `{version, edits, spawn, ...}`)
- `game docs/GAME_PROMPT.md` §1 — constraint 2 ("one island, not an infinite world") is what this ticket **replaces**; update that doc when done.

## 1. Goal

The world is currently one 56-block floating island generated up front and meshed in full.
Replace it with a world that extends without limit in x and z, made of two layers:
**endless ground terrain** below and **floating islands** scattered in the sky above it.
**The player starts on the ground** and can walk/build anywhere, climb or bridge up to the
islands, and never hit a wall or a pre-generated boundary. Everything must be deterministic
from a single `seed` so host, clients and reloads all see the same terrain.

## 2. World shape (decision made — do not re-litigate)

**Vertical layout** (block y, chunk `cy` band is fixed, e.g. `cy` 0..7 → y 0..127):
- `y = 0`: bedrock, unbreakable. Nothing exists below; no void.
- Ground surface: `SEA_LEVEL = 32`, terrain height roughly 24–56 from 2-D fractal noise
  (reuse `PerlinNoise`/`makeN2` from `islandGen.ts`). Columns: stone up to `h−4`, dirt to
  `h−1`, grass on top; sand where `h ≤ SEA_LEVEL + 1`; water fills from `h+1` to `SEA_LEVEL`.
  Gentle rolling hills with occasional cliffs (add a second, lower-frequency ridge noise);
  no caves, no biomes, no ores in this ticket — keep it YAGNI.
- **Spawn pad on the ground at the origin.** Within `padRadius = 8` of `(0, 0)` the ground
  is flattened to the median height of the ring just outside it (same rule as the island pad
  today), forced ≥ `SEA_LEVEL + 2` so it is never flooded, with grass on top; a smooth blend
  ring of 4 blocks eases into the natural terrain. No water within 12 blocks of the origin
  (push the water noise up there). Player spawns standing on the pad centre, facing +Z.
- Ground trees: same `addTree` shape, density ~0.006 per grass column, not within 2 blocks
  of water and not on the pad or its blend ring.
- Floating islands: placed on a jittered grid of `CELL = 96` m; each cell `(ix, iz)` hashes
  `(seed, ix, iz)` to decide whether it holds an island (~50 %), its centre offset, its base
  height (`y` 72–96, well clear of the highest ground) and its params (size 24–56,
  maxHeight 5–9, depth 9–16, lake 40 %, tree density). Jitter ≤ (CELL − maxSize) / 2 so
  islands never overlap horizontally. Islands use the existing `islandGen.ts` rules
  (mask, terraces, lake, sand shore) unchanged in look. Islands have **no** build pad.
- Cell `(0, 0)` is the **legacy island**: `ISLAND_LARGE`, seed 11, lowest grass layer at
  `y = 80`, centred over the spawn pad. Its block layout must equal the current
  `generateIsland(world, ISLAND_LARGE)` output translated by +80 in y (pad included) so v1
  saves keep their builds. It is a landmark visible from spawn, reachable by building up.
  Dropping off it lands you near spawn — if the game has fall damage, it applies; if not,
  do not add it in this ticket.
- Zombies spawn on grass/sand on **both** layers, near players only (§5).

## 3. Generation must be per-chunk and pure

Refactor generation into something that can produce **any single chunk on demand** with no
dependence on generation order or on neighbouring chunks:

```ts
// resources/js/world/terrainGen.ts
export function generateChunk(seed: number, cx: number, cy: number, cz: number): Uint8Array | null
export function groundSpawn(seed: number): { x: number; y: number; z: number }  // feet on the pad
```

- Split into `groundColumn(seed, x, z)` (height, surface block, water, pad flattening) and
  `islandColumn(seed, x, z)` (looks at the 3×3 surrounding cells, finds the island whose mask
  covers the column — at most one — and computes `h`/`dep` exactly as `islandGen.ts` does
  today). `generateChunk` fills each block from those two column descriptions plus trees.
- Trees write across chunk borders. Do **not** stamp them into neighbouring chunks. Decide
  tree positions deterministically per column (hash of seed + x + z + layer + density rule),
  and when filling a block ask "does any tree within radius 2 horizontally / 8 vertically
  cover this cell?" (log column vs. canopy shape from `addTree`). Result must be identical
  regardless of which chunk was generated first.
- Return `null` for all-air chunks (most sky chunks) so they cost no memory.
- Performance target: a 16³ chunk in **≤ 1.5 ms** on the main thread. Cache the column
  descriptions per chunk column (one heightmap lookup serves all 8 `cy` chunks). Measure and
  print in the existing `console.info` line. If you can't hit it, move `generateChunk` into a
  Web Worker (`resources/js/world/genWorker.ts`, transferable `Uint8Array`) — it is pure, so
  this is a drop-in.

## 4. Streaming

Add a `ChunkStreamer` (`resources/js/world/chunkStreamer.ts`) owned by `Game`:

- Each frame compute the set of chunk coords within `LOAD_RADIUS` (default 6 chunks ≈ 96 m
  horizontally, the full `cy` band vertically; make it a setting) of every **local-relevant**
  position: the host streams around all avatars (it runs the sim), a client streams around
  itself only.
- Load missing chunks nearest-first, capped at N per frame (start with 4, tune). Unload
  chunks beyond `LOAD_RADIUS + 2` (hysteresis) — free the `Uint8Array` and tell the renderer
  to dispose that mesh. Never unload a chunk a zombie or drop is standing in.
- **Edits are the source of truth.** `world.edits` (already absolute-keyed) stays resident for
  the lifetime of the world; when a chunk is (re)loaded, regenerate it then re-apply every
  edit inside it. Add `World.editsInChunk(cx,cy,cz)` backed by a per-chunk index so this is
  O(edits in chunk), not O(all edits).
- Prop metadata (`world.props`) follows the same rule: re-applied on load, kept on unload.

## 5. Things that currently assume a finite world — fix all of them

- `chunkStore.ts` `numKey` only covers ±512 chunks (±8 km). Replace with a key that is safe
  for at least ±2²⁰ chunks using JS safe integers (the `cy` band is tiny, so
  `(cx + 2^20) * 2^21 * 8 + …` fits under 2^53), or switch the hot cache to a 2-level map.
  Add a test that `getBlock` works at x = 1 000 000.
- `World.bounds` no longer means anything. Remove it. The two bedrock checks in `Game.ts`
  (`y <= bounds.minY + 1`) become `y === 0` (real bedrock). Island bottoms are breakable.
- `IslandInfo` / `this.island` in `Game.ts` goes away; spawn and respawn use
  `groundSpawn(seed)`. Anything that respawns "at the island" now means the ground pad.
  A player who somehow ends up below `y = 0` is teleported to the pad.
- `zombies.ts` `grassTop` walks `bounds.maxY..minY` — walk the fixed vertical band instead
  and return the **nearest** standable grass/sand surface to the spawn anchor's y (so night
  spawns near a player on the ground use the ground, and near a player on an island use the
  island). Only spawn on loaded chunks within ~40 m of a player. Night-one zombies must be
  able to reach a player standing on the spawn pad on foot (verify no water moat / cliff
  encloses the pad for the default seed; the blend ring rule should guarantee it).
- `pathfinding.ts`: treat unloaded chunks as solid/unwalkable so zombies never walk into
  nothing. Check `chunkCount`/`chunkKeys()` callers for anything that iterates "the world".
- `ChunkRenderer.buildAll()` + `markAllDirty()` go away; the renderer reacts to load/unload
  events. Keep `MAX_REBUILDS_PER_FRAME`. Water and leaves still go in the translucent mesh.
- `Game` constructor no longer generates everything before first frame — spawn once the
  chunks around the spawn point are loaded (show the existing loading state until then).
  Camera far plane / fog: the sky islands must be visible from the pad (~80 m up) — check
  the renderer's far distance and fog settings and raise them if needed.

## 6. Networking and saves

- `welcome` already carries `seed` and `spawn` — clients must generate from the seed, never
  from a constant. Make `Game.seed` come from the host's world / the save, with
  `ISLAND_LARGE.seed` only as the default for a brand-new world.
- `SaveData`: bump to `version: 2`, add `seed`. Loading a v1 save: assume seed 11,
  **translate every edit by +80 in y** (their builds stay on the legacy island) and replace
  the saved spawn with `groundSpawn(seed)`. Update `api.ts` validation and the Laravel side
  if it inspects the payload (`grep -rn version app/`).
- Block edits far from origin must survive the wire unchanged — check `protocol.ts` has no
  Int16/byte packing of coordinates.

## 7. Tests (vitest, `resources/js/world/__tests__/`)

Write these **before** the implementation where practical:
1. Determinism: `generateChunk(seed, c)` called twice → identical bytes; different seed → differs.
2. Order independence: generate chunk A then B vs. B then A → identical bytes for both.
3. Legacy-island parity: chunks covering cell (0,0) in the island band equal the output of
   the old `generateIsland(ISLAND_LARGE)` shifted +80 in y (keep the old generator in the test
   only; delete it in a follow-up commit once parity is proven).
4. Ground invariants over a 256×256 sample: bedrock at y=0 everywhere, no air under a
   surface block, water never above `SEA_LEVEL`, grass never under water, no island block
   below y = 64.
5. Spawn pad: for 20 different seeds, `groundSpawn` stands on grass, the pad is flat within
   `padRadius`, above sea level, no water within 12 blocks, and the two blocks above the
   spawn are air.
6. Edits survive unload → reload; props too.
7. Streamer set maths: load/unload sets for a moving position, hysteresis, per-frame cap.
8. `numKey`/`getBlock` at ±1 000 000 blocks.
9. Trees straddling a chunk border render identically from both chunks (both layers).
10. v1 save migration shifts edits by +80 and replaces the spawn with the ground pad.
Coverage on new files ≥ 80 %.

## 8. Acceptance

- New game: you appear on a flat grass pad on the ground with the legacy island floating
  overhead. Walk in any direction for 2 km: terrain and new sky islands appear before you can
  reach them; no visible pop-in closer than ~60 m at walking speed; frame time stays ≤ 16 ms
  on an integrated GPU with `LOAD_RADIUS = 6`.
- Build a pillar/stairs up to the legacy island; it is solid and buildable like before.
- Host + one client: both see the same ground and islands 500 m from origin; a block placed
  there by the client is visible to the host and survives the client walking 300 m away and
  back.
- Save, reload, walk to a distant place you built → your build is there. An old (v1) save
  loads with its builds still on the legacy island and the player on the ground pad.
- Memory: chunk count stays bounded while walking 2 km in a straight line (log it).
- `game docs/GAME_PROMPT.md` §1.2 updated to describe ground + archipelago + ground spawn;
  `README.md` mentions the world is infinite and seeded.

Work in phases and commit each one on `dev` with conventional-commit messages:
(1) tests + pure `generateChunk` (ground + pad + islands) with legacy-island parity,
(2) streamer + renderer load/unload + removal of `bounds`/`IslandInfo`, (3) zombies/pathfinding/respawn,
(4) net + save v2 with v1 migration, (5) perf pass / worker if needed, (6) docs.
Open a PR `dev → staging` when all tests pass.
