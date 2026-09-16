# Architecture

The Dart tree mirrors `server/resources/js/` so a reader of either codebase
finds the twin. Pure-Dart modules (no Flutter import) sit under `lib/world`,
`lib/physics`, `lib/entities`, `lib/items`, `lib/net` and are tested against
the fixtures in `shared/`; Flutter-facing code sits under `lib/render`,
`lib/input`, `lib/ui`.

## Module map

| TS module | Dart | State | Notes |
|---|---|---|---|
| `world/seed.ts` | `lib/world/seed.dart` | done | |
| `world/noise.ts` | `lib/world/noise.dart` | done | mulberry32, hashInt, Perlin, fractal2 |
| `world/groundGen.ts` | `lib/world/ground_gen.dart` | done | |
| `world/islandGen.ts`, `islandTemplate.ts`, `islandField.ts` | `lib/world/island_*.dart` | done | |
| `world/updraft.ts` | `lib/world/updraft.dart` | done | |
| `world/terrainGen.ts` | `lib/world/terrain_gen.dart` | done | |
| `world/palette.ts` | `lib/world/palette.dart` | done | block ids are the save/wire format |
| `world/chunkStore.ts` | `lib/world/chunk.dart`, `lib/world/world.dart` | done | edits, props, streaming load/unload |
| `world/mesher.ts` | `lib/world/mesher.dart` | done | interleaved GPU vertices |
| — (JS `Math` semantics) | `lib/world/js_math.dart` | done | imul, `>>>`, Math.round, V8 hypot, fdlibm sin/cos |
| `world/chunkStreamer.ts` | `lib/world/chunk_streamer.dart` | P1 | the spike page has an inline version |
| `world/raycast.ts` | `lib/world/raycast.dart` | P1 | |
| `physics/aabb.ts`, `playerController.ts` | `lib/physics/` | P1 | same fixed timestep; add fixtures (`npm run fixtures:physics`) |
| `game/DayNight.ts` | `lib/game/day_night.dart` | P1 | |
| `entities/zombies.ts`, `pathfinding.ts`, `drops.ts`, `crates.ts` | `lib/entities/` | P2 | |
| `items/registry.ts`, `recipes.ts`, `inventory.ts` | `lib/items/` | P2 | registry + recipes to move into `shared/data/*.json` for both clients |
| `game/Game.ts` (1063 lines) | `lib/game/{loop,session,save,score,visitors}.dart` | P2/P3 | never one file |
| `game/saveState.ts`, `autosave.ts`, `net/saveMigrate.ts` | `lib/game/save*.dart` | P2 | save version 3, gzipped JSON |
| `net/protocol.ts` | `lib/net/protocol.dart`, `lib/net/msgpack.dart` | done | byte-identical to msgpackr |
| `net/transport.ts` | `lib/net/signaller.dart`, `lib/net/transport.dart`, `lib/net/rtc*.dart` | done | `flutter_webrtc` behind `RtcFactory` |
| `net/SnapshotBuffer.ts` | `lib/net/snapshot_buffer.dart` | P3 | |
| `net/HostSession.ts`, `ClientSession.ts` | `lib/net/host_session.dart`, `client_session.dart` | P3 | |
| `net/api.ts` | `lib/api/{api_client,auth_api,game_api,models,token_store}.dart` | done | bearer token instead of session |
| `net/globalWorld.ts` | `lib/api/game_api.dart` (join/claim/leave) + `lib/game/global_world.dart` | P3 | |
| `render/ChunkRenderer.ts`, `Lighting.tsx` | `lib/render/chunk_renderer.dart`, `lighting.dart`, `camera.dart` | done | flutter_gpu; shaders in `shaders/` |
| `render/ZombieRenderer.ts`, `RemotePlayerRenderer.ts`, `PropRenderer.ts`, `PlayerBody.tsx`, `ViewModel.ts` | `lib/render/gltf/`, `lib/render/skinned_renderer.dart` | P1/P2 | own glTF loader + skinning (flutter_scene's source as reference) |
| `render/UpdraftRenderer.ts`, `CombatFx.ts`, `Effects.tsx` | `lib/render/fx/` | P2 | |
| `input/Input.ts` | `lib/input/mouse_capture.dart`, `touch_controls.dart`, `lib/input/bindings.dart` | done / P1 | per-platform adapters |
| `ui/*`, `state/uiStore.ts` | `lib/ui/` with **Riverpod** | P4 | chosen over Bloc: less ceremony for a game HUD that reads many small pieces of state |

## Threading

- **World generation and meshing on isolates.** `TerrainGenerator` and
  `meshChunk` are pure Dart with no Flutter dependency, so a `chunk_worker`
  isolate takes `(seed, cx, cz)` and returns the column's chunks plus their
  meshes as transferable typed data. The main isolate keeps the authoritative
  `World` (edits) and re-meshes single dirty chunks synchronously when the
  player edits a block (< 1 ms).
- **Rendering** stays on the main isolate: `flutter_gpu` objects are not
  isolate-portable. The spike measured ~2.4 ms per frame for 188 chunks, so
  this is not the bottleneck; meshing was 0 ms per frame once the initial
  stream was in.
- **Networking** on the main isolate; `flutter_webrtc` delivers on it anyway.

## Asset pipeline

`Design/` → `client/assets/`:

- GLB models (`server/public/assets/Assets/*.glb`, `Characters/*.glb`) are
  copied as-is and loaded by the Dart glTF loader (P1). Animation clips are
  sampled on the CPU into bone matrices per frame; skinning is in the vertex
  shader (`shaders/skinned.vert`).
- Blocks are vertex-coloured from `palette.dart` (as on the web); no atlas.
- UI icons: `ui/ItemIcon.tsx` renders items from GLBs; the native client bakes
  PNG icons at build time (`tool/bake_icons.dart`, P4).

## Storage per OS

| What | Where |
|---|---|
| Bearer token, device token | `flutter_secure_storage` (Keychain / EncryptedSharedPreferences / libsecret) |
| Settings (render distance, sensitivity, server URL) | `shared_preferences` |
| Local save cache (last downloaded world, for offline play) | `path_provider` app support dir, gzipped JSON like the server's |

## Data flow (one frame)

```
input (mouse/touch/keys) ─► PlayerController ─► World edits ─► dirty chunks ─► mesher (main or isolate)
                                   │                                              │
                                   ▼                                              ▼
                       HostSession / ClientSession ◄── transport ◄── peers    ChunkRenderer.sync
                                   │                                              │
                                   ▼                                              ▼
                              snapshots ─► SnapshotBuffer ─► entity renderers ─► frame texture ─► widget
```
