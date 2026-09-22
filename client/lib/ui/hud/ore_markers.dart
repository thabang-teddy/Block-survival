/// Where the ore is (issue #25) — twin of `ui/OreMarkers.tsx`. The prospector's
/// answer to the same question the player markers answer about people: a tag over
/// each pocket in view, and one pinned to the screen edge, arrow first, for each
/// pocket behind you. Tinted with the ore's own colour so a tuned lens reads at a
/// glance.
library;

import 'dart:math' as math;

import 'package:block_survival/game/game.dart' show oreMarkerNearMetres;
import 'package:block_survival/game/locator.dart';
import 'package:block_survival/game/prospector.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/render/camera.dart';
import 'package:block_survival/ui/hud/player_markers.dart'
    show safeBottom, safeTop, safeX;
import 'package:block_survival/ui/theme.dart';
import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';
import 'package:flutter/material.dart';

/// the ore's block colour, lifted so it reads on the dark panel
Color oreColour(int block) {
  final def = blockDef(block);
  if (def == null) return Hud.accent;
  final (r, g, b) = def.top;
  int ch(double v) => (v * 255 * 1.5).clamp(0, 255).round();
  return Color.fromARGB(255, ch(r), ch(g), ch(b));
}

class OreMarkersLayer extends StatelessWidget {
  const OreMarkersLayer({super.key, required this.camera, required this.ui});

  final Camera camera;
  final GameUiState ui;

  @override
  Widget build(BuildContext context) {
    final p = ui.prospector;
    if (p == null || ui.oreFixes.isEmpty) return const SizedBox.shrink();
    final name = oreOf(p.ore)?.drop ?? 'ore';
    final colour = oreColour(p.ore);
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final h = constraints.maxHeight;
        if (!w.isFinite || !h.isFinite || h == 0) {
          return const SizedBox.shrink();
        }
        final vp = camera.viewProjection(w / h);
        return Stack(
          children: [
            for (final fix in ui.oreFixes) ?_marker(vp, fix, name, colour, w, h),
          ],
        );
      },
    );
  }

  Widget? _marker(
    Matrix4 vp,
    OreFix fix,
    String name,
    Color colour,
    double w,
    double h,
  ) {
    if (fix.distance < oreMarkerNearMetres) return null;
    final m = projectMarker(vp, fix.x, fix.y, fix.z);
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
        child: _OreTag(
          name: name,
          colour: colour,
          distance: fix.distance.round(),
          count: fix.count,
          angle: m.onScreen ? null : m.angle,
        ),
      ),
    );
  }
}

class _OreTag extends StatelessWidget {
  const _OreTag({
    required this.name,
    required this.colour,
    required this.distance,
    required this.count,
    required this.angle,
  });

  final String name;
  final Color colour;
  final int distance;
  final int count;

  /// degrees clockwise from up; null when the pocket is in view (no arrow)
  final double? angle;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(
      color: Hud.panel,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: colour),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (angle != null) ...[
          Transform.rotate(
            angle: angle! * math.pi / 180,
            child: Text('▲', style: TextStyle(fontSize: 14, color: colour)),
          ),
          const SizedBox(width: 6),
        ],
        Text(
          name,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: colour,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '$distance m · $count',
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

/// The prospector readout: what it is tuned to, how far it reaches, what it found.
class ProspectorReadout extends StatelessWidget {
  const ProspectorReadout({super.key, required this.ui});

  final GameUiState ui;

  @override
  Widget build(BuildContext context) {
    final p = ui.prospector;
    if (p == null) return const SizedBox.shrink();
    final name = oreOf(p.ore)?.drop ?? 'ore';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: Hud.panel,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'PROSPECTOR · ${p.range.round()} M',
            style: const TextStyle(
              fontSize: 10,
              letterSpacing: .5,
              color: Colors.white60,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            name,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: oreColour(p.ore),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            p.found > 0 ? '${p.found} nearby' : 'nothing in range',
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
}
