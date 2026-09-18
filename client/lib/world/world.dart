/// Sparse voxel world — twin of `World` in `server/resources/js/world/chunkStore.ts`.
/// 16³ chunks of block ids keyed by chunk coordinate; x/z horizontal, y up.
///
/// Two modes:
/// - **static** (tests, templates): `setBlock` allocates chunks on demand.
/// - **streamed** (the game): a [ChunkGenerator] produces any chunk on demand
///   and columns are loaded / unloaded by the streamer. Player edits are the
///   source of truth: they stay in `edits` for the life of the world and are
///   re-applied on top of the generated chunk whenever a column loads.
library;

import 'dart:typed_data';

import 'package:block_survival/world/chunk.dart';
import 'package:block_survival/world/palette.dart';

/// Extra data for prop blocks (torch, workbench, bed).
final class PropMeta {
  const PropMeta({
    required this.id,
    required this.x,
    required this.y,
    required this.z,
    required this.yaw,
    this.partner,
    required this.primary,
  });

  final int id;
  final int x;
  final int y;
  final int z;

  /// facing in radians, a multiple of π/2
  final double yaw;

  /// for multi-cell props: the other cell; `primary` cells own the model
  final (int, int, int)? partner;
  final bool primary;
}

final class Edit {
  const Edit(this.x, this.y, this.z, this.id);

  final int x;
  final int y;
  final int z;
  final int id;
}

/// Produces the pristine contents of one chunk, or null when it is all air.
typedef ChunkGenerator = Uint8List? Function(int cx, int cy, int cz);

typedef ChunkKey = (int, int, int);

String blockKey(int x, int y, int z) => '$x,$y,$z';

final class World {
  final Map<ChunkKey, Uint8List> _chunks = {};
  ChunkKey? _lastKey;
  Uint8List? _lastChunk;
  final Set<ChunkKey> _dirty = {};
  List<ChunkKey> _removed = [];
  ChunkGenerator? _generator;
  int _chunksY = 0;
  final Set<(int, int)> _loadedColumns = {};

  /// prop block metadata keyed by blockKey; bumps [propsVersion] on change
  final Map<String, PropMeta> props = {};
  int propsVersion = 0;

  /// when true, every block change is recorded in [edits] (enable after generation)
  bool trackEdits = false;
  final Map<String, Edit> edits = {};
  final Map<ChunkKey, Map<String, Edit>> _editsByChunk = {};

  /// Switch to streamed mode: chunks come from `generator`, columns via [loadColumn].
  void setGenerator(ChunkGenerator generator, int chunksY) {
    _generator = generator;
    _chunksY = chunksY;
  }

  bool get isStreamed => _generator != null;

  Uint8List? getChunk(int cx, int cy, int cz) => _chunks[(cx, cy, cz)];

  Iterable<ChunkKey> get chunkKeys => _chunks.keys;

  int get chunkCount => _chunks.length;

  int get loadedColumnCount => _loadedColumns.length;

  /// Static worlds count as fully loaded; streamed worlds only where a column was loaded.
  bool isColumnLoaded(int x, int z) =>
      _generator == null ||
      _loadedColumns.contains((chunkCoord(x), chunkCoord(z)));

  bool isChunkColumnLoaded(int cx, int cz) =>
      _generator == null || _loadedColumns.contains((cx, cz));

  int getBlock(int x, int y, int z) {
    final k = (chunkCoord(x), chunkCoord(y), chunkCoord(z));
    Uint8List? c;
    if (k == _lastKey) {
      c = _lastChunk;
    } else {
      c = _chunks[k];
      _lastKey = k;
      _lastChunk = c;
    }
    return c == null ? air : c[localIndex(x, y, z)];
  }

  bool hasBlock(int x, int y, int z) => getBlock(x, y, z) != air;

  /// Write a block and mark affected chunks dirty. Static mode allocates the
  /// chunk if needed; streamed mode only records the edit when the column is
  /// not loaded (it is applied when the column loads).
  void setBlock(int x, int y, int z, int id) {
    final cx = chunkCoord(x);
    final cy = chunkCoord(y);
    final cz = chunkCoord(z);
    final key = (cx, cy, cz);
    final pk = blockKey(x, y, z);
    var c = _chunks[key];
    if (c == null) {
      if (_generator != null && !_loadedColumns.contains((cx, cz))) {
        if (props.remove(pk) != null) propsVersion++;
        _recordEdit(key, pk, x, y, z, id);
        return;
      }
      if (id == air) return;
      c = _allocate(key);
    }
    final i = localIndex(x, y, z);
    if (c[i] == id) return;
    c[i] = id;
    if (props.remove(pk) != null) propsVersion++;
    _recordEdit(key, pk, x, y, z, id);
    _dirty.add(key);
    _markNeighbourChunks(x, y, z, cx, cy, cz);
  }

