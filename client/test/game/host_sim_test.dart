// The host-side rules: night schedule, zombie attacks, sword and rifle,
// death → crate → respawn, poison, regen, drops from digging, placing.
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/game/avatar.dart';
import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/host_sim.dart';
import 'package:block_survival/game/rules.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/world/noise.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter_test/flutter_test.dart';

final class _Host implements SimHost {
  _Host(this.world)
    : localAvatar = Avatar(
        id: 'host',
        name: 'Teddy',
        userId: 1,
        spawn: const Vec3(0.5, 1, 0.5),
      );

  @override
  final World world;
  @override
  DayNight dayNight = DayNight();
  @override
  GameRules rules = GameRules.defaults;

  /// the game builds its clock from the rules; the fake does the same on demand
  void useRules(GameRules r) {
    rules = r;
    dayNight = DayNight(r);
  }

  @override
  final Avatar localAvatar;
  final edits = <(int, int, int)>[];
  final broadcasts = <String>[];
  final told = <String>[];
  int dawns = 0;
  int deaths = 0;
  Vec3? respawnedAt;

  @override
  void recordEdit(int x, int y, int z) => edits.add((x, y, z));

  @override
  void broadcastMessage(String text) => broadcasts.add(text);

  @override
  void tell(Avatar a, String text) => told.add('${a.id}: $text');

  @override
  void onDawn(int night) => dawns++;

  @override
  void onLocalDeath() => deaths++;

  @override
  void onLocalRespawn(Vec3 spawn) => respawnedAt = spawn;
}

/// flat grass floor at y = 0 from -r..r
World floor([int r = 40]) {
  final w = World();
  for (var x = -r; x <= r; x++) {
    for (var z = -r; z <= r; z++) {
      w.setBlock(x, 0, z, Block.grass);
    }
  }
  return w;
}

(HostSim, _Host) sim({World? world, int seed = 1}) {
  final host = _Host(world ?? floor());
  return (HostSim(host, rng: Rng(seed)), host);
}

/// a ray from the avatar's eye along +X, dipping so it hits a zombie's body
Ray rayPlusX(Avatar a) => Ray(a.eye(), const Vec3(1, -0.1, 0));

void run(HostSim s, double seconds) {
  final steps = (seconds * 60).round();
  for (var i = 0; i < steps; i++) {
    s.tick(1 / 60);
  }
}

