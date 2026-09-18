/// A floating island generated once into a dense block template, then stamped
/// into any chunk it overlaps — twin of `server/resources/js/world/islandTemplate.ts`.
library;

import 'dart:typed_data';

import 'island_gen.dart';
import 'palette.dart';

/// room around the nominal radius for the noisy mask and tree canopies
const int _xzMargin = 5;

/// the island hangs up to ~depth × 1.5 below y = 0; peaks + trees reach maxHeight + ~11 above
const int _yBelow = 12;
const int _yAbove = 16;

/// stands in for ±Infinity on the bounds of a template with no blocks yet
const int _unset = 1 << 40;

final class IslandTemplate implements VoxelSink {
  IslandTemplate(IslandParams params)
    : ext = params.size ~/ 2 + _xzMargin,
      yLo = -(params.depth + _yBelow),
      yHi = params.maxHeight + _yAbove {
    sx = ext * 2 + 1;
    sy = yHi - yLo + 1;
    _data = Uint8List(sx * sy * sx);
    padHeight = generateIsland(this, params).padHeight;
  }

  /// tight bounds of the non-air blocks, island-local
  int minX = _unset;
  int minY = _unset;
  int minZ = _unset;
  int maxX = -_unset;
  int maxY = -_unset;
  int maxZ = -_unset;

  /// y of the build pad's top block (only meaningful when params.padRadius > 0)
  late final int padHeight;
  int voxelCount = 0;

  final int ext;
  final int yLo;
  final int yHi;
  late final int sx;
  late final int sy;
  late final Uint8List _data;

  /// block at island-local coordinates; AIR outside the template
  int get(int x, int y, int z) {
    if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) {
      return air;
    }
    return _data[_index(x, y, z)];
  }

  @override
  int getBlock(int x, int y, int z) {
    if (!_inside(x, y, z)) return air;
    return _data[_index(x, y, z)];
  }

  @override
  void setBlock(int x, int y, int z, int id) {
    if (!_inside(x, y, z)) {
      throw StateError('island block $x,$y,$z outside its template');
    }
    final i = _index(x, y, z);
    if (_data[i] == air && id != air) voxelCount++;
    _data[i] = id;
    if (id == air) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  @override
  void setBlockIfAir(int x, int y, int z, int id) {
    if (getBlock(x, y, z) == air) setBlock(x, y, z, id);
  }

  bool _inside(int x, int y, int z) =>
      x >= -ext && x <= ext && z >= -ext && z <= ext && y >= yLo && y <= yHi;

  int _index(int x, int y, int z) =>
      ((z + ext) * sy + (y - yLo)) * sx + (x + ext);
}
