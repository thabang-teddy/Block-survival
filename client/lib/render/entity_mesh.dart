/// Stand-in geometry for the entities until the glTF loader lands: every
/// zombie, drop and crate becomes a few vertex-coloured boxes in the chunk
/// shader's vertex format, rebuilt each frame. Pure Dart, no GPU here.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:block_survival/entities/crates.dart';
import 'package:block_survival/entities/drops.dart';
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/world/mesher.dart';
import 'package:block_survival/world/palette.dart';

/// body colours per variant (linear RGB)
const Map<ZombieKind, Rgb> zombieColours = {
  ZombieKind.basic: (0.30, 0.55, 0.28),
  ZombieKind.worker: (0.50, 0.40, 0.24),
  ZombieKind.soldier: (0.36, 0.40, 0.52),
  ZombieKind.toxic: (0.45, 0.85, 0.25),
};

const Rgb _crateColour = (0.55, 0.38, 0.18);
const Rgb _crateLid = (0.40, 0.27, 0.12);
const Rgb _skin = (0.62, 0.68, 0.50);

/// one box: centre-bottom at (x, y, z), size (w, h, d), turned by yaw about y
final class _BoxSpec {
  const _BoxSpec(
    this.x,
    this.y,
    this.z,
    this.w,
    this.h,
    this.d,
    this.rgb, [
    this.yaw = 0,
  ]);

  final double x;
  final double y;
  final double z;
  final double w;
  final double h;
  final double d;
  final Rgb rgb;
  final double yaw;
}

final class EntityMeshBuilder {
  final List<double> _v = [];
  final List<int> _i = [];
  int _count = 0;

  void zombie(Zombie z) {
    final rgb = zombieColours[z.kind]!;
    // dying / burning: sink into the ground as the timer runs out
    final t = z.alive
        ? 1.0
        : (z.burnTimer /
                  (z.state == ZombieState.burn
                      ? ZombieTuning.burnSeconds
                      : ZombieTuning.deathSeconds))
              .clamp(0.0, 1.0);
    final tint = z.state == ZombieState.burn
        ? (rgb.$1 * 0.5 + 0.45, rgb.$2 * 0.5 + 0.2, rgb.$3 * 0.5)
        : rgb;
    final y = z.y - (1 - t) * ZombieTuning.height;
    const w = ZombieTuning.width;
    _box(_BoxSpec(z.x, y, z.z, w * 0.9, 0.8, w * 0.6, tint, z.yaw));
    _box(_BoxSpec(z.x, y + 0.8, z.z, w, 0.6, w * 0.7, tint, z.yaw));
    _box(_BoxSpec(z.x, y + 1.4, z.z, 0.4, 0.4, 0.4, _skin, z.yaw));
    // arms out front, the classic
    final ax = math.sin(z.yaw) * 0.35;
    final az = math.cos(z.yaw) * 0.35;
    final lift = z.attacked ? 0.15 : 0.0;
    _box(
      _BoxSpec(z.x + ax, y + 1.0 + lift, z.z + az, 0.5, 0.18, 0.5, tint, z.yaw),
    );
  }

  void drop(Drop d, double time) {
    final def = getItem(d.item);
    final rgb = def.block != null ? blockDefs[def.block!].side : def.colour;
    final bob = 0.05 + math.sin(time * 2 + d.id) * 0.04;
    _box(
      _BoxSpec(
        d.x,
        d.y + bob,
        d.z,
        dropSize,
        dropSize,
        dropSize,
        rgb,
        time * 1.6 + d.id,
      ),
    );
  }

  void crate(LootCrate c, double time) {
    final yaw = math.sin(time * 0.8 + c.id) * 0.06;
    _box(_BoxSpec(c.x, c.y, c.z, 0.8, 0.6, 0.8, _crateColour, yaw));
    _box(_BoxSpec(c.x, c.y + 0.6, c.z, 0.84, 0.1, 0.84, _crateLid, yaw));
  }

  MeshData? build() {
    if (_i.isEmpty) return null;
    return MeshData(
      vertices: Float32List.fromList(_v),
      indices: Uint32List.fromList(_i),
    );
  }

  void _box(_BoxSpec b) {
    final c = math.cos(b.yaw);
    final s = math.sin(b.yaw);
    (double, double, double) corner(double lx, double ly, double lz) =>
        (b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c);
    final hw = b.w / 2;
    final hd = b.d / 2;
    // 8 corners: index bit 0 = +x, bit 1 = +y, bit 2 = +z
    final p = [
      for (var i = 0; i < 8; i++)
        corner(
          i & 1 != 0 ? hw : -hw,
          i & 2 != 0 ? b.h : 0,
          i & 4 != 0 ? hd : -hd,
        ),
    ];
    // faces as CCW corner indices seen from outside, with the local normal
    const faces = [
      ([2, 6, 7, 3], (0.0, 1.0, 0.0)),
      ([0, 1, 5, 4], (0.0, -1.0, 0.0)),
      ([1, 3, 7, 5], (1.0, 0.0, 0.0)),
      ([4, 6, 2, 0], (-1.0, 0.0, 0.0)),
      ([4, 5, 7, 6], (0.0, 0.0, 1.0)),
      ([0, 2, 3, 1], (0.0, 0.0, -1.0)),
    ];
    for (final (idx, (nx, ny, nz)) in faces) {
      final wnx = nx * c + nz * s;
      final wnz = -nx * s + nz * c;
      for (final k in idx) {
        final (x, y, z) = p[k];
        _v.addAll([x, y, z, wnx, ny, wnz, b.rgb.$1, b.rgb.$2, b.rgb.$3, 1]);
      }
      final base = _count;
      _i.addAll([base, base + 1, base + 2, base, base + 2, base + 3]);
      _count += 4;
    }
  }
}
