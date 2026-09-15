/// Per-chunk world generation — twin of `server/resources/js/world/terrainGen.ts`:
/// endless ground with floating islands stamped over it. `generateChunk` depends
/// only on (seed, cx, cy, cz), so chunks come out identical in any order.
library;

import 'dart:typed_data';

import 'chunk.dart';
import 'ground_gen.dart';
import 'island_field.dart';
import 'island_template.dart';
import 'palette.dart';
import 'updraft.dart';

/// vertical band of the world: chunks cy 0 .. worldChunksY-1 (y 0..127)
const int worldChunksY = 8;
const int worldHeight = worldChunksY * chunkSize;

/// columns evaluated around a chunk so trees straddling its border are complete
const int _border = 4;
const int _canopy = 2;
const int _cols = chunkSize + 2 * _border;

/// column blocks kept; each is 24×24 heights + tree table
const int _columnCache = 512;

/// a shaft sits at most this far from its island's centre
const int _updraftReach = 8;

final class Spawn {
  const Spawn(this.x, this.y, this.z);

  final double x;
  final double y;
  final double z;
}

final class _IslandRef {
  const _IslandRef(this.island, this.template);

  final PlacedIsland island;
  final IslandTemplate template;
}

/// heights / surfaces / trees for a chunk column plus a border ring around it
final class _ColumnBlock {
  const _ColumnBlock({
    required this.h,
    required this.tree,
    required this.maxY,
    required this.islands,
  });

  final Int16List h;
  final Uint8List tree;

  /// highest non-air block any ground column here can produce
  final int maxY;
  final List<_IslandRef> islands;
}

final class TerrainGenerator {
  TerrainGenerator(this.seed) : ground = GroundModel(seed);

  final int seed;
  final GroundModel ground;
  final IslandTemplates _templates = IslandTemplates();
  final Map<String, _ColumnBlock> _columns = {};
  final Map<String, Updraft> _updrafts = {};

  /// where a new player stands: on the centre of the spawn pad
  Spawn spawn() => Spawn(0.5, (ground.padHeight + 1).toDouble(), 0.5);

  /// the updraft shaft of an island (memoised; a pure function of the island)
  Updraft updraftOf(PlacedIsland island) => _updrafts.putIfAbsent(
    island.key,
    () => updraftFor(island, _templates.get(island), ground.height),
  );

  /// shafts whose axis lies inside the block range [x0, x1] × [z0, z1]
  List<Updraft> updraftsNear(int x0, int z0, int x1, int z1) {
    final out = <Updraft>[];
    for (final island in islandsNear(
      seed,
      x0 - _updraftReach,
      z0 - _updraftReach,
      x1 + _updraftReach,
      z1 + _updraftReach,
    )) {
      final u = updraftOf(island);
      if (u.x >= x0 && u.x <= x1 + 1 && u.z >= z0 && u.z <= z1 + 1) out.add(u);
    }
    return out;
  }

  /// The pristine contents of a chunk, or null when it is all air.
  Uint8List? generateChunk(int cx, int cy, int cz) {
    if (cy < 0 || cy >= worldChunksY) return null;
    final col = _columnBlock(cx, cz);
    final y0 = cy * chunkSize;
    final y1 = y0 + chunkSize - 1;
    final islands = col.islands
        .where(
          (r) =>
              r.island.baseY + r.template.minY <= y1 &&
              r.island.baseY + r.template.maxY >= y0,
        )
        .toList();
    if (y0 > col.maxY && islands.isEmpty) return null;

    final data = Uint8List(chunkVolume);
    var any = false;
    final x0 = cx * chunkSize;
    final z0 = cz * chunkSize;
    for (var lx = 0; lx < chunkSize; lx++) {
      for (var lz = 0; lz < chunkSize; lz++) {
        final h = col.h[(lx + _border) * _cols + lz + _border];
        for (var ly = 0; ly < chunkSize; ly++) {
          final id = _groundBlock(y0 + ly, h);
          if (id == air) continue;
          data[localIndex(lx, ly, lz)] = id;
          any = true;
        }
      }
    }
    if (col.maxY >= y0) any = _stampTrees(data, col, y0) || any;
    for (final r in islands) {
      any =
          _stampIsland(
            data,
            r.template,
            x0 - r.island.x,
            y0 - r.island.baseY,
            z0 - r.island.z,
          ) ||
          any;
    }
    return any ? data : null;
  }

