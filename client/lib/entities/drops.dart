/// Dropped items — twin of `entities/drops.ts`: small physics bodies that
/// fall, settle on blocks, and are picked up when a player walks over them.
library;

import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/net/protocol.dart' show DropSnap;
import 'package:block_survival/physics/aabb.dart';
import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/world.dart';

final class Drop {
  Drop({
    required this.id,
    required this.item,
    required this.count,
    required this.x,
    required this.y,
    required this.z,
    this.vx = 0,
    this.vy = 0,
    this.vz = 0,
    this.age = 0,
  });

  final int id;
  final String item;
  int count;
  double x;
  double y;
  double z;
  double vx;
  double vy;
  double vz;
  double age;
}

/// someone who can pocket a drop they stand over
final class Collector {
  const Collector(this.x, this.y, this.z, this.inv);

  final double x;
  final double y;
  final double z;
  final Inventory inv;
}

const double dropSize = 0.3;
const double _gravity = 18;

/// horizontal / vertical reach of the pickup cylinder around the player's feet
const double _pickupRadius = 1.2;
const double _pickupBelow = 1.6;
const double _pickupAbove = 2.0;
const double _pickupDelay = 0.6;
const int _maxDrops = 200;

bool canPickUp(Drop d, double px, double py, double pz) =>
    hypot(d.x - px, d.z - pz) < _pickupRadius &&
    d.y > py - _pickupBelow &&
    d.y < py + _pickupAbove;

final class DropManager {
  DropManager(this._world);

  final World _world;
  final List<Drop> drops = [];
  int _nextId = 1;

  Drop spawn(
    String item,
    int count,
    double x,
    double y,
    double z, {
    double vx = 0,
    double vy = 2,
    double vz = 0,
  }) {
    final drop = Drop(
      id: _nextId++,
      item: item,
      count: count,
      x: x,
      y: y,
      z: z,
      vx: vx,
      vy: vy,
      vz: vz,
    );
    drops.add(drop);
    if (drops.length > _maxDrops) drops.removeAt(0);
    return drop;
  }

  /// Simulate and try to pick up into the inventory of any collector standing over a drop.
  void update(double dt, List<Collector> collectors) {
    for (final d in List.of(drops)) {
      d.age += dt;
      d.vy -= _gravity * dt;
      d.vx *= 0.9;
      d.vz *= 0.9;
      final box = Box(
        x: d.x - dropSize / 2,
        y: d.y,
        z: d.z - dropSize / 2,
        w: dropSize,
        h: dropSize,
        d: dropSize,
      );
      final r = moveBox(_world, box, d.vx * dt, d.vy * dt, d.vz * dt);
      d.x = r.box.x + dropSize / 2;
      d.y = r.box.y;
      d.z = r.box.z + dropSize / 2;
      if (r.hitY) d.vy = 0;
      if (d.y < -60) {
        drops.remove(d);
        continue;
      }
      if (d.age > _pickupDelay) {
        for (final c in collectors) {
          if (!canPickUp(d, c.x, c.y, c.z)) continue;
          final left = c.inv.add(d.item, d.count);
          if (left == 0) {
            drops.remove(d);
            break;
          }
          d.count = left;
        }
      }
    }
  }

  /// Client side: mirror the host's drop list (no physics, no pickup).
  void applySnapshot(List<DropSnap> list) {
    final seen = <int>{};
    for (final s in list) {
      seen.add(s.id);
      var d = drops.where((x) => x.id == s.id).firstOrNull;
      if (d == null) {
        d = Drop(
          id: s.id,
          item: s.item,
          count: 1,
          x: s.x,
          y: s.y,
          z: s.z,
          age: 1,
        );
        drops.add(d);
      }
      d
        ..x = s.x
        ..y = s.y
        ..z = s.z;
    }
    drops.removeWhere((d) => !seen.contains(d.id));
  }
}
