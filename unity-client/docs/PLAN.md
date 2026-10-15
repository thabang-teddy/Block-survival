# Block Survival — Unity client: plan and progress

**Status: P1 started, 2026-10-06.** World generation, the msgpack wire codec,
and physics/raycast/player-controller are all ported and fixture-verified.
Spikes S1 (WebRTC), S2 (msgpack) and S3 (physics) are all **GO** — the full
spike list from §3 is now clear, see §2.1/§2.2/§2.3. A minimal playable
vertical slice now exists on top of that (§7): open `Assets/Scenes/Main.unity`
and press Play to walk around the real seed-11 world. This document is both
the plan and the live progress log — update it at the end of every work
session.

This mirrors the structure of `docs/flutter-client-plan.md`, which is the
project's only precedent for porting this game to a new client, and the same
cross-play bar applies: **worldgen, physics, the wire protocol and the save
format must match the TypeScript implementation exactly, not approximately.**

## 0. Scope (decided)

- **Engine/version:** Unity 6000.6.4f1 (already installed on the dev machine).
  Pin it; re-validate this whole plan before moving to a newer major version.
- **Platforms:** Windows, Android, Linux — same targets as `client/` (the
  Flutter port), for full cross-play parity across every client. Android and
  Linux Unity *build support modules* are **not installed yet** on this
  machine (only Windows + WebGL are) — install them before attempting a
  player build on those platforms. Editor work and tests do not need them.
- **Feature scope v1:** everything the web/Flutter clients have except the
  admin pages (admin stays web-only), matching `docs/flutter-client-plan.md`
  D6's precedent.
- **Cross-play guarantee: strict.** This client must join the same rooms,
  same seeds, same global world as the browser and Flutter clients.
- **Repo layout:** `unity-client/` sits next to `client/`, `server/`,
  `host-app/`, `shared/` — one more peer project, not nested inside any of
  them. `CLAUDE.md` already lists it.

## 1. Decisions

| # | Decision | Chosen | Why |
|---|---|---|---|
| D1 | Rendering | Unity's own renderer (start with the Built-in/Core pipeline the default project uses; revisit URP later), hand-written chunk mesher producing vertex-coloured `Mesh`es — no texture atlas, matching the web client's actual look ("the palette is the look") | Unity has a real 3D engine; unlike the Flutter port there is no D1-style renderer spike needed. Keep the first milestone unblocked by not fighting URP setup yet. |
| D2 | Auth | Reuse the existing `POST /api/auth/token` Sanctum endpoint (built for the Flutter client, §S5 of the Flutter plan) via `UnityWebRequest` + bearer token | Zero backend changes needed; every `/api/*` route already accepts a token. |
| D3 | Realtime networking | WebRTC DataChannel via Unity's `com.unity.webrtc` package (pinned to 3.0.0), signalled through the existing `/api/rooms/{code}/signal[s]` mailbox | Only viable native WebRTC option in Unity. **Confirmed working on Unity 6000.6 — spike S1 is GO** (§2.1), though Unity marks the package deprecated and one native crash was observed once (not yet reproduced again) — watch both. |
| D4 | Wire format | A hand-rolled codec (`BlockSurvival.Net/Msgpack.cs`), direct C# port of `client/lib/net/msgpack.dart` rather than `MessagePack-CSharp` | **Confirmed byte-identical to `msgpackr` — spike S2 is GO** (§2.2). Went straight to the hand-rolled port: the Dart codec's design (operate on generic map/array/primitive values, not typed classes) ports to C# almost mechanically, so there was no reason to spend the spike budget trying to coerce a general-purpose library's own opinions (map encoding width, int/float boundaries) to match msgpackr's instead. |
| D5 | Input | Unity's built-in `Input`/new Input System — native pointer lock and touch support, unlike Flutter which needed a hand-rolled platform channel | Lower risk than the Flutter port's D5; no spike needed, just build it when UI/player-controller work starts. Note: adding `com.unity.inputsystem` 1.11.2 on this Unity 6000.6 install broke compilation (`TreeView` APIs it uses are obsolete in 6000.6) — pin a version known-good for 6000.6 when this is actually wired up, or use the legacy `Input` class instead. |
| D6 | Module layout | One Unity **assembly definition per module**, mirroring `server/resources/js/`'s folders, same as the Dart port's `lib/` layout: `BlockSurvival.World`, `BlockSurvival.Net`, `BlockSurvival.Physics` (all done), then `BlockSurvival.Entities`, `BlockSurvival.Items`, `BlockSurvival.Game`, `BlockSurvival.Render`, `BlockSurvival.Input`, `BlockSurvival.UI` | Same reasoning as the Flutter plan's architecture table: a reader of any client finds the twin module. Pure-logic assemblies (`World`, `Net`, `Physics`, soon `Items`, `Entities`) set `noEngineReferences: true` so they stay engine-agnostic and fixture-testable without the Editor. One naming deviation: the chunk-store class is `WorldStore`, not `World` — see §2.3. |
| D7 | Testing | Unity Test Framework (NUnit) **EditMode** tests, reading `shared/fixtures/` directly via Newtonsoft.Json (`com.unity.nuget.newtonsoft-json`) | The only test runner Unity ships; this is a justified deviation from the C# house style's "prefer xUnit" rule — xUnit cannot run inside the Unity Editor/IL2CPP toolchain. |

