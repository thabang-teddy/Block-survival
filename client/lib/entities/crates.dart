/// Loot crates — twin of `entities/crates.ts`: a dead player's inventory,
/// left where they fell. Press F to take it. Crates are entities (not
/// voxels) so they never block a doorway; they settle onto the first solid
/// block below the death point.
library;

import 'dart:math' as math;

import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/net/protocol.dart' show CrateSnap;
import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';

final class LootCrate {
  LootCrate({
    required this.id,
    required this.x,
    required this.y,
    required this.z,
    required this.items,
  }) : count = items.length;

  final int id;
  final double x;
  final double y;
  final double z;
  List<ItemStack> items;

  /// number of stacks inside (mirrored crates on clients only know the count)
  int count;
}

/// how far down to look for ground under the death point
const int _settleDepth = 24;
const double lootReach = 3.5;

/// cosine of the half-angle the player must be looking within to target a crate
final double _lootArc = math.cos(math.pi / 8);

/// Move a point down to rest on the nearest solid block below (or return it unchanged).
(double, double, double) settle(World world, double x, double y, double z) {
  final bx = x.floor();
  final bz = z.floor();
  var by = y.floor();
  for (var i = 0; i < _settleDepth; i++, by--) {
    if (isSolid(world.getBlock(bx, by - 1, bz))) {
      return (bx + 0.5, by.toDouble(), bz + 0.5);
    }
  }
  return (x, y, z);
}

final class CrateManager {
  CrateManager(this._world);

  final World _world;
  final List<LootCrate> crates = [];
  int _nextId = 1;

  /// Drop every stack in `inv` into a new crate at the death point (nothing if empty).
  LootCrate? dropInventory(Inventory inv, double x, double y, double z) {
    final items = <ItemStack>[];
    final all = inv.all();
    for (var i = 0; i < all.length; i++) {
      final stack = all[i];
      if (stack == null) continue;
      items.add(ItemStack(stack.id, stack.count));
      inv.takeFromSlot(i, stack.count);
    }
    if (items.isEmpty) return null;
    final (px, py, pz) = settle(_world, x, y, z);
    final crate = LootCrate(id: _nextId++, x: px, y: py, z: pz, items: items);
    crates.add(crate);
    return crate;
  }

  /// put a saved crate back
  LootCrate restore(double x, double y, double z, List<ItemStack> items) {
    final crate = LootCrate(
      id: _nextId++,
      x: x,
      y: y,
      z: z,
      items: items.map((s) => ItemStack(s.id, s.count)).toList(),
    );
    crates.add(crate);
    return crate;
  }

  /// The crate the player is looking at within reach, if any.
  LootCrate? targeted(
    double ex,
    double ey,
    double ez,
    double dx,
    double dy,
    double dz,
  ) {
    LootCrate? best;
    var bestD = lootReach;
    for (final c in crates) {
      final vx = c.x - ex;
      final vy = c.y + 0.5 - ey;
      final vz = c.z - ez;
      final d = hypot3(vx, vy, vz);
      if (d > bestD) continue;
      final cos = (vx * dx + vy * dy + vz * dz) / (d == 0 ? 1 : d);
      if (cos < _lootArc) continue;
      best = c;
      bestD = d;
    }
    return best;
  }

  /// Move as much as fits into `inv`; the crate disappears once empty. Returns items taken.
  int loot(LootCrate crate, Inventory inv) {
    var taken = 0;
    final rest = <ItemStack>[];
    for (final stack in crate.items) {
      final left = inv.add(stack.id, stack.count);
      taken += stack.count - left;
      if (left > 0) rest.add(ItemStack(stack.id, left));
    }
    crate.items = rest;
    crate.count = crate.items.length;
    if (crate.items.isEmpty) remove(crate);
    return taken;
  }

  /// Client side: mirror the host's crates.
  void applySnapshot(List<CrateSnap> list) {
    final seen = <int>{};
    for (final s in list) {
      seen.add(s.id);
      var c = crates.where((x) => x.id == s.id).firstOrNull;
      if (c == null) {
        c = LootCrate(id: s.id, x: s.x, y: s.y, z: s.z, items: []);
        crates.add(c);
      }
      c.count = s.items;
    }
    crates.removeWhere((c) => !seen.contains(c.id));
  }

  void remove(LootCrate crate) => crates.remove(crate);
}
