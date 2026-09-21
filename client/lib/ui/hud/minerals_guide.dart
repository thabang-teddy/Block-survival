/// The minerals guide (issue #25) — twin of `ui/MineralsGuide.tsx`: the in-game
/// answer to "where do I find this?". Every ore, the depth band it lives in, the
/// pickaxe it takes and what it is for, with the band you are standing in called
/// out so the table reads as a map.
library;

import 'package:block_survival/items/registry.dart';
import 'package:block_survival/ui/hud/widgets.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';
import 'package:flutter/material.dart';

/// the pickaxe each tier names, for the "needs" column
const Map<int, String> _tierName = {
  1: 'wooden',
  2: 'stone',
  3: 'copper',
  4: 'iron',
  5: 'diamond',
};

class MineralsGuide extends StatelessWidget {
  const MineralsGuide({super.key, required this.y, required this.surfaceY});

  /// the depth the player is standing at
  final int y;

  /// top block of their column, for "how far down am I?"
  final int surfaceY;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(
          'You are at y $y, ${depthNote(y.toDouble(), surfaceY)} — ${depthBand(y)}. '
          'Bedrock is y 0, the sea is y 32. '
          'Dig down, or follow a cave: ore shows in tunnel walls.',
          style: const TextStyle(fontSize: 13, color: Colors.white70),
        ),
      ),
      for (final o in ores) _OreRow(ore: o, here: y >= o.minY && y <= o.maxY),
      const SizedBox(height: 10),
      Row(
        children: [
          ItemIcon(getItem('prospector')),
          const SizedBox(width: 8),
          const Expanded(
            child: Fine(
              'A prospector (lapis, redstone and iron at a workbench) marks the nearest '
              'veins of one mineral on screen — hold it and place to tune it. '
              'Two emeralds attune it to twice the range.',
            ),
          ),
        ],
      ),
    ],
  );
}

class _OreRow extends StatelessWidget {
  const _OreRow({required this.ore, required this.here});

  final OreDef ore;
  final bool here;

  @override
  Widget build(BuildContext context) {
    final (r, g, b) = blockDefs[ore.block].top;
    final colour = Color.fromARGB(
      255,
      (r * 255).round(),
      (g * 255).round(),
      (b * 255).round(),
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: here ? const Color(0x1AE8B23A) : null,
        border: const Border(top: BorderSide(color: Color(0x12FFFFFF))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 18,
            height: 18,
            margin: const EdgeInsets.only(top: 1),
            decoration: BoxDecoration(
              color: colour,
              borderRadius: BorderRadius.circular(3),
              border: Border.all(color: Colors.black26),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 76,
            child: Text(
              ore.drop,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          SizedBox(
            width: 82,
            child: Row(
              children: [
                Text(
                  'y ${ore.minY}–${ore.maxY}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontFamily: Hud.mono,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (here)
                  Container(
                    margin: const EdgeInsets.only(left: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: Hud.accent,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'HERE',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(
            width: 64,
            child: Text(
              _tierName[ore.tier] ?? '—',
              style: const TextStyle(fontSize: 12, color: Colors.white70),
            ),
          ),
          Expanded(
            child: Text(
              ore.note,
              style: const TextStyle(fontSize: 12, color: Colors.white54),
            ),
          ),
        ],
      ),
    );
  }
}