## 2. What's done

**`BlockSurvival.World`** (`Assets/Scripts/World/`) — a full C# port of
`server/resources/js/world/*.ts` (ported via the already-proven Dart port in
`client/lib/world/*.dart`, which made the JS-number-semantics quirks explicit
and easy to carry over): `JsMath.cs` (V8 `Math.sin`/`cos`/`hypot`/`round`
emulation, including the fdlibm port), `Noise.cs` (mulberry32 RNG, `hashInt`,
Perlin noise, `fractal2`), `Seed.cs`, `Palette.cs`, `Ores.cs`, `Chunk.cs`,
`GroundGen.cs`, `IslandGen.cs`, `IslandTemplate.cs`, `IslandField.cs`,
`Underground.cs` (caves + ore veins), `Updraft.cs`, `TerrainGen.cs`
(`TerrainGenerator.GenerateChunk`, the top-level entry point), `LruCache.cs`
(a small reusable bounded cache for the memoisation Dart did by hand).

**`BlockSurvival.World.Tests`** (`Assets/Scripts/World/Tests/`) —
`WorldGenFixtureTests.cs`, an EditMode NUnit suite that loads
`shared/fixtures/worldgen/*.json` directly and checks, per seed (11, 1, 12345,
987654321, 2147483646): RNG/hash/Perlin/fractal2/hypot/trig primitives, spawn,
pad height, ground heights, natural heights, tree placement, island
placement + params, island template bounds/voxel-count/SHA-256, updrafts,
`updraftsNear`, `islandsNear`, cave/vein sampling, and full chunk generation
(SHA-256 **and** decompressed byte-for-byte match against the gzip+base64
fixture data). **60/61 assertions pass; the one residual failure is a single
sin() call off by 1 ULP, confirmed to be a Mono-JIT floating-point quirk, not
a logic bug** — see the risk register (§5). Run it with:

```bash
"/c/Program Files/Unity/Hub/Editor/6000.6.4f1/Editor/Unity.exe" -batchmode -nographics \
  -projectPath unity-client -runTests -testPlatform EditMode \
  -testResults unity-client-test-results.xml -logFile unity-client-test.log
```

**Known bug fixed along the way:** `PerlinNoise.SampleNoise` must truncate
through `long` before masking with `& 255` — `fractal2`'s z-slice value
(`seed * 7.31`, and `seed` here can be a `hashInt` output up to ~4.3 billion)
regularly exceeds `int32`, and C#'s `(int)someHugeDouble` is an overflow where
Dart's `.toInt()` (64-bit) is not. Any future porting work that does
`(int)someDouble` on a value that isn't obviously small should go through
`long` first, exactly like `JsMath.JsRound`/`JsTrunc` already do.

