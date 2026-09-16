/// The host-authoritative simulation — the parts of `game/Game.ts` that
/// only the host runs: the night schedule, zombies, drops, crates, every
/// avatar's vitals, and the actions players ask for (break, place, craft,
/// drop, interact, swing, fire, reload). A client keeps a [HostSim] too but
/// only mirrors the host's entity lists into it.
library;

import 'dart:math' as math;

import 'package:block_survival/entities/crates.dart';
import 'package:block_survival/entities/drops.dart';
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/game/avatar.dart';
import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/save.dart';
import 'package:block_survival/items/recipes.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/net/protocol.dart' hide ItemStack;
import 'package:block_survival/physics/aabb.dart';
import 'package:block_survival/physics/player_controller.dart';
import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/noise.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/raycast.dart';
import 'package:block_survival/world/terrain_gen.dart' show worldHeight;
import 'package:block_survival/world/world.dart';

const int rifleMag = 30;

abstract final class RifleTuning {
  static const double damage = 12;
  static const double headshot = 2;
  static const double interval = 0.12;
  static const double reloadSeconds = 2;
  static const double range = 80;

  /// radians of pitch per shot
  static const double kick = 0.012;
}

abstract final class SwordTuning {
  static const double damage = 20;
  static const double reach = 2.5;
  static const double knockback = 6;
}

/// cos(π/6): the half-angle a swing covers
final double swordArcCos = math.cos(math.pi / 6);

abstract final class PoisonTuning {
  static const double seconds = 5;
  static const double dps = 2;
}

/// fraction of the night over which the zombie groups arrive
const double spawnWindow = 0.7;
const double respawnSeconds = 5;

/// how far an avatar can act on a block
const double actionReach = 6;
const double benchReach = 4;

/// what the sim needs from the game around it
abstract interface class SimHost {
  World get world;
  DayNight get dayNight;

  /// the host's own avatar
  Avatar get localAvatar;

  /// a block changed by the sim: remember it for the save and the peers
  void recordEdit(int x, int y, int z);

  /// a toast for everyone
  void broadcastMessage(String text);

  /// a toast for one avatar
  void tell(Avatar a, String text);

  /// dawn broke: post the score, autosave
  void onDawn(int night);

  /// the local player died / came back (camera, panel, teleport)
  void onLocalDeath();
  void onLocalRespawn(Vec3 spawn);
}

final class HostSim implements ZombieHost {
  HostSim(this._host, {Rng? rng})
    : drops = DropManager(_host.world),
      crates = CrateManager(_host.world),
      _rng = rng ?? Rng(DateTime.now().millisecondsSinceEpoch & 0xffff) {
    zombies = ZombieManager(this, _rng);
    avatars[_host.localAvatar.id] = _host.localAvatar;
  }

  final SimHost _host;
  final Rng _rng;
  final DropManager drops;
  final CrateManager crates;
  late final ZombieManager zombies;

  /// everyone the host simulates, keyed by peer id (the host is [SimHost.local])
  final Map<String, Avatar> avatars = {};

  /// sim times at which the night's remaining groups arrive
  List<double> spawnTimes = [];

  double get time => _host.dayNight.time;

  @override
  World get world => _host.world;

  /// attacks are resolved in [tick] against the nearest avatar
  @override
  void damagePlayer(double amount, {required bool poison}) {}

  @override
  void breakBlock(int x, int y, int z) =>
      _breakBlock(x, y, z, world.getBlock(x, y, z));

  // ---------------------------------------------------------------- restore

  /// zombies, drops and crates that were live when the world was saved
  void restore(SaveData save) {
    // zombies only come back when the saved clock is still in the night they belong to
    if (_host.dayNight.phaseAt(save.time) == Phase.night) {
      for (final z in save.zombies) {
        final zb = zombies.spawn(ZombieKind.parse(z.kind), z.x, z.y, z.z);
        zb.hp = math.min(zb.hp, math.max(1, z.hp));
      }
    }
    for (final d in save.drops) {
      drops.spawn(d.id, d.count, d.x, d.y, d.z, vy: 0);
    }
    for (final c in save.crates) {
      crates.restore(c.x, c.y, c.z, c.items);
    }
  }

