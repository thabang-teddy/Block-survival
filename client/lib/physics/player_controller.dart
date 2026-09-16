/// First-person player — twin of `physics/playerController.ts`: mouse look,
/// WASD, sprint, jump, gravity, step-up, updraft lift, all resolved against the
/// voxel world with swept AABBs. Checked tick for tick against
/// shared/fixtures/physics/walk.json.
library;

import 'dart:math' as math;

import 'package:block_survival/physics/aabb.dart';
import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/updraft.dart';
import 'package:block_survival/world/world.dart';

abstract final class PlayerTuning {
  static const double width = 0.6;
  static const double height = 1.8;
  static const double eyeHeight = 1.62;
  static const double walkSpeed = 4.3;
  static const double sprintSpeed = 7.0;
  static const double jumpSpeed = 8.0;
  static const double gravity = 25;
  static const double stepHeight = 0.55;
  static const double groundAccel = 40;
  static const double airAccel = 10;
  static const double mouseSensitivity = 0.0022;

  /// px of look applied in one tick at most: more than this is a stall, not a move
  static const double maxLookPerTick = 400;

  /// below the bedrock at y = 0: something went wrong, put the player back on the pad
  static const double voidY = -8;
  static const double maxStamina = 100;
  static const double staminaDrain = 15;
  static const double staminaRegen = 12;
  static const double staminaRegenDelay = 1.0;
}

/// normalise an angle into (-π, π]
double wrapAngle(double a) {
  const twoPi = math.pi * 2;
  // JS % keeps the sign of the dividend, like Dart's remainder (not %)
  a = a.remainder(twoPi);
  if (a > math.pi) {
    a -= twoPi;
  } else if (a <= -math.pi) {
    a += twoPi;
  }
  return a;
}

/// the keys the controller reads, by the browser's KeyboardEvent.code names
abstract interface class PlayerInput {
  bool isDown(String code);
}

final class KeySetInput implements PlayerInput {
  KeySetInput([Set<String>? down]) : down = down ?? {};

  final Set<String> down;

  @override
  bool isDown(String code) => down.contains(code);
}

final class PlayerState {
  PlayerState({
    required this.x,
    required this.y,
    required this.z,
    this.vx = 0,
    this.vy = 0,
    this.vz = 0,
    this.yaw = 0,
    this.pitch = 0,
    this.onGround = false,
    this.stamina = PlayerTuning.maxStamina,
    this.sprinting = false,
    this.sinceSprint = 99,
    this.inUpdraft = false,
  });

  /// feet centre
  double x;
  double y;
  double z;
  double vx;
  double vy;
  double vz;
  double yaw;
  double pitch;
  bool onGround;
  double stamina;

  /// true while actually sprinting this tick
  bool sprinting;

  /// seconds since the player last sprinted
  double sinceSprint;

  /// standing in an updraft shaft: Space rises, Shift sinks, otherwise hover
  bool inUpdraft;
}

typedef UpdraftsNear = List<Updraft> Function(double x, double z);

final class PlayerController {
  PlayerController(this._world, double x, double y, double z)
    : spawnX = x,
      spawnY = y,
      spawnZ = z,
      state = PlayerState(x: x, y: y, z: z);

  final World _world;
  final PlayerState state;

  /// respawn point (the bed sets this)
  double spawnX;
  double spawnY;
  double spawnZ;
  bool _jumpQueued = false;

  /// the updraft shafts near a point (the terrain generator's; tests pass a fake)
  UpdraftsNear updrafts = (_, _) => const [];

  Box get box {
    final s = state;
    const half = PlayerTuning.width / 2;
    return Box(
      x: s.x - half,
      y: s.y,
      z: s.z - half,
      w: PlayerTuning.width,
      h: PlayerTuning.height,
      d: PlayerTuning.width,
    );
  }

  /// would placing a solid block at this voxel overlap the player?
  bool overlapsVoxel(int x, int y, int z) {
    final b = box;
    return b.x < x + 1 &&
        b.x + b.w > x &&
        b.y < y + 1 &&
        b.y + b.h > y &&
        b.z < z + 1 &&
        b.z + b.d > z;
  }

  void teleport(double x, double y, double z) {
    state
      ..x = x
      ..y = y
      ..z = z
      ..vx = 0
      ..vy = 0
      ..vz = 0;
  }

  void queueJump() => _jumpQueued = true;

  void _updateVitals(double dt, bool wantSprint, bool moving) {
    final s = state;
    s.sprinting = wantSprint && moving && s.stamina > 0 && s.onGround;
    if (s.sprinting) {
      s.stamina = math.max(0.0, s.stamina - PlayerTuning.staminaDrain * dt);
      s.sinceSprint = 0;
    } else {
      s.sinceSprint += dt;
      if (s.sinceSprint > PlayerTuning.staminaRegenDelay) {
        s.stamina = math.min(
          PlayerTuning.maxStamina,
          s.stamina + PlayerTuning.staminaRegen * dt,
        );
      }
    }
  }

