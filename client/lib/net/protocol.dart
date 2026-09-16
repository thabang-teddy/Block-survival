/// Wire protocol between the host (authoritative sim) and clients — twin of
/// `server/resources/js/net/protocol.ts`. Messages are maps packed with
/// MessagePack (lib/net/msgpack.dart) and sent over WebRTC DataChannels; the
/// field names and key order below are the wire format, checked against
/// shared/fixtures/protocol/messages.json.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/net/msgpack.dart';

export 'package:block_survival/items/inventory.dart' show ItemStack;

const int protocolVersion = 1;
const int inputHz = 30;
const int snapshotHz = 20;

/// clients render remote entities this far behind host time
const double interpolationDelay = 0.1;
const int maxPlayers = 4;

typedef Json = Map<String, Object?>;

double _d(Object? v) => (v as num).toDouble();
int _i(Object? v) => (v as num).toInt();

// ---------------------------------------------------------------- shared shapes

/// x, y, z
final class Vec3 {
  const Vec3(this.x, this.y, this.z);

  factory Vec3.fromMap(Json j) => Vec3(_d(j['x']), _d(j['y']), _d(j['z']));

  final double x;
  final double y;
  final double z;

  Json toMap() => {'x': x, 'y': y, 'z': z};
}

final class PlayerSnap {
  const PlayerSnap({
    required this.id,
    required this.name,
    required this.x,
    required this.y,
    required this.z,
    required this.yaw,
    required this.pitch,
    required this.anim,
    required this.held,
    required this.health,
    required this.dead,
    required this.kills,
    required this.deaths,
  });

  factory PlayerSnap.fromMap(Json j) => PlayerSnap(
    id: j['id'] as String,
    name: j['name'] as String,
    x: _d(j['x']),
    y: _d(j['y']),
    z: _d(j['z']),
    yaw: _d(j['yaw']),
    pitch: _d(j['pitch']),
    anim: j['anim'] as String,
    held: j['held'] as String?,
    health: _d(j['health']),
    dead: j['dead'] as bool,
    kills: _i(j['kills']),
    deaths: _i(j['deaths']),
  );

  final String id;
  final String name;
  final double x;
  final double y;
  final double z;
  final double yaw;
  final double pitch;

  /// Idle | Walk | Run | Aim | Swing
  final String anim;
  final String? held;
  final double health;
  final bool dead;
  final int kills;
  final int deaths;

  Json toMap() => {
    'id': id,
    'name': name,
    'x': x,
    'y': y,
    'z': z,
    'yaw': yaw,
    'pitch': pitch,
    'anim': anim,
    'held': held,
    'health': health,
    'dead': dead,
    'kills': kills,
    'deaths': deaths,
  };
}

final class ZombieSnap {
  const ZombieSnap({
    required this.id,
    required this.kind,
    required this.x,
    required this.y,
    required this.z,
    required this.yaw,
    required this.state,
    required this.attacked,
    required this.burnTimer,
  });

  factory ZombieSnap.fromMap(Json j) => ZombieSnap(
    id: _i(j['id']),
    kind: j['kind'] as String,
    x: _d(j['x']),
    y: _d(j['y']),
    z: _d(j['z']),
    yaw: _d(j['yaw']),
    state: j['state'] as String,
    attacked: j['attacked'] as bool,
    burnTimer: _d(j['burnTimer']),
  );

  final int id;

  /// Basic | Worker | Soldier | Toxic
  final String kind;
  final double x;
  final double y;
  final double z;
  final double yaw;

  /// chase | attack | burn | dead
  final String state;
  final bool attacked;
  final double burnTimer;

  Json toMap() => {
    'id': id,
    'kind': kind,
    'x': x,
    'y': y,
    'z': z,
    'yaw': yaw,
    'state': state,
    'attacked': attacked,
    'burnTimer': burnTimer,
  };
}

final class DropSnap {
  const DropSnap({
    required this.id,
    required this.item,
    required this.x,
    required this.y,
    required this.z,
  });

  factory DropSnap.fromMap(Json j) => DropSnap(
    id: _i(j['id']),
    item: j['item'] as String,
    x: _d(j['x']),
    y: _d(j['y']),
    z: _d(j['z']),
  );

