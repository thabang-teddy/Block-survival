/// The game's JSON endpoints — twin of the `api` object in
/// `server/resources/js/net/api.ts`: rooms, invites, signalling, scores and the
/// gzipped world saves. Every call is best-effort from the game's point of view.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/world/seed.dart';

/// the endpoints the WebRTC transport needs, so it can be tested with a fake
abstract interface class GameApiSignals {
  Future<RoomInfo> resolveRoom(String code);
  Future<void> signal(
    String code, {
    required String from,
    required String to,
    required String type,
    required Map<String, dynamic> data,
  });
  Future<List<SignalRow>> signals(
    String code, {
    required String to,
    required int after,
  });
}

// not final: tests implement it with a fake
class GameApi implements GameApiSignals {
  const GameApi(this._client);

  final ApiClient _client;

  // ---- rooms
  Future<RoomInfo> createRoom(
    String code,
    String hostPeerId,
    String hostName, {
    WorldKind worldKind = WorldKind.own,
  }) async {
    final res = await _client.post('/rooms', {
      'code': code,
      'host_peer_id': hostPeerId,
      'host_name': hostName,
      'world_kind': worldKind.name,
    });
    return RoomInfo.fromJson(res.json!['room'] as Map<String, dynamic>);
  }

  /// the host's heartbeat; in the global world the accounts it lists keep their seats
  Future<void> refreshRoom(
    String code,
    String hostPeerId,
    int players, {
    List<int> userIds = const [],
  }) => _client.patch('/rooms/$code', {
    'host_peer_id': hostPeerId,
    'players': players,
    'user_ids': userIds,
  });

  Future<void> closeRoom(String code, String hostPeerId) =>
      _client.delete('/rooms/$code', {'host_peer_id': hostPeerId});

  /// the host's peer id — only for the host and accepted invitees, or anyone seated in the global world
  @override
  Future<RoomInfo> resolveRoom(String code) async => RoomInfo.fromJson(
    (await _client.get('/rooms/$code')).json!['room'] as Map<String, dynamic>,
  );

  // ---- the shared global world
  Future<GlobalPresence> presence() async =>
      GlobalPresence.fromJson((await _client.get('/global/presence')).json!);
  Future<GlobalState> joinGlobal() async =>
      GlobalState.fromJson((await _client.post('/global/join')).json!);
  Future<GlobalState> claimGlobal() async =>
      GlobalState.fromJson((await _client.post('/global/claim')).json!);
  Future<void> leaveGlobal() => _client.post('/global/leave');

  // ---- invitations
  Future<List<PlayerRow>> players() async =>
      ((await _client.get('/players')).json!['players'] as List)
          .map((p) => PlayerRow.fromJson(p as Map<String, dynamic>))
          .toList();

  Future<HostInvite> invite(String code, int userId) async =>
      HostInvite.fromJson(
        (await _client.post('/rooms/$code/invites', {
              'user_id': userId,
            })).json!['invite']
            as Map<String, dynamic>,
      );

  Future<List<HostInvite>> roomInvites(String code) async =>
      ((await _client.get('/rooms/$code/invites')).json!['invites'] as List)
          .map((i) => HostInvite.fromJson(i as Map<String, dynamic>))
          .toList();

  Future<List<Invite>> invites() async =>
      ((await _client.get('/invites')).json!['invites'] as List)
          .map((i) => Invite.fromJson(i as Map<String, dynamic>))
          .toList();

  Future<({Invite invite, RoomInfo room})> acceptInvite(int id) async {
    final json = (await _client.post('/invites/$id/accept')).json!;
    return (
      invite: Invite.fromJson(json['invite'] as Map<String, dynamic>),
      room: RoomInfo.fromJson(json['room'] as Map<String, dynamic>),
    );
  }

  Future<void> declineInvite(int id) => _client.post('/invites/$id/decline');

  // ---- WebRTC signalling mailbox
  @override
  Future<void> signal(
    String code, {
    required String from,
    required String to,
    required String type,
    required Map<String, dynamic> data,
  }) => _client.post('/rooms/$code/signal', {
    'from': from,
    'to': to,
    'type': type,
    'data': data,
  });

  /// everything addressed to `to` with an id past `after`, oldest first
  @override
  Future<List<SignalRow>> signals(
    String code, {
    required String to,
    required int after,
  }) async {
    final res = await _client.get(
      '/rooms/$code/signals',
      query: {'to': to, 'after': '$after'},
    );
    return (res.json!['signals'] as List)
        .map((s) => SignalRow.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  // ---- scores
  Future<ScoreResult> postScore({
    required int nights,
    required int kills,
    required int deaths,
    required int seconds,
  }) async {
    final json = (await _client.post('/scores', {
      'nights': nights,
      'kills': kills,
      'deaths': deaths,
      'seconds': seconds,
    })).json!;
    return ScoreResult(score: json['score'] as int, best: json['best'] as int);
  }

  Future<List<LeaderboardRow>> leaderboard() async =>
      ((await _client.get('/leaderboard')).json!['leaderboard'] as List)
          .map((r) => LeaderboardRow.fromJson(r as Map<String, dynamic>))
          .toList();

  // ---- cloud saves (gzipped JSON; the save format itself lives in lib/game/save.dart)
  Future<WorldMeta> saveWorld(
    Map<String, dynamic> save, {
    required int night,
    required int seconds,
    WorldKind kind = WorldKind.own,
  }) async {
    final bytes = Uint8List.fromList(
      gzip.encode(utf8.encode(jsonEncode(save))),
    );
    final res = await _client.put(
      '/world/${kind.name}',
      raw: bytes,
      contentType: 'application/gzip',
      query: {'night': '$night', 'seconds': '$seconds'},
    );
    return WorldMeta.fromJson(res.json!['world'] as Map<String, dynamic>);
  }

  /// the saved world's raw JSON, or null when nobody has saved one yet
  Future<Map<String, dynamic>?> loadWorld({
    WorldKind kind = WorldKind.own,
  }) async {
    try {
      final res = await _client.get('/world/${kind.name}');
      return jsonDecode(utf8.decode(gzip.decode(res.bytes)))
          as Map<String, dynamic>;
    } on ApiError catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  /// start over: forget the player's own world (an admin resets the global one)
  Future<void> resetWorld() => _client.delete('/world/own');
}