  _ColumnBlock _columnBlock(int cx, int cz) {
    final key = '$cx,$cz';
    final cached = _columns[key];
    if (cached != null) return cached;
    final x0 = cx * chunkSize - _border;
    final z0 = cz * chunkSize - _border;
    final h = Int16List(_cols * _cols);
    var maxY = seaLevel;
    for (var i = 0; i < _cols; i++) {
      for (var j = 0; j < _cols; j++) {
        final v = ground.height(x0 + i, z0 + j);
        h[i * _cols + j] = v;
        if (v > maxY) maxY = v;
      }
    }
    int heightAt(int x, int z) {
      final i = x - x0;
      final j = z - z0;
      return i >= 0 && i < _cols && j >= 0 && j < _cols
          ? h[i * _cols + j]
          : ground.height(x, z);
    }

    final tree = Uint8List(_cols * _cols);
    for (var i = _canopy; i < _cols - _canopy; i++) {
      for (var j = _canopy; j < _cols - _canopy; j++) {
        tree[i * _cols + j] = ground.treeHeight(x0 + i, z0 + j, heightAt);
      }
    }
    final block = _ColumnBlock(
      h: h,
      tree: tree,
      maxY: maxY + treeMaxHeight + 2,
      islands: islandsNear(
        seed,
        cx * chunkSize,
        cz * chunkSize,
        cx * chunkSize + chunkSize - 1,
        cz * chunkSize + chunkSize - 1,
      ).map((island) => _IslandRef(island, _templates.get(island))).toList(),
    );
    if (_columns.length >= _columnCache) _columns.remove(_columns.keys.first);
    _columns[key] = block;
    return block;
  }
}

/// ground column layering: bedrock, stone, 3 dirt, surface, water up to sea level
int _groundBlock(int y, int h) {
  if (y == 0) return Block.bedrock;
  if (y <= h - 4) return Block.stone;
  if (y <= h - 1) return Block.dirt;
  if (y == h) return GroundModel.surfaceFor(h);
  if (y <= seaLevel) return Block.water;
  return air;
}

final class _Tree {
  const _Tree(this.lx, this.lz, this.base, this.height);

  final int lx;
  final int lz;
  final int base;
  final int height;
}

/// Trunks first, then leaves into air only, so overlapping canopies resolve the same way from every chunk.
bool _stampTrees(Uint8List data, _ColumnBlock col, int y0) {
  var any = false;
  void put(int lx, int y, int lz, int id, bool onlyAir) {
    if (lx < 0 ||
        lx >= chunkSize ||
        lz < 0 ||
        lz >= chunkSize ||
        y < y0 ||
        y >= y0 + chunkSize) {
      return;
    }
    final i = localIndex(lx, y - y0, lz);
    if (onlyAir && data[i] != air) return;
    data[i] = id;
    any = true;
  }

  final trees = <_Tree>[];
  for (var i = _border - _canopy; i < _cols - _border + _canopy; i++) {
    for (var j = _border - _canopy; j < _cols - _border + _canopy; j++) {
      final height = col.tree[i * _cols + j];
      if (height != 0) {
        trees.add(
          _Tree(i - _border, j - _border, col.h[i * _cols + j] + 1, height),
        );
      }
    }
  }
  for (final t in trees) {
    for (var dy = 0; dy < t.height; dy++) {
      put(t.lx, t.base + dy, t.lz, Block.log, false);
    }
  }
  for (final t in trees) {
    final top = t.base + t.height;
    for (var dy = -2; dy < 2; dy++) {
      final r = dy < 0 ? 2 : 1;
      for (var dx = -r; dx <= r; dx++) {
        for (var dz = -r; dz <= r; dz++) {
          if (dx.abs() == r && dz.abs() == r && dy != -1) continue;
          put(t.lx + dx, top + dy, t.lz + dz, Block.leaves, true);
        }
      }
    }
    put(t.lx, top + 2, t.lz, Block.leaves, true);
  }
  return any;
}

int _max(int a, int b) => a > b ? a : b;
int _min(int a, int b) => a < b ? a : b;

/// Copy the template's non-air blocks over the chunk; `ox/oy/oz` = chunk origin in island-local space.
bool _stampIsland(Uint8List data, IslandTemplate t, int ox, int oy, int oz) {
  var any = false;
  final lx0 = _max(0, t.minX - ox);
  final lx1 = _min(chunkSize - 1, t.maxX - ox);
  final lz0 = _max(0, t.minZ - oz);
  final lz1 = _min(chunkSize - 1, t.maxZ - oz);
  final ly0 = _max(0, t.minY - oy);
  final ly1 = _min(chunkSize - 1, t.maxY - oy);
  for (var lx = lx0; lx <= lx1; lx++) {
    for (var lz = lz0; lz <= lz1; lz++) {
      for (var ly = ly0; ly <= ly1; ly++) {
        final id = t.get(ox + lx, oy + ly, oz + lz);
        if (id == air) continue;
        data[localIndex(lx, ly, lz)] = id;
        any = true;
      }
    }
  }
  return any;
}
