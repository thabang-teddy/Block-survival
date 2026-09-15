# Block Survival — native Flutter client: planning plan

**Status:** draft, 2026-09-15. Nothing here is built yet.
**Goal of this document:** get from "we want a native client" to an implementation
plan we trust, without guessing at the two things that could sink the project
(3D rendering in Flutter, and cross-play with the browser client).

Targets: **Android, Windows, Linux.** The web build stays the Inertia/React game.
The Laravel backend stays the single backend for both.

---

## 0. What we are planning

A native port of the game in `server/resources/js/` — not a wrapper around the web build.
The client must:

1. render the same seeded world (chunks, floating islands, updrafts) natively;
2. play the same rules (crafting, day/night, zombies, combat, death crates, score);
3. **cross-play** with browser players in the same room over the existing WebRTC
   mesh, using the existing signalling mailbox (`/api/rooms/{code}/signal[s]`);
4. use the same accounts, leaderboard, cloud saves (`/api/world/{own|global}`)
   and the shared global world;
5. ship through Play Store, a Windows installer and a Linux package.

Cross-play is the constraint that makes this hard: world generation, physics,
the wire protocol and the save format must match the TypeScript implementation
*exactly*, not approximately.

---

## 1. Decisions to make before the plan (with recommendations)

Each of these changes the shape of the implementation plan. Decide them first;
where the answer is not obvious, a time-boxed spike in §2 produces it.

### D1 — Rendering approach

