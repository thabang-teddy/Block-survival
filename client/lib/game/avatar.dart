/// One player's authoritative state on the host — twin of `game/Avatar.ts`:
/// pose (mirrored from the local controller or from a client's input
/// packets), inventory, weapon, vitals, score. The local player's avatar is
/// also used on clients, filled from the host's private state messages.
library;

import 'dart:math' as math;

import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/net/protocol.dart' hide ItemStack;

abstract final class AvatarTuning {
  static const double maxHealth = 100;
  static const double healthRegen = 1;
  static const double healthRegenDelay = 8;
  static const double eyeHeight = 1.62;
}

final class Avatar {
  Avatar({
    required this.id,
    required this.name,
    this.userId,
    required Vec3 spawn,
  }) : spawn = spawn,
       x = spawn.x,
       y = spawn.y,
       z = spawn.z;

  final String id;
  String name;

  /// the account behind this player, when known
  final int? userId;

  // ---- pose
  double x;
  double y;
  double z;
  double yaw = 0;
  double pitch = 0;

  /// Idle | Walk | Run | Aim | Swing
  String anim = 'Idle';
  int slot = 0;
  bool aiming = false;

  // ---- gear
  final Inventory inventory = Inventory();
  int magazine = 0;
  double reloadUntil = 0;
  int pendingRounds = 0;
  double nextShotAt = 0;

  // ---- vitals
  double health = AvatarTuning.maxHealth;
  double sinceDamage = 99;
  double poisonUntil = 0;
  double hurtAt = -10;
  bool dead = false;
  double respawnAt = 0;
  Vec3 spawn;

  // ---- score
  int kills = 0;
  int deaths = 0;

  _Outbox _outbox = _Outbox();

  String? get heldItem => inventory.get(slot)?.id;

  bool get alive => !dead;

  Vec3 eye() => Vec3(x, y + AvatarTuning.eyeHeight, z);

  void damage(double amount) {
    health = math.max(0, health - amount);
    sinceDamage = 0;
  }

  void tickHealth(double dt) {
    sinceDamage += dt;
    if (sinceDamage > AvatarTuning.healthRegenDelay && !dead) {
      health = math.min(
        AvatarTuning.maxHealth,
        health + AvatarTuning.healthRegen * dt,
      );
    }
  }

  /// queue a private-state change for the client (unused for the host's own avatar)
  void push({
    List<ItemStack?>? inventory,
    int? magazine,
    bool? reloading,
    double? health,
    bool? poisoned,
    double? hurtAt,
    bool? dead,
    double? respawnIn,
    Vec3? teleport,
    Vec3? spawn,
    String? message,
    List<Fx>? fx,
  }) {
    final o = _outbox;
    if (inventory != null) o.inventory = inventory;
    if (magazine != null) o.magazine = magazine;
    if (reloading != null) o.reloading = reloading;
    if (health != null) o.health = health;
    if (poisoned != null) o.poisoned = poisoned;
    if (hurtAt != null) o.hurtAt = hurtAt;
    if (dead != null) o.dead = dead;
    if (respawnIn != null) o.respawnIn = respawnIn;
    if (teleport != null) o.teleport = teleport;
    if (spawn != null) o.spawn = spawn;
    if (message != null) o.message = message;
    if (fx != null) o.fx = [...?o.fx, ...fx];
    o.changed = true;
  }

  PrivateState? takeOutbox() {
    final o = _outbox;
    if (!o.changed) return null;
    _outbox = _Outbox();
    return PrivateState(
      inventory: o.inventory,
      magazine: o.magazine,
      reloading: o.reloading,
      health: o.health,
      poisoned: o.poisoned,
      hurtAt: o.hurtAt,
      dead: o.dead,
      respawnIn: o.respawnIn,
      teleport: o.teleport,
      spawn: o.spawn,
      message: o.message,
      fx: o.fx,
    );
  }
}

final class _Outbox {
  bool changed = false;
  List<ItemStack?>? inventory;
  int? magazine;
  bool? reloading;
  double? health;
  bool? poisoned;
  double? hurtAt;
  bool? dead;
  double? respawnIn;
  Vec3? teleport;
  Vec3? spawn;
  String? message;
  List<Fx>? fx;
}
