// Twin of entities/__tests__/crates.test.ts and drops.test.ts.
import 'package:block_survival/entities/crates.dart';
import 'package:block_survival/entities/drops.dart';
import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter_test/flutter_test.dart';

World floor([int r = 5]) {
  final w = World();
  for (var x = -r; x <= r; x++) {
    for (var z = -r; z <= r; z++) {
      w.setBlock(x, 0, z, Block.stone);
    }
  }
  return w;
}

void main() {
  group('loot crates', () {
    test('settle drops the crate onto the ground below the death point', () {
      final w = floor();
      expect(settle(w, 2.3, 6.7, -1.2), (2.5, 1.0, -1.5));
      expect(settle(w, 2.3, 1.2, -1.2), (2.5, 1.0, -1.5));
      expect(settle(w, 40, 5, 40), (
        40.0,
        5.0,
        40.0,
      )); // nothing below: stays put
    });

    test('dropInventory empties the inventory into a crate; nothing for an empty inventory', () {
      final cm = CrateManager(floor());
      final inv = Inventory();
      expect(cm.dropInventory(inv, 0.5, 3, 0.5), isNull);
      inv.add('planks', 10);
      inv.add('rifle', 1);
      final crate = cm.dropInventory(inv, 0.5, 3, 0.5)!;
      expect(crate.items, const [
        ItemStack('planks', 10),
        ItemStack('rifle', 1),
      ]);
      expect(inv.count('planks'), 0);
      expect(inv.count('rifle'), 0);
      expect(crate.y, 1);
      expect(cm.crates, hasLength(1));
    });

    test('targeted picks the crate in front of the player within reach', () {
      final cm = CrateManager(floor());
      final inv = Inventory()..add('dirt', 1);
      final crate = cm.dropInventory(inv, 2.5, 1, 0.5)!;
      // looking +X from the origin at eye height
      expect(cm.targeted(0.5, 2.6, 0.5, 1, -0.3, 0), same(crate));
      // looking away
      expect(cm.targeted(0.5, 2.6, 0.5, -1, 0, 0), isNull);
      // too far
      expect(cm.targeted(-3, 2.6, 0.5, 1, 0, 0), isNull);
    });

    test('loot takes what fits and removes the crate when empty', () {
      final cm = CrateManager(floor());
      final src = Inventory()..add('planks', 100);
      final crate = cm.dropInventory(src, 0.5, 1, 0.5)!;
      final inv = Inventory();
      for (var i = 0; i < 35; i++) {
        inv.add('sword', 1); // one free slot → 64 planks fit
      }
      expect(cm.loot(crate, inv), 64);
      expect(crate.items, const [ItemStack('planks', 36)]);
      expect(cm.crates, hasLength(1));
      inv.takeFromSlot(0, 1);
      expect(cm.loot(crate, inv), 36);
      expect(cm.crates, isEmpty);
    });
  });

  group('drops', () {
    test('a drop falls, settles on the floor and is picked up once the player is near', () {
      final dm = DropManager(floor(4));
      final inv = Inventory();
      dm.spawn('dirt', 3, 0.5, 4, 0.5, vy: 0);
      // far away: no pickup, it lands on the block top (y = 1)
      for (var i = 0; i < 120; i++) {
        dm.update(1 / 60, [Collector(10, 1, 10, inv)]);
      }
      expect(dm.drops, hasLength(1));
      expect(dm.drops[0].y, closeTo(1, 0.01));
      expect(inv.count('dirt'), 0);
      // walk over it
      dm.update(1 / 60, [Collector(0.5, 1, 0.5, inv)]);
      expect(dm.drops, isEmpty);
      expect(inv.count('dirt'), 3);
    });

    test('pickup waits for the spawn delay so thrown items are not caught instantly', () {
      final dm = DropManager(floor(4));
      final inv = Inventory();
      dm.spawn('planks', 1, 0.5, 1.2, 0.5);
      for (var i = 0; i < 20; i++) {
        dm.update(1 / 60, [Collector(0.5, 1, 0.5, inv)]); // 0.33 s < delay
      }
      expect(inv.count('planks'), 0);
      for (var i = 0; i < 30; i++) {
        dm.update(1 / 60, [Collector(0.5, 1, 0.5, inv)]);
      }
      expect(inv.count('planks'), 1);
    });

    test('a full inventory leaves the remainder on the ground', () {
      final dm = DropManager(floor(4));
      final inv = Inventory();
      for (var i = 0; i < 36; i++) {
        inv.add('sword', 1);
      }
      inv.takeFromSlot(0, 1);
      inv.add('dirt', 60);
      dm.spawn('dirt', 10, 0.5, 1.2, 0.5);
      for (var i = 0; i < 60; i++) {
        dm.update(1 / 60, [Collector(0.5, 1, 0.5, inv)]);
      }
      expect(inv.count('dirt'), 64);
      expect(dm.drops[0].count, 6);
    });

    test('pickup volume is a cylinder around the feet', () {
      Drop at(double x, double y, double z) =>
          Drop(id: 1, item: 'dirt', count: 1, x: x, y: y, z: z, age: 1);
      expect(canPickUp(at(1, 0, 0), 0, 0, 0), isTrue);
      expect(canPickUp(at(1.5, 0, 0), 0, 0, 0), isFalse);
      expect(canPickUp(at(0, -1, 0), 0, 0, 0), isTrue); // in a hole below
      expect(canPickUp(at(0, -2, 0), 0, 0, 0), isFalse);
      expect(canPickUp(at(0, 2.5, 0), 0, 0, 0), isFalse);
    });
  });
}
