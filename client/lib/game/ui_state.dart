/// What the HUD shows — twin of `state/uiStore.ts`. The game publishes a
/// snapshot each frame; listeners rebuild only when something visible changed.
library;

import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/locator.dart';
import 'package:block_survival/game/prospector.dart';
import 'package:block_survival/items/inventory.dart';
import 'package:flutter/foundation.dart';

enum Panel { none, crafting }

enum CameraMode { first, third }

enum Role { host, client }

/// why the game is showing the connection overlay
enum NetStatus { none, hostLeft, handover, error }

final class ScoreRow {
  const ScoreRow({
    required this.id,
    required this.name,
    required this.score,
    required this.kills,
    required this.deaths,
    required this.you,
    this.where,
  });

  final String id;
  final String name;
  final int score;
  final int kills;
  final int deaths;
  final bool you;

  /// distance and direction to this player (issue #15); null for you
  final Where? where;

  ScoreRow withWhere(Where? where) => ScoreRow(
    id: id,
    name: name,
    score: score,
    kills: kills,
    deaths: deaths,
    you: you,
    where: where,
  );
}

/// another player's place in the world, for the HUD's markers (issue #15)
final class PlayerPose {
  const PlayerPose({
    required this.id,
    required this.name,
    required this.x,
    required this.y,
    required this.z,
  });

  final String id;
  final String name;
  final double x;
  final double y;
  final double z;
}

final class Ammo {
  const Ammo(this.mag, this.reserve);

  final int mag;
  final int reserve;
}

/// what the prospector in hand is doing; null when none is held (issue #25)
final class ProspectorState {
  const ProspectorState({
    required this.ore,
    required this.range,
    required this.found,
  });

  /// the block id it is tuned to
  final int ore;

  /// how far it senses, in metres
  final double range;

  /// pockets within range
  final int found;
}

final class GameUiState extends ChangeNotifier {
  /// pointer captured / touch controls active: the game is being played
  bool locked = false;
  int hotbarSlot = 0;
  List<ItemStack?> hotbar = List.filled(hotbarSize, null);
  int inventoryVersion = 0;
  int targetBlock = 0;
  double x = 0;
  double y = 0;
  double z = 0;
  double health = 100;
  double stamina = 100;
  Ammo? ammo;
  CameraMode cameraMode = CameraMode.first;

  /// 0..1 while digging
  double breakProgress = 0;

  /// false when the targeted block needs a pickaxe you are not holding
  bool canBreak = true;
  Panel panel = Panel.none;
  bool nearWorkbench = false;

  /// transient toast, empty when none
  String message = '';

  /// e.g. "F  craft" when looking at a workbench
  String interactHint = '';

  /// MM:SS to the next sunset / dawn
  String timer = '15:00';
  Phase phase = Phase.day;
  int night = 0;
  int zombies = 0;
  int kills = 0;

  /// sim time of the last hit taken; the HUD flashes when it changes
  double hurtAt = 0;
  bool poisoned = false;
  bool aiming = false;
  bool reloading = false;
  bool dead = false;
  int respawnIn = 0;
  int score = 0;
  int bestScore = 0;
  int nightsSurvived = 0;
  double timeAlive = 0;
  bool scoreboard = false;
  List<ScoreRow> players = const [];

  /// the other players' positions this frame; the HUD projects them onto the screen
  List<PlayerPose> poses = const [];

  /// where the prospector says the ore is; the HUD projects these the same way (issue #25)
  List<OreFix> oreFixes = const [];
  ProspectorState? prospector;

  /// top block of the player's column, so the HUD can say how far down they are
  int surfaceY = 0;
  String? roomCode;
  Role role = Role.host;
  NetStatus netStatus = NetStatus.none;
  String netError = '';

  /// the game calls this once per frame after updating the fields above
  void publish() => notifyListeners();

  void setNetStatus(NetStatus status, [String error = '']) {
    netStatus = status;
    netError = error;
    notifyListeners();
  }
}