**`BlockSurvival.Net`** (`Assets/Scripts/Net/`) — `Msgpack.cs`, a direct C#
port of `client/lib/net/msgpack.dart`'s hand-rolled MessagePack codec: a
generic encoder/decoder over `null`/`bool`/`long`/`double`/`string`/`byte[]`/
`List<object>`/`MsgpackMap` (an explicitly insertion-ordered string-keyed map
— msgpack map key order is wire-visible, and a plain `Dictionary<,>`'s
enumeration order is an implementation detail, not a guarantee, so relying on
it would be the kind of bug that only shows up once in a while). No typed
message classes yet (`ClientMessage`/`HostMessage`/etc. from `protocol.ts`) —
those are a `BlockSurvival.Game`/`BlockSurvival.Net` ergonomics task for P3,
not part of the byte-parity question this spike answers.

**`BlockSurvival.Net.Tests`** — `ProtocolFixtureTests.cs`, an EditMode suite
over all 24 messages in `shared/fixtures/protocol/messages.json` (client and
host, including Unicode text, `null`s, nested objects/arrays, negative and
large numbers): encode the fixture's JSON-derived value and diff the bytes,
decode the fixture bytes and diff the resulting value, decode-then-re-encode
and diff the bytes again. **All 72 assertions (24 messages × 3 checks) pass.**

## 2.1 Spike S1 result — WebRTC on Unity 6000.6: **GO** (2026-10-06)

`com.unity.webrtc` is on version **3.0.0** now (released 2025-09-26, well
after the research that informed D3 — the "only up to 2022.3/2023.1 LTS"
docs were stale), and it declares `"unity": "6000.0"` in its own
`package.json`. Added it to `unity-client/Packages/manifest.json`:

- **Compiles cleanly** against Unity 6000.6.4f1 — no errors.
- Package Manager still prints `com.unity.webrtc is deprecated: This feature
  set is no longer supported on this editor version` on every load. This is a
  real signal (Unity isn't actively maintaining/testing this "feature" going
  forward), not a false alarm — noted as a standing risk, not dismissed.
