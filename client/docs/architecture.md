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
| `game/DayNight.ts`, `game/rules.ts` | `lib/game/day_night.dart`, `lib/game/rules.dart` | done | day/night lengths and the zombie schedule are the admin's (`/admin/rules`); loaded from `GET /api/rules`, a joiner takes the host's from the welcome |
| `entities/zombies.ts`, `pathfinding.ts`, `drops.ts`, `crates.ts` | `lib/entities/` | done | same tuning tables; tests are twins of `entities/__tests__` |
| `items/registry.ts`, `recipes.ts`, `inventory.ts` | `lib/items/` | done | registry + recipes still to move into `shared/data/*.json` for both clients |
| `game/Game.ts` (1063 lines), `game/Avatar.ts` | `lib/game/game.dart` (loop, local actions, streaming, saves, UI snapshot), `lib/game/host_sim.dart` (night schedule, zombies/drops/crates, vitals, host-authoritative actions), `lib/game/avatar.dart` + `lib/net/*_session.dart` | mostly | hardness-timed digging still open |
| `game/saveState.ts`, `autosave.ts`, `net/saveMigrate.ts` | `lib/game/save.dart`, autosave in `play_page.dart` | partial | v3 only (the browser migrates older saves before upload) |
| `net/protocol.ts` | `lib/net/protocol.dart`, `lib/net/msgpack.dart` | done | byte-identical to msgpackr |
| `net/transport.ts` | `lib/net/signaller.dart`, `lib/net/transport.dart`, `lib/net/rtc*.dart` | done | `flutter_webrtc` behind `RtcFactory` |
| `net/SnapshotBuffer.ts` | `lib/net/snapshot_buffer.dart` | P3 | |
| `net/HostSession.ts`, `ClientSession.ts` | `lib/net/host_session.dart`, `client_session.dart` | done | joiners get an `Avatar` in the host sim; private state per client; the client mirrors entities from snapshots |
| `net/api.ts` | `lib/api/{api_client,auth_api,game_api,models,token_store}.dart` | done | bearer token instead of session |
| `net/globalWorld.ts` | `lib/app/launch.dart` (`Launcher.enterGlobal/handover`) | done | |
| `render/ChunkRenderer.ts`, `Lighting.tsx` | `lib/render/chunk_renderer.dart`, `lighting.dart`, `camera.dart` | done | flutter_gpu; shaders in `shaders/` |
| `render/ZombieRenderer.ts`, `RemotePlayerRenderer.ts`, `PropRenderer.ts`, `PlayerBody.tsx`, `ViewModel.ts` | `lib/render/entity_mesh.dart` now; `lib/render/gltf/`, `skinned_renderer.dart` later | stand-in | zombies, drops and crates are coloured boxes drawn through the chunk pipeline (`ChunkRenderer.render(dynamic:)`); the glTF loader + skinning replaces them |
| `render/UpdraftRenderer.ts`, `CombatFx.ts`, `Effects.tsx` | `lib/render/fx/` | P2 | |
| `input/Input.ts` | `lib/input/mouse_capture.dart`, `touch_controls.dart`, `lib/input/bindings.dart` | done / P1 | per-platform adapters |
| `ui/*`, `state/uiStore.ts` | `lib/ui/pages`, `lib/ui/hud`, `lib/game/ui_state.dart`, `lib/app/session.dart` | done | plain `ChangeNotifier` + `ListenableBuilder`: two notifiers cover it, no Riverpod yet |

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