  // ---------------------------------------------------------------- tick

  void tick(double dt) {
    _updateNight(dt);
    final alive = avatars.values.where((a) => a.alive).toList();
    zombies.update(dt, [for (final a in alive) ZombieTarget(a.x, a.y, a.z)]);
    for (final z in zombies.zombies) {
      if (!z.attacked || z.state != ZombieState.attack) continue;
      final victim = _nearestAvatar(z.x, z.y, z.z);
      if (victim != null) {
        final st = zombieStats[z.kind]!;
        hurt(victim, st.damage, poison: st.poisons);
      }
    }
    drops.update(dt, [
      for (final a in alive) Collector(a.x, a.y, a.z, a.inventory),
    ]);
    for (final a in avatars.values) {
      a.tickHealth(dt);
      if (time < a.poisonUntil) a.damage(PoisonTuning.dps * dt);
      if (a.pendingRounds > 0 && time >= a.reloadUntil) {
        a.magazine += a.pendingRounds;
        a.pendingRounds = 0;
        if (a != _host.localAvatar) {
          a.push(magazine: a.magazine, reloading: false);
        }
      }
      if (a.health <= 0 && !a.dead) die(a);
      if (a.dead && time >= a.respawnAt) respawn(a);
    }
  }

  Avatar? _nearestAvatar(double x, double y, double z) {
    Avatar? best;
    var bestD = double.infinity;
    for (final a in avatars.values) {
      if (a.dead) continue;
      final d = hypot3(a.x - x, a.y - y, a.z - z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return bestD <= ZombieTuning.attackRange + 0.8 ? best : null;
  }

  // ---------------------------------------------------------------- night

  void _updateNight(double dt) {
    final dn = _host.dayNight;
    dn.update(dt);
    if (dn.justChanged) {
      if (dn.phase == Phase.night) {
        _scheduleNight(dn.night);
      } else {
        zombies.burnAll();
        spawnTimes = [];
        _host.broadcastMessage('Dawn — you survived night ${dn.night}');
        _host.onDawn(dn.night);
      }
    }
    while (spawnTimes.isNotEmpty && dn.time >= spawnTimes[0]) {
      spawnTimes.removeAt(0);
      final targets = [
        for (final a in avatars.values)
          if (a.alive) ZombieTarget(a.x, a.y, a.z),
      ];
      zombies.spawnGroup(
        kindsForNight(dn.night),
        3 + _rng.randint(0, 3),
        targets,
        28,
      );
    }
  }

  /// Split the night's zombie count into groups of 3–6 spread over the spawn window.
  void _scheduleNight(int night) {
    final total = zombiesForNight(night);
    final groups = math.max(1, jsRound(total / 4.5));
    final window = nightSeconds * spawnWindow;
    spawnTimes = [
      for (var i = 0; i < groups; i++) time + 2 + (i * window) / groups,
    ];
    _host.broadcastMessage('Night $night — they are coming');
  }

  // ---------------------------------------------------------------- vitals

  void hurt(Avatar a, double amount, {required bool poison}) {
    a.damage(amount);
    a.hurtAt = time;
    if (poison) a.poisonUntil = time + PoisonTuning.seconds;
    if (a != _host.localAvatar) {
      a.push(health: a.health, hurtAt: 1, poisoned: time < a.poisonUntil);
    }
  }

  /// Death: the inventory becomes a loot crate where you fell; respawn after
  /// 5 s at the bed / pad.
  void die(Avatar a) {
    a.deaths++;
    a.dead = true;
    a.respawnAt = time + respawnSeconds;
    crates.dropInventory(a.inventory, a.x, a.y + 0.5, a.z);
    a.magazine = 0;
    a.pendingRounds = 0;
    a.reloadUntil = 0;
    a.poisonUntil = 0;
    if (a == _host.localAvatar) {
      _host.onLocalDeath();
    } else {
      a.push(
        dead: true,
        respawnIn: respawnSeconds,
        magazine: 0,
        reloading: false,
        poisoned: false,
      );
    }
  }

  void respawn(Avatar a) {
    a.dead = false;
    a.health = AvatarTuning.maxHealth;
    a.sinceDamage = 0;
    final sp = a.spawn;
    a.x = sp.x;
    a.y = sp.y;
    a.z = sp.z;
    final msg = crates.crates.isNotEmpty
        ? 'Your loot crate is where you fell'
        : 'Back on your feet';
    if (a == _host.localAvatar) {
      _host.onLocalRespawn(sp);
      _host.tell(a, msg);
    } else {
      a.push(dead: false, health: a.health, teleport: sp, message: msg);
    }
  }

  // ---------------------------------------------------------------- actions

  /// A player's request, from the local input or a client's message.
  void apply(Avatar a, ClientMessage msg) {
    switch (msg) {
      case BreakBlock(:final x, :final y, :final z):
        doBreak(a, x, y, z);
      case PlaceBlock():
        doPlace(a, msg);
      case Craft(:final recipe):
        doCraft(a, recipe);
      case MoveSlot(:final from, :final to):
        if (from != to) a.inventory.swap(from, to);
      case DropHeld(:final slot, :final dx, :final dz):
        doDropHeld(a, slot, dx, dz);
      case Interact():
        doInteract(a, msg);
      case Swing(:final ray):
        doSwing(a, ray);
      case Fire(:final ray):
        doFire(a, ray);
      case Reload():
        doReload(a);
      default:
        break;
    }
  }

  bool _withinReach(Avatar a, int x, int y, int z) {
    final e = a.eye();
    return hypot3(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z) <= actionReach;
  }

  void doBreak(Avatar a, int x, int y, int z) {
    if (a.dead || !_withinReach(a, x, y, z)) return;
    final block = world.getBlock(x, y, z);
    if (block == air) return;
    // includes bedrock
    if (breakTime(block, a.heldItem) == double.infinity) return;
    _breakBlock(x, y, z, block);
  }

  void _breakBlock(int x, int y, int z, int block) {
    // multi-cell props (bed) go together and drop once
    final partner = world.getProp(x, y, z)?.partner;
    world.setBlock(x, y, z, air);
    _host.recordEdit(x, y, z);
    if (partner != null) {
      final (px, py, pz) = partner;
      world.setBlock(px, py, pz, air);
      _host.recordEdit(px, py, pz);
    }
    final item = dropForBlock(block);
    if (item != null) {
      drops.spawn(
        item,
        1,
        x + 0.5,
        y + 0.3,
        z + 0.5,
        vx: (_rng.random() - 0.5) * 2,
        vy: 2.5,
        vz: (_rng.random() - 0.5) * 2,
      );
    }
  }

  bool _anyAvatarOverlaps(int x, int y, int z) {
    const half = PlayerTuning.width / 2;
    for (final a in avatars.values) {
      if (a.dead) continue;
      if (a.x - half < x + 1 &&
          a.x + half > x &&
          a.y < y + 1 &&
          a.y + PlayerTuning.height > y &&
          a.z - half < z + 1 &&
          a.z + half > z) {
        return true;
      }
    }
    return false;
  }

  bool _canOccupy(int x, int y, int z, {required bool solid}) {
    final existing = world.getBlock(x, y, z);
    if (existing != air && existing != Block.water) return false;
    return !(solid && _anyAvatarOverlaps(x, y, z));
  }

  void doPlace(Avatar a, PlaceBlock msg) {
    if (a.dead) return;
    final stack = a.inventory.get(msg.slot);
    if (stack == null) return;
    final block = getItem(stack.id).block;
    if (block == null) return;
    final x = msg.x + msg.nx;
    final y = msg.y + msg.ny;
    final z = msg.z + msg.nz;
    if (y < 0 || y >= worldHeight) return;
    if (!_withinReach(a, x, y, z) ||
        !_canOccupy(x, y, z, solid: isSolid(block))) {
      return;
    }
    if (isProp(block)) {
      if (!_placeProp(block, x, y, z, msg.yaw)) return;
    } else {
      world.setBlock(x, y, z, block);
      _host.recordEdit(x, y, z);
    }
    a.inventory.takeFromSlot(msg.slot, 1);
  }

  /// Props need a solid floor; the bed also needs its second cell. Returns false if blocked.
  bool _placeProp(int block, int x, int y, int z, double yaw) {
    if (!isSolid(world.getBlock(x, y - 1, z))) return false;
    (int, int, int)? partner;
    if (block == Block.bed) {
      final fx = x + jsRound(math.sin(yaw));
      final fz = z + jsRound(math.cos(yaw));
      if (!_canOccupy(fx, y, fz, solid: false) ||
          !isSolid(world.getBlock(fx, y - 1, fz))) {
        return false;
      }
      partner = (fx, y, fz);
      world.setProp(
        PropMeta(
          id: block,
          x: fx,
          y: y,
          z: fz,
          yaw: yaw,
          primary: false,
          partner: (x, y, z),
        ),
      );
      _host.recordEdit(fx, y, fz);
    }
    world.setProp(
      PropMeta(
        id: block,
        x: x,
        y: y,
        z: z,
        yaw: yaw,
        primary: true,
        partner: partner,
      ),
    );
    _host.recordEdit(x, y, z);
    return true;
  }

  void doCraft(Avatar a, String recipeId) {
    if (a.dead) return;
    final recipe = getRecipe(recipeId);
    final overflow = craft(
      a.inventory,
      recipe,
      nearBench: isNear(a, Block.workbench, benchReach),
    );
    if (overflow != null && overflow > 0) {
      drops.spawn(recipe.output.id, overflow, a.x, a.y + 1, a.z);
    }
  }

  void doDropHeld(Avatar a, int slot, double dx, double dz) {
    if (a.dead) return;
    final stack = a.inventory.get(slot);
    if (stack == null || a.inventory.takeFromSlot(slot, 1) != 1) return;
    drops.spawn(
      stack.id,
      1,
      a.x + dx * 0.6,
      a.y + 1.3,
      a.z + dz * 0.6,
      vx: dx * 4,
      vy: 2.5,
      vz: dz * 4,
    );
  }

  void doInteract(Avatar a, Interact msg) {
    if (a.dead) return;
    final crateId = msg.crate;
    if (crateId != null) {
      final crate = crates.crates.where((c) => c.id == crateId).firstOrNull;
      if (crate == null ||
          hypot3(crate.x - a.x, crate.y - a.y, crate.z - a.z) > 5) {
        return;
      }
      final n = crates.loot(crate, a.inventory);
      _host.tell(
        a,
        n > 0 ? 'Took $n item${n == 1 ? '' : 's'}' : 'Inventory full',
      );
      return;
    }
    if (msg.block == Block.bed &&
        world.getBlock(msg.x, msg.y, msg.z) == Block.bed &&
        _withinReach(a, msg.x, msg.y, msg.z)) {
      a.spawn = Vec3(msg.x + 0.5, msg.y + 1, msg.z + 0.5);
      if (a != _host.localAvatar) a.push(spawn: a.spawn);
      _host.tell(a, 'Respawn point set');
    }
  }

  void doSwing(Avatar a, Ray r) {
    if (a.dead || a.heldItem != 'sword') return;
    final o = r.origin;
    final d = r.direction;
    for (final z in zombies.zombies) {
      if (!z.alive) continue;
      final vx = z.x - o.x;
      final vy = z.y + 1 - o.y;
      final vz = z.z - o.z;
      final dist = hypot3(vx, vy, vz);
      if (dist > SwordTuning.reach) continue;
      if ((vx * d.x + vy * d.y + vz * d.z) / (dist == 0 ? 1 : dist) <
          swordArcCos) {
        continue;
      }
      if (zombies.damage(
        z,
        SwordTuning.damage,
        knockX: d.x * SwordTuning.knockback,
        knockZ: d.z * SwordTuning.knockback,
      )) {
        a.kills++;
      }
    }
  }

  void doFire(Avatar a, Ray r) {
    if (a.dead ||
        a.heldItem != 'rifle' ||
        time < a.reloadUntil ||
        time < a.nextShotAt) {
      return;
    }
    if (a.magazine <= 0) {
      doReload(a);
      return;
    }
    a.magazine--;
    a.nextShotAt = time + RifleTuning.interval;
    final o = r.origin;
    final d = r.direction;
    final wall = raycastVoxels(
      world,
      o.x,
      o.y,
      o.z,
      d.x,
      d.y,
      d.z,
      RifleTuning.range,
    );
    var bestT = wall?.distance ?? RifleTuning.range;
    Zombie? hit;
    for (final z in zombies.zombies) {
      if (!z.alive) continue;
      const half = ZombieTuning.width / 2;
      final t = rayBox(
        o.x,
        o.y,
        o.z,
        d.x,
        d.y,
        d.z,
        Box(
          x: z.x - half,
          y: z.y,
          z: z.z - half,
          w: ZombieTuning.width,
          h: 2,
          d: ZombieTuning.width,
        ),
      );
      if (t != null && t < bestT) {
        hit = z;
        bestT = t;
      }
    }
    if (hit != null) {
      final headshot = o.y + d.y * bestT > hit.y + 1.5;
      final dmg =
          RifleTuning.damage *
          (headshot ? RifleTuning.headshot : 1) *
          zombieStats[hit.kind]!.rifleResist;
      if (zombies.damage(hit, dmg, knockX: d.x * 1.5, knockZ: d.z * 1.5)) {
        a.kills++;
      }
    }
    if (a != _host.localAvatar) a.push(magazine: a.magazine);
  }

  void doReload(Avatar a) {
    if (a.dead ||
        a.heldItem != 'rifle' ||
        a.magazine == rifleMag ||
        time < a.reloadUntil) {
      return;
    }
    final have = math.min(rifleMag - a.magazine, a.inventory.count('ammo'));
    if (have <= 0) return;
    a.inventory.remove('ammo', have);
    a.reloadUntil = time + RifleTuning.reloadSeconds;
    a.pendingRounds = have;
    if (a != _host.localAvatar) a.push(reloading: true);
  }

  /// is a prop block of this kind within `radius` of the avatar's chest?
  bool isNear(Avatar a, int block, double radius) {
    for (final p in world.props.values) {
      if (p.id == block &&
          hypot3(p.x + 0.5 - a.x, p.y + 0.5 - (a.y + 0.9), p.z + 0.5 - a.z) <=
              radius) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- wire

  Snapshot snapshot() => Snapshot(
    time: time,
    players: [for (final a in avatars.values) snapOf(a)],
    zombies: [
      for (final z in zombies.zombies)
        ZombieSnap(
          id: z.id,
          kind: z.kind.wire,
          x: z.x,
          y: z.y,
          z: z.z,
          yaw: z.yaw,
          state: z.state.wire,
          attacked: z.attacked,
          burnTimer: z.burnTimer,
        ),
    ],
    drops: [
      for (final d in drops.drops)
        DropSnap(id: d.id, item: d.item, x: d.x, y: d.y, z: d.z),
    ],
    crates: [
      for (final c in crates.crates)
        CrateSnap(id: c.id, x: c.x, y: c.y, z: c.z, items: c.items.length),
    ],
  );

  PlayerSnap snapOf(Avatar a) => PlayerSnap(
    id: a.id,
    name: a.name,
    x: a.x,
    y: a.y,
    z: a.z,
    yaw: a.yaw,
    pitch: a.pitch,
    anim: a.anim,
    held: a.heldItem,
    health: a.health,
    dead: a.dead,
    kills: a.kills,
    deaths: a.deaths,
  );

  /// Client side: mirror the host's entity lists.
  void applySnapshot(Snapshot s) {
    zombies.applySnapshot(s.zombies);
    drops.applySnapshot(s.drops);
    crates.applySnapshot(s.crates);
  }

  /// what the save carries: live zombies, the newest drops, every crate
  ({List<SavedZombie> zombies, List<SavedDrop> drops, List<SavedCrate> crates})
  savedEntities() {
    final d = [
      for (final x in drops.drops)
        SavedDrop(id: x.item, count: x.count, x: x.x, y: x.y, z: x.z),
    ];
    return (
      // burning / dead zombies are already on their way out
      zombies: [
        for (final z in zombies.zombies)
          if (z.alive)
            SavedZombie(kind: z.kind.wire, x: z.x, y: z.y, z: z.z, hp: z.hp),
      ],
      drops: d.sublist(math.max(0, d.length - maxSavedDrops)),
      crates: [
        for (final c in crates.crates)
          SavedCrate(x: c.x, y: c.y, z: c.z, items: List.of(c.items)),
      ],
    );
  }
}
