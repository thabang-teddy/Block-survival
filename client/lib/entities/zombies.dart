/// Zombie simulation — twin of `entities/zombies.ts`: variants, night
/// spawning schedule, chase AI on the voxel pathfinder, attacks on players
/// and on the blocks in their way. Rendering lives in lib/render/.
library;

import 'dart:math' as math;

import 'package:block_survival/entities/pathfinding.dart';
import 'package:block_survival/net/protocol.dart' show ZombieSnap;
import 'package:block_survival/physics/aabb.dart';
import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/noise.dart';
import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';

enum ZombieKind {
  basic('Basic'),
  worker('Worker'),
  soldier('Soldier'),
  toxic('Toxic');

  const ZombieKind(this.wire);

  /// the name on the wire and in saves
  final String wire;

  static ZombieKind parse(String wire) =>
      values.firstWhere((k) => k.wire == wire, orElse: () => basic);
}

final class ZombieStats {
  const ZombieStats({
    required this.hp,
    required this.speed,
    required this.damage,
    required this.blockDamage,
    required this.rifleResist,
    required this.poisons,
  });

  final double hp;
  final double speed;
  final double damage;

  /// block damage per hit (blocks have hit-point counts)
  final int blockDamage;

  /// multiplier on rifle damage
  final double rifleResist;
  final bool poisons;
}

const Map<ZombieKind, ZombieStats> zombieStats = {
  ZombieKind.basic: ZombieStats(
    hp: 30,
    speed: 2.0,
    damage: 4,
    blockDamage: 1,
    rifleResist: 1,
    poisons: false,
  ),
  ZombieKind.worker: ZombieStats(
    hp: 50,
    speed: 1.8,
    damage: 5,
    blockDamage: 3,
    rifleResist: 1,
    poisons: false,
  ),
  ZombieKind.soldier: ZombieStats(
    hp: 80,
    speed: 2.2,
    damage: 7,
    blockDamage: 1,
    rifleResist: 0.5,
    poisons: false,
  ),
  ZombieKind.toxic: ZombieStats(
    hp: 25,
    speed: 3.2,
    damage: 3,
    blockDamage: 1,
    rifleResist: 1,
    poisons: true,
  ),
};

/// Hits a zombie needs to destroy a block; null = cannot.
int? blockHitPoints(int id) => switch (id) {
  Block.dirt ||
  Block.sand ||
  Block.gravel ||
  Block.leaves ||
  Block.grass ||
  Block.snow => 3,
  Block.planks || Block.glass => 5,
  Block.log => 8,
  Block.cobble || Block.stone => 15,
  Block.torch || Block.workbench || Block.bed => 2,
  _ => isOre(id) ? 15 : null, // air, water, reinforced wall
};

/// Which variants a night can spawn (spec §4).
List<ZombieKind> kindsForNight(int night) => [
  ZombieKind.basic,
  if (night >= 2) ZombieKind.worker,
  if (night >= 3) ZombieKind.soldier,
  if (night >= 4) ZombieKind.toxic,
];

/// how many zombies a night brings: the first night's count plus the
/// per-night increase (the admin's rules; the defaults are 8 and 6)
int zombiesForNight(int night, {int firstNight = 8, int perNight = 6}) =>
    math.max(0, firstNight + perNight * (night - 1));

enum ZombieState {
  chase('chase'),
  attack('attack'),
  burn('burn'),
  dead('dead');

  const ZombieState(this.wire);

  final String wire;

  static ZombieState parse(String wire) =>
      values.firstWhere((s) => s.wire == wire, orElse: () => chase);

  bool get alive => this == chase || this == attack;
}

final class Zombie {
  Zombie({
    required this.id,
    required this.kind,
    required this.x,
    required this.y,
    required this.z,
    required this.hp,
    required this.repathIn,
  });

  final int id;
  final ZombieKind kind;
  double x;
  double y;
  double z;
  double vx = 0;
  double vy = 0;
  double vz = 0;

  /// facing; model faces +Z at yaw 0
  double yaw = 0;
  double hp;
  bool onGround = false;

  /// burn at dawn / dead after a kill; removed when burnTimer reaches 0
  ZombieState state = ZombieState.chase;
  double burnTimer = 0;
  List<Cell> path = [];
  double repathIn;
  double attackCooldown = 0.5;
  double stuckTime = 0;