  /// Place a prop block with its metadata.
  void setProp(PropMeta meta) {
    setBlock(meta.x, meta.y, meta.z, meta.id);
    props[blockKey(meta.x, meta.y, meta.z)] = meta;
    propsVersion++;
  }

  PropMeta? getProp(int x, int y, int z) => props[blockKey(x, y, z)];

  /// Same as [setBlock] but never overwrites an existing block.
  void setBlockIfAir(int x, int y, int z, int id) {
    if (getBlock(x, y, z) == air) setBlock(x, y, z, id);
  }

  /// Recorded edits inside one chunk (streamed mode re-applies these on load).
  Iterable<Edit> editsInChunk(int cx, int cy, int cz) =>
      _editsByChunk[(cx, cy, cz)]?.values ?? const [];

  // ---------------------------------------------------------------- streaming

  /// Generate every chunk of a column, overlay its edits and mark it (and its
  /// neighbours) dirty.
  void loadColumn(int cx, int cz) {
    final gen = _generator;
    if (gen == null) throw StateError('World.loadColumn needs a generator');
    if (!_loadedColumns.add((cx, cz))) return;
    for (var cy = 0; cy < _chunksY; cy++) {
      final key = (cx, cy, cz);
      var data = gen(cx, cy, cz);
      final chunkEdits = _editsByChunk[key];
      if (chunkEdits != null) {
        for (final e in chunkEdits.values) {
          if (data == null) {
            if (e.id == air) continue;
            data = Uint8List(chunkVolume);
          }
          data[localIndex(e.x, e.y, e.z)] = e.id;
        }
      }
      if (data == null) continue;
      _chunks[key] = data;
      _dirty.add(key);
    }
    _lastKey = null;
    // neighbours meshed against a missing column drew border faces; rebuild them
    for (final (dx, dz) in const [(1, 0), (-1, 0), (0, 1), (0, -1)]) {
      for (var cy = 0; cy < _chunksY; cy++) {
        _dirtyIfExists((cx + dx, cy, cz + dz));
      }
    }
  }

  /// Drop a column's chunk data; edits and props stay so a later load restores them.
  void unloadColumn(int cx, int cz) {
    if (!_loadedColumns.remove((cx, cz))) return;
    for (var cy = 0; cy < _chunksY; cy++) {
      final key = (cx, cy, cz);
      if (_chunks.remove(key) == null) continue;
      _dirty.remove(key);
      _removed.add(key);
    }
    _lastKey = null;
  }

  /// Chunks whose data was dropped. Calling this clears the list.
  List<ChunkKey> takeRemoved() {
    final out = _removed;
    _removed = [];
    return out;
  }

  /// Chunks whose mesh is stale. Calling this clears the set.
  List<ChunkKey> takeDirty() {
    final out = _dirty.toList();
    _dirty.clear();
    return out;
  }

  void markAllDirty() => _dirty.addAll(_chunks.keys);

  // ---------------------------------------------------------------- internals
  Uint8List _allocate(ChunkKey key) {
    final c = Uint8List(chunkVolume);
    _chunks[key] = c;
    _lastKey = null;
    return c;
  }

  void _recordEdit(ChunkKey chunk, String pk, int x, int y, int z, int id) {
    if (!trackEdits) return;
    final e = Edit(x, y, z, id);
    edits[pk] = e;
    _editsByChunk.putIfAbsent(chunk, () => {})[pk] = e;
  }

  void _markNeighbourChunks(int x, int y, int z, int cx, int cy, int cz) {
    const mask = chunkSize - 1;
    final lx = x & mask;
    final ly = y & mask;
    final lz = z & mask;
    if (lx == 0) _dirtyIfExists((cx - 1, cy, cz));
    if (lx == mask) _dirtyIfExists((cx + 1, cy, cz));
    if (ly == 0) _dirtyIfExists((cx, cy - 1, cz));
    if (ly == mask) _dirtyIfExists((cx, cy + 1, cz));
    if (lz == 0) _dirtyIfExists((cx, cy, cz - 1));
    if (lz == mask) _dirtyIfExists((cx, cy, cz + 1));
  }

  void _dirtyIfExists(ChunkKey key) {
    if (_chunks.containsKey(key)) _dirty.add(key);
  }
}
