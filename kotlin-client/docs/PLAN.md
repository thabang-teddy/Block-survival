# Block Survival — Kotlin Android client: plan and progress

**Status: P1 started, 2026-10-15.** World generation, the msgpack wire codec,
and physics/raycast/player-controller are all ported and fixture-verified on the
JVM. Spikes **S2 (msgpack) and S3 (worldgen + physics) are GO**; **S1 (WebRTC) is
NO-GO-for-now / deferred** — not because the approach is wrong, but because a
live DataChannel handshake needs an Android device or emulator plus a running
server, which this headless, pure-JVM work could not drive (see §2.1). A minimal
playable vertical slice sits on top of the verified modules (§7). This document
is both the plan and the live progress log — update it at the end of every work
session.

This mirrors the structure of `unity-client/docs/PLAN.md`, the project's
precedent for porting this game to a new native client (itself mirroring
`docs/flutter-client-plan.md`). The same cross-play bar applies: **worldgen,
physics, the wire protocol and the save format must match the TypeScript
implementation exactly, not approximately.**

## 0. Scope (decided)

- **Platform/target:** Android. Kotlin + Jetpack Compose for menus / HUD /
  panels; an OpenGL ES 3.0 `GLSurfaceView` for the voxel world.
- **Toolchain (pinned):** Gradle 9.1.0, Kotlin 2.2.21, AGP 9.0.1, JDK 21
  (Android Studio JBR), `compileSdk`/`targetSdk` 36, `minSdk` 26 (GLES 3.0 is
  API 18+). kotlinx-serialization-json 1.11.0 and JUnit 4.13.2 for the
  JVM fixture suites. Re-validate this plan before a major Kotlin/AGP bump.
- **Feature scope v1:** everything the web / Flutter / Unity clients have except
  the admin pages (admin stays web-only), matching the Flutter and Unity plans.
- **Cross-play guarantee: strict.** This client must join the same rooms, same
  seeds, same global world as the browser / Flutter / Unity clients.
- **Repo layout:** `kotlin-client/` sits next to `client/`, `unity-client/`,
  `server/`, `host-app/`, `shared/` — one more peer project, not nested inside
  any of them. `CLAUDE.md` lists it.
- **Branch:** `feature/kotlin-client`, cut from `dev` (f18ad48) exactly as
  `feature/unity-client` was, so the ported TS source and the fixtures match
  what Unity/Flutter targeted. (`shared/` and `server/resources/js/` are
  byte-identical on `dev` and `master`, so the base is parity-neutral.)

## 1. Decisions

| # | Decision | Chosen | Why |
|---|---|---|---|
| D1 | Rendering | OpenGL ES 3.0 via `GLSurfaceView` + a hand-written chunk mesher producing vertex-coloured VBOs — no texture atlas, matching the web client's look ("the palette is the look"). Compose hosts the surface through `AndroidView`. | Android ships GLES; the mesher is a direct port of `world/mesher.ts`. No third-party engine to fight, lowest-risk path to a drawable world. |
| D2 | Auth | Reuse the existing `POST /api/auth/token` Sanctum endpoint (built for the Flutter client) with a bearer token. | Zero backend changes; every `/api/*` route already accepts a token. (Wiring is P2/P3; the logic modules carry no auth yet.) |
| D3 | Realtime networking | WebRTC DataChannel on a maintained Android libwebrtc (`io.github.webrtc-sdk:android` / stream-io `webrtc-android`), signalled through the existing `/api/rooms/{code}/signal[s]` mailbox. | The only viable native WebRTC option on Android. **Spike S1 is deferred** — the codec and signaller are pure-Kotlin and testable, but a live channel needs a device + server (§2.1). |
| D4 | Wire format | A hand-rolled codec (`net/Msgpack.kt`), direct port of `client/lib/net/msgpack.dart`, NOT a general library. | **Byte-identical to msgpackr — spike S2 is GO** (§2.2). The Dart codec is already language-agnostic (a generic codec over dynamic values), so the port is mechanical; coercing a general library's map-width / int-vs-float choices to match msgpackr would be more work and more risk. |
| D5 | Input | Android touch (drag-to-look + on-screen controls) for the world view; Compose for everything else. | Native to the platform; no spike needed. The pure `PlayerController` reads abstract `KeyboardEvent.code` strings, so touch just maps onto the same input interface the other clients use. |
| D6 | Module layout | One **pure-Kotlin/JVM Gradle library module per logic domain** (`:world`, `:net`, `:physics`, later `:items`, `:entities`, `:game`) with **no Android dependency**, plus one `:app` Android module. | The analogue of Unity's `noEngineReferences: true` assemblies and the Dart port's pure `lib/`: the logic is fixture-testable on the JVM with no device or emulator. A reader of any client finds the twin module. The chunk-store class is `WorldStore` (not `World`) to match the Unity port and keep the type distinct from the `world` package. |
| D7 | Testing | JUnit 4 (JVM) suites that read `shared/fixtures/*.json` directly via kotlinx-serialization's `JsonElement` API (no `@Serializable` classes, so no compiler plugin needed). | The fixtures are the acceptance test. Plain JVM tests run with no device, in a few seconds, offline from the Gradle cache. |

