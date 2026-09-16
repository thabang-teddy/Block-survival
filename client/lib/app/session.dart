/// The signed-in state of the app and the lobby's data — the native twin of
/// what the Inertia page props (`auth`, `worlds`, `leaderboard`, `presence`)
/// and `useInvites` give the web lobby. One instance lives for the app; pages
/// listen to it.
library;

import 'dart:async';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/auth_api.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/api/token_store.dart';
import 'package:block_survival/app/settings.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter/foundation.dart';

/// how often the lobby re-fetches the invitations while it is on screen
const Duration invitesPoll = Duration(seconds: 5);

/// how often the parked client asks whether the admin has approved the device
const Duration approvalPoll = Duration(seconds: 10);

enum AuthState {
  /// restoring a stored token
  unknown,
  signedOut,

  /// credentials were right; an admin has to approve this device
  pendingApproval,
  signedIn,
}

final class AppSession extends ChangeNotifier {
  AppSession({
    required Uri serverUrl,
    required String deviceName,
    TokenStore? store,
    SettingsStore? settings,
    ApiClient? client,
  }) : serverUrl = serverUrl,
       _store = store ?? SecureTokenStore(),
       _settings = settings ?? PrefsSettingsStore() {
    _client =
        client ?? ApiClient(baseUrl: serverUrl, token: _store.readAccessToken);
    auth = AuthApi(_client, _store, deviceName: deviceName);
    api = GameApi(_client);
  }

  /// the server this session talks to (the build default until a player
  /// types another on the sign-in page; the choice is kept between launches)
  Uri serverUrl;
  final TokenStore _store;
  final SettingsStore _settings;
  late final ApiClient _client;
  late final AuthApi auth;
  late final GameApi api;

  AuthState state = AuthState.unknown;
  ApiUser? user;
  Map<String, WorldMeta?> worlds = const {'own': null, 'global': null};
  List<LeaderboardRow> leaderboard = const [];
  GlobalPresence presence = GlobalPresence.empty;
  List<Invite> invites = const [];
  bool invitesLoaded = false;
  String invitesError = '';

  /// the message that parked us on the approval page
  String pendingMessage = '';
  String lastError = '';

  Timer? _invitesTimer;
  Timer? _approvalTimer;

  WorldMeta? get ownWorld => worlds['own'];
  WorldMeta? get globalWorld => worlds['global'];

  /// Point the session at another server: the address is kept for next
  /// time, and a token from the previous server is forgotten.
  Future<void> setServerUrl(Uri url) async {
    if (url == serverUrl) return;
    serverUrl = url;
    _client.baseUrl = url;
    await _settings.writeServerUrl(url.toString());
    await _store.writeAccessToken(null);
    notifyListeners();
  }

  /// on launch: the server picked last time, then a stored token that it
  /// still honours skips the sign-in page
  Future<void> restore() async {
    final saved = await _settings.readServerUrl();
    final savedUrl = saved == null ? null : Uri.tryParse(saved);
    if (savedUrl != null && savedUrl != serverUrl) {
      serverUrl = savedUrl;
      _client.baseUrl = savedUrl;
    }
    try {
      final me = await auth.me();
      if (me == null) {
        _set(AuthState.signedOut);
        return;
      }
      user = me;
      _set(AuthState.signedIn);
      await refreshMenu();
    } on ApiError catch (e) {
      lastError = e.message;
      _set(AuthState.signedOut);
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    lastError = '';
    try {
      switch (await auth.signIn(email: email, password: password)) {
        case SignedIn(:final user):
          this.user = user;
          _set(AuthState.signedIn);
          await refreshMenu();
        case AwaitingApproval(:final message):
          pendingMessage = message;
          _set(AuthState.pendingApproval);
          _watchApproval();
        case SignInRefused(:final message):
          lastError = message;
          notifyListeners();
      }
    } on ApiError catch (e) {
      lastError = e.message;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    _stopPolling();
    await auth.signOut();
    user = null;
    _set(AuthState.signedOut);
  }

  /// the approval page polls; once approved it goes back to sign-in
  bool deviceApproved = false;

  void _watchApproval() {
    _approvalTimer?.cancel();
    deviceApproved = false;
    _approvalTimer = Timer.periodic(approvalPoll, (_) async {
      try {
        if (await auth.deviceApproved()) {
          deviceApproved = true;
          _approvalTimer?.cancel();
          notifyListeners();
        }
      } on ApiError {
        // offline for a moment: keep polling
      }
    });
  }

  /// back to the sign-in page from the approval page
  void backToSignIn() {
    _approvalTimer?.cancel();
    _set(AuthState.signedOut);
  }

  /// the worlds, the leaderboard and who is in the global world change while a
  /// run is in progress; pull fresh copies whenever the lobby comes back
  Future<void> refreshMenu() async {
    try {
      final me = await auth.meWithWorlds();
      if (me != null) {
        user = me.user;
        worlds = me.worlds;
      }
      leaderboard = await api.leaderboard();
      presence = await api.presence();
    } on ApiError catch (e) {
      lastError = e.message;
    }
    notifyListeners();
    await refreshInvites();
  }

  Future<void> refreshInvites() async {
    try {
      final now = DateTime.now();
      invites = (await api.invites()).where((i) => isJoinable(i, now)).toList()
        ..sort((a, b) => b.expiresAt.compareTo(a.expiresAt));
      invitesError = '';
    } on ApiError catch (e) {
      invitesError = e.message;
    }
    invitesLoaded = true;
    notifyListeners();
  }

  /// poll invitations while the lobby is on screen
  void startInvitesPolling() {
    _invitesTimer?.cancel();
    _invitesTimer = Timer.periodic(invitesPoll, (_) => refreshInvites());
  }

  void stopInvitesPolling() {
    _invitesTimer?.cancel();
    _invitesTimer = null;
  }

  Future<void> declineInvite(Invite invite) async {
    try {
      await api.declineInvite(invite.id);
    } on ApiError catch (e) {
      lastError = e.message;
    }
    await refreshInvites();
  }

  Future<void> resetWorld() async {
    lastError = '';
    try {
      await api.resetWorld();
      await refreshMenu();
    } on ApiError catch (e) {
      lastError = e.message;
      notifyListeners();
    }
  }

  void _stopPolling() {
    _invitesTimer?.cancel();
    _approvalTimer?.cancel();
  }

  void _set(AuthState s) {
    state = s;
    notifyListeners();
  }

  @override
  void dispose() {
    _stopPolling();
    _client.close();
    super.dispose();
  }
}

/// "2/4"
String seatsText(Invite invite) => '${invite.players}/${invite.maxPlayers}';

/// "Sam's world" / "the global world"
String worldLabel(WorldKind kind, String hostName) =>
    kind == WorldKind.global ? 'the global world' : "$hostName's world";

bool isJoinable(Invite invite, DateTime now) {
  final expires = DateTime.tryParse(invite.expiresAt);
  return invite.status == InviteStatus.pending &&
      invite.players < invite.maxPlayers &&
      expires != null &&
      expires.isAfter(now);
}