| Option | Pros | Cons |
|---|---|---|
| **A. Custom voxel renderer on `flutter_gpu`** (recommended) | We need one textured, fogged, vertex-lit shader plus a few animated GLBs — small surface; full control of chunk buffers; Impeller-native on all three targets | `flutter_gpu` is preview; no scene graph, we write the glTF/skinning path ourselves |
| B. `flutter_scene` (Flutter team's 3D engine on Flutter GPU) | glTF import, PBR, animation, tooling out of the box | Preview; **requires the master channel** today; PBR is more than a voxel game needs; version churn |
| C. Dart port of three.js (`three_js` via `flutter_angle`) | Closest 1:1 mapping from `render/*.ts` | Community-maintained; OpenGL-ES-through-texture path, not Impeller; desktop support less proven |
| D. Native renderer (C++/Rust, wgpu) via FFI into a `Texture` | Fastest, most control | Three native toolchains to maintain; overkill for the visual budget |
| E. WebView around the web game | Weeks, not months | Not a native client; Linux WebView story is weak; no Play-Store-quality input/perf |

Recommendation: **A**, using `flutter_scene`'s source as reference for the glTF
loader and skinning rather than depending on it. Spike S1 confirms or rejects.

### D2 — Authentication for a non-browser client

`routes/web.php` is **session + CSRF + device approval** (`auth`, `access`
middleware, `/pending-approval`). A Flutter client cannot use Inertia login.
Needs a backend change: **Laravel Sanctum personal-access tokens** issued by a
new `POST /api/auth/token` (login + device fingerprint → pending-approval
state → token), with the existing device-approval admin flow reused. Every
`/api/*` route must accept `auth:sanctum` *or* session so the browser keeps working.

Decide: Sanctum tokens (recommended) vs. cookie-jar emulation (fragile, CSRF).

### D3 — Repository layout — **decided: monorepo, one folder per project**

```
/server/                    Laravel app + web client (everything that is at the root today,
                            including server/deploy/ — it ships inside the artefact)
/client/                    Flutter app (pubspec.yaml, lib/, android/, windows/, linux/)
/shared/                    cross-project contracts, owned by neither side:
  fixtures/worldgen/          golden chunks (§2 S2)
  protocol/                   JSON schema of protocol.ts messages + version
  data/recipes.json, items.json   the registry both clients load
/docs/                      repo-wide docs (this file, cpanel-go-live.md)
/.github/workflows/         ci.yml (server), client.yml (client)
/CLAUDE.md, /README.md
```

Why monorepo: a change to `world/*.ts` regenerates the fixtures and updates the
Dart port in *one* commit, which is the only way to keep cross-play honest.
Why `server/` rather than Laravel-at-root: two peers, no "main" project, and
`shared/` has an obvious home.

**Step 0 — restructure chore PR on `dev`, before any spike.** It must be
green in CI and deploy to staging unchanged (the artefact keeps its shape, so
the cPanel side is not touched). Concretely:

1. `git mv` everything except `.github/`, `.claude/`, `docs/`, `CLAUDE.md`,
   `README.md`, `.gitignore`, `.gitattributes`, `.editorconfig` into `server/`.
   `Design/` and `game docs/` move to the top level next to `shared/`.
2. `ci.yml`: `defaults.run.working-directory: server` on the `test` and `build`
   jobs; cache keys `hashFiles('server/composer.lock')`; setup-node
   `cache-dependency-path: server/package-lock.json`; rsync source `./server/`
   (the exclude list is relative to it and stays as is); `paths-ignore:
   ['client/**']` on push/PR.
3. New `client.yml`: `paths: ['client/**', 'shared/**']`, matrix of
   `ubuntu-latest` (analyze, test, Android + Linux builds) and `windows-latest`
   (Windows build), `working-directory: client`.
4. `.claude/launch.json`: `cwd: server` on the `vite` and `app` configs; re-link
   the Herd site `block-survival.test` to `server/`.
5. `README.md` "Run it", `CLAUDE.md`, `docs/cpanel-go-live.md` (~44 lines
   of commands/paths): prefix with `server/` or add `cd server`.
6. Untouched: `server/deploy/cpanel-deploy.sh`, the `deploy/*` branches, the
   cPanel clone, `phpunit.xml`, `vite.config.ts`, `tsconfig*.json` (all
   relative to their own folder).

The existing `flow` job and branch protection apply to the client unchanged.
Trade-off accepted: client releases ride the same `staging → master` promotion
as the web deploy. Tag store builds on `master` as `client-vX.Y.Z`.

Alternative rejected: separate `block-survival-client` repo pinning a fixture
commit — decoupled cadence, but fixture drift becomes a cross-repo chore.

### D4 — Cross-play guarantee level

- **Strict**: native and browser clients join the same room, same seed, identical chunks, identical protocol. (Recommended; it is the point of the port.)
- **Loose**: native clients only play with native clients; browser rooms are separate. Halves the determinism work but splits the player base.

### D5 — Input model per platform

- Desktop: keyboard + mouse-look. Flutter has **no built-in pointer lock**; mouse-look on Windows/Linux needs a plugin or platform channel that hides the cursor and streams relative deltas. Spike S3.
- Android: on-screen joystick + look-drag + action buttons; optional Bluetooth gamepad.
- Gamepad on desktop: nice-to-have, not v1.

### D6 — Feature scope of v1

Recommendation: **everything the browser client has except the admin pages.**
Admin stays web-only. Cut list if time is short (in this order): rifle FX polish,
third-person camera, global shared world, invites UI (join by code only).

---

## 2. Spikes (time-boxed, each ends in a written go/no-go)

Run these **before** writing the implementation plan. Each is ≤ 1 week, produces
a throwaway repo/branch and a one-page result appended to this file.

### S1 — Render a real chunk on all three targets (D1)
- Port `world/mesher.ts` output format only (hand-feed one meshed chunk as a
  static vertex buffer) and draw it with `flutter_gpu` on Android, Windows, Linux.
- Textured, fogged, per-vertex light; 60 fps with 16×16 chunks in view.
- Load one GLB from `server/public/assets/` (a zombie) and play its animation.
- **Pass:** stable frame rate on a mid-range Android phone and on Linux (Impeller
  is newest there); no channel/version blockers we cannot pin.
- **Fail →** re-evaluate D1-B/C.

### S2 — Bit-exact world generation (D4)
- Add a script under `server/` that dumps golden fixtures: for N seeds, the raw
  block arrays of a set of chunks at ground level and at island height, plus
  `updraft` positions. Commit under `shared/fixtures/worldgen/`.
- Port `world/noise.ts`, `seed.ts`, `terrainGen.ts`, `groundGen.ts`,
  `islandField.ts`, `islandGen.ts`, `islandTemplate.ts` to Dart.
- **Pass:** byte-identical output for every fixture. Watch: JS `Math` vs Dart
  `dart:math` transcendental functions, `|0` truncation vs `~/`, 32-bit integer
  hashing (`>>>`) — Dart ints are 64-bit on native.
- **Fail →** identify the non-portable operations and decide whether to change
  the TS side (a world-format version bump) or emulate.

### S3 — Desktop mouse-look and Android touch (D5)
- Prove relative mouse motion with a hidden cursor on Windows and Linux (X11
  **and** Wayland), and Esc to release.
- Prove a touch joystick + look-drag coexist without gesture conflicts.
- **Pass:** a moving camera you would accept in a shooter on all three.

### S4 — WebRTC handshake with a browser peer (D4)
- `flutter_webrtc` on Android/Windows/Linux, signalling through the existing
  `/api/rooms/{code}/signal[s]` mailbox against a local `php artisan serve`.
- Open a DataChannel to a browser tab running the current game; exchange one
  `protocol.ts` message each way.
- **Pass:** connection on all three targets, including desktop behind a
  home NAT. Confirms the STUN/TURN story is unchanged.

### S5 — Token auth (D2)
- Sanctum branch on `dev`: `POST /api/auth/token`, device-approval integration,
  all `/api/*` routes accepting token or session, `php artisan test` green.
- **Pass:** the Flutter spike app fetches `/api/leaderboard` with a token;
  browser flow unchanged.

Spikes S1/S2 are the gating ones and can run in parallel; S3–S5 can start once
S1 shows the platform is viable.

---

## 3. The implementation plan itself — what it must contain

Once the spikes are green, produce these (in this order) under `client/docs/`.
This follows the project's planning workflow: PRD → architecture → system
design → tech doc → task list.

1. **PRD** (`docs/PRD.md`) — the feature list from D6, the cut list, the
   cross-play guarantee from D4, platform minimums (Android API level, Windows
   10+, Linux glibc/GPU floor), store/packaging targets, non-goals (web, iOS,
   macOS for now — note that adding iOS/macOS later is cheap on this stack).
2. **Architecture** (`docs/architecture.md`) — module map mirroring
   `server/resources/js/` so a reader of either codebase finds the twin:

   | TS module | Dart package/lib | Notes |
   |---|---|---|
   | `world/*` | `lib/world/` | pure Dart, fixture-tested (S2) |
   | `physics/aabb.ts`, `playerController.ts` | `lib/physics/` | pure Dart, same fixed timestep |
   | `entities/zombies.ts`, `pathfinding.ts`, `drops.ts`, `crates.ts` | `lib/entities/` | pure Dart |
   | `items/*` | `lib/items/` | pure Dart, recipe table shared as JSON |
   | `game/Game.ts` (1063 lines) | `lib/game/` split into loop, session, save, score | do not port as one file |
   | `net/protocol.ts`, `SnapshotBuffer.ts`, `transport.ts`, `HostSession.ts`, `ClientSession.ts` | `lib/net/` | protocol byte-identical; transport on `flutter_webrtc` |
   | `net/api.ts`, `saveMigrate.ts`, `globalWorld.ts` | `lib/api/` | Dio/http + token auth |
   | `render/*` | `lib/render/` | `flutter_gpu` custom renderer (S1) |
   | `input/Input.ts` | `lib/input/` | per-platform adapters (S3) |
   | `ui/*`, `state/uiStore.ts` | `lib/ui/`, state via Riverpod or Bloc — pick one | HUD, menus, crafting, invites |

   Also: threading (world gen + meshing on isolates), asset pipeline (GLB +
   texture atlas from `Design/` → `assets/`), save/settings storage per OS.
3. **System design** (`docs/system-design.md`) — sequence diagrams for: login +
   device approval; host a room and invite; join a room from an invite; autosave
   + beacon; death → crate → respawn; global world join/claim/leave. Each one
   names the `/api` endpoint and the `protocol.ts` messages used.
4. **Tech doc** (`docs/tech.md`) — pinned Flutter channel/version and why;
   `flutter_gpu` shader toolchain (`flutter_gpu_shaders`, `.shaderbundle`);
   package list with the reason for each; CI matrix (ubuntu, windows, android
   build on ubuntu); signing/secrets handling; packaging (AAB, MSIX, Flatpak +
   AppImage); crash reporting choice.
5. **Task list** (`docs/tasks.md`) — phased, each task with test criteria.
   Suggested phases:

   - **P0 Foundations** — repo, CI matrix, token auth client, settings storage,
     golden-fixture harness, shader build.
   - **P1 World** — worldgen, chunk store/streamer, mesher, raycast; renderer
     draws a walkable world; player controller; day/night lighting.
   - **P2 Game rules** — inventory, recipes, registry, drops, crates, zombies +
     pathfinding, combat, score, death/respawn, autosave to `/api/world`.
   - **P3 Multiplayer** — protocol, snapshot buffer, transport, host/client
     sessions, invites, remote player rendering, cross-play test vs browser.
   - **P4 UI/UX** — main menu, HUD, crafting panel, invite panel, pause,
     scoreboard, per-platform input polish, accessibility pass.
   - **P5 Ship** — store listings, installers, crash reporting, beta channel,
     performance budget sign-off on the slowest supported Android device.

   Cross-play is tested continuously from P1 (worldgen fixtures) and end-to-end
   from P3 (a browser peer in CI via Playwright is optional but valuable).

---

## 4. Testing strategy the plan must commit to

- **Unit (pure Dart)** — worldgen, physics, items, entities, protocol: ≥ 80 %,
  and the golden fixtures from S2 are the contract with the TS side. Any change
  to `world/*.ts` must regenerate `shared/fixtures/` in the same PR; `client.yml`
  runs on `shared/**` changes so drift fails CI immediately.
- **Widget** — menus, HUD, crafting; golden screenshots at 3 breakpoints
  (phone, 1080p desktop, small laptop).
- **Integration** — `integration_test` on all three OS runners: launch, log in
  against a seeded Laravel test server, load world, walk, dig, place, save.
- **Cross-play E2E** — one browser peer (Playwright) + one native peer join a
  room, exchange snapshots, both see the same block edit. Manual until stable,
  then CI.
- **Performance gates** — frame-time p95 and chunk-mesh time on the reference
  Android device, tracked per PR.

---

## 5. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| `flutter_gpu` API churn / preview breakage | High | Pin Flutter version; wrap the GPU API behind one `Renderer` interface; S1 proves the floor |
| Worldgen not bit-exact (float/int semantics) | High — breaks cross-play | S2 golden fixtures before any other porting; agree a world-format version field |
| Protocol drift between TS and Dart | High | Single JSON schema for `protocol.ts` messages, checked in both repos; version handshake on join |
| No pointer lock on desktop | Medium | S3; fallback is a small platform-channel plugin per OS |
| Linux GPU/driver variance (Wayland, Mesa versions) | Medium | Document a floor; Flatpak bundles Mesa; test on Intel iGPU |
| Session-only auth | Medium (blocks everything) | S5 first; small, isolated backend change on `dev` |
| Android thermal/perf on low-end phones | Medium | Render-distance setting; isolate meshing; perf gate in CI |
| Two codebases drift in game rules | Medium | Shared recipe/registry JSON; fixture tests for physics and rules; changes land in both repos in the same week |
| Store review / signing delays | Low | Start Play Console and MSIX signing setup in P0 |

---

## 6. Sequence and rough effort

| Step | Output | Effort |
|---|---|---|
| Decide D1–D6 | this file, §1 filled in | 1–2 days |
| Step 0: restructure into `server/` + `client/` + `shared/` | chore PR on `dev`, staging deploy unchanged | 1 day |
| Spikes S1–S5 | go/no-go notes | 3–5 weeks (S1/S2 parallel) |
| Write PRD, architecture, system design, tech doc, task list | `docs/` in client repo | 1–2 weeks |
| Review plan (architect + code-reviewer pass), adjust | approved plan | 2–3 days |
| P0–P5 implementation | shippable v1 | estimated **after** the spikes — do not estimate before S1/S2 |

The single most valuable thing to do next is **S1 and S2 in parallel**. If
either fails, the rest of the plan changes; if both pass, the port is a large
but ordinary engineering job.

---

## Sources

- [Flutter Scene — realtime 3D engine on Flutter GPU](https://fscene.dev/) and its [pub.dev package](https://pub.dev/packages/flutter_scene) — Impeller default on every native platform as of Flutter 3.47; flutter_scene needs the master channel today
- [Getting started with Flutter GPU — Flutter blog](https://blog.flutter.dev/getting-started-with-flutter-gpu-f33d497b7c11)
- [bdero/flutter_scene on GitHub](https://github.com/bdero/flutter_scene)
