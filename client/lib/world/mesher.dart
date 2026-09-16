/// Culled chunk mesher — twin of `server/resources/js/world/mesher.ts`. Emits
/// only exposed faces, with per-vertex colours from the palette and baked
/// 4-level ambient occlusion. Two geometries per chunk: opaque and translucent.
///
/// Vertices are interleaved for the GPU: position(3) normal(3) colour(4), all
/// float32 — see [vertexFloats].
library;

import 'dart:typed_data';

import 'package:block_survival/world/chunk.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';

/// floats per vertex in [MeshData.vertices]
const int vertexFloats = 10;
const int vertexBytes = vertexFloats * 4;

final class MeshData {
  const MeshData({required this.vertices, required this.indices});

  /// interleaved x y z nx ny nz r g b a
  final Float32List vertices;
  final Uint32List indices;

  int get vertexCount => vertices.length ~/ vertexFloats;
}

final class ChunkMesh {
  const ChunkMesh({this.opaque, this.translucent});

  final MeshData? opaque;
  final MeshData? translucent;

  bool get isEmpty => opaque == null && translucent == null;
}

typedef _V3 = (int, int, int);

final class _Face {
  const _Face(this.n, this.corners, this.slot, this.ao);

  final _V3 n;

  /// CCW seen from outside
  final List<_V3> corners;

  /// 0 top, 1 side, 2 bottom colour
  final int slot;

  /// the two in-plane axes used for AO neighbour sampling, per corner
  final List<(_V3, _V3)> ao;
}

const List<_Face> _faces = [
  _Face((0, 1, 0), [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)], 0, [
    ((-1, 0, 0), (0, 0, -1)),
    ((-1, 0, 0), (0, 0, 1)),
    ((1, 0, 0), (0, 0, 1)),
    ((1, 0, 0), (0, 0, -1)),
  ]),
  _Face((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], 2, [
    ((-1, 0, 0), (0, 0, -1)),
    ((1, 0, 0), (0, 0, -1)),
    ((1, 0, 0), (0, 0, 1)),
    ((-1, 0, 0), (0, 0, 1)),
  ]),
  _Face((1, 0, 0), [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)], 1, [
    ((0, -1, 0), (0, 0, -1)),
    ((0, 1, 0), (0, 0, -1)),
    ((0, 1, 0), (0, 0, 1)),
    ((0, -1, 0), (0, 0, 1)),
  ]),
  _Face((-1, 0, 0), [(0, 0, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0)], 1, [
    ((0, -1, 0), (0, 0, 1)),
    ((0, 1, 0), (0, 0, 1)),
    ((0, 1, 0), (0, 0, -1)),
    ((0, -1, 0), (0, 0, -1)),
  ]),
  _Face((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)], 1, [
    ((-1, 0, 0), (0, -1, 0)),
    ((1, 0, 0), (0, -1, 0)),
    ((1, 0, 0), (0, 1, 0)),
    ((-1, 0, 0), (0, 1, 0)),
  ]),
  _Face((0, 0, -1), [(1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0)], 1, [
    ((1, 0, 0), (0, -1, 0)),
    ((-1, 0, 0), (0, -1, 0)),
    ((-1, 0, 0), (0, 1, 0)),
    ((1, 0, 0), (0, 1, 0)),
  ]),
];

const List<double> aoLevels = [0.5, 0.68, 0.84, 1.0];
const double _waterTopDrop = 0.15;

final class _Builder {
  final List<double> _vertices = [];
  final List<int> _indices = [];
  int _vertexCount = 0;