  final int id;
  final String item;
  final double x;
  final double y;
  final double z;

  Json toMap() => {'id': id, 'item': item, 'x': x, 'y': y, 'z': z};
}

final class CrateSnap {
  const CrateSnap({
    required this.id,
    required this.x,
    required this.y,
    required this.z,
    required this.items,
  });

  factory CrateSnap.fromMap(Json j) => CrateSnap(
    id: _i(j['id']),
    x: _d(j['x']),
    y: _d(j['y']),
    z: _d(j['z']),
    items: _i(j['items']),
  );

  final int id;
  final double x;
  final double y;
  final double z;
  final int items;

  Json toMap() => {'id': id, 'x': x, 'y': y, 'z': z, 'items': items};
}

/// prop metadata on the wire
final class PropMetaWire {
  const PropMetaWire({
    required this.id,
    required this.x,
    required this.y,
    required this.z,
    required this.yaw,
    this.partner,
    required this.primary,
  });

  factory PropMetaWire.fromMap(Json j) => PropMetaWire(
    id: _i(j['id']),
    x: _i(j['x']),
    y: _i(j['y']),
    z: _i(j['z']),
    yaw: _i(j['yaw']),
    partner: j['partner'] == null ? null : Vec3.fromMap(j['partner'] as Json),
    primary: j['primary'] as bool,
  );

  final int id;
  final int x;
  final int y;
  final int z;
  final int yaw;
  final Vec3? partner;
  final bool primary;

  Json toMap() => {
    'id': id,
    'x': x,
    'y': y,
    'z': z,
    'yaw': yaw,
    if (partner != null)
      'partner': {
        'x': partner!.x.toInt(),
        'y': partner!.y.toInt(),
        'z': partner!.z.toInt(),
      },
    'primary': primary,
  };
}

/// a block edit: id plus prop metadata when the block is a prop
final class BlockEdit {
  const BlockEdit({
    required this.x,
    required this.y,
    required this.z,
    required this.id,
    this.meta,
  });

  factory BlockEdit.fromMap(Json j) => BlockEdit(
    x: _i(j['x']),
    y: _i(j['y']),
    z: _i(j['z']),
    id: _i(j['id']),
    meta: j['meta'] == null ? null : PropMetaWire.fromMap(j['meta'] as Json),
  );

  final int x;
  final int y;
  final int z;
  final int id;
  final PropMetaWire? meta;

  Json toMap() => {
    'x': x,
    'y': y,
    'z': z,
    'id': id,
    if (meta != null) 'meta': meta!.toMap(),
  };
}

final class Fx {
  const Fx({required this.kind, required this.a, required this.b});

  factory Fx.fromMap(Json j) => Fx(
    kind: j['kind'] as String,
    a: Vec3(_d(j['ax']), _d(j['ay']), _d(j['az'])),
    b: Vec3(_d(j['bx']), _d(j['by']), _d(j['bz'])),
  );

  /// flash | tracer
  final String kind;
  final Vec3 a;
  final Vec3 b;

  Json toMap() => {
    'kind': kind,
    'ax': a.x,
    'ay': a.y,
    'az': a.z,
    'bx': b.x,
    'by': b.y,
    'bz': b.z,
  };
}

// ---------------------------------------------------------------- client → host

sealed class ClientMessage {
  const ClientMessage();

  static ClientMessage fromMap(Json j) => switch (j['t']) {
    'hello' => Hello(
      v: _i(j['v']),
      name: j['name'] as String,
      userId: j['userId'] == null ? null : _i(j['userId']),
    ),
    'input' => InputMessage(
      x: _d(j['x']),
      y: _d(j['y']),
      z: _d(j['z']),
      yaw: _d(j['yaw']),
      pitch: _d(j['pitch']),
      anim: j['anim'] as String,
      slot: _i(j['slot']),
      aiming: j['aiming'] as bool,
    ),
    'break' => BreakBlock(_i(j['x']), _i(j['y']), _i(j['z'])),
    'place' => PlaceBlock(
      x: _i(j['x']),
      y: _i(j['y']),
      z: _i(j['z']),
      nx: _i(j['nx']),
      ny: _i(j['ny']),
      nz: _i(j['nz']),
      slot: _i(j['slot']),
      yaw: _i(j['yaw']),
    ),
    'craft' => Craft(j['recipe'] as String),
    'moveSlot' => MoveSlot(_i(j['from']), _i(j['to'])),
    'dropHeld' => DropHeld(_i(j['slot']), _d(j['dx']), _d(j['dz'])),
    'interact' => Interact(
      x: _i(j['x']),
      y: _i(j['y']),
      z: _i(j['z']),
      block: _i(j['block']),
      crate: j['crate'] == null ? null : _i(j['crate']),
    ),
    'swing' => Swing(_ray(j)),
    'fire' => Fire(_ray(j)),
    'reload' => const Reload(),
    'chat' => ClientChat(j['text'] as String),
    _ => throw FormatException('unknown client message ${j['t']}'),
  };

