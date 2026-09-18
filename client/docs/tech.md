# Tech doc

## Flutter version — 3.47.4 stable, pinned

Pinned in `.github/workflows/client.yml` (`FLUTTER_VERSION`) and by
`environment: sdk: ^3.13.0` in `pubspec.yaml`. Why this exact version, found
during spike S1:

- **3.44** could not run the renderer: the shader-bundle loader never filled
  `float_type` in uniform metadata, so every uniform binding failed on
  Impeller's OpenGL backend ("Float uniform should have a float type"), and the
  Windows embedder had no way to enable Impeller in release builds (env
  switches are compiled out of the release engine).
- **3.47** makes Impeller the default on Windows and Linux, derives the float
  type in the loader, and adds a per-project Flutter GPU switch
  (`DartProject::set_enable_flutter_gpu`, `fl_dart_project_set_enable_flutter_gpu`,
  `io.flutter.embedding.android.EnableFlutterGPU`). The `flutter_gpu` API also
  changed shape between the two (async `ShaderLibrary.fromAsset`,
  `bindVertexBuffer(view)` + `drawIndexed(count)`), so a version bump is a
  deliberate change with a rebuild of `lib/render/`.

`flutter_gpu` is still labelled preview; everything that touches it is behind
`ChunkRenderer` (and later `SkinnedRenderer`) so an API change is one file.

## Shader toolchain

- Sources in `shaders/*.vert|frag` (GLSL 4.60 as impellerc expects; uniform
  blocks, no `layout(location)` needed).
- `block.shaderbundle.json` lists them; `hook/build.dart` calls
  `flutter_gpu_shaders` (`buildShaderBundleJson`), which runs the SDK's
  `impellerc` on every build and writes
  `build/shaderbundles/block.shaderbundle`, registered as an asset in
  `pubspec.yaml`. No manual step, no committed binaries.
- Lighting in the fragment shader follows three.js's physical lights:
  `albedo · (hemisphere + sun · N·L) / π`, then a 1/2.2 gamma to match the
  browser's sRGB output.

## Packages

| Package | Why |
|---|---|
| `flutter_gpu` (SDK) | the renderer; Impeller-native on all three targets |
| `flutter_gpu_shaders`, `hooks` | build hook that compiles the shaders |
| `vector_math` | matrices/vectors (`_64` for the camera, 32-bit for `flutter_gpu` clear values) |
| `http` | API client; `MockClient` in tests |
| `flutter_secure_storage` | bearer token + device token |
| `path_provider` | local save cache directory |
| `crypto` | SHA-256 of fixtures in tests |
| `flutter_webrtc` | RTCPeerConnection + DataChannel on Android/Windows/Linux; wrapped by `RtcFactory` so tests use in-memory peers |
| `fake_async` (dev) | signalling cadence tests |
| later: `flutter_riverpod` (P4), `shared_preferences` (P0) | UI state, settings |

Not used: `flutter_scene` (master channel only; its glTF loader is the
reference for ours), `pointer_lock` (macOS/web only — our runners implement the
`block_survival/mouse` channel instead).

## Platform runners

- **Windows** (`windows/runner/`): `main.cpp` enables Impeller + Flutter GPU;
  `mouse_capture.cpp` implements pointer lock with Raw Input (`WM_INPUT`),
  `ClipCursor`, `ShowCursor(FALSE)`, an 8 ms flush timer, and releases on
  `WM_KILLFOCUS`.
- **Linux** (`linux/runner/`): `my_application.cc` enables Flutter GPU. Mouse
  capture backend is **not written yet**: the Dart side reports
  `isSupported == false` and the game falls back to drag-to-look. Plan: X11 via
  `gdk_seat_grab` + XI2 raw motion; Wayland needs `zwp_relative_pointer_v1` /
  `zwp_pointer_constraints_v1`, which GTK 3 does not expose — likely a small
  Wayland-protocol shim. Untested here (no Linux box); CI builds Linux.
- **Android**: `EnableFlutterGPU` meta-data in the manifest; touch controls are
  pure Dart.

## CI matrix (`.github/workflows/client.yml`)

- `ubuntu-latest`: `dart format --set-exit-if-changed`, `flutter analyze
  --fatal-infos`, `flutter test --coverage`, `flutter build apk --debug`,
  `flutter build linux --debug` (needs `ninja-build libgtk-3-dev libsecret-1-dev`).
- `windows-latest`: `flutter test`, `flutter build windows --debug`.
- Triggered by `client/**` and `shared/**`, so a server change that
  regenerates fixtures runs the Dart contract tests in the same PR.
- The server workflow (`ci.yml`) has no path filter and stays a required check.

## Signing and secrets

- Play: upload key in Play App Signing; the upload keystore as a base64 GitHub
  secret decoded in the release job (`ANDROID_KEYSTORE`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`). Never in the repo.
- Windows MSIX: a code-signing certificate (or Azure Trusted Signing) as a
  secret; unsigned builds are blocked by Smart App Control on stock Windows 11
  (seen during S1 — testers must allow the exe or receive a signed build).
- No secrets in Dart source; the server URL defaults to the `--dart-define`
  (`BS_SERVER_URL`, dev default the Herd site) and the player can change it
  on the sign-in page (kept in `shared_preferences`; changing it drops the
  token from the previous server).

## Packaging

- Android: `flutter build appbundle --release --obfuscate --split-debug-info=build/symbols`.
- Windows: `flutter build windows --release` → MSIX via the `msix` pub package
  (`dart run msix:create`) once the certificate exists; portable zip meanwhile.
- Linux: Flatpak manifest (org.freedesktop.Platform 24.08, bundles the build
  output) as primary; AppImage via `appimagetool` as the no-runtime fallback.
- Version: `pubspec.yaml` `version:`; store builds tagged on `master` as
  `client-vX.Y.Z` (D3).

## Crash reporting

Sentry (`sentry_flutter`) — free tier, Dart + native (NDK, Windows minidumps)
symbolication, no Firebase dependency for the desktop targets. Opt-in toggle
in settings; off in debug.

## Tests

- `test/world/`: primitives + golden worldgen fixtures (all 5 seeds byte-identical).
- `test/net/`: msgpack/protocol fixtures (24 messages byte-identical), signaller cadence, host/client handshake.
- `test/api/`: token flow against a scripted `http` client; `live_server_test.dart` runs when `BS_SERVER_URL`/`BS_EMAIL`/`BS_PASSWORD` are set (passed against a scratch `php -S` server).
- `test/input/`: mouse capture channel, touch state machine + widget.
- Run: `flutter test` in `client/` (fixtures resolve `../shared/`).