  void quad(
    List<(double, double, double)> pts,
    _V3 n,
    Rgb rgb,
    double alpha,
    List<int> ao,
  ) {
    for (var i = 0; i < 4; i++) {
      final (px, py, pz) = pts[i];
      final shade = aoLevels[ao[i]];
      _vertices.addAll([
        px,
        py,
        pz,
        n.$1.toDouble(),
        n.$2.toDouble(),
        n.$3.toDouble(),
        rgb.$1 * shade,
        rgb.$2 * shade,
        rgb.$3 * shade,
        alpha,
      ]);
    }
    final b = _vertexCount;
    // flip the diagonal so AO interpolates without the classic seam artefact
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      _indices.addAll([b, b + 1, b + 2, b, b + 2, b + 3]);
    } else {
      _indices.addAll([b + 1, b + 2, b + 3, b + 1, b + 3, b]);
    }
    _vertexCount += 4;
  }

  MeshData? build() {
    if (_indices.isEmpty) return null;
    return MeshData(
      vertices: Float32List.fromList(_vertices),
      indices: Uint32List.fromList(_indices),
    );
  }
}

/// Does a block occlude ambient light? (opaque-ish solids)
bool _occludes(int id) =>
    id != air && id != Block.water && id != Block.glass && !isProp(id);

int _vertexAo(World world, int x, int y, int z, _V3 n, _V3 s1, _V3 s2) {
  final bx = x + n.$1;
  final by = y + n.$2;
  final bz = z + n.$3;
  final side1 = _occludes(world.getBlock(bx + s1.$1, by + s1.$2, bz + s1.$3))
      ? 1
      : 0;
  final side2 = _occludes(world.getBlock(bx + s2.$1, by + s2.$2, bz + s2.$3))
      ? 1
      : 0;
  final corner =
      _occludes(
        world.getBlock(
          bx + s1.$1 + s2.$1,
          by + s1.$2 + s2.$2,
          bz + s1.$3 + s2.$3,
        ),
      )
      ? 1
      : 0;
  if (side1 == 1 && side2 == 1) return 0;
  return 3 - (side1 + side2 + corner);
}

/// Should this face of `kind` be drawn against neighbour `nb`?
bool faceVisible(int kind, int nb, bool isTop) {
  if (nb != air && !(isSeeThrough(nb) && nb != kind)) return false;
  if (kind == Block.water && !isTop && nb != air) return false;
  return true;
}

ChunkMesh meshChunk(World world, int cx, int cy, int cz) {
  final chunk = world.getChunk(cx, cy, cz);
  if (chunk == null) return const ChunkMesh();
  final opaque = _Builder();
  final translucent = _Builder();
  final ox = cx * chunkSize;
  final oy = cy * chunkSize;
  final oz = cz * chunkSize;
  final ao = [3, 3, 3, 3];

  for (var lx = 0; lx < chunkSize; lx++) {
    for (var ly = 0; ly < chunkSize; ly++) {
      for (var lz = 0; lz < chunkSize; lz++) {
        final kind = chunk[(lx << 8) | (ly << 4) | lz];
        if (kind == air || isProp(kind)) continue;
        final x = ox + lx;
        final y = oy + ly;
        final z = oz + lz;
        final def = blockDefs[kind];
        final target = isTranslucent(kind) ? translucent : opaque;
        for (final face in _faces) {
          final nb = world.getBlock(
            x + face.n.$1,
            y + face.n.$2,
            z + face.n.$3,
          );
          final isTop = face.slot == 0;
          if (!faceVisible(kind, nb, isTop)) continue;
          final drop = kind == Block.water && isTop ? _waterTopDrop : 0.0;
          final pts = [
            for (final c in face.corners)
              (x + c.$1.toDouble(), y + c.$2 - drop, z + c.$3.toDouble()),
          ];
          for (var i = 0; i < 4; i++) {
            ao[i] = _vertexAo(
              world,
              x,
              y,
              z,
              face.n,
              face.ao[i].$1,
              face.ao[i].$2,
            );
          }
          final colour = switch (face.slot) {
            0 => def.top,
            2 => def.bottom,
            _ => def.side,
          };
          target.quad(pts, face.n, colour, def.alpha, ao);
        }
      }
    }
  }
  return ChunkMesh(opaque: opaque.build(), translucent: translucent.build());
}
