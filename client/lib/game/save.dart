/// The saved-world format — twin of the `SaveData` shape in `net/api.ts` and
/// `game/saveState.ts` (version 3): the seed regenerates the terrain and
/// `edits` is the diff on top of it; `players` keeps everyone's gear keyed by
/// user id. Parts this client does not simulate yet (zombies, drops, crates)
/// are carried through untouched so a save written here loses nothing the
/// browser host put in it.
library;

import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/net/protocol.dart' hide ItemStack;

final class SavedPlayer {
  const SavedPlayer({
    required this.name,
    required this.inventory,
    required this.spawn,
    required this.pos,
    required this.yaw,
    required this.pitch,
    required this.health,
    required this.magazine,
    required this.kills,
    required this.deaths,
  });

  factory SavedPlayer.fromJson(Map<String, dynamic> j) {
    final pos = j['pos'] as Map<String, dynamic>;
    return SavedPlayer(
      name: j['name'] as String,
      inventory: (j['inventory'] as List)
          .map(
            (s) => s == null
                ? null
                : ItemStack.fromJson(s as Map<String, dynamic>),
          )
          .toList(),
      spawn: Vec3.fromMap(j['spawn'] as Map<String, dynamic>),
      pos: Vec3.fromMap(pos),
      yaw: (pos['yaw'] as num).toDouble(),
      pitch: (pos['pitch'] as num).toDouble(),
      health: (j['health'] as num).toDouble(),
      magazine: (j['magazine'] as num).toInt(),
      kills: (j['kills'] as num).toInt(),
      deaths: (j['deaths'] as num).toInt(),
    );
  }

  final String name;
  final List<ItemStack?> inventory;
  final Vec3 spawn;
  final Vec3 pos;
  final double yaw;
  final double pitch;
  final double health;
  final int magazine;
  final int kills;
  final int deaths;

  Map<String, dynamic> toJson() => {
    'name': name,
    'inventory': inventory.map((s) => s?.toJson()).toList(),
    'spawn': spawn.toMap(),
    'pos': {...pos.toMap(), 'yaw': yaw, 'pitch': pitch},
    'health': health,
    'magazine': magazine,
    'kills': kills,
    'deaths': deaths,
  };
}

final class SaveData {
  const SaveData({
    required this.seed,
    required this.time,
    required this.edits,
    required this.players,
    required this.zombies,
    required this.drops,
    required this.crates,
    required this.savedAt,
  });

  /// version 3 only; older saves are migrated by the browser (`saveMigrate.ts`)
  /// before they reach the cloud, so a v1/v2 here is a corrupt upload
  factory SaveData.fromJson(Map<String, dynamic> j) {
    if (j['version'] != version) {
      throw FormatException('save version ${j['version']}, expected $version');
    }
    return SaveData(
      seed: (j['seed'] as num).toInt(),
      time: (j['time'] as num).toDouble(),
      edits: (j['edits'] as List)
          .map((e) => BlockEdit.fromMap(e as Map<String, dynamic>))
          .toList(),
      players: {
        for (final e in (j['players'] as Map<String, dynamic>).entries)
          e.key: SavedPlayer.fromJson(e.value as Map<String, dynamic>),
      },
      zombies: (j['zombies'] as List? ?? const []).cast<Object?>(),
      drops: (j['drops'] as List? ?? const []).cast<Object?>(),
      crates: (j['crates'] as List? ?? const []).cast<Object?>(),
      savedAt: (j['savedAt'] as num?)?.toInt() ?? 0,
    );
  }

  static const int version = 3;

  final int seed;
  final double time;
  final List<BlockEdit> edits;

  /// keyed by user id ("0" for a guest)
  final Map<String, SavedPlayer> players;
  final List<Object?> zombies;
  final List<Object?> drops;
  final List<Object?> crates;

  /// ms since the epoch on the host when the save was built
  final int savedAt;

  Map<String, dynamic> toJson() => {
    'version': version,
    'seed': seed,
    'time': time,
    'edits': edits.map((e) => e.toMap()).toList(),
    'players': {for (final e in players.entries) e.key: e.value.toJson()},
    'zombies': zombies,
    'drops': drops,
    'crates': crates,
    'savedAt': savedAt,
  };
}