## 2. What's done

**`:net`** (`net/src/main/kotlin/com/blocksurvival/net/Msgpack.kt`) — a direct
port of `client/lib/net/msgpack.dart`'s hand-rolled MessagePack codec: a generic
encoder/decoder over `null` / `Boolean` / `Long` / `Double` / `String` /
`ByteArray` / `List<Any?>` / `MsgpackMap` (an explicitly insertion-ordered
string-keyed map — msgpack map key order is wire-visible, so the ordering is made
explicit instead of relying on a particular map implementation). No typed message
classes yet (`ClientMessage` / `HostMessage` from `protocol.ts`) — those are a P3
ergonomics task, not part of the byte-parity question S2 answers.

**`:world`** (`world/src/main/kotlin/com/blocksurvival/world/`) — a full Kotlin
port of `server/resources/js/world` (via the proven Dart port): `JsMath.kt` (V8
`Math.sin`/`cos`/`hypot`/`round` emulation incl. the fdlibm `sin`/`cos`),
`Noise.kt` (mulberry32 RNG, `hashInt`, Perlin, `fractal2`), `Palette.kt`,
`Ores.kt`, `Chunk.kt`, `GroundGen.kt`, `IslandGen.kt`, `IslandTemplate.kt`,
`IslandField.kt`, `Underground.kt` (caves + ore veins), `Updraft.kt`,
`TerrainGen.kt` (`TerrainGenerator.generateChunk`, the entry point),
`WorldStore.kt` (the chunk store), `Raycast.kt`, `Mesher.kt`.

**`:physics`** (`physics/src/main/kotlin/com/blocksurvival/physics/`) — `Aabb.kt`
(`Box`, `MoveResult`, `boxIntersectsSolid`, `moveBox`, `rayBox`) and
`PlayerController.kt` (`PlayerTuning`, `PlayerState`, `PlayerInput`,
`KeySetInput`, `wrapAngle`, the controller: WASD, mouse look, sprint/stamina,
jump, gravity, step-up, updraft riding). Depends on `:world`.

### Number-semantics traps carried over (same as Unity/Flutter)

- **All hash/RNG integer math runs on `Long`** (a 64-bit Dart native int), never
  `Int`: `imul`'s intermediate product overflows 32 bits, and — the one that
  actually bit the other ports — `fractal2`'s z-slice (`seed * 7.31`, where
  `seed` can be a ~4.3-billion `hashInt` output) must truncate through `Long`
  before masking `& 255` in `PerlinNoise.noise`; `(hugeDouble).toInt()`
  **saturates** on the JVM where a 64-bit truncation does not.
- **fdlibm `sin`/`cos`** ported verbatim (`JsMath.kt`) via `doubleToRawLongBits`
  for the high-word tricks.