void main() {
  group('night schedule', () {
    test('sunset schedules the groups, they arrive during the night, dawn burns them', () {
      final (s, h) = sim();
      h.dayNight.time = daySeconds - 0.5;
      run(s, 1);
      expect(h.broadcasts, ['Night 1 — they are coming']);
      // 8 zombies on night 1 → round(8 / 4.5) = 2 groups
      expect(s.spawnTimes, hasLength(2));
      run(s, 3);
      expect(s.zombies.liveCount, greaterThan(0));
      expect(s.spawnTimes, hasLength(1));
      h.dayNight.time = daySeconds + nightSeconds - 0.5;
      run(s, 1);
      expect(h.broadcasts.last, 'Dawn — you survived night 1');
      expect(h.dawns, 1);
      expect(s.zombies.liveCount, 0);
      expect(s.spawnTimes, isEmpty);
    });
  });

  test('the admin schedule sets when and how many zombies come', () {
    final (s, h) = sim();
    h.useRules(
      const GameRules(
        daySeconds: 60,
        nightSeconds: 40,
        zombiesFirstNight: 20,
        zombiesPerNight: 0,
        spawnDelaySeconds: 10,
        spawnWindow: 0.5,
      ),
    );
    h.dayNight.time = 59.9;
    run(s, 0.2);
    expect(h.broadcasts, ['Night 1 — they are coming']);
    // 20 zombies → round(20 / 4.5) = 4 groups, the first 10 s after sunset,
    // the rest over half of a 40 s night
    expect(s.spawnTimes, hasLength(4));
    expect(s.spawnTimes.first, closeTo(60 + 10, 0.05));
    expect(s.spawnTimes.last, closeTo(60 + 10 + 15, 0.05));
    run(s, 9);
    expect(s.zombies.liveCount, 0);
    run(s, 2);
    expect(s.zombies.liveCount, greaterThan(0));

    // no zombies at all: nothing is scheduled
    final (s2, h2) = sim();
    h2.useRules(const GameRules(zombiesFirstNight: 0, zombiesPerNight: 0));
    h2.dayNight.time = daySeconds - 0.1;
    run(s2, 1);
    expect(s2.spawnTimes, isEmpty);
    expect(h2.broadcasts, isEmpty);
  });

  group('combat', () {
    test(
      'a sword swing within reach and arc kills a zombie and counts the kill',
      () {
        final (s, h) = sim();
        final me = h.localAvatar;
        me.inventory.add('sword', 1);
        final z = s.zombies.spawn(ZombieKind.basic, 2.5, 1, 0.5);
        s.apply(me, Swing(rayPlusX(me)));
        expect(z.hp, 10);
        expect(z.vx, swordTuning.knockback);
        // behind us: untouched
        final behind = s.zombies.spawn(ZombieKind.basic, -1.5, 1, 0.5);
        s.apply(me, Swing(rayPlusX(me)));
        expect(behind.hp, 30);
        expect(z.state, ZombieState.dead);
        expect(me.kills, 1);
        // no sword in hand: nothing happens behind us either way
        me.slot = 1;
        s.apply(me, Swing(rayPlusX(me)));
        expect(behind.hp, 30);
      },
    );

    test('bare hands and tools still hit, weakly and only up close', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      final near = s.zombies.spawn(ZombieKind.basic, 1.9, 1, 0.5);
      final far = s.zombies.spawn(ZombieKind.basic, 2.9, 1, 0.5);
      s.apply(me, Swing(rayPlusX(me)));
      expect(near.hp, 30 - fistsTuning.damage);
      expect(near.vx, fistsTuning.knockback);
      expect(far.hp, 30); // within a sword's reach, not a fist's
      me.inventory.add('pickaxe_wood', 1);
      s.apply(me, Swing(rayPlusX(me)));
      expect(near.hp, 30 - 2 * fistsTuning.damage);
      // the rifle never swings
      me.inventory.replace([const ItemStack('rifle', 1)]);
      s.apply(me, Swing(rayPlusX(me)));
      expect(near.hp, 30 - 2 * fistsTuning.damage);
    });

    test('the rifle needs a loaded magazine, reloads from ammo and hits the first zombie on the ray', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      me.inventory.add('rifle', 1);
      me.inventory.add('ammo', 40);
      final near = s.zombies.spawn(ZombieKind.soldier, 6.5, 1, 0.5);
      final far = s.zombies.spawn(ZombieKind.basic, 12.5, 1, 0.5);
      // empty magazine: the first trigger pull starts a reload instead
      s.apply(me, Fire(rayPlusX(me)));
      expect(me.magazine, 0);
      expect(me.pendingRounds, rifleMag);
      expect(me.inventory.count('ammo'), 10);
      run(s, RifleTuning.reloadSeconds + 0.1);
      expect(me.magazine, rifleMag);
      s.apply(me, Fire(rayPlusX(me)));
      expect(me.magazine, rifleMag - 1);
      // soldiers take half rifle damage; the one behind is shielded
      expect(near.hp, 80 - RifleTuning.damage * 0.5);
      expect(far.hp, 30);
      // the fire interval gates the next shot
      s.apply(me, Fire(rayPlusX(me)));
      expect(me.magazine, rifleMag - 1);
      run(s, RifleTuning.interval + 0.01);
      s.apply(me, Fire(rayPlusX(me)));
      expect(me.magazine, rifleMag - 2);
    });

    test('a headshot doubles the damage', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      me.inventory.add('rifle', 1);
      me.magazine = rifleMag;
      final z = s.zombies.spawn(ZombieKind.basic, 4.5, 1, 0.5);
      // level from eye height (2.62) the ray passes above the neck (y = 2.5)
      s.apply(me, Fire(Ray(me.eye(), const Vec3(1, 0, 0))));
      expect(z.hp, 30 - RifleTuning.damage * RifleTuning.headshot);
    });

    test('walls stop bullets', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      me.inventory.add('rifle', 1);
      me.magazine = rifleMag;
      for (var y = 1; y <= 3; y++) {
        h.world.setBlock(3, y, 0, Block.stone);
      }
      final z = s.zombies.spawn(ZombieKind.basic, 6.5, 1, 0.5);
      s.apply(me, Fire(rayPlusX(me)));
      expect(me.magazine, rifleMag - 1);
      expect(z.hp, 30);
    });
  });

  group('vitals', () {
    test('an attacking zombie hurts the nearest avatar; toxic ones poison', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      s.zombies.spawn(ZombieKind.toxic, 1.5, 1, 0.5);
      run(s, 1);
      expect(me.health, lessThan(100));
      expect(me.poisonUntil, greaterThan(s.time));
      final afterHit = me.health;
      // the poison keeps ticking after the zombie is gone
      s.zombies.zombies.clear();
      run(s, 1);
      expect(me.health, lessThan(afterHit));
    });

    test('health regenerates after 8 s without damage', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      s.hurt(me, 30, poison: false);
      run(s, 7);
      expect(me.health, 70);
      run(s, 3);
      expect(me.health, greaterThan(70));
      expect(me.health, lessThan(100));
    });

    test('death drops the inventory as a crate and respawns after 5 s at the spawn', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      me.inventory.add('planks', 12);
      me.magazine = 7;
      me.x = 10.5;
      me.z = 3.5;
      s.hurt(me, 500, poison: true);
      s.tick(1 / 60);
      expect(me.dead, isTrue);
      expect(me.deaths, 1);
      expect(h.deaths, 1);
      expect(me.magazine, 0);
      expect(me.poisonUntil, 0);
      expect(me.inventory.count('planks'), 0);
      expect(s.crates.crates, hasLength(1));
      expect(s.crates.crates[0].x, 10.5);
      expect(s.crates.crates[0].y, 1);
      run(s, respawnSeconds + 0.1);
      expect(me.dead, isFalse);
      expect(me.health, AvatarTuning.maxHealth);
      expect(h.respawnedAt, isNotNull);
      expect(me.x, 0.5);
      expect(h.told.last, 'host: Your loot crate is where you fell');
      // walk back and loot it
      me.x = 10.5;
      me.z = 3.5;
      s.apply(
        me,
        Interact(x: 0, y: 0, z: 0, block: 0, crate: s.crates.crates[0].id),
      );
      expect(me.inventory.count('planks'), 12);
      expect(s.crates.crates, isEmpty);
      expect(h.told.last, 'host: Took 12 items');
    });

    test('a remote avatar gets its private state queued instead', () {
      final (s, h) = sim();
      final joiner = Avatar(
        id: 'p1',
        name: 'Sam',
        spawn: const Vec3(20.5, 1, 20.5),
      );
      s.avatars['p1'] = joiner;
      s.hurt(joiner, 500, poison: false);
      s.tick(1 / 60);
      final st = joiner.takeOutbox()!;
      expect(st.health, 0);
      expect(st.dead, isTrue);
      expect(st.respawnIn, respawnSeconds);
      expect(joiner.takeOutbox(), isNull);
      run(s, respawnSeconds + 0.1);
      final back = joiner.takeOutbox()!;
      expect(back.dead, isFalse);
      expect(back.teleport, isNotNull);
      expect(back.teleport!.x, 20.5);
      expect(back.message, 'Back on your feet');
      expect(h.deaths, 0);
    });
  });

  group('blocks', () {
    test('breaking a block within reach drops its item, which is picked up when walked over', () {
      final (s, h) = sim();
      final me = h.localAvatar;
      h.world.setBlock(2, 1, 0, Block.dirt);
      s.apply(me, const BreakBlock(2, 1, 0));
      expect(h.world.getBlock(2, 1, 0), air);
      expect(h.edits, [(2, 1, 0)]);
      expect(s.drops.drops, hasLength(1));
      expect(s.drops.drops[0].item, 'dirt');
      me.x = 2.5;
      run(s, 1.5);
      expect(s.drops.drops, isEmpty);
      expect(me.inventory.count('dirt'), 1);
      // out of reach: ignored
      h.world.setBlock(30, 1, 0, Block.dirt);
      s.apply(me, const BreakBlock(30, 1, 0));
      expect(h.world.getBlock(30, 1, 0), Block.dirt);
    });

    test(
      'placing takes from the slot and refuses occupied or overlapping cells',
      () {
        final (s, h) = sim();
        final me = h.localAvatar;
        me.inventory.add('cobble', 3);
        PlaceBlock at(int x, int y, int z) =>
            PlaceBlock(x: x, y: 0, z: z, nx: 0, ny: y, nz: 0, slot: 0, yaw: 0);
        s.apply(me, at(2, 1, 0));
        expect(h.world.getBlock(2, 1, 0), Block.cobble);
        expect(me.inventory.count('cobble'), 2);
        // same cell again: occupied
        s.apply(me, at(2, 1, 0));
        expect(me.inventory.count('cobble'), 2);
        // where we stand: overlaps the avatar
        s.apply(me, at(0, 1, 0));
        expect(h.world.getBlock(0, 1, 0), air);
        expect(me.inventory.count('cobble'), 2);
      },
    );
  });
}