  /// set for one tick when an attack animation should play
  bool attacked = false;

  bool get alive => state.alive;
}

final class ZombieTarget {
  const ZombieTarget(this.x, this.y, this.z);

  final double x;
  final double y;
  final double z;
}

abstract interface class ZombieHost {
  World get world;
  void damagePlayer(double amount, {required bool poison});

  /// break a block the zombie destroyed (drops, props)
  void breakBlock(int x, int y, int z);
}

/// the ZOMBIE tuning table
abstract final class ZombieTuning {
  static const double width = 0.6;
  static const double height = 1.8;
  static const double gravity = 25;
  static const double jumpSpeed = 8;
  static const double accel = 25;
  static const double attackRange = 1.6;
  static const double attackSeconds = 1.2;
  static const double blockHitSeconds = 1.0;
  static const double repathSeconds = 0.5;
  static const double stuckSeconds = 0.5;
  static const int maxLive = 40;
  static const double minSpawnDistance = 20;
  static const double burnSeconds = 10;
  static const double deathSeconds = 1.2;

  /// pathfinding time budget per update call (ms); searches beyond it wait for the next tick
  static const double pathBudgetMs = 1.5;
  static const int pathMaxNodes = 500;

  /// beyond this distance zombies walk straight at the target instead of searching
  static const double pathMaxDistance = 40;

  /// spawn spots are looked for this far above / below the player being surrounded
  static const int spawnSearchHeight = 24;
}

final class ZombieManager {
  ZombieManager(this._host, this._rng);

  final ZombieHost _host;
  final Rng _rng;
  final List<Zombie> zombies = [];
  int kills = 0;
  int _nextId = 1;

  /// accumulated hits on blocks, keyed "x,y,z"
  final Map<String, int> _blockDamage = {};
  final Stopwatch _clock = Stopwatch()..start();

  int get liveCount => zombies.where((z) => z.alive).length;

  Zombie spawn(ZombieKind kind, double x, double y, double z) {
    final zb = Zombie(
      id: _nextId++,
      kind: kind,
      x: x,
      y: y,
      z: z,
      hp: zombieStats[kind]!.hp,
      repathIn: _rng.random() * ZombieTuning.repathSeconds,
    );
    zombies.add(zb);
    return zb;
  }

  /// Spawn a group on grass / sand around one of the targets, `radius` blocks
  /// out and ≥ minSpawnDistance from every target, on the same layer (ground
  /// or island) as them. Returns how many were spawned (0 if no spot was
  /// found or the cap is reached).
  int spawnGroup(
    List<ZombieKind> kinds,
    int count,
    List<ZombieTarget> targets,
    double radius,
  ) {
    final world = _host.world;
    var spawned = 0;
    if (targets.isEmpty) return 0;
    for (var attempt = 0; attempt < 40 && spawned < count; attempt++) {
      if (liveCount >= ZombieTuning.maxLive) break;
      final around = targets[_rng.randint(0, targets.length - 1)];
      final angle = _rng.random() * jsPi * 2;
      final dist = radius * (0.6 + _rng.random() * 0.35);
      final x = jsRound(around.x + jsCos(angle) * dist);
      final z = jsRound(around.z + jsSin(angle) * dist);
      final y = _grassTop(x, z, around.y);
      if (y == null) continue;
      if (targets.any(
        (t) => hypot(t.x - x, t.z - z) < ZombieTuning.minSpawnDistance,
      )) {
        continue;
      }
      // scatter the group around the spot
      for (var i = 0; i < count && spawned < count; i++) {
        final sx = x + _rng.randint(-2, 2);
        final sz = z + _rng.randint(-2, 2);
        final sy = _grassTop(sx, sz, y.toDouble()) ?? y;
        if (!isSolid(world.getBlock(sx, sy, sz)) &&
            !isSolid(world.getBlock(sx, sy + 1, sz))) {
          spawn(
            kinds[_rng.randint(0, kinds.length - 1)],
            sx + 0.5,
            sy.toDouble(),
            sz + 0.5,
          );
          spawned++;
        }
      }
    }
    return spawned;
  }

