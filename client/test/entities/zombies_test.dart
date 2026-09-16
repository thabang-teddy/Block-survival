// Twin of entities/__tests__/zombies.test.ts.
import 'package:block_survival/entities/pathfinding.dart';
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/noise.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter_test/flutter_test.dart';

/// flat grass floor at y = 0 from -r..r
World floor([int r = 20]) {
  final w = World();
  for (var x = -r; x <= r; x++) {
    for (var z = -r; z <= r; z++) {
      w.setBlock(x, 0, z, Block.grass);
    }
  }
  return w;
}

final class _Host implements ZombieHost {
  _Host(this.world);

  @override
  final World world;
  final hits = <(double, bool)>[];
  final broken = <(int, int, int)>[];

  @override
  void damagePlayer(double amount, {required bool poison}) =>
      hits.add((amount, poison));

  @override
  void breakBlock(int x, int y, int z) {
    broken.add((x, y, z));
    world.setBlock(x, y, z, air);
  }
}

void main() {
  group('pathfinding', () {
    test('standing cells need air for 2 blocks and a solid floor', () {
      final w = floor();
      expect(isStanding(w, 0, 1, 0), isTrue);
      expect(isStanding(w, 0, 2, 0), isFalse);
      expect(isStanding(w, 0, 0, 0), isFalse);
      expect(standingCellAt(w, 3.7, 1.4, -2.2), const Cell(3, 1, -3));
      // mid-air: drops to the floor
      expect(standingCellAt(w, 3.7, 3.0, -2.2), const Cell(3, 1, -3));
    });

    test(
      'walks straight across open ground and stops adjacent to the goal',
      () {
        final w = floor();
        final r = findPath(w, const Cell(0, 1, 0), const Cell(6, 1, 0));
        expect(r.reached, isTrue);
        expect(r.path.length, 5);
        expect(r.path.last, const Cell(5, 1, 0));
      },
    );

    test(
      'finds paths far from the origin (visited keys are start-relative)',
      () {
        final w = World();
        for (var x = 90000; x <= 90020; x++) {
          for (var z = -70010; z <= -69990; z++) {
            w.setBlock(x, 0, z, Block.grass);
          }
        }
        final r = findPath(
          w,
          const Cell(90000, 1, -70000),
          const Cell(90012, 1, -70000),
        );
        expect(r.reached, isTrue);
        expect(r.path.length, 11);
      },
    );

    test('routes around a wall and steps up over a single block', () {
      final w = floor();
      for (var z = -3; z <= 3; z++) {
        for (var y = 1; y <= 3; y++) {
          w.setBlock(3, y, z, Block.stone);
        }
      }
      final around = findPath(w, const Cell(0, 1, 0), const Cell(6, 1, 0));
      expect(around.reached, isTrue);
      expect(around.path.any((c) => c.z.abs() >= 4), isTrue);
      expect(around.path.every((c) => !(c.x == 3 && c.z.abs() <= 3)), isTrue);

      final w2 = floor();
      for (var z = -20; z <= 20; z++) {
        w2.setBlock(3, 1, z, Block.stone); // 1-high ridge across the map
      }
      final over = findPath(w2, const Cell(0, 1, 0), const Cell(6, 1, 0));
      expect(over.reached, isTrue);
      expect(over.path.any((c) => c.x == 3 && c.y == 2), isTrue);
    });

    test('an unreachable goal returns the closest partial path', () {
      final w = floor(8);
      for (var x = -8; x <= 8; x++) {
        for (var y = 1; y <= 4; y++) {
          w.setBlock(x, y, 2, Block.stone); // full wall
        }
      }
      final r = findPath(w, const Cell(0, 1, -5), const Cell(0, 1, 6));
      expect(r.reached, isFalse);
      expect(r.path, isNotEmpty);
      expect(r.path.last.z, 1); // right up against the wall
    });
  });

  group('zombies', () {
    test('spawn schedule and variant mix follow the spec', () {
      expect(zombiesForNight(1), 8);
      expect(zombiesForNight(3), 20);
      expect(kindsForNight(1), [ZombieKind.basic]);
      expect(kindsForNight(4), ZombieKind.values);
      expect(blockHitPoints(Block.reinforcedWall), isNull);
      expect(blockHitPoints(Block.cobble), 15);
    });

    test('a zombie chases the player and attacks with its cooldown', () {
      final h = _Host(floor());
      final zm = ZombieManager(h, Rng(1));
      zm.spawn(ZombieKind.basic, 0.5, 1, 0.5);
      const target = ZombieTarget(8.5, 1, 0.5);
      for (var i = 0; i < 60 * 6; i++) {
        zm.update(1 / 60, const [target]);
      }
      final z = zm.zombies[0];
      expect(
        hypot(z.x - target.x, z.z - target.z),
        lessThanOrEqualTo(ZombieTuning.attackRange + 0.2),
      );
      expect(z.state, ZombieState.attack);
      expect(h.hits.length, greaterThanOrEqualTo(3));
      // ~1.2 s cooldown over the remaining time
      expect(h.hits.length, lessThanOrEqualTo(5));
      expect(h.hits[0], (zombieStats[ZombieKind.basic]!.damage, false));
    });

    test(
      'a walled-off zombie breaks through dirt but not a reinforced wall',
      () {
        World walled(int block) {
          final w = floor(8);
          for (var x = -8; x <= 8; x++) {
            for (var y = 1; y <= 3; y++) {
              w.setBlock(x, y, 2, block);
            }
          }
          return w;
        }

        const target = ZombieTarget(0.5, 1, 5.5);
        final h = _Host(walled(Block.dirt));
        final zm = ZombieManager(h, Rng(2));
        zm.spawn(ZombieKind.worker, 0.5, 1, -2.5);
        for (var i = 0; i < 60 * 6; i++) {
          zm.update(1 / 60, const [target]);
        }
        expect(h.broken, isNotEmpty);
        expect(h.broken.every((b) => b.$3 == 2), isTrue);

        final h2 = _Host(walled(Block.reinforcedWall));
        final zm2 = ZombieManager(h2, Rng(2));
        zm2.spawn(ZombieKind.worker, 0.5, 1, -2.5);
        for (var i = 0; i < 60 * 6; i++) {
          zm2.update(1 / 60, const [target]);
        }
        expect(h2.broken, isEmpty);
      },
    );

    test('damage, knockback, death and dawn burn', () {
      final zm = ZombieManager(_Host(floor()), Rng(3));
      final z = zm.spawn(ZombieKind.toxic, 0.5, 1, 0.5);
      expect(zm.damage(z, 10, knockX: 5), isFalse);
      expect(z.hp, 15);
      expect(z.vx, 5);
      expect(zm.damage(z, 20), isTrue);
      expect(zm.kills, 1);
      expect(z.state, ZombieState.dead);
      for (var i = 0; i < 100; i++) {
        zm.update(1 / 60, const []);
      }
      expect(zm.zombies, isEmpty);

      zm.spawn(ZombieKind.basic, 0.5, 1, 0.5);
      zm.burnAll();
      expect(zm.liveCount, 0);
      expect(zm.zombies[0].state, ZombieState.burn);
      for (var i = 0; i < 60 * 11; i++) {
        zm.update(1 / 60, const []);
      }
      expect(zm.zombies, isEmpty);
    });

    test(
      'spawnGroup keeps its distance from the player and respects the cap',
      () {
        final zm = ZombieManager(_Host(floor(30)), Rng(4));
        const target = ZombieTarget(0.5, 1, 0.5);
        final n = zm.spawnGroup([ZombieKind.basic], 5, const [target], 28);
        expect(n, 5);
        for (final z in zm.zombies) {
          expect(
            hypot(z.x, z.z),
            greaterThanOrEqualTo(ZombieTuning.minSpawnDistance - 3),
          );
        }
        for (var i = 0; i < 20; i++) {
          zm.spawnGroup([ZombieKind.basic], 6, const [target], 28);
        }
        expect(zm.liveCount, lessThanOrEqualTo(ZombieTuning.maxLive + 5));
      },
    );

    test('spawnGroup surrounds a player far from the origin, on the layer they stand on', () {
      // ground at y = 0 everywhere around (5000, 5000) plus an "island" slab
      // at y = 40 over part of it
      final w = World();
      for (var x = 4960; x <= 5040; x++) {
        for (var z = 4960; z <= 5040; z++) {
          w.setBlock(x, 0, z, Block.grass);
          w.setBlock(x, 40, z, Block.grass);
        }
      }
      final zm = ZombieManager(_Host(w), Rng(5));
      expect(
        zm.spawnGroup(
          [ZombieKind.basic],
          4,
          const [ZombieTarget(5000.5, 1, 5000.5)],
          28,
        ),
        4,
      );
      for (final z in zm.zombies) {
        expect(z.y, 1);
        expect(
          hypot(z.x - 5000.5, z.z - 5000.5),
          greaterThanOrEqualTo(ZombieTuning.minSpawnDistance - 3),
        );
      }
      expect(
        zm.spawnGroup(
          [ZombieKind.basic],
          3,
          const [ZombieTarget(5000.5, 41, 5000.5)],
          28,
        ),
        3,
      );
      expect(zm.zombies.skip(4).every((z) => z.y == 41), isTrue);
    });

    test('spawnGroup finds nothing where the world is not loaded', () {
      final w = World()..setGenerator((cx, cy, cz) => null, 1);
      final zm = ZombieManager(_Host(w), Rng(5));
      expect(
        zm.spawnGroup(
          [ZombieKind.basic],
          4,
          const [ZombieTarget(0.5, 1, 0.5)],
          28,
        ),
        0,
      );
    });
  });
}