  /// Apply one tick of mouse delta (px), capped so a stall is not a spin.
  void look(double dx, double dy) {
    final s = state;
    const cap = PlayerTuning.maxLookPerTick;
    dx = math.max(-cap, math.min(cap, dx));
    dy = math.max(-cap, math.min(cap, dy));
    s.yaw = wrapAngle(s.yaw - dx * PlayerTuning.mouseSensitivity);
    s.pitch -= dy * PlayerTuning.mouseSensitivity;
    const limit = math.pi / 2 - 0.01;
    s.pitch = math.max(-limit, math.min(limit, s.pitch));
  }

  /// `frozen` (dead / in a menu): keys are ignored, only gravity applies
  void update(double dt, PlayerInput input, {bool frozen = false}) {
    final s = state;
    bool down(String code) => !frozen && input.isDown(code);
    // ---- wish direction in world space (yaw 0 looks down -Z)
    var fwd = 0.0;
    var side = 0.0;
    if (down('KeyW')) fwd += 1;
    if (down('KeyS')) fwd -= 1;
    if (down('KeyD')) side += 1;
    if (down('KeyA')) side -= 1;
    final rawLen = hypot(fwd, side);
    final len = rawLen == 0 ? 1.0 : rawLen;
    fwd /= len;
    side /= len;
    final sinY = jsSin(s.yaw);
    final cosY = jsCos(s.yaw);
    final wishX = -sinY * fwd + cosY * side;
    final wishZ = -cosY * fwd - sinY * side;
    _updateVitals(dt, down('ShiftLeft'), fwd != 0 || side != 0);
    final speed = s.sprinting
        ? PlayerTuning.sprintSpeed
        : PlayerTuning.walkSpeed;
    final accel =
        (s.onGround ? PlayerTuning.groundAccel : PlayerTuning.airAccel) * dt;
    s.vx += math.max(-accel, math.min(accel, wishX * speed - s.vx));
    s.vz += math.max(-accel, math.min(accel, wishZ * speed - s.vz));

    // ---- vertical
    final shaft = frozen ? null : updraftAt(updrafts(s.x, s.z), s.x, s.y, s.z);
    s.inUpdraft = shaft != null;
    if (shaft != null) {
      // the shaft carries you: ease towards rise / sink / hover, never past its top
      final want = down('Space')
          ? UpdraftTuning.rise
          : (down('ShiftLeft') ? -UpdraftTuning.sink : 0.0);
      final step = UpdraftTuning.accel * dt;
      s.vy += math.max(-step, math.min(step, want - s.vy));
      if (s.vy > 0 && s.y + s.vy * dt > shaft.topY) {
        s.vy = math.max(0.0, (shaft.topY - s.y) / dt);
      }
    } else {
      if (_jumpQueued && s.onGround && !frozen) s.vy = PlayerTuning.jumpSpeed;
      s.vy -= PlayerTuning.gravity * dt;
      s.vy = math.max(s.vy, -50.0);
    }
    _jumpQueued = false;

    _move(s.vx * dt, s.vy * dt, s.vz * dt);
    if (s.y < PlayerTuning.voidY) teleport(spawnX, spawnY, spawnZ);
  }

  void _move(double dx, double dy, double dz) {
    final s = state;
    final start = box;
    var r = moveBox(_world, start, dx, dy, dz);
    // step-up: blocked horizontally while grounded → try again from one step higher
    if ((r.hitX || r.hitZ) && s.onGround) {
      final raised = moveBox(_world, start, 0, PlayerTuning.stepHeight, 0);
      if (!raised.hitY) {
        final stepped = moveBox(_world, raised.box, dx, 0, dz);
        final settled = moveBox(
          _world,
          stepped.box,
          0,
          -PlayerTuning.stepHeight,
          0,
        );
        final gained = hypot(
          stepped.box.x - raised.box.x,
          stepped.box.z - raised.box.z,
        );
        final original = hypot(r.box.x - start.x, r.box.z - start.z);
        if (gained > original + 1e-3 &&
            settled.hitY &&
            !boxIntersectsSolid(_world, settled.box)) {
          r = MoveResult(
            box: settled.box,
            hitX: stepped.hitX,
            hitZ: stepped.hitZ,
            hitY: true,
          );
        }
      }
    }
    const half = PlayerTuning.width / 2;
    s.x = r.box.x + half;
    s.y = r.box.y;
    s.z = r.box.z + half;
    if (r.hitX) s.vx = 0;
    if (r.hitZ) s.vz = 0;
    if (r.hitY) {
      s.onGround = dy <= 0;
      s.vy = 0;
    } else {
      s.onGround = false;
    }
  }
}
