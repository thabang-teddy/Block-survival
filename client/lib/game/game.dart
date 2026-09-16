/// One run of the game — the native twin of the parts of `game/Game.ts` that
/// exist so far: the streamed world, the player, the day/night clock, the
/// inventory with dig/place/craft, cloud saves, and the UI snapshot. Zombies,
/// combat, drops and crates are P2 (client/docs/tasks.md); multiplayer is
/// layered on top by the sessions in lib/net/.
library;

import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/save.dart';
import 'package:block_survival/game/score.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/items/recipes.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/net/protocol.dart' hide ItemStack;
import 'package:block_survival/physics/player_controller.dart';
import 'package:block_survival/render/camera.dart';
import 'package:block_survival/render/lighting.dart';
import 'package:block_survival/world/chunk.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/raycast.dart';
import 'package:block_survival/world/seed.dart';
import 'package:block_survival/world/terrain_gen.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter/painting.dart' show Offset;
import 'package:vector_math/vector_math_64.dart' as vm;

/// chunk columns streamed around the player (chunkStreamer.ts LOAD_RADIUS)
const int loadRadiusChunks = loadRadius;

/// how far the player can dig / place
const double reach = 6;

/// the fixed simulation step, as the browser client
const double fixedDt = 1 / 60;

/// one frame's worth of player intent, whatever produced it
final class FrameInput {
  const FrameInput({
    this.look = Offset.zero,
    this.keys = const {},
    this.jump = false,
    this.dig = false,
    this.place = false,
    this.interact = false,
    this.togglePanel = false,
    this.selectSlot,
    this.scoreboard = false,
  });

  /// mouse counts / touch pixels since the last frame
  final Offset look;

  /// KeyboardEvent.code names held down
  final Set<String> keys;
  final bool jump;
  final bool dig;
  final bool place;
  final bool interact;
  final bool togglePanel;
  final int? selectSlot;

  /// Tab held
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

final class Game {
  Game({
    required this.seed,
    required this.local,
    required this.role,
    required this.worldKind,
    SaveData? restore,
  }) : terrain = TerrainGenerator(seed) {
    world = World()
      ..setGenerator(terrain.generateChunk, worldChunksY)
      ..trackEdits = true;
    final s = terrain.spawn();
    spawn = Vec3(s.x, s.y, s.z);
    player = PlayerController(world, s.x, s.y, s.z)
      ..updrafts = (x, z) => terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3);
    camera = Camera();
    ui.role = role;
    if (restore != null) _restore(restore);
    inventory.addListener(_inventoryChanged);
    _streamAround(force: true);
    _syncCamera();
  }

  final int seed;
  final LocalPlayer local;
  final Role role;
  final WorldKind worldKind;
  final TerrainGenerator terrain;
  late final World world;
  late final PlayerController player;
  late final Camera camera;
  final DayNight dayNight = DayNight();
  final Inventory inventory = Inventory();
  final GameUiState ui = GameUiState();

  /// where the player respawns (the bed changes it)
  late Vec3 spawn;
  int hotbarSlot = 0;
  Panel panel = Panel.none;
  double health = 100;
  int kills = 0;
  int deaths = 0;
  int bestScore = 0;

  /// everything the save must carry that this client does not simulate yet
  Map<String, SavedPlayer> _otherPlayers = const {};
  List<Object?> _restZombies = const [];
  List<Object?> _restDrops = const [];
  List<Object?> _restCrates = const [];

  /// set after every block change a save has not seen yet
  bool needsSave = false;
  String _toast = '';
  double _toastUntil = 0;
  double _accumulator = 0;
  final Set<(int, int)> _loaded = {};
  int _loadedAround = -1 << 40;
  EditListener? onEdit;

  /// the host's clock authority (a client follows `welcome.time`)
  double get time => dayNight.time;

  // ---------------------------------------------------------------- frame