  Json toMap();
}

/// origin + direction of a swing or shot
final class Ray {
  const Ray(this.origin, this.direction);

  final Vec3 origin;
  final Vec3 direction;
}

Ray _ray(Json j) => Ray(
  Vec3(_d(j['ox']), _d(j['oy']), _d(j['oz'])),
  Vec3(_d(j['dx']), _d(j['dy']), _d(j['dz'])),
);

Json _rayMap(String t, Ray r) => {
  't': t,
  'ox': r.origin.x,
  'oy': r.origin.y,
  'oz': r.origin.z,
  'dx': r.direction.x,
  'dy': r.direction.y,
  'dz': r.direction.z,
};

/// `userId`: the signed-in account, so the host can hand back gear saved for it
final class Hello extends ClientMessage {
  const Hello({required this.v, required this.name, this.userId});

  final int v;
  final String name;
  final int? userId;

  @override
  Json toMap() => {
    't': 'hello',
    'v': v,
    'name': name,
    if (userId != null) 'userId': userId,
  };
}

/// 30 Hz: the client's own movement is authoritative
final class InputMessage extends ClientMessage {
  const InputMessage({
    required this.x,
    required this.y,
    required this.z,
    required this.yaw,
    required this.pitch,
    required this.anim,
    required this.slot,
    required this.aiming,
  });

  final double x;
  final double y;
  final double z;
  final double yaw;
  final double pitch;
  final String anim;
  final int slot;
  final bool aiming;

  @override
  Json toMap() => {
    't': 'input',
    'x': x,
    'y': y,
    'z': z,
    'yaw': yaw,
    'pitch': pitch,
    'anim': anim,
    'slot': slot,
    'aiming': aiming,
  };
}

final class BreakBlock extends ClientMessage {
  const BreakBlock(this.x, this.y, this.z);

  final int x;
  final int y;
  final int z;

  @override
  Json toMap() => {'t': 'break', 'x': x, 'y': y, 'z': z};
}

final class PlaceBlock extends ClientMessage {
  const PlaceBlock({
    required this.x,
    required this.y,
    required this.z,
    required this.nx,
    required this.ny,
    required this.nz,
    required this.slot,
    required this.yaw,
  });

  final int x;
  final int y;
  final int z;
  final int nx;
  final int ny;
  final int nz;
  final int slot;
  final int yaw;

  @override
  Json toMap() => {
    't': 'place',
    'x': x,
    'y': y,
    'z': z,
    'nx': nx,
    'ny': ny,
    'nz': nz,
    'slot': slot,
    'yaw': yaw,
  };
}

final class Craft extends ClientMessage {
  const Craft(this.recipe);

  final String recipe;

  @override
  Json toMap() => {'t': 'craft', 'recipe': recipe};
}

final class MoveSlot extends ClientMessage {
  const MoveSlot(this.from, this.to);

  final int from;
  final int to;

  @override
  Json toMap() => {'t': 'moveSlot', 'from': from, 'to': to};
}

final class DropHeld extends ClientMessage {
  const DropHeld(this.slot, this.dx, this.dz);

  final int slot;
  final double dx;
  final double dz;

  @override
  Json toMap() => {'t': 'dropHeld', 'slot': slot, 'dx': dx, 'dz': dz};
}

/// F: interact with the targeted block / crate
final class Interact extends ClientMessage {
  const Interact({
    required this.x,
    required this.y,
    required this.z,
    required this.block,
    this.crate,
  });