  /// Standing y above the grass / sand surface nearest to `nearY` in a loaded
  /// column, or null. Searching out from the anchor keeps island spawns on
  /// the island and ground spawns on the ground.
  int? _grassTop(int x, int z, double nearY) {
    final world = _host.world;
    if (!world.isColumnLoaded(x, z)) return null;
    final centre = nearY.floor();
    for (var d = 0; d <= ZombieTuning.spawnSearchHeight; d++) {
      for (final y in d == 0 ? [centre] : [centre - d, centre + d]) {
        final id = world.getBlock(x, y, z);
        if (id != Block.grass && id != Block.sand) continue;
        if (isSolid(world.getBlock(x, y + 1, z)) ||
            isSolid(world.getBlock(x, y + 2, z))) {
          continue;
        }
        return y + 1;
      }
    }
    return null;
  }

  /// Dawn: everything left burns away.
  void burnAll() {
    for (final z in zombies) {
      if (z.alive) {
        z.state = ZombieState.burn;
        z.burnTimer = ZombieTuning.burnSeconds;
      }
    }
  }

  /// Apply damage; returns true if this hit killed it.
  bool damage(Zombie z, double amount, {double knockX = 0, double knockZ = 0}) {
    if (!z.alive) return false;
    z.hp -= amount;
    z.vx += knockX;
    z.vz += knockZ;
    if (knockX != 0 || knockZ != 0) z.vy = math.max(z.vy, 3);
    if (z.hp <= 0) {
      z.state = ZombieState.dead;
      z.burnTimer = ZombieTuning.deathSeconds;
      kills++;
      return true;
    }
    return false;
  }

  void update(double dt, List<ZombieTarget> targets) {
    final budgetEnd =
        _clock.elapsedMicroseconds / 1000 + ZombieTuning.pathBudgetMs;
    for (final z in List.of(zombies)) {
      z.attacked = false;
      if (!z.alive) {
        z.burnTimer -= dt;
        if (z.burnTimer <= 0) zombies.remove(z);
        continue;
      }
      final target = _nearest(z, targets);
      if (target == null) {
        _physics(z, dt, 0, 0);
        continue;
      }
      final dx = target.x - z.x;
      final dz = target.z - z.z;
      final horiz = hypot(dx, dz);
      z.attackCooldown = math.max(0, z.attackCooldown - dt);

      if (horiz <= ZombieTuning.attackRange && (target.y - z.y).abs() <= 1.6) {
        z.state = ZombieState.attack;
        z.yaw = math.atan2(dx, dz);
        if (z.attackCooldown == 0) {
          final st = zombieStats[z.kind]!;
          _host.damagePlayer(st.damage, poison: st.poisons);
          z.attackCooldown = ZombieTuning.attackSeconds;
          z.attacked = true;
        }
        _physics(z, dt, 0, 0);
        continue;
      }

      z.state = ZombieState.chase;
      z.repathIn -= dt;
      if (z.repathIn <= 0 && _clock.elapsedMicroseconds / 1000 < budgetEnd) {
        z.repathIn = ZombieTuning.repathSeconds;
        if (horiz > ZombieTuning.pathMaxDistance) {
          z.path = [];
        } else {
          final from = standingCellAt(_host.world, z.x, z.y, z.z);
          final to = standingCellAt(_host.world, target.x, target.y, target.z);
          z.path = findPath(
            _host.world,
            from,
            to,
            maxNodes: ZombieTuning.pathMaxNodes,
          ).path;
        }
      }
      // next waypoint (or straight at the target when there is no path)
      var wx = target.x;
      var wz = target.z;
      var wy = target.y;
      while (z.path.isNotEmpty) {
        final c = z.path[0];
        if (hypot(c.x + 0.5 - z.x, c.z + 0.5 - z.z) < 0.4 &&
            (c.y - z.y).abs() < 1.1) {
          z.path.removeAt(0);
          continue;
        }
        wx = c.x + 0.5;
        wz = c.z + 0.5;
        wy = c.y.toDouble();
        break;
      }
      final mx = wx - z.x;
      final mz = wz - z.z;
      var ml = hypot(mx, mz);
      if (ml == 0) ml = 1;
      z.yaw = math.atan2(mx, mz);
      if (wy > z.y + 0.5 && z.onGround && ml < 1.4) {
        z.vy = ZombieTuning.jumpSpeed;
      }
      final speed = zombieStats[z.kind]!.speed;
      final blocked = _physics(z, dt, (mx / ml) * speed, (mz / ml) * speed);
      if (blocked) {
        z.stuckTime += dt;
        if (z.stuckTime >= ZombieTuning.stuckSeconds) _attackBlockAhead(z, wy);
      } else {
        z.stuckTime = 0;
      }
    }
  }

