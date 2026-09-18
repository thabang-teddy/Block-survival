/// What the HUD shows — twin of `state/uiStore.ts`. The game publishes a
/// snapshot each frame; listeners rebuild only when something visible changed.
library;

import 'package:block_survival/game/day_night.dart';
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
  });

  final String id;
  final String name;
  final int score;
  final int kills;
  final int deaths;
  final bool you;
}

final class Ammo {
  const Ammo(this.mag, this.reserve);

  final int mag;
  final int reserve;
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
