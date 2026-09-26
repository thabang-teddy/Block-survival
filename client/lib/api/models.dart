/// JSON shapes of the Laravel API — twins of the interfaces in
/// `server/resources/js/net/api.ts`. Field names are the wire names.
library;

import 'package:block_survival/world/seed.dart';

WorldKind worldKindFrom(Object? v) =>
    v == 'global' ? WorldKind.global : WorldKind.own;

final class ApiUser {
  const ApiUser({
    required this.id,
    required this.name,
    required this.email,
    required this.isAdmin,
  });

  factory ApiUser.fromJson(Map<String, dynamic> j) => ApiUser(
    id: j['id'] as int,
    name: j['name'] as String,
    email: j['email'] as String,
    isAdmin: j['is_admin'] == true,
  );

  final int id;
  final String name;
  final String email;
  final bool isAdmin;
}

final class RoomInfo {
  const RoomInfo({
    required this.code,
    required this.hostPeerId,
    required this.hostName,
    required this.worldKind,
    required this.players,
    required this.expiresAt,
  });

  factory RoomInfo.fromJson(Map<String, dynamic> j) => RoomInfo(
    code: j['code'] as String,
    hostPeerId: j['host_peer_id'] as String,
    hostName: j['host_name'] as String,
    worldKind: worldKindFrom(j['world_kind']),
    players: j['players'] as int,
    expiresAt: j['expires_at'] as String,
  );

  final String code;
  final String hostPeerId;
  final String hostName;
  final WorldKind worldKind;
  final int players;
  final String expiresAt;
}

enum InviteStatus { pending, accepted, declined }

InviteStatus inviteStatusFrom(Object? v) => InviteStatus.values.firstWhere(
  (s) => s.name == v,
  orElse: () => InviteStatus.pending,
);

/// an invitation into someone's room, as the invitee's lobby sees it
final class Invite {
  const Invite({
    required this.id,
    required this.code,
    required this.hostName,
    required this.worldKind,
    required this.players,
    required this.maxPlayers,
    required this.expiresAt,
    required this.status,
  });

  factory Invite.fromJson(Map<String, dynamic> j) => Invite(
    id: j['id'] as int,
    code: j['code'] as String,
    hostName: j['host_name'] as String,
    worldKind: worldKindFrom(j['world_kind']),
    players: j['players'] as int,
    maxPlayers: j['max_players'] as int,
    expiresAt: j['expires_at'] as String,
    status: inviteStatusFrom(j['status']),
  );

  final int id;
  final String code;
  final String hostName;
  final WorldKind worldKind;
  final int players;
  final int maxPlayers;
  final String expiresAt;
  final InviteStatus status;
}

/// the host's view of one invitation
final class HostInvite {
  const HostInvite({
    required this.id,
    required this.userId,
    required this.name,
    required this.status,
  });

  factory HostInvite.fromJson(Map<String, dynamic> j) => HostInvite(
    id: j['id'] as int,
    userId: j['user_id'] as int,
    name: j['name'] as String,
    status: inviteStatusFrom(j['status']),
  );

  final int id;
  final int userId;
  final String name;
  final InviteStatus status;
}

final class PlayerRow {
  const PlayerRow({required this.id, required this.name});

  factory PlayerRow.fromJson(Map<String, dynamic> j) =>
      PlayerRow(id: j['id'] as int, name: j['name'] as String);

  final int id;
  final String name;
}

/// who runs the world at the other end: the host PC
/// (docs/pc-host-research.md), or another player's browser or app
enum HostKind { pc, browser }

/// What a global world tells a player who is in it (docs/pc-host-research.md
/// §8): connect to its host PC's room, wait for the paused PC, or go back to
/// the lobby because the world closed.
sealed class GlobalState {
  const GlobalState();

