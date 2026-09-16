/// The saved-world format — twin of the `SaveData` shape in `net/api.ts` and
/// `game/saveState.ts` (version 3): the seed regenerates the terrain and
/// `edits` is the diff on top of it; `players` keeps everyone's gear keyed by
/// user id; `zombies`, `drops` and `crates` are the live entities at save
/// time (`collectSave` in saveState.ts).
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

/// newest drops kept in a save; older ones are just gone
const int maxSavedDrops = 500;

final class SavedZombie {
  const SavedZombie({
    required this.kind,
    required this.x,
    required this.y,
    required this.z,
    required this.hp,
  });

  factory SavedZombie.fromJson(Map<String, dynamic> j) => SavedZombie(
    kind: j['kind'] as String,
    x: (j['x'] as num).toDouble(),
    y: (j['y'] as num).toDouble(),
    z: (j['z'] as num).toDouble(),
    hp: (j['hp'] as num).toDouble(),
  );

  final String kind;
  final double x;
  final double y;
  final double z;
  final double hp;

  Map<String, dynamic> toJson() => {
    'kind': kind,
    'x': x,
    'y': y,
    'z': z,
    'hp': hp,
  };
}

final class SavedDrop {
  const SavedDrop({
    required this.id,
    required this.count,
    required this.x,
    required this.y,
    required this.z,
  });

  factory SavedDrop.fromJson(Map<String, dynamic> j) => SavedDrop(
    id: j['id'] as String,
    count: (j['count'] as num).toInt(),
    x: (j['x'] as num).toDouble(),
    y: (j['y'] as num).toDouble(),
    z: (j['z'] as num).toDouble(),
  );

  /// the item id
  final String id;
  final int count;
  final double x;
  final double y;
  final double z;

  Map<String, dynamic> toJson() => {
    'id': id,
    'count': count,
    'x': x,
    'y': y,
    'z': z,
  };
}

final class SavedCrate {
  const SavedCrate({
    required this.x,
    required this.y,
    required this.z,
    required this.items,
  });

  factory SavedCrate.fromJson(Map<String, dynamic> j) => SavedCrate(
    x: (j['x'] as num).toDouble(),
    y: (j['y'] as num).toDouble(),
    z: (j['z'] as num).toDouble(),
    items: [
      for (final s in j['items'] as List)
        if (s != null) ItemStack.fromJson(s as Map<String, dynamic>),
    ],
  );

  final double x;
  final double y;
  final double z;
  final List<ItemStack> items;

  Map<String, dynamic> toJson() => {
    'x': x,
    'y': y,
    'z': z,
    'items': items.map((s) => s.toJson()).toList(),
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
      zombies: _list(j['zombies'], SavedZombie.fromJson),
      drops: _list(j['drops'], SavedDrop.fromJson),
      crates: _list(j['crates'], SavedCrate.fromJson),
      savedAt: (j['savedAt'] as num?)?.toInt() ?? 0,
    );
  }

  static const int version = 3;

  final int seed;
  final double time;
  final List<BlockEdit> edits;

  /// keyed by user id ("0" for a guest)
  final Map<String, SavedPlayer> players;
  final List<SavedZombie> zombies;
  final List<SavedDrop> drops;
  final List<SavedCrate> crates;

  /// ms since the epoch on the host when the save was built
  final int savedAt;

  Map<String, dynamic> toJson() => {
    'version': version,
    'seed': seed,
    'time': time,
    'edits': edits.map((e) => e.toMap()).toList(),
    'players': {for (final e in players.entries) e.key: e.value.toJson()},
    'zombies': zombies.map((z) => z.toJson()).toList(),
    'drops': drops.map((d) => d.toJson()).toList(),
    'crates': crates.map((c) => c.toJson()).toList(),
    'savedAt': savedAt,
  };
}

List<T> _list<T>(Object? raw, T Function(Map<String, dynamic>) parse) => [
  for (final e in raw as List? ?? const []) parse(e as Map<String, dynamic>),
];