  ZombieTarget? _nearest(Zombie z, List<ZombieTarget> targets) {
    ZombieTarget? best;
    var bestD = double.infinity;
    for (final t in targets) {
      final d = hypot3(t.x - z.x, t.y - z.y, t.z - z.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /// Integrate one step; returns true if horizontal movement was blocked.
  bool _physics(Zombie z, double dt, double wishX, double wishZ) {
    final a = ZombieTuning.accel * dt;
    z.vx += (wishX - z.vx).clamp(-a, a);
    z.vz += (wishZ - z.vz).clamp(-a, a);
    z.vy = math.max(-50, z.vy - ZombieTuning.gravity * dt);
    const half = ZombieTuning.width / 2;
    final box = Box(
      x: z.x - half,
      y: z.y,
      z: z.z - half,
      w: ZombieTuning.width,
      h: ZombieTuning.height,
      d: ZombieTuning.width,
    );
    final r = moveBox(_host.world, box, z.vx * dt, z.vy * dt, z.vz * dt);
    z.x = r.box.x + half;
    z.y = r.box.y;
    z.z = r.box.z + half;
    if (r.hitY) {
      z.onGround = z.vy <= 0;
      z.vy = 0;
    } else {
      z.onGround = false;
    }
    if (r.hitX) z.vx = 0;
    if (r.hitZ) z.vz = 0;
    if (z.y < -8) {
      // fell out of the world (should never happen over bedrock)
      z.state = ZombieState.dead;
      z.burnTimer = 0;
    }
    return (r.hitX || r.hitZ) && (wishX != 0 || wishZ != 0);
  }

  /// Hit the block in the zombie's way (chest height, then feet, then the
  /// block below a higher waypoint).
  void _attackBlockAhead(Zombie z, double waypointY) {
    if (z.attackCooldown > 0) return;
    final fx = (z.x + math.sin(z.yaw) * 0.7).floor();
    final fz = (z.z + math.cos(z.yaw) * 0.7).floor();
    final fy = z.y.floor();
    final candidates = [
      Cell(fx, fy + 1, fz),
      Cell(fx, fy, fz),
      Cell(fx, fy + 2, fz),
      Cell(z.x.floor(), fy + 2, z.z.floor()),
      if (waypointY > z.y + 1.5) Cell(z.x.floor(), fy + 2, z.z.floor()),
    ];
    for (final c in candidates) {
      final id = _host.world.getBlock(c.x, c.y, c.z);
      final hp = blockHitPoints(id);
      if (hp == null || (!isSolid(id) && !isProp(id))) continue;
      final k = '${c.x},${c.y},${c.z}';
      final dmg = (_blockDamage[k] ?? 0) + zombieStats[z.kind]!.blockDamage;
      z.attackCooldown = ZombieTuning.blockHitSeconds;
      z.attacked = true;
      if (dmg >= hp) {
        _blockDamage.remove(k);
        _host.breakBlock(c.x, c.y, c.z);
      } else {
        _blockDamage[k] = dmg;
      }
      return;
    }
  }

  /// hits accumulated on a block (for tests / crack overlay)
  int blockHits(int x, int y, int z) => _blockDamage['$x,$y,$z'] ?? 0;

  /// Client side: mirror the host's list (no AI, no physics).
  void applySnapshot(List<ZombieSnap> list) {
    final seen = <int>{};
    for (final s in list) {
      seen.add(s.id);
      var z = zombies.where((x) => x.id == s.id).firstOrNull;
      if (z == null) {
        final kind = ZombieKind.parse(s.kind);
        z = Zombie(
          id: s.id,
          kind: kind,
          x: s.x,
          y: s.y,
          z: s.z,
          hp: zombieStats[kind]!.hp,
          repathIn: 0,
        );
        zombies.add(z);
      }
      z
        ..x = s.x
        ..y = s.y
        ..z = s.z
        ..yaw = s.yaw
        ..state = ZombieState.parse(s.state)
        ..attacked = s.attacked
        ..burnTimer = s.burnTimer;
    }
    zombies.removeWhere((z) => !seen.contains(z.id));
  }
}