  factory GlobalState.fromJson(Map<String, dynamic> j) => switch (j['status']) {
    'client' => GlobalClient(
      online: j['online'] as int? ?? 0,
      world: j['world'] as int? ?? 0,
      hostName: j['host_name'] as String? ?? '',
      room: RoomInfo.fromJson(j['room'] as Map<String, dynamic>),
    ),
    'paused' => GlobalPaused(
      online: j['online'] as int? ?? 0,
      world: j['world'] as int? ?? 0,
      hostName: j['host_name'] as String? ?? '',
    ),
    _ => GlobalOffline(
      j['message'] as String? ??
          "This world is offline — its host PC isn't running.",
    ),
  };
}

/// connect to the host PC's room
final class GlobalClient extends GlobalState {
  const GlobalClient({
    required this.online,
    required this.world,
    required this.hostName,
    required this.room,
  });

  final int online;
  final int world;
  final String hostName;
  final RoomInfo room;
}

/// the host PC went quiet: wait for it, however long
final class GlobalPaused extends GlobalState {
  const GlobalPaused({
    required this.online,
    required this.world,
    required this.hostName,
  });

  final int online;
  final int world;
  final String hostName;
}

/// the world closed: back to the lobby
final class GlobalOffline extends GlobalState {
  const GlobalOffline(this.message);

  final String message;
}

/// the state of a global world's host PC
enum WorldState {
  online,
  paused,
  offline;

  static WorldState parse(Object? v) =>
      v == 'online' ? online : (v == 'paused' ? paused : offline);
}

/// one global world as the lobby lists it: run by a host PC, open only while
/// that PC is online (or paused)
final class GlobalWorldInfo {
  const GlobalWorldInfo({
    required this.id,
    required this.name,
    required this.seed,
    required this.state,
    required this.online,
    this.save,
  });

  factory GlobalWorldInfo.fromJson(Map<String, dynamic> j) => GlobalWorldInfo(
    id: j['id'] as int,
    name: j['name'] as String,
    seed: j['seed'] as int,
    state: WorldState.parse(j['state']),
    online: j['online'] as int? ?? 0,
    save: j['save'] == null
        ? null
        : WorldMeta.fromJson(j['save'] as Map<String, dynamic>),
  );

  final int id;
  final String name;
  final int seed;
  final WorldState state;

  /// players inside right now
  final int online;

  /// its save, or null before its PC first saved it
  final WorldMeta? save;
}

final class LeaderboardRow {
  const LeaderboardRow({required this.name, required this.score});

  factory LeaderboardRow.fromJson(Map<String, dynamic> j) =>
      LeaderboardRow(name: j['name'] as String, score: j['score'] as int);

  final String name;
  final int score;
}

/// summary of one of the player's worlds, as the lobby shows it
final class WorldMeta {
  const WorldMeta({
    required this.kind,
    required this.size,
    required this.night,
    required this.seconds,
    required this.players,
    required this.updatedAt,
  });

  factory WorldMeta.fromJson(Map<String, dynamic> j) => WorldMeta(
    kind: worldKindFrom(j['kind']),
    size: j['size'] as int,
    night: j['night'] as int,
    seconds: j['seconds'] as int,
    players: j['players'] as int,
    updatedAt: j['updated_at'] as String,
  );

  final WorldKind kind;
  final int size;
  final int night;
  final int seconds;
  final int players;
  final String updatedAt;
}

final class SignalRow {
  const SignalRow({
    required this.id,
    required this.from,
    required this.type,
    required this.data,
  });

  factory SignalRow.fromJson(Map<String, dynamic> j) => SignalRow(
    id: j['id'] as int,
    from: j['from'] as String,
    type: j['type'] as String,
    data: (j['data'] as Map).cast<String, dynamic>(),
  );

  final int id;
  final String from;

  /// offer | answer | candidate
  final String type;
  final Map<String, dynamic> data;
}

/// the result of `POST /api/scores`
final class ScoreResult {
  const ScoreResult({required this.score, required this.best});

  final int score;
  final int best;
}