- Ran the package's **own shipped test suite** (`Tests/Runtime/`, 204 tests —
  `PeerConnectionTest`, `DataChannelTest`, `IceCandidateTest`, `ContextTest`,
  `NativeAPITest`, etc.) as PlayMode tests by temporarily adding
  `"testables": ["com.unity.webrtc"]` to the manifest. Everything this project
  actually needs passed, repeatably, across two clean runs: `CreateOffer`,
  `SetLocalDescription`, `SetRemoteDescription`, `AddIceCandidate`,
  `IceConnectionStateChange`, `PeerConnectionStateChange`,
  `CanTrickleIceCandidates`, and — the one that matters most —
  `DataChannelTest.SendAndReceiveMessage`. 182/204 passed; the only failures
  were H.264/VP8 **video** decode tests timing out (irrelevant — Block
  Survival's protocol is DataChannel-only, no video tracks).
- **One reproducibility concern:** the very first run segfaulted the Editor
  process, crashing inside `webrtc.dll` itself (`StatsGetTimestamp` /
  `PeerConnectionRegisterOnIceCandidate`, on a background thread, right at
  native-plugin load). Two subsequent clean runs did not reproduce it. Treat
  this as a real but apparently rare instability in the native plugin, not a
  one-off to ignore — watch for it once real gameplay code is driving the
  plugin continuously rather than a single Editor test pass.
- `testables` was removed again afterwards — the package's own 200+ tests
  (mostly video-codec-focused) shouldn't run on every future EditMode/PlayMode
  pass of this project; `com.unity.webrtc: 3.0.0` stays as a normal
  dependency.

**Verdict: proceed with D3 as planned**, with two things to carry forward:
watch for the native crash recurring once a real `MonoBehaviour` drives the
plugin every frame, and don't be surprised if a future Unity Editor update
drops support outright (it's marked deprecated) — pin the Editor version
(already decided, §0) and re-run this check before ever upgrading it.

## 2.2 Spike S2 result — msgpack byte parity: **GO** (2026-10-06)

Ported `client/lib/net/msgpack.dart` to C# directly (`BlockSurvival.Net/Msgpack.cs`)
rather than trying `MessagePack-CSharp` first as originally planned — once the
Dart file was re-read, it was obviously already engine/language-agnostic
(a generic codec over dynamic values, no Dart-specific types involved beyond
`Uint8List`/`Map`/`List`), so porting it line-for-line was both faster and
lower-risk than fighting a general-purpose library's own defaults (map
encoding width, int-vs-float boundaries, map16 vs fixmap) to match msgpackr's
specific choices.

`ProtocolFixtureTests.cs` loads all 24 messages from
`shared/fixtures/protocol/messages.json` (every `ClientMessage`/`HostMessage`
shape from `protocol.ts`: `hello`, `input`, `break`, `place`, `craft`,
`moveSlot`, `dropHeld`, `interact`, `swing`, `fire`, `reload`, `chat`,
`welcome`, `snap`, `state`, `blocks`, `full`, `bye`, including edge cases like
a `null` field, Unicode text, nested `BlockEdit`/`PropMeta` objects, and an
empty snapshot) and for each one: encodes the fixture's value and diffs the
bytes, decodes the fixture bytes and diffs the resulting value, and
decodes-then-re-encodes and diffs the bytes again. **All 72 assertions
(24 messages × 3 checks) passed on the first run — no bugs found**, unlike
the worldgen port. Likely why: `js_math.dart`'s number-semantics lessons
(64-bit int truncation, explicit byte-order math) were already applied while
transcribing, instead of being discovered by a failing test afterward.

**Verdict: proceed with D4 as planned.** Typed message classes
(`ClientMessage`/`HostMessage` as C# types, instead of hand-building
`MsgpackMap`s at every call site) are deferred to P3, where the transport
layer actually needs ergonomic send/receive calls — building them now would
be speculative.

## 2.3 Spike S3 result — physics fixtures: **GO** (2026-10-06)

Turned out to need more than just `aabb.ts`/`playerController.ts`: `walk.json`
and `raycast.json` are generated against a real streamed seed-11 world, so
this spike also ported `world/chunkStore.ts`'s `World` class (as
`BlockSurvival.World/WorldStore.cs` — named `WorldStore`, not `World`,
specifically to avoid a self-inflicted trap: a type literally named `World`
inside the `BlockSurvival.World` namespace would resolve ahead of the
namespace itself the next time someone wrote `World.Block.X` meaning the
namespace qualifier, exactly the mistake already made once during the
worldgen port) and `world/raycast.ts` (`BlockSurvival.World/Raycast.cs`).
`BlockSurvival.Physics` (new assembly, references `BlockSurvival.World`) got
`Aabb.cs` (`Box`, `MoveResult`, `BoxIntersectsSolid`, `MoveBox`, `RayBox`) and
`PlayerController.cs` (`PlayerTuning`, `PlayerState`, `IPlayerInput`,
`KeySetInput`, the controller itself — WASD, mouse look, sprint/stamina,
jump, gravity, step-up, updraft riding).

`PhysicsFixtureTests.cs` checks all three fixtures: `aabb.json` (45
hand-built `moveBox` cases), `raycast.json` (224 rays against the streamed
world), and `walk.json` (828 ticks of a scripted walk — turn, sprint, jump a
cliff, ride the legacy island's updraft — replayed tick-for-tick by feeding
each fixture tick's own recorded keys/look/jump/frozen/teleport into
`PlayerController.Update` and diffing all 13 state fields every tick, rather
than re-deriving the walk script independently). **aabb and walk passed
immediately. raycast failed on one case** — not a porting bug:

