/// The app: one [AppSession], and the page that its state calls for — sign-in,
/// waiting for approval, the lobby, or a running game.
library;

import 'package:block_survival/app/launch.dart';
import 'package:block_survival/app/session.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/net/rtc_flutter.dart';
import 'package:block_survival/ui/pages/lobby_page.dart';
import 'package:block_survival/ui/pages/login_page.dart';
import 'package:block_survival/ui/pages/pending_approval_page.dart';
import 'package:block_survival/ui/pages/play_page.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:flutter/material.dart';

/// `--dart-define=BS_SERVER_URL=https://...`; the dev default is the Herd site
const String defaultServerUrl = String.fromEnvironment(
  'BS_SERVER_URL',
  defaultValue: 'http://block-survival.test',
);

class BlockSurvivalApp extends StatefulWidget {
  const BlockSurvivalApp({super.key, required this.session, this.rtc});

  final AppSession session;

  /// WebRTC; the production factory unless a test injects one
  final RtcFactory? rtc;

  @override
  State<BlockSurvivalApp> createState() => _BlockSurvivalAppState();
}

class _BlockSurvivalAppState extends State<BlockSurvivalApp> {
  Launch? _launch;

  @override
  void initState() {
    super.initState();
    widget.session.restore();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.session;
    return MaterialApp(
      title: 'Block Survival',
      theme: buildTheme(),
      debugShowCheckedModeBanner: false,
      home: ListenableBuilder(
        listenable: s,
        builder: (context, _) {
          final launch = _launch;
          if (launch != null) {
            return PlayPage(
              key: ValueKey(launch),
              launch: launch,
              api: s.api,
              onExit: () => setState(() => _launch = null),
            );
          }
          return switch (s.state) {
            AuthState.unknown => const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            ),
            AuthState.signedOut => LoginPage(session: s),
            AuthState.pendingApproval => PendingApprovalPage(session: s),
            AuthState.signedIn => LobbyPage(
              session: s,
              launcher: Launcher(
                api: s.api,
                rtc: widget.rtc ?? const FlutterWebRtc(),
                player: LocalPlayer(
                  name: s.user?.name ?? 'Survivor',
                  userId: s.user?.id,
                ),
              ),
              onLaunch: (launch) => setState(() => _launch = launch),
            ),
          };
        },
      ),
    );
  }
}
