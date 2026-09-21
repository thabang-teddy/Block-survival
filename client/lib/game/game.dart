/// One run of the game — the native twin of `game/Game.ts`: the streamed
/// world, the player, the day/night clock, the inventory with dig/place/craft,
/// combat (sword, rifle), the host sim (zombies, drops, crates, vitals) in
/// [HostSim], cloud saves, and the UI snapshot. Multiplayer is layered on top
/// by the sessions in lib/net/: the host applies every player's actions
/// through [HostSim.apply]; a client sends its own to the host via [onAction]
/// and mirrors the host's entities from snapshots.
library;

import 'dart:math' as math;

import 'package:block_survival/entities/crates.dart';
import 'package:block_survival/game/avatar.dart';
import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/host_sim.dart';
import 'package:block_survival/game/locator.dart';
import 'package:block_survival/game/prospector.dart';
import 'package:block_survival/game/rules.dart';
import 'package:block_survival/game/save.dart';
import 'package:block_survival/game/score.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/net/protocol.dart' hide ItemStack;
import 'package:block_survival/physics/player_controller.dart';
import 'package:block_survival/render/camera.dart';
import 'package:block_survival/render/lighting.dart';
import 'package:block_survival/world/chunk.dart';
import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/raycast.dart';
import 'package:block_survival/world/seed.dart';
import 'package:block_survival/world/terrain_gen.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter/foundation.dart' show setEquals;
import 'package:flutter/painting.dart' show Offset;
import 'package:vector_math/vector_math_64.dart' as vm;

/// chunk columns streamed around the player (chunkStreamer.ts LOAD_RADIUS)
const int loadRadiusChunks = loadRadius;

/// how far the player can dig / place
const double reach = 6;

/// the fixed simulation step, as the browser client
const double fixedDt = 1 / 60;

/// how long the arm / weapon swing animation plays
const double swingSeconds = 0.4;

/// The prospector rescans this often while it is in hand (issue #25). A scan walks
/// every loaded chunk in range, so it is worth a few milliseconds a second but not a
/// frame's worth. Nothing about it is networked — each player's lens is their own.
const double _prospectInterval = 0.4;

/// an ore marker is dropped this close: you are standing on the vein
const double oreMarkerNearMetres = 4;

/// one frame's worth of player intent, whatever produced it
final class FrameInput {
  const FrameInput({
    this.look = Offset.zero,
    this.keys = const {},
    this.jump = false,
    this.dig = false,
    this.primaryHeld = false,
    this.place = false,
    this.interact = false,
    this.reload = false,
    this.dropHeld = false,
    this.togglePanel = false,
    this.selectSlot,
    this.scoreboard = false,
  });

  /// mouse counts / touch pixels since the last frame
  final Offset look;

  /// KeyboardEvent.code names held down
  final Set<String> keys;
  final bool jump;

  /// primary pressed this frame: dig, swing or fire
  final bool dig;

  /// primary still held (the rifle keeps firing)
  final bool primaryHeld;
  final bool place;
  final bool interact;
  final bool reload;
  final bool dropHeld;
  final bool togglePanel;
  final int? selectSlot;

  /// Tab held, or the pause screen (which shows the board) is up
  final bool scoreboard;
}

/// who the game is told to save for
final class LocalPlayer {
  const LocalPlayer({required this.name, this.userId});

  final String name;
  final int? userId;

  String get saveKey => '${userId ?? 0}';
}

/// a block change to tell the other peers about
typedef EditListener = void Function(BlockEdit edit);

/// an action a client asks its host for
typedef ActionListener = void Function(ClientMessage message);

