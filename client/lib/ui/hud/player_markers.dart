/// Where the other players are (issue #15) — twin of `ui/PlayerMarkers.tsx`:
/// a tag over each player in view with their name and distance, and one
/// pinned to the screen edge, arrow first, for each player out of view.
library;

import 'dart:math' as math;

import 'package:block_survival/game/locator.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/physics/player_controller.dart';
import 'package:block_survival/render/camera.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:flutter/material.dart';

/// an on-screen marker is dropped this close: the player is plainly visible
const double markerNearMetres = 12;

/// markers float this far above the feet
const double markerHeadMetres = PlayerTuning.height + 0.4;

/// an edge-pinned marker stays out of the corner panels (timer, readouts, hotbar)
const double safeX = 64;
const double safeTop = 130;
const double safeBottom = 130;

class PlayerMarkersLayer extends StatelessWidget {
  const PlayerMarkersLayer({super.key, required this.camera, required this.ui});

  final Camera camera;
  final GameUiState ui;

  @override
  Widget build(BuildContext context) {
    if (ui.poses.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final h = constraints.maxHeight;
        if (!w.isFinite || !h.isFinite || h == 0) {
          return const SizedBox.shrink();
        }
        final vp = camera.viewProjection(w / h);
        return Stack(
          children: [for (final pose in ui.poses) ?_marker(vp, pose, w, h)],
        );
      },
    );
  }

  Widget? _marker(Matrix4 vp, PlayerPose pose, double w, double h) {
    final m = projectMarker(vp, pose.x, pose.y + markerHeadMetres, pose.z);
    final dx = pose.x - ui.x;
    final dy = pose.y - ui.y;
    final dz = pose.z - ui.z;
    final distance = math.sqrt(dx * dx + dy * dy + dz * dz).round();
    if (m.onScreen && distance < markerNearMetres) return null;
    var left = (m.x + 1) / 2 * w;
    var top = (1 - m.y) / 2 * h;
    if (!m.onScreen) {
      left = left.clamp(safeX, math.max(safeX, w - safeX));
      top = top.clamp(safeTop, math.max(safeTop, h - safeBottom));
    }
    return Positioned(
      left: left,
      top: top,
      child: FractionalTranslation(
        translation: const Offset(-0.5, -0.5),
        child: _MarkerTag(
          name: pose.name,
          distance: distance,
          angle: m.onScreen ? null : m.angle,
        ),
      ),
    );
  }
}

class _MarkerTag extends StatelessWidget {
  const _MarkerTag({
    required this.name,
    required this.distance,
    required this.angle,
  });

  final String name;
  final int distance;

  /// degrees clockwise from up; null when the player is in view (no arrow)
  final double? angle;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(
      color: Hud.panel,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: Colors.white12),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (angle != null) ...[
          Transform.rotate(
            angle: angle! * math.pi / 180,
            child: const Text(
              '▲',
              style: TextStyle(fontSize: 14, color: Hud.accent),
            ),
          ),
          const SizedBox(width: 6),
        ],
        Text(
          name,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: Color(0xFFDFE8FF),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '$distance m',
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            fontFamily: Hud.mono,
            color: Colors.white70,
          ),
        ),
      ],
    ),
  );
}
