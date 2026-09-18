/// Lobby for the signed-in player — twin of `ui/MainMenu.tsx`: the two worlds
/// (own and global), the invitations other hosts sent, and the leaderboard.
library;

import 'dart:async';

import 'package:block_survival/api/models.dart';
import 'package:block_survival/app/launch.dart';
import 'package:block_survival/app/session.dart';
import 'package:block_survival/game/score.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter/material.dart';

class LobbyPage extends StatefulWidget {
  const LobbyPage({
    super.key,
    required this.session,
    required this.launcher,
    required this.onLaunch,
  });

  final AppSession session;
  final Launcher launcher;

  /// the play page takes over with this launch
  final void Function(Launch launch) onLaunch;

  @override
  State<LobbyPage> createState() => _LobbyPageState();
}

class _LobbyPageState extends State<LobbyPage> {
  String _busy = '';
  String _status = '';
  String _error = '';

  @override
  void initState() {
    super.initState();
    // pull fresh worlds / leaderboard / presence whenever the lobby comes back
    unawaited(widget.session.refreshMenu());
    widget.session.startInvitesPolling();
  }

  @override
  void dispose() {
    widget.session.stopInvitesPolling();
    super.dispose();
  }

  Future<void> _run(String busy, Future<Launch> Function() start) async {
    setState(() {
      _busy = busy;
      _error = '';
      _status = '';
    });
    try {
      final launch = await start();
      if (!mounted) return;
      widget.onLaunch(launch);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _error = _errorText(e));
      unawaited(widget.session.refreshMenu());
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _startOver() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Start over?'),
        content: const Text(
          'Delete your world and start again? This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = 'reset');
    await widget.session.resetWorld();
    if (mounted) setState(() => _busy = '');
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    return ListenableBuilder(
      listenable: s,
      builder: (context, _) {
        final user = s.user;
        final hasOwn = s.ownWorld != null;
        final presence = s.presence;
        final whoIsIn = presence.online > 0
            ? '${presence.online} online now, hosted by '
                  '${presence.hostName ?? 'someone'} — you would join them.'
            : 'Nobody is in it right now — you would host it.';
        return MenuCard(
          maxWidth: 960,
          children: [
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: 'Signed in as '),
                      TextSpan(
                        text: user?.name ?? '',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const TextSpan(text: ' · '),
                    ],
                  ),
                ),
                if (user?.isAdmin == true)
                  const Fine('admin section: web only · '),
                LinkButton(
                  'sign out',
                  onPressed: _busy.isEmpty ? s.signOut : null,
                ),
              ],
            ),
            const SizedBox(height: 14),
            LayoutBuilder(
              builder: (context, c) {
                final columns = c.maxWidth > 700 ? 3 : 1;
                final options = [
                  _Option(
                    title: 'My world',
                    body: 'Your own map, with its own seed — nobody visits without an invitation.',
                    fine: _summary(
                      s.ownWorld,
                      'A fresh world with a new seed — it saves itself every minute, at dawn, and when you leave.',
                    ),
                    children: [
                      FilledButton(
                        onPressed: _busy.isEmpty
                            ? () => _run(
                                'solo',
                                () => widget.launcher.solo(hasSave: hasOwn),
                              )
                            : null,
                        child: Text(_busy == 'solo' ? 'Loading…' : 'Play solo'),
                      ),
                      OutlinedButton(
                        onPressed: _busy.isEmpty
                            ? () => _run(
                                'host',
                                () => widget.launcher.host(hasSave: hasOwn),
                              )
                            : null,
                        child: Text(
                          _busy == 'host'
                              ? 'Opening room…'
                              : 'Host for friends',
                        ),
                      ),
                      if (hasOwn)
                        LinkButton(
                          _busy == 'reset'
                              ? 'Resetting…'
                              : 'Start over with a new world',
                          onPressed: _busy.isEmpty ? _startOver : null,
                        ),
                    ],
                  ),
                  _Option(
                    title: 'Global world',
                    body:
                        'The classic map (${seedTag(globalSeed)}) everyone builds in together. '
                        'Whoever is in it hosts it; when they leave, the next player in takes over.',
                    fine:
                        '${_summary(s.globalWorld, 'Nobody has played the global world yet.')} $whoIsIn',
                    children: [
                      FilledButton(
                        onPressed: _busy.isEmpty
                            ? () => _run(
                                'global',
                                () => widget.launcher.enterGlobal(
                                  onStatus: (t) => setState(() => _status = t),
                                ),
                              )
                            : null,
                        child: Text(
                          _busy == 'global'
                              ? (_status.isEmpty ? 'Entering…' : _status)
                              : 'Enter',
                        ),
                      ),
                    ],
                  ),
                  _Option(
                    title: 'Invitations',
                    body: 'Friends who are hosting right now and asked you in.',
                    children: [_invites(s)],
                  ),
                ];
                if (columns == 1) {
                  return Column(
                    children: [
                      for (final o in options)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: o,
                        ),
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final o in options)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: o,
                        ),
                      ),
                  ],
                );
              },
            ),
            ErrorLine(_error.isNotEmpty ? _error : s.lastError),
            if (s.leaderboard.isNotEmpty) ...[
              const SizedBox(height: 16),
              _Leaderboard(s.leaderboard),
            ],
            const SizedBox(height: 12),
            const Fine(
              "Up to 4 players. The host's device runs the world — in your own world "
              'the match ends when you leave; in the global world the next player '
              'takes over. Invite friends from the pause screen once you are hosting '
              'your own world.',
            ),
          ],
        );
      },
    );
  }

  Widget _invites(AppSession s) {
    if (!s.invitesLoaded) return const Fine('Loading…');
    if (s.invites.isEmpty) {
      return Fine(
        s.invitesError.isNotEmpty
            ? 'Could not load invitations: ${s.invitesError}'
            : 'No invitations right now',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final i in s.invites)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: i.hostName,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      TextSpan(
                        text:
                            ' · ${worldLabel(i.worldKind, i.hostName)} · ${seatsText(i)}',
                        style: const TextStyle(
                          color: Colors.white60,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    FilledButton(
                      onPressed: _busy.isEmpty
                          ? () => _run(
                              'join:${i.id}',
                              () => widget.launcher.acceptInvite(i),
                            )
                          : null,
                      child: Text(
                        _busy == 'join:${i.id}' ? 'Joining…' : 'Accept',
                      ),
                    ),
                    LinkButton(
                      'decline',
                      onPressed: _busy.isEmpty
                          ? () => s.declineInvite(i)
                          : null,
                    ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }

  static String _summary(WorldMeta? w, String fresh) => w == null
      ? fresh
      : 'Night ${w.night} · ${formatTime(w.seconds)} survived · '
            '${w.players} player${w.players == 1 ? '' : 's'} have played · '
            'saved ${timeAgo(w.updatedAt)}.';
}

String _errorText(Object e) => e is Error || e is Exception
    ? e.toString().replaceFirst(
        RegExp(r'^(Bad state|Exception|StateError): '),
        '',
      )
    : e.toString();

class _Option extends StatelessWidget {
  const _Option({
    required this.title,
    required this.body,
    this.fine,
    required this.children,
  });

  final String title;
  final String body;
  final String? fine;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: const Color(0x33000000),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: Colors.white12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(body, style: const TextStyle(fontSize: 13.5)),
        if (fine != null) ...[const SizedBox(height: 6), Fine(fine!)],
        const SizedBox(height: 10),
        for (final c in children)
          Padding(padding: const EdgeInsets.only(bottom: 6), child: c),
      ],
    ),
  );
}

class _Leaderboard extends StatelessWidget {
  const _Leaderboard(this.rows);

  final List<LeaderboardRow> rows;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        'Leaderboard',
        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 6),
      for (final (i, r) in rows.indexed)
        Row(
          children: [
            SizedBox(
              width: 28,
              child: Text(
                '${i + 1}.',
                style: const TextStyle(color: Colors.white60),
              ),
            ),
            Expanded(child: Text(r.name)),
            Text(
              '${r.score}',
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontFamily: Hud.mono,
              ),
            ),
          ],
        ),
    ],
  );
}
