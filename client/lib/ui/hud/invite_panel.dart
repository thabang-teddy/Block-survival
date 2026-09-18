/// The host's invitation list on the pause screen — twin of `ui/InvitePanel.tsx`:
/// every other player with an Invite button and where they stand.
library;

import 'dart:async';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/app/session.dart' show invitesPoll;
import 'package:block_survival/ui/theme.dart';
import 'package:flutter/material.dart';

enum InviteState { invite, pending, accepted, joined, declined }

InviteState statusOf(
  PlayerRow player,
  List<HostInvite> invites,
  List<String> joinedNames,
) {
  if (joinedNames.contains(player.name)) return InviteState.joined;
  final inv = invites.where((i) => i.userId == player.id).firstOrNull;
  if (inv == null) return InviteState.invite;
  return switch (inv.status) {
    InviteStatus.pending => InviteState.pending,
    InviteStatus.accepted => InviteState.accepted,
    InviteStatus.declined => InviteState.declined,
  };
}

class InvitePanel extends StatefulWidget {
  const InvitePanel({
    super.key,
    required this.api,
    required this.code,
    required this.joinedNames,
    required this.onClose,
  });

  final GameApi api;
  final String code;

  /// names of the players currently in the match (besides the host)
  final List<String> joinedNames;
  final VoidCallback onClose;

  @override
  State<InvitePanel> createState() => _InvitePanelState();
}

class _InvitePanelState extends State<InvitePanel> {
  List<PlayerRow> _players = const [];
  List<HostInvite> _invites = const [];
  String _error = '';
  int? _busy;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _timer = Timer.periodic(invitesPoll, (_) => _tick());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final players = await widget.api.players();
      if (mounted) setState(() => _players = players);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    await _tick();
  }

  Future<void> _tick() async {
    try {
      final invites = await widget.api.roomInvites(widget.code);
      if (mounted) setState(() => _invites = invites);
    } on ApiError {
      // keep the last list
    }
  }

  Future<void> _invite(PlayerRow p) async {
    setState(() {
      _busy = p.id;
      _error = '';
    });
    try {
      final inv = await widget.api.invite(widget.code, p.id);
      if (mounted) {
        setState(
          () => _invites = [
            ..._invites.where((i) => i.userId != inv.userId),
            inv,
          ],
        );
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 380),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xEE101418),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Text(
                'Invite players',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
              const Spacer(),
              IconButton(
                onPressed: widget.onClose,
                icon: const Icon(Icons.close),
                tooltip: 'Close',
              ),
            ],
          ),
          if (_players.isEmpty)
            Fine(
              _error.isNotEmpty
                  ? _error
                  : 'No other players yet — an admin creates accounts.',
            )
          else
            for (final p in _players) _row(p),
          if (_error.isNotEmpty && _players.isNotEmpty) ErrorLine(_error),
        ],
      ),
    );
  }

  Widget _row(PlayerRow p) {
    final st = statusOf(p, _invites, widget.joinedNames);
    final label = switch (st) {
      InviteState.pending => 'invited',
      InviteState.accepted => 'accepted',
      InviteState.joined => 'joined',
      _ => '',
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(p.name)),
          if (st == InviteState.invite || st == InviteState.declined)
            OutlinedButton(
              onPressed: _busy == p.id ? null : () => _invite(p),
              child: Text(
                _busy == p.id
                    ? 'Inviting…'
                    : st == InviteState.declined
                    ? 'Invite again'
                    : 'Invite',
              ),
            )
          else
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: st == InviteState.joined
                    ? const Color(0x336FB04A)
                    : const Color(0x33FFFFFF),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(label, style: const TextStyle(fontSize: 12)),
            ),
        ],
      ),
    );
  }
}