- **msgpack map key order** preserved with an insertion-ordered `MsgpackMap`.
- **Kotlin gotcha found in passing:** Kotlin block comments *nest*, so `/*.ts`
  inside a KDoc (the `/` before `*`) opens a nested comment and swallows the rest
  of the file. Avoid `/` immediately before `*` in doc text.

## 2.1 Spike S1 result — WebRTC DataChannel: **DEFERRED / NO-GO for this pass** (2026-10-15)

D3's approach (libwebrtc via `io.github.webrtc-sdk:android`, signalled through
the existing mailbox, carrying the real `Msgpack.kt` bytes) is sound and
unchanged. But the spike as written — "open a channel and exchange a real
`hello`/`welcome` through the signal mailbox against a local `php artisan serve`
+ a browser tab" — **could not be run here**: libwebrtc is a native `.aar` that
only loads inside an Android runtime, so it needs a device or emulator running
this app, plus the Laravel server and a browser peer. This session is a headless
JVM port; standing up an emulator for a not-yet-existent app was out of scope.

What *is* established toward S1: the wire codec it depends on is done and
byte-verified (S2, §2.2), and the signaller is just an HTTP mailbox poll
(`/api/rooms/{code}/signal[s]`) that will be a pure-Kotlin, JVM-testable class.
**The gating work for S1 is therefore P3 setup, not a research risk.** Run it on
an emulator once `:net` has a stub signaller/transport to drive — doing it with
throwaway code now would just be thrown away, exactly as the Unity plan concluded
for its own S1 follow-up.

**Verdict: proceed with D3 as the design; mark S1 unverified and schedule the
live handshake for the start of P3, on a device/emulator.**

## 2.2 Spike S2 result — msgpack byte parity: **GO** (2026-10-15)

`net/src/test/.../ProtocolFixtureTest.kt` loads all **24** messages from
`shared/fixtures/protocol/messages.json` (every `ClientMessage`/`HostMessage`
shape, including Unicode text, a `null` field, nested objects/arrays, negative
and large numbers) and for each one: encodes the fixture's value and diffs the
bytes, decodes the fixture bytes and diffs the value, and decodes-then-re-encodes
and diffs the bytes again. **All 72 checks (24 × 3) pass** — 24/24 encode
byte-identical, 24/24 decode match, 24/24 round-trip byte-identical. No bugs
found (the Dart file was already engine-agnostic; the number-semantics lessons
were applied while transcribing rather than discovered by a failing test).

```bash
# from kotlin-client/
./gradlew :net:test
```

## 2.3 Spike S3 result — worldgen + physics fixtures: **GO** (2026-10-15)

**Worldgen** — `world/src/test/.../WorldGenFixtureTest.kt` loads
`shared/fixtures/worldgen/*.json` and checks, across seeds 11, 1, 12345,
987654321, 2147483646: RNG (48), `hashInt` (7), Perlin (6), `fractal2` (7),
`hypot` (13), `sin`/`cos` (86), spawn + pad height (20), ground + natural heights
(140), tree placement (5), island placement + params (125), island template
bounds / voxel-count / **SHA-256** (122), updrafts (61), `updraftsNear` (5),
`islandsNear` (5), caves (70), ore veins incl. offset bytes (625), and full chunk
generation — **SHA-256 and decompressed gzip byte-for-byte against the fixture
(440 checks)**. **17 suites, 0 failures.** Notably every `sin`/`cos` matches V8
exactly, including `sin(3.22637297972782)` which was 1 ULP off under Unity's Mono
JIT — the JVM reproduces V8 here, so "byte-exact" is literally true on the JVM.