**Found and fixed a real staleness bug in the existing repo, unrelated to
this port.** Ray 102 expected `block: 3` (stone) at world `(12, 73, -1)`
(inside the legacy floating island's underside) but the C# port — and a
from-scratch direct call to `TerrainGenerator.GenerateChunk`, and the exact
bytes already committed in `shared/fixtures/worldgen/seed-11.json` — all
agreed on `block: 20` (copper ore). `shared/fixtures/physics/` was committed
in `0254426` (2026-09-16), five days *before* `5eb30a7` (2026-09-21, "all
eight Overworld minerals, caves to find them in, and a prospector #25") added
the ore roll inside island stone — the physics fixtures were simply never
regenerated after that change, even though `shared/fixtures/worldgen/` was.
Ran `npm run fixtures:physics` in `server/` to regenerate: exactly one line
of `raycast.json` changed (that ray's `block` field, `3` → `20`); `aabb.json`
and `walk.json` were untouched. All 136 assertions pass after that.
**This likely means `client/test/physics/physics_fixtures_test.dart` (the
Dart client also reads `raycast.json`) has been silently broken since
2026-09-21 too** — `shared/README.md` already notes CI doesn't check
client/shared drift, only a manual `flutter test` would have caught it.
Worth a `flutter test` run in `client/` to confirm and, if so, this fixture
regeneration fixes that too (same file, already committed by this session).

**Verdict: proceed with the physics module as ported.** No tuning constants
or algorithms needed to change — this was a fixture-freshness bug in the
existing repo, not a cross-language semantics bug like the Perlin one in
§2 above.

## 3. Immediate next spikes

S1, S2 and S3 are all done (§2.1-§2.3: all GO) — every spike originally
identified has a result. One follow-up remains before P3 can start for real:

- **S1-follow-up — live signalling handshake.** §2.1 only proves the WebRTC
  package *works in isolation* (its own test suite, no real network peer).
  Still needed: a real offer/answer/ICE-candidate exchange through the actual
  `/api/rooms/{code}/signal[s]` mailbox (`php artisan serve` locally) ending
  in an open DataChannel to a running browser tab, now using the real
  `Msgpack.cs` codec (§2.2) to exchange an actual `hello`/`welcome` pair.
  Worth doing once there's at least a stub signaller/transport in
  `BlockSurvival.Net` to drive it — doing it with throwaway script code now
  would just be thrown away.

With no more gating spikes, the rest of P1/P2/P3 (§4) is "a large but
ordinary engineering job" — the same phrase the Flutter plan used once its
own S1/S2 passed.

## 4. Phased task list (after the spikes)

Same phase shape as the Flutter plan, adapted:

- **P1 World (in progress)** — worldgen, `WorldStore`, raycast and the full
  player controller are done and fixture-verified; still needed: the chunk
  streamer proper (`world/chunkStreamer.ts` twin — column load/unload driven
  by player position, not a fixed radius loaded once), the mesher
  (`world/mesher.ts` twin → Unity `Mesh`), a `MonoBehaviour` that drives the
  streamer/mesher/`PlayerController` together and renders the result,
  wiring `IPlayerInput` to Unity's actual input, day/night lighting.
- **P2 Game rules** — `BlockSurvival.Items` (registry, recipes, inventory —
  port `items/*.ts`), `BlockSurvival.Entities` (zombies, pathfinding, drops,
  crates — port `entities/*.ts`), combat, score, death/respawn, autosave to
  `/api/world`.
- **P3 Multiplayer** — builds on S1/S2 (both GO): typed message classes,
  snapshot buffer, transport, host/client session logic (twins of
  `net/HostSession.ts` / `ClientSession.ts`), invites, remote player
  rendering, the still-outstanding S1-follow-up live handshake, a live
  cross-play test against a running browser tab and the Flutter client.
- **P4 UI/UX** — main menu, HUD, crafting panel, invite panel, scoreboard,
  per-platform input (D5), accessibility pass.
- **P5 Ship** — install Android/Linux build support modules, store listings,
  installers/packaging, crash reporting, performance budget sign-off on a
  low-end Android device and on Linux/Mesa.

## 5. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| `com.unity.webrtc` is marked deprecated by Unity for this editor version, and crashed the Editor once (native crash in `webrtc.dll`, not reproduced since) | High if it recurs under real sustained use — blocks all multiplayer | Confirmed working for everything this game needs (§2.1); re-run the package's own `Tests/Runtime/` suite (`testables`) if the crash resurfaces once gameplay code drives it continuously, and before any future Unity Editor upgrade |
| msgpack byte layout drift vs `msgpackr` | High — breaks cross-play silently | Confirmed byte-identical across all 24 protocol fixtures (§2.2); re-run `ProtocolFixtureTests` on every `protocol.ts` change (regenerate `shared/fixtures/protocol/` first) |
| Mono Editor JIT produces a 1-ULP-different `sin()` for rare inputs (confirmed: `JsMath.JsSin(3.22637297972782)` matches the fixture exactly under `dotnet run` on CoreCLR but not inside the Unity Editor's Mono EditMode test run) | Low in practice (zero effect on any of the 88 generated chunks across 5 seeds, or any other fixture value) but means "byte-exact" isn't literally true in the Editor | Treat Editor/Mono EditMode runs as a strong but not perfect signal; validate worldgen fixture tests again on an IL2CPP player build before shipping, since IL2CPP compiles to native code and shouldn't share Mono's quirk. Do not spend more time chasing this specific ULP unless a real chunk mismatch is ever traced to it. |
| Android/Linux build support modules not installed locally | Low, just unblocked by an install | Install via Unity Hub before the first Android/Linux player build (P5, or sooner if a platform-specific bug needs reproducing) |
| `com.unity.inputsystem` 1.11.2 breaks compilation on Unity 6000.6 (obsolete `TreeView` APIs) | Low, deferred | Don't add the package until P4; pin whatever version is current/compatible at that time, or use the legacy `Input` class |
| Two (now three) codebases drift in game rules | Medium | Same mitigation as the Flutter plan: shared fixtures are the contract, not code review |
| `shared/fixtures/` itself goes stale relative to the TS source — **confirmed to actually happen**: `shared/fixtures/physics/` sat 5 days out of date after `5eb30a7` added ore-in-islands, until this session's S3 spike caught and fixed it (§2.3). `shared/README.md` already says CI doesn't check `client/` drift, only a manual `flutter test` would | Medium-high — a stale fixture makes a *correct* new port fail, or worse, a genuinely broken port pass against an equally-broken fixture | When a physics/world/protocol fixture test fails, check whether `shared/fixtures/` is actually current for the TS source (`git log` both) before assuming the C# port is wrong. The Dart client likely has the same `raycast.json` failure right now — worth a `flutter test` in `client/` to confirm it's fixed by the same regeneration |

## 6. Testing strategy

- **Unit (pure C#, `noEngineReferences: true` assemblies)** — worldgen,
  protocol, physics/raycast (all done), items, entities still to come:
  fixture-tested against `shared/fixtures/`, same contract the Dart port
  uses. Any change to `resources/js/world/*.ts` (or `physics/*.ts`, etc.)
  must regenerate `shared/fixtures/` **for every consumer, not just the one
  you're thinking about** (§2.3 found `shared/fixtures/physics/` had been
  missed for five days after a `world/islandGen.ts` change); re-run the
  Unity EditMode suite before merging anything that touches `shared/` or
  `unity-client/`.
- **Integration** — once P3 lands, a live join against a local
  `php artisan serve` plus a real browser tab, mirroring the Flutter plan's
  cross-play E2E check.
- **Performance** — once rendering exists, frame-time budget on the same
  reference devices the Flutter plan uses (a mid-range Android phone, Linux
  on Intel iGPU), tracked per PR.

## 7. Minimal playable vertical slice (2026-10-06)

With all three spikes GO, built the first thing you can actually press Play
on, pulled forward from P1's task list:

- **`Mesher.cs`** (`BlockSurvival.World`, pure C#) — direct port of
  `world/mesher.ts` (via `client/lib/world/mesher.dart`): culled faces, 4-level
  baked ambient occlusion, separate opaque/translucent geometry, vertex colour
  from the palette (no texture atlas, matching the web client).
- **`BlockSurvival.App`** (new assembly, normal Unity engine access —
  `BlockSurvival.World`/`Physics` stay `noEngineReferences: true`, this is
  where that logic finally meets `MonoBehaviour`): `ChunkMeshBuilder.cs`
  (plain `MeshData` → Unity `Mesh`), `UnityPlayerInput.cs` (maps the
  `KeyboardEvent.code` strings `PlayerController` expects onto
  `UnityEngine.Input`), `GameBootstrap.cs` (loads a 7×7 column radius around
  spawn for seed 11, meshes every non-empty chunk, spawns a camera driven by
  `PlayerController` every frame).
- Two small Built-in-RP shaders (`Assets/Shaders/VertexColor{Opaque,Transparent}.shader`)
  — unlit-ish, a hardcoded half-lambert term for depth, `Cull Off` (the
  mesher's winding is CCW-from-outside per `three.js` convention; rather than
  re-derive Unity's left-handed winding rule, both shaders just draw both
  sides).
- `Assets/Editor/SceneBuilder.cs` + `Assets/Scenes/Main.unity` — a scene with
  one `Game` object holding `GameBootstrap`, registered as the project's
  start scene. Rebuild it any time with
  `Unity.exe -batchmode -nographics -projectPath unity-client -executeMethod BlockSurvival.EditorTools.SceneBuilder.BuildMainScene -quit`.
- `GameBootstrapSmokeTest.cs` (`BlockSurvival.App.Tests`, PlayMode) —
  instantiates `GameBootstrap` standalone (not through the scene), runs two
  frames, asserts a camera and at least one chunk mesh exist. **Passed** —
  confirms Start()/Update() run with no exceptions before asking anyone to
  trust it visually, which nothing before this section could do (everything
  up to here was EditMode-only, headless, non-visual).

**What this is not:** the real game. No chunk streaming (the radius loads
once, never follows the player), no HUD, no inventory/crafting, no combat, no
day/night, no multiplayer, no saving. It is a controllable camera in the real
voxel world with real collision — the smallest slice that proves the ported
modules compose into something you can walk around in, not a milestone in
`§4`'s phase list.

**Mouse-look sign convention: verified correct (2026-10-07), via the
MCP-for-Unity Editor connection.** Checked against the browser client's own
semantics (`playerController.ts` + `Game.ts`'s `camera.rotation.set(pitch,
yaw, 0)`, three.js): positive `pitch` means look up there. Drove the live
Editor directly (`execute_code` against the running `GameBootstrap`
instance) rather than reasoning in the abstract:
- Called `PlayerController.Look(0, +100)` directly — `+100` is
  `GameBootstrap`'s post-flip "mouse moved down" convention. `State.Pitch`
  went `0 → -0.22`, i.e. looking down, matching the web client.
- Reproduced `GameBootstrap.Update`'s exact `pitchDeg`/`yawDeg` formula in
  isolation and checked the resulting Unity `Quaternion.Euler` forward
  vector: a web-semantics "look up" pitch (`+0.5`) produces `forward.y > 0`
  in Unity too.
- Checked the `+ 180°` yaw offset isn't an accidental bug: at `yaw = 0` the
  physics moves in world `-Z` (per `playerController.ts`'s own comment), and
  `Quaternion.Euler(0, 180, 0) * Vector3.forward` is exactly `(0, 0, -1)` —
  so the camera's visual facing already matches the direction of travel.

All three (pitch sign, yaw sign, the yaw+180 offset) are correct as
committed; no code change was needed. Visual correctness beyond that (does
it actually *look* like Block Survival, are the AO/shading reasonable) was
eyeballed via an in-Editor screenshot (seed-11 spawn: grass, a dirt
stair-stepped slope with visible per-face AO, water, sky) and looks
reasonable, but hasn't been compared side-by-side against the browser
client's actual output.