final class Game implements SimHost {
  Game({
    required this.seed,
    required this.local,
    required this.role,
    required this.worldKind,
    this.rules = GameRules.defaults,
    SaveData? restore,
  }) : terrain = TerrainGenerator(seed),
       dayNight = DayNight(rules) {
    world = World()
      ..setGenerator(terrain.generateChunk, worldChunksY)
      ..trackEdits = true;
    final s = terrain.spawn();
    me = Avatar(
      id: role == Role.host ? 'host' : 'me',
      name: local.name,
      userId: local.userId,
      spawn: Vec3(s.x, s.y, s.z),
    );
    player = PlayerController(world, s.x, s.y, s.z)
      ..updrafts = (x, z) => terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3);
    camera = Camera();
    sim = HostSim(this);
    ui.role = role;
    if (restore != null) _restore(restore);
    inventory.addListener(_inventoryChanged);
    _streamAround(force: true);
    _mirrorLocalPose();
    _syncCamera();
  }

  final int seed;
  final LocalPlayer local;
  final Role role;
  final WorldKind worldKind;
  final TerrainGenerator terrain;
  @override
  late final World world;
  late final PlayerController player;
  late final Camera camera;
  @override
  final DayNight dayNight;

  /// the admin's clock and zombie schedule (a joiner takes the host's)
  @override
  final GameRules rules;
  final GameUiState ui = GameUiState();

  /// the local player's authoritative state (on a client: the host's view of it)
  late final Avatar me;

  /// zombies, drops, crates and every avatar (mirrors only on a client)
  late final HostSim sim;

  bool get isHost => role == Role.host;

  @override
  Avatar get localAvatar => me;

  Inventory get inventory => me.inventory;
  double get health => me.health;
  set health(double v) => me.health = v;
  int get kills => me.kills;
  int get deaths => me.deaths;
  Vec3 get spawn => me.spawn;
  set spawn(Vec3 v) => me.spawn = v;
  int get hotbarSlot => me.slot;
  Panel panel = Panel.none;
  CameraMode cameraMode = CameraMode.first;
  CameraMode _cameraBeforeDeath = CameraMode.first;
  int bestScore = 0;

  /// saved gear of everyone else in the world, keyed by user id
  Map<String, SavedPlayer> _otherPlayers = const {};

  /// set after every block change a save has not seen yet
  bool needsSave = false;
  String _toast = '';
  double _toastUntil = 0;
  double _swingUntil = 0;

  /// which ore the prospector is tuned to, and the last scan (issue #25; purely local)
  int _prospectOre = ores.first.block;
  List<OreFix> _oreFixes = const [];
  double _nextProspectAt = 0;
  double _accumulator = 0;
  final Set<(int, int)> _loaded = {};
  Set<(int, int)> _anchors = const {};
  Set<(int, int)> _keep = const {};
  EditListener? onEdit;
  ActionListener? onAction;

  /// dawn broke on the host: the page posts the score and autosaves
  void Function(int night)? onDawnBroke;

  /// the host's clock authority (a client follows `welcome.time`)
  double get time => dayNight.time;

  // ---------------------------------------------------------------- frame

  void update(double dt, FrameInput input) {
    final frozen = panel != Panel.none || me.dead;
    if (!frozen) {
      player.look(input.look.dx, input.look.dy);
      if (input.jump) player.queueJump();
      if (input.dig) useItem();
      if (input.primaryHeld && !input.dig && held?.id == 'rifle') fire();
      if (input.place) place();
      if (input.interact) interact();
      if (input.reload) act(const Reload());
      if (input.dropHeld) dropHeld();
    }
    if (input.togglePanel) togglePanel();
    if (input.selectSlot != null) selectSlot(input.selectSlot!);
    final clamped = dt > 0.25 ? 0.25 : dt;
    _accumulator += clamped;
    final keys = KeySetInput(frozen ? const {} : input.keys);
    while (_accumulator >= fixedDt) {
      player.update(fixedDt, keys, frozen: frozen);
      _accumulator -= fixedDt;
    }
    _mirrorLocalPose();
    if (isHost) {
      sim.tick(clamped);
    } else {
      dayNight.update(clamped);
    }
    _syncCamera();
    _streamAround();
    _updateProspector();
    _publish(scoreboard: input.scoreboard);
  }

  void _mirrorLocalPose() {
    final s = player.state;
    me
      ..x = s.x
      ..y = s.y
      ..z = s.z
      ..yaw = s.yaw
      ..pitch = s.pitch
      ..anim = time < _swingUntil
          ? 'Swing'
          : s.sprinting
          ? 'Run'
          : 'Idle';
  }

  void _syncCamera() {
    final s = player.state;
    camera
      ..yaw = s.yaw
      ..pitch = s.pitch
      ..position = vm.Vector3(s.x, s.y + PlayerTuning.eyeHeight, s.z);
    if (cameraMode == CameraMode.third) {
      // behind and above the player, looking the same way
      camera.position -= camera.forward * 4;
    }
  }

  /// the lighting for this frame, from the clock
  Lighting lighting() {
    final sky = dayNight.sky();
    final palette = day
        .mix(sunset, sky.sunset + sky.night)
        .mix(night, sky.night);
    return Lighting(
      palette: palette,
      sunDirection: vm.Vector3(sky.sunX, sky.sunY, sky.sunZ),
    );
  }

  // ---------------------------------------------------------------- streaming

  /// The host keeps the world loaded around every player (it simulates them
  /// all) and never drops a column a zombie or drop is in; a client streams
  /// around itself.
  void _streamAround({bool force = false}) {
    (int, int) column(double x, double z) =>
        (chunkCoord(x.floor()), chunkCoord(z.floor()));
    final anchors = isHost
        ? {for (final a in sim.avatars.values) column(a.x, a.z)}
        : {column(player.state.x, player.state.z)};
    final keep = isHost
        ? {
            for (final z in sim.zombies.zombies)
              if (z.alive) column(z.x, z.z),
            for (final d in sim.drops.drops) column(d.x, d.z),
          }
        : const <(int, int)>{};
    if (!force && setEquals(anchors, _anchors) && setEquals(keep, _keep)) {
      return;
    }
    _anchors = anchors;
    _keep = keep;
    final wanted = <(int, int)>{};
    for (final (ccx, ccz) in anchors) {
      for (var dx = -loadRadiusChunks; dx <= loadRadiusChunks; dx++) {
        for (var dz = -loadRadiusChunks; dz <= loadRadiusChunks; dz++) {
          if (dx * dx + dz * dz <= loadRadiusChunks * loadRadiusChunks + 1) {
            wanted.add((ccx + dx, ccz + dz));
          }
        }
      }
    }
    for (final c in _loaded.difference(wanted).difference(keep)) {
      world.unloadColumn(c.$1, c.$2);
      _loaded.remove(c);
    }
    for (final (cx, cz) in wanted.difference(_loaded)) {
      world.loadColumn(cx, cz);
    }
    _loaded.addAll(wanted);
  }

  // ---------------------------------------------------------------- actions

  /// the block the crosshair is on, within reach
  RayHit? target() {
    final f = camera.forward;
    final e = me.eye();
    return raycastVoxels(world, e.x, e.y, e.z, f.x, f.y, f.z, reach);
  }

  ItemStack? get held => inventory.get(hotbarSlot);

  /// the eye ray: in third person it still starts at the head, not the camera
  Ray viewRay() {
    final f = camera.forward;
    return Ray(me.eye(), Vec3(f.x, f.y, f.z));
  }

  /// Local action: apply directly on the host, or send it to the host.
  void act(ClientMessage msg) {
    if (isHost) {
      sim.apply(me, msg);
    } else {
      onAction?.call(msg);
    }
  }

  /// Primary: the rifle fires; anything else swings at what is in front (the
  /// sword hard, hands and tools weakly) and, unless it is the sword, digs.
  void useItem() {
    final item = held?.id;
    if (item == 'rifle') {
      fire();
      return;
    }
    act(Swing(viewRay()));
    if (isSword(item)) {
      _swing();
      return;
    }
    dig();
  }

  /// break the targeted block; what it drops lands on the ground to be
  /// walked over (instant for now; the hardness-timed break is still open)
  void dig() {
    final hit = target();
    if (hit == null || hit.block == Block.bedrock) return;
    if (breakTime(hit.block, held?.id) == double.infinity) {
      toast('Needs a pickaxe');
      return;
    }
    act(BreakBlock(hit.x, hit.y, hit.z));
    _swing();
  }

  bool get reloading => time < me.reloadUntil;

  void fire() {
    if (reloading || time < me.nextShotAt) return;
    if (me.magazine <= 0) {
      act(const Reload());
      return;
    }
    act(Fire(viewRay()));
    // immediate feedback on a client; the host resolves the damage
    if (!isHost) me.nextShotAt = time + RifleTuning.interval;
    _swing();
    player.look(0, -RifleTuning.kick / PlayerTuning.mouseSensitivity);
  }

  void _swing() => _swingUntil = time + swingSeconds;

  // ---------------------------------------------------------------- the prospector (issue #25)
  /// how far the held prospector senses, or 0 when none is in hand
  double get prospectRange {
    final item = held?.id;
    return (item == null ? null : getItem(item).senseRange) ?? 0;
  }

  /// the ore the prospector is tuned to
  int get prospectTuning => _prospectOre;

  /// Place with a prospector in hand: tune it to the next ore. Returns false when
  /// there is no prospector, so the input falls through to placing a block.
  bool tuneProspector() {
    if (prospectRange == 0 || me.dead) return false;
    final i = ores.indexWhere((o) => o.block == _prospectOre);
    final next = ores[(i + 1) % ores.length];
    _prospectOre = next.block;
    _nextProspectAt = 0;
    toast('Prospector tuned to ${next.drop}');
    return true;
  }

  /// Rescan for the tuned ore, at most every [_prospectInterval] and only while held.
  void _updateProspector() {
    final range = prospectRange;
    if (range == 0 || me.dead) {
      if (_oreFixes.isNotEmpty) _oreFixes = const [];
      return;
    }
    if (time < _nextProspectAt) return;
    // a wider lens reads four times the chunks, so it reads them half as often
    _nextProspectAt = time + _prospectInterval * (range > 40 ? 2 : 1);
    final s = player.state;
    _oreFixes = scanForOre(
      world.getChunk,
      _prospectOre,
      s.x,
      s.y + PlayerTuning.eyeHeight,
      s.z,
      range,
      worldChunksY,
    );
  }

  /// put the held block against the face the crosshair is on
  void place() {
    // a prospector in hand tunes instead of placing
    if (tuneProspector()) return;
    final hit = target();
    final item = held;
    if (hit == null || item == null) return;
    if (hit.nx == 0 && hit.ny == 0 && hit.nz == 0) return;
    if (getItem(item.id).block == null) return;
    final yaw = (player.state.yaw / (math.pi / 2)).round() * (math.pi / 2);
    act(
      PlaceBlock(
        x: hit.x,
        y: hit.y,
        z: hit.z,
        nx: hit.nx,
        ny: hit.ny,
        nz: hit.nz,
        slot: hotbarSlot,
        yaw: yaw,
      ),
    );
    _swing();
  }

  /// F: loot a crate, set respawn at a bed, or open crafting at a workbench.
  void interact() {
    final crate = crateTarget;
    if (crate != null) {
      act(Interact(x: 0, y: 0, z: 0, block: 0, crate: crate.id));
      return;
    }
    final t = target();
    if (t == null) return;
    if (t.block == Block.workbench) {
      panel = Panel.crafting;
    } else if (t.block == Block.bed) {
      act(Interact(x: t.x, y: t.y, z: t.z, block: t.block));
    }
  }

  /// the crate the crosshair is on, within loot reach
  LootCrate? get crateTarget {
    final e = me.eye();
    final f = camera.forward;
    return sim.crates.targeted(e.x, e.y, e.z, f.x, f.y, f.z);
  }

  /// Q: throw one of the held stack forward
  void dropHeld() {
    final f = camera.forward;
    act(DropHeld(hotbarSlot, f.x, f.z));
  }

  /// a block change from another peer: applied without echo
  void applyEdit(BlockEdit e) {
    world.setBlock(e.x, e.y, e.z, e.id);
    final m = e.meta;
    if (m != null) {
      world.setProp(
        PropMeta(
          id: m.id,
          x: m.x,
          y: m.y,
          z: m.z,
          yaw: m.yaw,
          primary: m.primary,
          partner: m.partner == null
              ? null
              : (
                  m.partner!.x.toInt(),
                  m.partner!.y.toInt(),
                  m.partner!.z.toInt(),
                ),
        ),
      );
    }
  }

  /// the wire form of a block as it is now, prop metadata included
  BlockEdit editAt(int x, int y, int z) {
    final p = world.getProp(x, y, z);
    return BlockEdit(
      x: x,
      y: y,
      z: z,
      id: world.getBlock(x, y, z),
      meta: p == null
          ? null
          : PropMetaWire(
              id: p.id,
              x: p.x,
              y: p.y,
              z: p.z,
              yaw: p.yaw,
              primary: p.primary,
              partner: p.partner == null
                  ? null
                  : Vec3(
                      p.partner!.$1.toDouble(),
                      p.partner!.$2.toDouble(),
                      p.partner!.$3.toDouble(),
                    ),
            ),
    );
  }

  // ---------------------------------------------------------------- SimHost

  @override
  void recordEdit(int x, int y, int z) {
    needsSave = true;
    onEdit?.call(editAt(x, y, z));
  }

  @override
  void broadcastMessage(String text) {
    toast(text);
    for (final a in sim.avatars.values) {
      if (a != me) a.push(message: text);
    }
  }

  @override
  void tell(Avatar a, String text) {
    if (a == me) {
      toast(text);
    } else {
      a.push(message: text);
    }
  }

  @override
  void onDawn(int night) {
    bestScore = math.max(bestScore, score);
    needsSave = true; // the night survived is worth keeping
    onDawnBroke?.call(night);
  }

  @override
  void onLocalDeath() {
    _cameraBeforeDeath = cameraMode;
    cameraMode = CameraMode.third;
    panel = Panel.none;
    bestScore = math.max(bestScore, score);
  }

  @override
  void onLocalRespawn(Vec3 spawn) {
    player.teleport(spawn.x, spawn.y, spawn.z);
    player.state.stamina = PlayerTuning.maxStamina;
    cameraMode = _cameraBeforeDeath;
    _mirrorLocalPose();
  }

  // ---------------------------------------------------------------- inventory

  void selectSlot(int slot) {
    if (slot >= 0 && slot < hotbarSize) me.slot = slot;
  }

  void togglePanel() =>
      panel = panel == Panel.none ? Panel.crafting : Panel.none;

  void closePanel() => panel = Panel.none;

  bool get nearWorkbench => sim.isNear(me, Block.workbench, benchReach);

  void craftRecipe(String id) => act(Craft(id));

  void moveSlot(int from, int to) => act(MoveSlot(from, to));

  void _inventoryChanged() {
    needsSave = true;
  }

  void toast(String text, {double seconds = 2.5}) {
    _toast = text;
    _toastUntil = dayNight.time + seconds;
  }

  // ---------------------------------------------------------------- saves

  void _restore(SaveData save) {
    dayNight.time = save.time;
    dayNight.phase = dayNight.phaseAt(save.time);
    for (final e in save.edits) {
      applyEdit(e);
    }
    final mine = save.players[local.saveKey];
    _otherPlayers = {
      for (final e in save.players.entries)
        if (e.key != local.saveKey) e.key: e.value,
    };
    if (mine != null) {
      restorePlayer(me, mine, pose: true);
      player.teleport(mine.pos.x, mine.pos.y, mine.pos.z);
      player.state
        ..yaw = mine.yaw
        ..pitch = mine.pitch;
    }
    sim.restore(save);
    needsSave = false;
  }

  /// Give a player their saved self back (restorePlayer in saveState.ts).
  /// The host resumes exactly where they were; a visitor rejoining gets
  /// gear, spawn and score but starts at their spawn with full health.
  static void restorePlayer(Avatar a, SavedPlayer p, {required bool pose}) {
    a.inventory.replace(p.inventory);
    a.spawn = p.spawn;
    a.kills = p.kills;
    a.deaths = p.deaths;
    a.magazine = p.magazine;
    if (!pose) return;
    a.x = p.pos.x;
    a.y = p.pos.y;
    a.z = p.pos.z;
    a.yaw = p.yaw;
    a.pitch = p.pitch;
    a.health = p.health;
  }

  /// what the save remembers about an account that is not playing right now
  SavedPlayer? savedVisitor(int? userId) =>
      userId == null ? null : _otherPlayers['$userId'];

  /// a visitor left: keep their gear for next time
  void leaveSaved(Avatar a) {
    if (a.userId == null) return;
    _otherPlayers = {..._otherPlayers, '${a.userId}': savedPlayerOf(a)};
    needsSave = true;
  }

  static SavedPlayer savedPlayerOf(Avatar a) => SavedPlayer(
    name: a.name,
    inventory: a.inventory.all(),
    spawn: a.spawn,
    pos: Vec3(a.x, a.y, a.z),
    yaw: a.yaw,
    pitch: a.pitch,
    health: a.health,
    magazine: a.magazine,
    kills: a.kills,
    deaths: a.deaths,
  );

  SaveData buildSave() {
    final entities = sim.savedEntities();
    return SaveData(
      seed: seed,
      time: dayNight.time,
      edits: world.edits.values.map((e) => editAt(e.x, e.y, e.z)).toList(),
      players: {
        ..._otherPlayers,
        // a live player wins over a stale entry
        for (final a in sim.avatars.values)
          if (a.userId != null) '${a.userId}': savedPlayerOf(a),
        local.saveKey: savedPlayerOf(me),
      },
      zombies: entities.zombies,
      drops: entities.drops,
      crates: entities.crates,
      savedAt: DateTime.now().millisecondsSinceEpoch,
    );
  }

  /// nights survived so far, the score's basis
  int get nightsSurvived => nightsSurvivedFor(dayNight.night, dayNight.phase);

  int get score => computeScore(nightsSurvived, kills);

  // ---------------------------------------------------------------- ui

  /// remote players for the scoreboard and room counter (the sessions fill it)
  List<ScoreRow> remotePlayers = const [];

  /// where the remote players are (the sessions fill it alongside the rows)
  List<PlayerPose> remotePoses = const [];

  void _publish({required bool scoreboard}) {
    final s = player.state;
    final hit = target();
    final u = ui;
    u.locked = true;
    u.hotbarSlot = hotbarSlot;
    u.hotbar = inventory.hotbar();
    u.inventoryVersion = inventory.version;
    u.targetBlock = hit?.block ?? 0;
    u.canBreak =
        hit == null || breakTime(hit.block, held?.id) != double.infinity;
    u.x = s.x;
    u.y = s.y;
    u.z = s.z;
    u.health = health;
    u.stamina = s.stamina;
    u.ammo = held?.id == 'rifle'
        ? Ammo(me.magazine, inventory.count('ammo'))
        : null;
    u.cameraMode = cameraMode;
    u.oreFixes = _oreFixes;
    u.surfaceY = terrain.ground.height(s.x.floor(), s.z.floor());
    u.prospector = prospectRange > 0
        ? ProspectorState(
            ore: _prospectOre,
            range: prospectRange,
            found: _oreFixes.length,
          )
        : null;
    u.panel = panel;
    u.nearWorkbench = nearWorkbench;
    u.message = dayNight.time < _toastUntil ? _toast : '';
    u.interactHint = crateTarget != null
        ? 'F  loot crate'
        : hit?.block == Block.workbench
        ? 'F  craft'
        : hit?.block == Block.bed
        ? 'F  set respawn'
        : '';
    u.timer = dayNight.timerText;
    u.phase = dayNight.phase;
    u.night = dayNight.night;
    u.zombies = sim.zombies.liveCount;
    u.kills = kills;
    u.hurtAt = me.hurtAt;
    u.poisoned = time < me.poisonUntil;
    u.reloading = reloading;
    u.dead = me.dead;
    u.respawnIn = me.dead ? math.max(0, (me.respawnAt - time).ceil()) : 0;
    u.score = score;
    u.bestScore = bestScore > score ? bestScore : score;
    u.nightsSurvived = nightsSurvived;
    u.timeAlive = dayNight.time;
    u.scoreboard = scoreboard;
    // only while the board is up are the fixes worth computing
    final poseById = {
      for (final p in remotePoses)
        if (scoreboard) p.id: p,
    };
    u.players = [
      ScoreRow(
        id: 'me',
        name: local.name,
        score: score,
        kills: kills,
        deaths: deaths,
        you: true,
      ),
      for (final r in remotePlayers) r.withWhere(_whereTo(poseById[r.id], s)),
    ];
    u.poses = remotePoses;
    u.publish();
  }

  /// the scoreboard's fix on another player, when we know where they are
  Where? _whereTo(PlayerPose? pose, PlayerState s) => pose == null
      ? null
      : whereOf(
          x: s.x,
          y: s.y,
          z: s.z,
          yaw: s.yaw,
          other: vm.Vector3(pose.x, pose.y, pose.z),
        );

  void dispose() {
    inventory.removeListener(_inventoryChanged);
    ui.dispose();
  }
}

/// a night counts once dawn has broken (score.ts)
int nightsSurvivedFor(int night, Phase phase) => nightsSurvived(night, phase);