**Physics** — `physics/src/test/.../PhysicsFixtureTest.kt` checks all three
fixtures: `aabb.json` (**45/45** `moveBox` cases), `raycast.json` (**224/224**
rays against a streamed seed-11 world), and `walk.json` (**828 ticks**, all 13
state fields per tick, 0 mismatches — a scripted walk: turn, sprint, jump a
cliff, ride the legacy island's updraft).

**Found and fixed the same stale-fixture bug the Unity port hit (its §2.3).**
`raycast.json` initially failed on rays 102 and 103 only: both expected
`block: 3` (stone) at world `(12, 73, -1)` inside the legacy island's underside,
but the port — and the already-committed `worldgen/seed-11.json` chunks, which
passed byte-for-byte — produce `block: 20` (copper ore). `git log` confirmed
`shared/fixtures/physics/` was committed `0254426` (2026-09-16), **five days
before** `5eb30a7` (2026-09-21, "all eight Overworld minerals… #25") added the
ore roll inside island stone; the physics fixtures were never regenerated.
Ran `npm run fixtures:physics` in `server/`: **exactly one line of
`raycast.json` changed** (those two rays' `block` field, 3 → 20); `aabb.json` and
`walk.json` were untouched. All 269 physics checks pass after that. This almost
certainly means `client/test/physics/` (Dart) has been silently broken on `dev`
since 2026-09-21 too — the same regeneration (committed here) fixes it.

```bash
# from kotlin-client/
./gradlew :world:test :physics:test
```

**Verdict: proceed. No tuning constant or algorithm needed changing — this was a
repo fixture-freshness bug, not a cross-language semantics bug.**

## 3. Immediate next

- **S1 live handshake** (the one unverified spike): on an emulator, once `:net`
  has a stub signaller + transport, open a real DataChannel to a browser tab via
  the mailbox and exchange a `hello`/`welcome` with `Msgpack.kt`.
- Everything else in §4 is, in the Flutter plan's phrase, "a large but ordinary
  engineering job."

## 4. Phased task list

- **P1 World (in progress)** — worldgen, `WorldStore`, raycast, player controller
  and the mesher are done and fixture-verified; the minimal walk-around slice
  (§7) exists. Still to do: a real chunk *streamer* (column load/unload driven by
  player position, a twin of `world/chunkStreamer.ts`), day/night lighting, and
  turning the slice's one-shot radius into that streamer.
- **P2 Game rules** — `:items` (registry, recipes, inventory), `:entities`
  (zombies, pathfinding, drops, crates), `:game` (combat, score, death/respawn,
  autosave to `/api/world`), each a pure module with its own fixture/behaviour
  tests where the TS side has them.
- **P3 Multiplayer** — typed message classes, snapshot buffer, transport,
  host/client sessions (`net/HostSession.ts` / `ClientSession.ts` twins), the
  S1 live handshake, remote players, live cross-play vs a browser tab + Flutter +
  Unity.
- **P4 UI/UX** — Compose main menu, HUD, crafting / invite panels, scoreboard,
  touch tuning, accessibility pass.
- **P5 Ship** — AAB/APK signing & packaging, crash reporting, a perf budget on a
  low-end device.

## 5. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| S1 (WebRTC DataChannel) is unverified — it could still surprise us on a real device (NAT/ICE, the libwebrtc `.aar` ABI set, threading) | High if it fails — blocks all multiplayer | The codec it carries is byte-verified (S2); the signaller is plain HTTP and JVM-testable; run the live handshake first thing in P3 on an emulator before building on it. Pin the libwebrtc version. |
| msgpack byte-layout drift vs msgpackr | High — breaks cross-play silently | Byte-identical across all 24 protocol fixtures (§2.2); re-run `:net:test` on every `protocol.ts` change (regenerate `shared/fixtures/protocol/` first). |
| Cross-language float drift in worldgen/physics | High — different world shape per client | The JVM matched V8 exactly on all 88 generated chunks and every trig sample (§2.3) — better than Unity's Mono (1-ULP `sin`). Re-run `:world:test`/`:physics:test` on any `world/`/`physics/` TS change. Still re-check on a real ARM device before shipping, since a device's libm/JIT is not this dev JVM. |
| `shared/fixtures/` goes stale vs the TS source — **confirmed to happen** (physics raycast sat 5 days stale after the #25 ore change, §2.3) | Medium-high — a stale fixture fails a *correct* port, or passes a broken one | When a fixture test fails, `git log` the fixture vs the TS source before assuming the port is wrong; regenerate with `npm run fixtures:*` in `server/`. CI does not check client/shared drift — run these suites by hand before merging anything touching `shared/` or a client. |
| Three (now four) clients drift in game rules | Medium | Shared fixtures are the contract, not code review — same mitigation as the other plans. |
| Android app build needs the SDK + network for first dependency resolution | Low | SDK present locally; `local.properties` is git-ignored (CI sets `sdk.dir`/`ANDROID_HOME`). Pure-logic modules need neither the SDK nor Android deps. |

## 6. Testing strategy

- **Unit (pure Kotlin/JVM, no Android):** worldgen, protocol, physics/raycast
  (done); items, entities, game rules to come — all fixture-tested against
  `shared/fixtures/`, the same contract the Dart and Unity ports use. Any change
  to the TS source must regenerate `shared/fixtures/` **for every consumer** and
  re-run these suites before merge.
- **Integration (P3):** a live join against a local `php artisan serve` plus a
  real browser tab, on an emulator.
- **Performance (P5):** GL frame-time budget on a mid-range and a low-end Android
  device, tracked per PR.

## 7. Minimal playable vertical slice (2026-10-15)

With S2/S3 GO, the first thing you can actually run, pulled forward from P1:

- **`world/Mesher.kt`** — direct port of `world/mesher.ts` (via
  `mesher.dart`): culled faces, 4-level baked ambient occlusion, separate
  opaque/translucent geometry, vertex colour from the palette (no texture atlas).
- **`:app`** (Android, the only module with engine access — `:world`/`:physics`
  stay Android-free) — a `GLSurfaceView` renderer that builds seed-11 around
  spawn, meshes every non-empty chunk into GLES 3.0 VBOs, and drives a
  `PlayerController` every frame with real swept-AABB collision; a Compose host
  with drag-to-look and on-screen movement controls; a vertex-colour + half-
  lambert shader drawing both faces (the mesher's winding is three.js CCW).
- **`physics` JVM smoke test** — `SliceSmokeTest` composes the real pieces
  headlessly: streams seed-11 around spawn, asserts the mesher produces non-empty
  geometry, then steps the `PlayerController` forward for a simulated second and
  asserts the player stayed on the ground and actually moved. This is the
  device-free analogue of the Unity port's PlayMode smoke test — it proves the
  ported modules compose into something walkable before anyone trusts it
  visually.

**What this is not:** the real game. No chunk streaming that follows the player
(the radius loads once), no HUD, no inventory/crafting, no combat, no day/night,
no multiplayer, no saving. It is a controllable camera in the real voxel world
with real collision — the smallest slice proving the ported modules compose, not
a milestone in §4's phase list. Visual correctness on a device/emulator has not
yet been eyeballed against the browser client.

### On-device run attempt (2026-10-15)

Ran the debug APK on the local Android emulators (`adb install` + launch). The
app **installs, launches, stays up without an app crash, and the Jetpack Compose
HUD renders** (the W/A/S/D + Jump/Sprint controls, in landscape — screenshotted).
Two real runtime bugs were found by running and fixed (committed):

1. `eglChooseConfig failed` on the default `GLSurfaceView` config chooser →
   `setEGLConfigChooser(8, 8, 8, 8, 16, 0)`.
2. The GL world was hidden behind the opaque window background (the SurfaceView
   is hosted in a Compose `AndroidView`) → `setZOrderMediaOverlay(true)`.

**The GLES-3.0 voxel world itself was not confirmed rendered**, blocked by the
dev machine's emulators, not by the app: the only ES 3.0 backend available
(`-gpu swiftshader_indirect`) destabilises under the voxel GL load (`bad color
buffer handle`, emulator process dies), while the host-GPU and `angle_indirect`
paths both resolve to the Intel UHD 620 translator that exposes **only ES 2.0**
(`eglCreateContext … maj 2 min 0 rcv 2`), so an ES 3.0 context can't be created
there. Confirming the render needs a physical device, an emulator system image /
driver combo that gives a stable ES 3.0 surface, or a desktop (LWJGL/ANGLE) GL
harness for the pure mesher output. The logic underneath is independently green
(all fixture suites + the JVM `SliceSmokeTest`).