  final int x;
  final int y;
  final int z;
  final int block;
  final int? crate;

  @override
  Json toMap() => {
    't': 'interact',
    'x': x,
    'y': y,
    'z': z,
    'block': block,
    'crate': crate,
  };
}

final class Swing extends ClientMessage {
  const Swing(this.ray);

  final Ray ray;

  @override
  Json toMap() => _rayMap('swing', ray);
}

final class Fire extends ClientMessage {
  const Fire(this.ray);

  final Ray ray;

  @override
  Json toMap() => _rayMap('fire', ray);
}

final class Reload extends ClientMessage {
  const Reload();

  @override
  Json toMap() => {'t': 'reload'};
}

final class ClientChat extends ClientMessage {
  const ClientChat(this.text);

  final String text;

  @override
  Json toMap() => {'t': 'chat', 'text': text};
}

// ---------------------------------------------------------------- host → client

sealed class HostMessage {
  const HostMessage();

  static HostMessage fromMap(Json j) => switch (j['t']) {
    'welcome' => Welcome(
      v: _i(j['v']),
      you: j['you'] as String,
      seed: _i(j['seed']),
      time: _d(j['time']),
      edits: _edits(j['edits']),
      spawn: Vec3.fromMap(j['spawn'] as Json),
    ),
    'snap' => Snapshot(
      time: _d(j['time']),
      players: _list(j['players'], PlayerSnap.fromMap),
      zombies: _list(j['zombies'], ZombieSnap.fromMap),
      drops: _list(j['drops'], DropSnap.fromMap),
      crates: _list(j['crates'], CrateSnap.fromMap),
    ),
    'state' => PrivateState.fromMap(j),
    'blocks' => Blocks(_edits(j['edits'])),
    'chat' => HostChat(j['from'] as String, j['text'] as String),
    'full' => const Full(),
    'bye' => const Bye(),
    _ => throw FormatException('unknown host message ${j['t']}'),
  };

  Json toMap();
}

List<T> _list<T>(Object? v, T Function(Json) f) =>
    (v as List).map((e) => f(e as Json)).toList();

List<BlockEdit> _edits(Object? v) => _list(v, BlockEdit.fromMap);

final class Welcome extends HostMessage {
  const Welcome({
    required this.v,
    required this.you,
    required this.seed,
    required this.time,
    required this.edits,
    required this.spawn,
  });

  final int v;
  final String you;
  final int seed;
  final double time;
  final List<BlockEdit> edits;
  final Vec3 spawn;

  @override
  Json toMap() => {
    't': 'welcome',
    'v': v,
    'you': you,
    'seed': seed,
    'time': time,
    'edits': edits.map((e) => e.toMap()).toList(),
    'spawn': spawn.toMap(),
  };
}

final class Snapshot extends HostMessage {
  const Snapshot({
    required this.time,
    required this.players,
    required this.zombies,
    required this.drops,
    required this.crates,
  });

  final double time;
  final List<PlayerSnap> players;
  final List<ZombieSnap> zombies;
  final List<DropSnap> drops;
  final List<CrateSnap> crates;

  @override
  Json toMap() => {
    't': 'snap',
    'time': time,
    'players': players.map((p) => p.toMap()).toList(),
    'zombies': zombies.map((z) => z.toMap()).toList(),
    'drops': drops.map((d) => d.toMap()).toList(),
    'crates': crates.map((c) => c.toMap()).toList(),
  };
}

/// private per-client state, sent when it changes; every field optional and the
/// key order on the wire is whatever the host set
final class PrivateState extends HostMessage {
  const PrivateState({
    this.inventory,
    this.magazine,
    this.reloading,
    this.health,
    this.poisoned,
    this.hurtAt,
    this.dead,
    this.respawnIn,
    this.teleport,
    this.spawn,
    this.message,
    this.fx,
    this.keyOrder = const [],
  });

