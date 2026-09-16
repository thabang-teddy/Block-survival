# Block Survival native client — PRD

**Status:** v1 scope, 2026-09-16. Follows the decisions and spike results in
[`docs/flutter-client-plan.md`](../../docs/flutter-client-plan.md).

## Problem

The game is a browser app (Inertia/React + three.js in `server/`). Players on
phones and on PCs without a modern browser session cannot play, and the browser
cannot give the shooter-style input (pointer lock, gamepad) or the performance
headroom a voxel game wants. The native client is the same game, on the same
accounts, in the same rooms.

## Goals

1. **Cross-play, strict (D4).** A native player joins a browser player's room
   and vice versa: same seed → identical chunks, same wire protocol, same save
   format. Enforced by the fixtures in `shared/` (worldgen and protocol both
   byte-identical today).
2. **Same backend.** Token sign-in (`POST /api/auth/token`), same device
   approval by an admin, same leaderboard, cloud saves and global world.
3. **Feature parity with the browser client (D6)** except the admin pages.
4. **Ship** on the Play Store, as a Windows installer and as a Linux package.

## Non-goals (v1)

- Web (the Inertia app stays), iOS, macOS. The stack makes them cheap later:
  `flutter_gpu`, `flutter_webrtc` and the input layer already cover them.
- Admin section. Web only.
- Gamepad on desktop (nice-to-have after v1).
- Voice chat.

## Users

- **Players** on Android phones (touch), Windows and Linux PCs (mouse + keyboard).
- **Admins** keep using the web admin: the native client's device shows up on
  `/admin/devices` like a browser does and is approved the same way.

## Features

| Area | v1 | Notes |
|---|---|---|
| Sign-in | email + password → token; parked on "waiting for approval" until an admin approves the device; sign-out revokes the token | done (S5) |
| Worlds | own world (random seed) and the shared global world; load, autosave, reset own | own/global load + save via `GameApi`; autosave cadence TBD in P2 |
| World | endless ground, floating islands, updrafts, day/night | worldgen done (S2); day/night lighting in renderer; clock in P1 |
| Rendering | chunk meshes with AO, fog, sunset/night palettes; animated zombies, remote players, props (GLB) | chunks done (S1); GLB path in P1/P2 |
| Movement | walk/run/jump, updraft lift, block collision, raycast dig/place | P1 |
| Rules | inventory, hotbar, crafting, drops, crates, zombies + pathfinding, combat (sword, rifle), death → crate → respawn, score | P2 |
| Multiplayer | host a room, invite by name, join by code/invite, ≤ 4 players, WebRTC mesh via the signalling mailbox | transport done (S4); sessions in P3 |
| Global world | join / claim / leave queue | P3 |
| UI | main menu, HUD, crafting panel, invites, pause, scoreboard, chat | P4 |
| Input | desktop mouse look (captured) + keyboard; touch joystick + look-drag + buttons | Windows done, Android layer done, Linux backend pending (S3) |
| Settings | render distance, sensitivity, server URL (on the sign-in page) | P0/P4 |

**Cut list if time is short (in order):** rifle FX polish, third-person camera,
global shared world, invites UI (join by code only).

## Platform minimums

| Platform | Minimum | Why |
|---|---|---|
| Android | API 24 (Android 7), Vulkan-capable GPU recommended; OpenGL ES 3 fallback | Impeller's floor; flutter_gpu needs Impeller |
| Windows | Windows 10 1809+, x64, OpenGL 4.x or Vulkan driver | Impeller on Windows uses OpenGL (ES via ANGLE) today |
| Linux | x64, glibc 2.31+, GTK 3, Mesa 22+ (Vulkan or GL 4.x) | Flatpak bundles Mesa; document the driver floor |
| Flutter | **3.47.4 stable**, pinned | first stable where Impeller is the desktop default and Flutter GPU binds uniforms on GLES |

## Packaging targets

- Android: AAB to Play (internal → closed testing → production).
- Windows: MSIX (signed) — installer per D3; a portable zip for testers.
- Linux: Flatpak (primary; bundles Mesa/GTK) and AppImage.

## Success criteria

- A browser peer and a native peer in the same room see the same world and each
  other's edits (the cross-play E2E in §4 of the plan).
- 60 fps at the default render distance on the reference Android device;
  frame-time p95 tracked per PR.
- No regression in the web client: `php artisan test` and `npm test` stay green
  and the browser flow is unchanged (covered by `TokenAuthTest`).
