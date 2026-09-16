# Task list

Phased as in the plan. Each task names its test. ✅ done on `dev`; ⬜ open.
Cross-play is tested continuously: any change to `server/resources/js/world/*`
or `net/protocol.ts` regenerates `shared/fixtures/` (`npm run fixtures`) in the
same PR and `client.yml` fails on drift.

## P0 — Foundations

| | Task | Test |
|---|---|---|
| ✅ | Monorepo: `server/`, `client/`, `shared/`; server CI unchanged | `ci.yml` green, staging deploy unchanged |
| ✅ | `client.yml`: format, analyze, test, Android + Linux + Windows builds | workflow runs on `client/**`/`shared/**` |
| ✅ | Sanctum token auth on the backend (`/api/auth/*`), device approval, CSRF exemption | `TokenAuthTest` (10 tests), browser flow unchanged |
| ✅ | Dart API client + token/device secure storage | `test/api/*`, live test against a real server |
| ✅ | Golden worldgen fixtures + Dart harness | `test/world/*` |
| ✅ | Protocol fixtures + msgpack codec | `test/net/protocol_fixtures_test.dart` |
| ✅ | Shader build hook (`impellerc` via `flutter_gpu_shaders`) | Windows build produces the bundle |
| ✅ | Flutter version pinned (3.47.4), Impeller + Flutter GPU switched on per runner | app starts on Windows |
| ⬜ | Settings storage (`shared_preferences`): render distance, sensitivity, server URL | unit test with in-memory prefs |
| ⬜ | Play Console app + upload key; MSIX signing decision | secrets in place, dry-run release job |
| ⬜ | Sentry wired, off in debug | crash in a debug build not reported |

## Open decision from the review

The code review of the token flow suggested that a sign-in on an *already approved* device by a *different* account should require re-approval (today the device stays approved and moves to the new account — the same semantics as a shared browser). That is a product call; it is not implemented.

## P1 — World

| | Task | Test |
|---|---|---|
| ✅ | Worldgen port (seed, noise, ground, islands, updrafts, terrain) | fixtures byte-identical, 5 seeds |
| ✅ | `World` (chunks, edits, props, streamed load/unload) | port `world.test.ts` cases (⬜) |
| ✅ | Mesher with AO, opaque/translucent split | ⬜ add mesher fixtures (`npm run fixtures:mesh`) |
| ✅ | `flutter_gpu` chunk renderer, fog, day/night palettes | spike: 188 chunks in 2.4 ms |
| ⬜ | `ChunkStreamer` port (load radius, unload, priority by distance) | `streaming.test.ts` twins |
| ⬜ | Meshing on an isolate; main-isolate re-mesh for edits | frame-time p95 unchanged with 6-chunk radius |
| ✅ | `raycast.ts` port (dig/place targeting) | `fixtures/physics/raycast.json`, 224 rays |
| ✅ | `aabb.ts` + `playerController.ts` port, same fixed timestep, updraft lift | `npm run fixtures:physics`: 828 scripted ticks, byte-identical |
| ✅ | `DayNight` clock → lighting phase, sun direction | `test/game/day_night_test.dart` |
| ⬜ | glTF loader (meshes, skins, animations) + skinned shader; zombie GLB playing its clip (the S1 item not yet done) | golden render test on Windows CI |
| ⬜ | Keyboard bindings (`Input.ts` twin), gamepad stub | unit tests |
| ◐ | Walk on the real world with collision, dig and place a block | walk, dig (drops to inventory) and place (from the hotbar) work in the play page; ⬜ hardness-timed breaking, integration test |

## P2 — Game rules

| | Task | Test |
|---|---|---|
| ⬜ | Move `items/registry.ts` + `recipes.ts` tables to `shared/data/{items,recipes}.json`; both clients load them | Vitest + Dart tests read the same files |
| ✅ | Inventory, hotbar, crafting (Dart tables for now) | `test/items/items_test.dart` |
| ⬜ | Drops, crates | port `entities/__tests__` |
| ⬜ | Zombies + pathfinding, spawning at night | port tests; determinism fixture for pathfinding |
| ⬜ | Combat: sword swing, rifle fire/reload, damage, poison | port tests |
| ⬜ | Death → crate → respawn, score, leaderboard post | port `game/__tests__` |
| ◐ | Save v3 (`saveState.ts`, `saveMigrate.ts`), autosave, local cache, `PUT /api/world` on pause | `lib/game/save.dart` parses/builds v3 and carries unknown parts through; autosave every 60 s and on leave; ⬜ round-trip fixtures, local cache |
| ⬜ | `Game.ts` split into loop / session / save / score / visitors | each ≤ 400 lines |

## P3 — Multiplayer

| | Task | Test |
|---|---|---|
| ✅ | Signaller + Host/Client transports on `flutter_webrtc` | in-memory handshake tests |
| ⬜ | `SnapshotBuffer` (interpolation delay 100 ms) | port `net.test.ts` cases |
| ◐ | `HostSession` / `ClientSession` (hello/welcome/full, input @30 Hz, snap @20 Hz, private state, blocks, chat) | hello/welcome/full/bye, blocks, snapshots with players, chat; ⬜ zombies/drops/crates in snapshots, per-client inventory, session tests |
| ✅ | Rooms: create, heartbeat, close; invites: list, send, accept, decline | `Launcher` + `InvitePanel`; page tests against a scripted server |
| ⬜ | Remote player rendering (animated avatars) | golden render |
| ◐ | Global world join/claim/leave + host handover | `Launcher.enterGlobal/handover` mirror globalWorld.ts; ⬜ the HUD does not yet trigger the handover on host-left |
| ⬜ | **Cross-play E2E**: browser peer (Playwright) + native peer in one room, both see one block edit | manual first, then CI |
| ⬜ | NAT check: desktop behind a home router reaches a browser host (STUN only) | manual, documented |

## P4 — UI/UX

| | Task | Test |
|---|---|---|
| ✅ | UI state (`uiStore.ts` twin) — `GameUiState` + `AppSession` on ChangeNotifier (no Riverpod needed yet) | page tests |
| ✅ | Sign-in, pending approval, lobby (worlds, global world, invitations, leaderboard) | `test/ui/pages_test.dart`; ⬜ goldens at three breakpoints |
| ✅ | HUD (logo, room code, timer, position, health/stamina, ammo, toast, crosshair, hotbar, death, scoreboard, connection overlay) | page test; ⬜ goldens |
| ✅ | Crafting panel, invite panel, pause, scoreboard | page test; ⬜ goldens |
| ✅ | Touch controls with visible indicators: resting joystick, outlined look zone, labelled jump/sprint/dig/place/use, ☰ pause | `test/input/touch_controls_test.dart`; ⬜ hotbar tap-to-select on touch |
| ⬜ | Linux mouse capture backend (X11 first, Wayland shim) | manual on Linux, both sessions |
| ⬜ | Accessibility pass: text scale, contrast, reduced motion for updraft FX | manual checklist |

## P5 — Ship

| | Task | Test |
|---|---|---|
| ⬜ | Store listing, screenshots, privacy policy (no PII beyond email) | Play pre-launch report |
| ⬜ | MSIX + portable zip; Flatpak + AppImage | install on clean VMs |
| ⬜ | Crash reporting verified on all three | test crash appears in Sentry |
| ⬜ | Beta channel: Play internal testing + GitHub pre-release | testers on all three OSes |
| ⬜ | Performance sign-off on the slowest supported Android device (frame-time p95 < 16.6 ms, mesh time per column < 8 ms) | perf gate in CI with recorded numbers |