  factory PrivateState.fromMap(Json j) => PrivateState(
    inventory: j.containsKey('inventory')
        ? (j['inventory'] as List)
              .map((s) => s == null ? null : ItemStack.fromJson(s as Json))
              .toList()
        : null,
    magazine: j['magazine'] == null ? null : _i(j['magazine']),
    reloading: j['reloading'] as bool?,
    health: j['health'] == null ? null : _d(j['health']),
    poisoned: j['poisoned'] as bool?,
    hurtAt: j['hurtAt'] == null ? null : _d(j['hurtAt']),
    dead: j['dead'] as bool?,
    respawnIn: j['respawnIn'] == null ? null : _d(j['respawnIn']),
    teleport: j['teleport'] == null
        ? null
        : Vec3.fromMap(j['teleport'] as Json),
    spawn: j['spawn'] == null ? null : Vec3.fromMap(j['spawn'] as Json),
    message: j['message'] as String?,
    fx: j['fx'] == null ? null : _list(j['fx'], Fx.fromMap),
    keyOrder: j.keys.where((k) => k != 't').toList(),
  );

  final List<ItemStack?>? inventory;
  final int? magazine;
  final bool? reloading;
  final double? health;
  final bool? poisoned;
  final double? hurtAt;
  final bool? dead;
  final double? respawnIn;
  final Vec3? teleport;
  final Vec3? spawn;
  final String? message;
  final List<Fx>? fx;

  /// the order the keys arrived in, so a re-encode is byte-identical
  final List<String> keyOrder;

  @override
  Json toMap() {
    final fields = <String, Object?>{
      if (inventory != null)
        'inventory': inventory!.map((s) => s?.toJson()).toList(),
      if (magazine != null) 'magazine': magazine,
      if (reloading != null) 'reloading': reloading,
      if (health != null) 'health': health,
      if (poisoned != null) 'poisoned': poisoned,
      if (hurtAt != null) 'hurtAt': hurtAt,
      if (dead != null) 'dead': dead,
      if (respawnIn != null) 'respawnIn': respawnIn,
      if (teleport != null) 'teleport': teleport!.toMap(),
      if (spawn != null) 'spawn': spawn!.toMap(),
      if (message != null) 'message': message,
      if (fx != null) 'fx': fx!.map((f) => f.toMap()).toList(),
    };
    final ordered = <String, Object?>{'t': 'state'};
    for (final k in keyOrder) {
      if (fields.containsKey(k)) ordered[k] = fields.remove(k);
    }
    ordered.addAll(fields);
    return ordered;
  }
}

final class Blocks extends HostMessage {
  const Blocks(this.edits);

  final List<BlockEdit> edits;

  @override
  Json toMap() => {
    't': 'blocks',
    'edits': edits.map((e) => e.toMap()).toList(),
  };
}

final class HostChat extends HostMessage {
  const HostChat(this.from, this.text);

  final String from;
  final String text;

  @override
  Json toMap() => {'t': 'chat', 'from': from, 'text': text};
}

/// the room is full
final class Full extends HostMessage {
  const Full();

  @override
  Json toMap() => {'t': 'full'};
}

final class Bye extends HostMessage {
  const Bye();

  @override
  Json toMap() => {'t': 'bye'};
}

// ---------------------------------------------------------------- codec

Uint8List encodeClient(ClientMessage m) => msgpackEncode(m.toMap());
Uint8List encodeHost(HostMessage m) => msgpackEncode(m.toMap());
ClientMessage decodeClient(Uint8List bytes) =>
    ClientMessage.fromMap(msgpackDecode(bytes) as Json);
HostMessage decodeHost(Uint8List bytes) =>
    HostMessage.fromMap(msgpackDecode(bytes) as Json);

// ---------------------------------------------------------------- room codes

const String _codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O
const int roomCodeLength = 6;

String makeRoomCode([math.Random? random]) {
  final r = random ?? math.Random.secure();
  return List.generate(
    roomCodeLength,
    (_) => _codeAlphabet[r.nextInt(_codeAlphabet.length)],
  ).join();
}

String normalizeRoomCode(String input) {
  final cleaned = input.toUpperCase().replaceAll(RegExp('[^A-Z]'), '');
  return cleaned.length > roomCodeLength
      ? cleaned.substring(0, roomCodeLength)
      : cleaned;
}

bool isRoomCode(String code) =>
    code.length == roomCodeLength &&
    code.split('').every(_codeAlphabet.contains);
