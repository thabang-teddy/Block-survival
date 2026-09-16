/// Where the floating islands are — twin of `server/resources/js/world/islandField.ts`.
/// The sky is divided into [islandCell]-metre cells; each cell hashes (seed, ix, iz)
/// to decide whether it holds an island and what it looks like. Cell (0, 0) is the
/// legacy island over the spawn pad.
library;

import 'island_gen.dart';
import 'island_template.dart';
import 'js_math.dart';
import 'noise.dart';

const int islandCell = 96;
const double islandChance = 0.5;

/// lowest grass layer of a generated island floats between these heights
const int islandMinY = 80;
const int islandMaxY = 96;
const int legacyIslandY = 80;

/// widest island plus the room its trees need; centres stay this far inside their cell
const int maxHalfExtent = 33;

/// templates kept in memory; islands beyond that are regenerated when needed
const int _templateCache = 48;

const int _saltExists = 1;
const int _saltOffsetX = 2;
const int _saltOffsetZ = 3;
const int _saltSize = 4;
const int _saltHeight = 5;
const int _saltDepth = 6;
const int _saltLake = 7;
const int _saltSeed = 8;
const int _saltBaseY = 9;

final class PlacedIsland {
  const PlacedIsland({
    required this.ix,
    required this.iz,
    required this.x,
    required this.z,
    required this.baseY,
    required this.params,
  });

  final int ix;
  final int iz;

  /// world x/z of the island centre
  final int x;
  final int z;

  /// world y of the island's lowest grass layer (template y = 0)
  final int baseY;
  final IslandParams params;

  String get key => '$ix,$iz';
}

/// The island in a sky cell, or null for an empty cell. Pure in (seed, ix, iz).
PlacedIsland? islandAtCell(int seed, int ix, int iz) {
  if (ix == 0 && iz == 0) {
    return PlacedIsland(
      ix: ix,
      iz: iz,
      x: 0,
      z: 0,
      baseY: legacyIslandY,
      params: islandLarge,
    );
  }
  if (hash01(seed, ix, iz, _saltExists) >= islandChance) return null;
  final size =
      24 + 2 * (hash01(seed, ix, iz, _saltSize) * 17).floor(); // 24..56, even
  const maxJitter = islandCell / 2 - maxHalfExtent;
  final jx = (hash01(seed, ix, iz, _saltOffsetX) * 2 - 1) * maxJitter;
  final jz = (hash01(seed, ix, iz, _saltOffsetZ) * 2 - 1) * maxJitter;
  return PlacedIsland(
    ix: ix,
    iz: iz,
    x: jsRound(ix * islandCell + islandCell / 2 + jx),
    z: jsRound(iz * islandCell + islandCell / 2 + jz),
    baseY:
        islandMinY +
        (hash01(seed, ix, iz, _saltBaseY) * (islandMaxY - islandMinY + 1))
            .floor(),
    params: IslandParams(
      size: size,
      seed: hashInt(seed, ix, iz, _saltSeed),
      maxHeight: 5 + (hash01(seed, ix, iz, _saltHeight) * 5).floor(), // 5..9
      depth: 9 + (hash01(seed, ix, iz, _saltDepth) * 8).floor(), // 9..16
      padRadius: 0,
      lake: hash01(seed, ix, iz, _saltLake) < 0.4,
      treeDensity: 0.022,
    ),
  );
}

/// Islands whose footprint may overlap the block range [x0, x1] × [z0, z1].
/// The player controller passes fractional positions, so the bounds are num.
List<PlacedIsland> islandsNear(int seed, num x0, num z0, num x1, num z1) {
  final out = <PlacedIsland>[];
  // `/` then floor, not `~/`: the range goes negative
  final ix0 = ((x0 - maxHalfExtent) / islandCell).floor();
  final ix1 = ((x1 + maxHalfExtent) / islandCell).floor();
  final iz0 = ((z0 - maxHalfExtent) / islandCell).floor();
  final iz1 = ((z1 + maxHalfExtent) / islandCell).floor();
  for (var ix = ix0; ix <= ix1; ix++) {
    for (var iz = iz0; iz <= iz1; iz++) {
      final island = islandAtCell(seed, ix, iz);
      if (island == null) continue;
      if (island.x + maxHalfExtent < x0 || island.x - maxHalfExtent > x1) {
        continue;
      }
      if (island.z + maxHalfExtent < z0 || island.z - maxHalfExtent > z1) {
        continue;
      }
      out.add(island);
    }
  }
  return out;
}

/// Memoised island templates (generation is ~10 ms for a large island).
final class IslandTemplates {
  final Map<String, IslandTemplate> _cache = {};

  IslandTemplate get(PlacedIsland island) {
    final key = island.key;
    final cached = _cache.remove(key);
    if (cached != null) {
      _cache[key] = cached; // refresh LRU position
      return cached;
    }
    final t = IslandTemplate(island.params);
    if (_cache.length >= _templateCache) _cache.remove(_cache.keys.first);
    _cache[key] = t;
    return t;
  }
}
