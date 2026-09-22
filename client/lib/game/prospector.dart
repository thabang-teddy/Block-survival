/// The prospector (issue #25) — twin of `server/resources/js/game/prospector.ts`:
/// finding ore you cannot see yet.
///
/// Issue #15 answered "where did the others go?" with a distance and a bearing; this
/// answers "where is the iron?" the same way, so the HUD can reuse the markers. The
/// scan walks the chunks already streamed in around the player and reports one fix per
/// chunk that holds the tuned ore — a vein is about eight blocks and a chunk is sixteen
/// across, so a chunk's centre of mass is the vein, near enough to walk to. A vein lying
/// across a chunk border shows as two markers a couple of metres apart; both lead to the
/// same hole, which is cheaper than clustering and reads no differently.
///
/// It reads the live chunk data rather than asking the generator, so a vein someone has
/// already dug out stops showing, and one a player walled in still does.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:block_survival/world/chunk.dart';

/// the most fixes the HUD will show at once; the nearest win
const int maxFixes = 5;

/// where a pocket of ore is, in world coordinates
final class OreFix {
  const OreFix(this.x, this.y, this.z, this.count, this.distance);

  /// centre of mass of the ore in one chunk
  final double x;
  final double y;
  final double z;

  /// how many blocks of it are in there
  final int count;

  /// metres from the player, straight line
  final double distance;
}

/// The slice of the world the scan needs: `world.getChunk` as a tear-off. Dart has
/// no structural typing, so a callback keeps this free of the World class (and easy
/// to stub in tests) where the TypeScript twin uses a one-method interface.
typedef ChunkSource = Uint8List? Function(int cx, int cy, int cz);

/// Nearest pockets of [ore] within [range] of the player, nearest first.
List<OreFix> scanForOre(
  ChunkSource getChunk,
  int ore,
  double px,
  double py,
  double pz,
  double range,
  int chunksY,
) {
  final fixes = <OreFix>[];
  final r2 = range * range;
  final cx0 = ((px - range) / chunkSize).floor();
  final cx1 = ((px + range) / chunkSize).floor();
  final cy0 = math.max(0, ((py - range) / chunkSize).floor());
  final cy1 = math.min(chunksY - 1, ((py + range) / chunkSize).floor());
  final cz0 = ((pz - range) / chunkSize).floor();
  final cz1 = ((pz + range) / chunkSize).floor();
  for (var cx = cx0; cx <= cx1; cx++) {
    for (var cz = cz0; cz <= cz1; cz++) {
      for (var cy = cy0; cy <= cy1; cy++) {
        // cheapest rejection first: the nearest corner of the chunk box to the player
        if (_boxDistanceSq(
              px,
              py,
              pz,
              (cx * chunkSize).toDouble(),
              (cy * chunkSize).toDouble(),
              (cz * chunkSize).toDouble(),
            ) >
            r2) {
          continue;
        }
        final data = getChunk(cx, cy, cz);
        if (data == null) continue;
        var n = 0;
        var sx = 0;
        var sy = 0;
        var sz = 0;
        for (var i = 0; i < data.length; i++) {
          if (data[i] != ore) continue;
          sx += i >> 8;
          sy += (i >> 4) & (chunkSize - 1);
          sz += i & (chunkSize - 1);
          n++;
        }
        if (n == 0) continue;
        final x = cx * chunkSize + sx / n + 0.5;
        final y = cy * chunkSize + sy / n + 0.5;
        final z = cz * chunkSize + sz / n + 0.5;
        final dx = x - px;
        final dy = y - py;
        final dz = z - pz;
        final distance = math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance > range) continue;
        fixes.add(OreFix(x, y, z, n, distance));
      }
    }
  }
  fixes.sort((a, b) => a.distance.compareTo(b.distance));
  return fixes.length > maxFixes ? fixes.sublist(0, maxFixes) : fixes;
}

/// squared distance from a point to a chunkSize³ box with its low corner at (bx,by,bz)
double _boxDistanceSq(
  double px,
  double py,
  double pz,
  double bx,
  double by,
  double bz,
) {
  final dx = px < bx
      ? bx - px
      : px > bx + chunkSize
      ? px - bx - chunkSize
      : 0.0;
  final dy = py < by
      ? by - py
      : py > by + chunkSize
      ? py - by - chunkSize
      : 0.0;
  final dz = pz < bz
      ? bz - pz
      : pz > bz + chunkSize
      ? pz - bz - chunkSize
      : 0.0;
  return dx * dx + dy * dy + dz * dz;
}