  void update(double dt, FrameInput input) {
    final frozen = panel != Panel.none || ui.dead;
    if (!frozen) {
      player.look(input.look.dx, input.look.dy);
      if (input.jump) player.queueJump();
      if (input.dig) dig();
      if (input.place) place();
    }
    if (input.togglePanel) togglePanel();
    if (input.selectSlot != null) selectSlot(input.selectSlot!);
    _accumulator += dt > 0.25 ? 0.25 : dt;
    final keys = KeySetInput(frozen ? const {} : input.keys);
    while (_accumulator >= fixedDt) {
      player.update(fixedDt, keys, frozen: frozen);
      dayNight.update(fixedDt);
      _accumulator -= fixedDt;
    }
    _syncCamera();
    _streamAround();
    _publish(scoreboard: input.scoreboard);
  }

  void _syncCamera() {
    final s = player.state;
    camera
      ..position = vm.Vector3(s.x, s.y + PlayerTuning.eyeHeight, s.z)
      ..yaw = s.yaw
      ..pitch = s.pitch;
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

  void _streamAround({bool force = false}) {
    final ccx = chunkCoord(player.state.x.floor());
    final ccz = chunkCoord(player.state.z.floor());
    final key = ccx * 100000 + ccz;
    if (!force && key == _loadedAround) return;
    _loadedAround = key;
    final wanted = <(int, int)>{};
    for (var dx = -loadRadiusChunks; dx <= loadRadiusChunks; dx++) {
      for (var dz = -loadRadiusChunks; dz <= loadRadiusChunks; dz++) {
        if (dx * dx + dz * dz <= loadRadiusChunks * loadRadiusChunks + 1) {
          wanted.add((ccx + dx, ccz + dz));
        }
      }
    }
    for (final (cx, cz) in _loaded.difference(wanted)) {
      world.unloadColumn(cx, cz);
    }
    for (final (cx, cz) in wanted.difference(_loaded)) {
      world.loadColumn(cx, cz);
    }
    _loaded
      ..clear()
      ..addAll(wanted);
  }

  // ---------------------------------------------------------------- blocks

  /// the block the crosshair is on, within reach
  RayHit? target() {
    final f = camera.forward;
    final o = camera.position;
    return raycastVoxels(world, o.x, o.y, o.z, f.x, f.y, f.z, reach);
  }

  ItemStack? get held => inventory.get(hotbarSlot);

  /// break the targeted block and pocket what it drops (instant for now; the
  /// hardness-timed break with progress ring is P2)
  void dig() {
    final hit = target();
    if (hit == null || hit.block == Block.bedrock) return;
    if (breakTime(hit.block, held?.id) == double.infinity) {
      toast('Needs a pickaxe');
      return;
    }
    _edit(hit.x, hit.y, hit.z, air);
    final drop = dropForBlock(hit.block);
    if (drop != null) inventory.add(drop, 1);
  }

  /// put the held block against the face the crosshair is on
  void place() {
    final hit = target();
    final item = held;
    if (hit == null || item == null) return;
    final def = getItem(item.id);
    final block = def.block;
    if (block == null || def.kind == ItemKind.prop) return;
    final x = hit.x + hit.nx;
    final y = hit.y + hit.ny;
    final z = hit.z + hit.nz;
    if (y < 0 || y >= worldHeight) return;
    if (world.getBlock(x, y, z) != air || player.overlapsVoxel(x, y, z)) {
      return;
    }
    inventory.takeFromSlot(hotbarSlot, 1);
    _edit(x, y, z, block);
  }

  /// a block change from this player: applied, remembered for the save, and
  /// handed to the session so the other peers get it
  void _edit(int x, int y, int z, int id) {
    world.setBlock(x, y, z, id);
    needsSave = true;
    onEdit?.call(BlockEdit(x: x, y: y, z: z, id: id));
  }

  /// a block change from another peer (or the save): applied without echo
  void applyEdit(BlockEdit e) {
    world.setBlock(e.x, e.y, e.z, e.id);
  }

  // ---------------------------------------------------------------- inventory

  void selectSlot(int slot) {
    if (slot >= 0 && slot < hotbarSize) hotbarSlot = slot;
  }

  void togglePanel() =>
      panel = panel == Panel.none ? Panel.crafting : Panel.none;

  void closePanel() => panel = Panel.none;

  bool get nearWorkbench {
    final s = player.state;
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -1; dy <= 2; dy++) {
        for (var dz = -2; dz <= 2; dz++) {
          if (world.getBlock(
                s.x.floor() + dx,
                s.y.floor() + dy,
                s.z.floor() + dz,
              ) ==
              Block.workbench) {
            return true;
          }
        }
      }
    }
    return false;
  }

  void craftRecipe(String id) {
    final overflow = craft(inventory, getRecipe(id), nearBench: nearWorkbench);
    if (overflow == null) return;
    if (overflow > 0) toast('Inventory full: $overflow left behind');
  }

  void moveSlot(int from, int to) => inventory.swap(from, to);

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
      world.setBlock(e.x, e.y, e.z, e.id);
    }
    final mine = save.players[local.saveKey];
    _otherPlayers = {
      for (final e in save.players.entries)
        if (e.key != local.saveKey) e.key: e.value,
    };
    _restZombies = save.zombies;
    _restDrops = save.drops;
    _restCrates = save.crates;
    if (mine != null) {
      inventory.replace(mine.inventory);
      spawn = mine.spawn;
      player.teleport(mine.pos.x, mine.pos.y, mine.pos.z);
      player.state
        ..yaw = mine.yaw
        ..pitch = mine.pitch;
      health = mine.health;
      kills = mine.kills;
      deaths = mine.deaths;
    }
    needsSave = false;
  }

  SaveData buildSave() {
    final s = player.state;
    final me = SavedPlayer(
      name: local.name,
      inventory: inventory.all(),
      spawn: spawn,
      pos: Vec3(s.x, s.y, s.z),
      yaw: s.yaw,
      pitch: s.pitch,
      health: health,
      magazine: 0,
      kills: kills,
      deaths: deaths,
    );
    return SaveData(
      seed: seed,
      time: dayNight.time,
      edits: world.edits.values
          .map((e) => BlockEdit(x: e.x, y: e.y, z: e.z, id: e.id))
          .toList(),
      players: {..._otherPlayers, local.saveKey: me},
      zombies: _restZombies,
      drops: _restDrops,
      crates: _restCrates,
      savedAt: DateTime.now().millisecondsSinceEpoch,
    );
  }

  /// nights survived so far, the score's basis
  int get nightsSurvived => nightsSurvivedFor(dayNight.night, dayNight.phase);

  int get score => computeScore(nightsSurvived, kills);

  // ---------------------------------------------------------------- ui

  /// remote players for the scoreboard and room counter (the sessions fill it)
  List<ScoreRow> remotePlayers = const [];

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
    u.panel = panel;
    u.nearWorkbench = nearWorkbench;
    u.message = dayNight.time < _toastUntil ? _toast : '';
    u.interactHint = hit?.block == Block.workbench ? 'F  craft' : '';
    u.timer = dayNight.timerText;
    u.phase = dayNight.phase;
    u.night = dayNight.night;
    u.kills = kills;
    u.score = score;
    u.bestScore = bestScore > score ? bestScore : score;
    u.nightsSurvived = nightsSurvived;
    u.timeAlive = dayNight.time;
    u.scoreboard = scoreboard;
    u.players = [
      ScoreRow(
        id: 'me',
        name: local.name,
        score: score,
        kills: kills,
        deaths: deaths,
        you: true,
      ),
      ...remotePlayers,
    ];
    u.publish();
  }

  void dispose() {
    inventory.removeListener(_inventoryChanged);
    ui.dispose();
  }
}

/// a night counts once dawn has broken (score.ts)
int nightsSurvivedFor(int night, Phase phase) => nightsSurvived(night, phase);
