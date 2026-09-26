/// The in-game HUD — twin of `ui/Hud.tsx`: logo, room code, day/night timer,
/// position line, health/stamina, ammo, toast, hotbar, crafting panel, death
/// screen, scoreboard, the pause overlay with save / invite / leave, and the
/// connection-lost overlay. All widgets over the scene; state comes from the
/// game's [GameUiState].
library;

import 'dart:math' as math;

import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/app/launch.dart';
import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/locator.dart';
import 'package:block_survival/game/score.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/ui/hud/crafting_panel.dart';
import 'package:block_survival/ui/hud/invite_panel.dart';
import 'package:block_survival/ui/hud/ore_markers.dart';
import 'package:block_survival/ui/hud/player_markers.dart';
import 'package:block_survival/ui/hud/widgets.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter/material.dart';

/// what the pause overlay can do
final class HudActions {
  const HudActions({
    required this.resume,
    required this.leave,
    required this.saveWorld,
    required this.closePanel,
  });

  final VoidCallback resume;
  final Future<void> Function() leave;
  final Future<String> Function()? saveWorld;
  final VoidCallback closePanel;
}

class HudLayer extends StatefulWidget {
  const HudLayer({
    super.key,
    required this.launch,
    required this.api,
    required this.paused,
    required this.touch,
    required this.actions,
  });

  final Launch launch;
  final GameApi api;

  /// pointer released / touch pause pressed: the overlay is up
  final bool paused;

  /// touch layout: the crosshair belongs to the touch layer, hints differ
  final bool touch;
  final HudActions actions;

  @override
  State<HudLayer> createState() => _HudLayerState();
}

class _HudLayerState extends State<HudLayer> {
  String _saving = '';
  bool _leaving = false;
  bool _inviting = false;

  GameUiState get ui => widget.launch.game.ui;

  Future<void> _leave() async {
    setState(() => _leaving = true);
    await widget.actions.leave();
  }

  Future<void> _save() async {
    final save = widget.actions.saveWorld;
    if (save == null) return;
    setState(() => _saving = 'Saving…');
    final result = await save();
    if (!mounted) return;
    setState(() => _saving = result);
    await Future<void>.delayed(const Duration(milliseconds: 2500));
    if (mounted) setState(() => _saving = '');
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ui,
      builder: (context, _) {
        final u = ui;
        final launch = widget.launch;
        final isGlobal = launch.worldKind == WorldKind.global;
        final role = launch.role;
        final roomCode = launch.roomCode;
        final showPause =
            widget.paused &&
            u.panel == Panel.none &&
            !u.dead &&
            u.netStatus == NetStatus.none;
        return Stack(
          fit: StackFit.expand,
          children: [
            // ---- always-on readouts
            Positioned(
              left: 18,
              top: 14,
              child: IgnorePointer(child: _logoAndRoom(u, roomCode, role)),
            ),
            Positioned(
              top: 14,
              left: 0,
              right: 0,
              child: IgnorePointer(child: Center(child: _timer(u))),
            ),
            Positioned(
              right: 18,
              top: 96,
              child: IgnorePointer(child: _debug(u)),
            ),
            // touch: above the joystick (28 margin + 120 diameter + label)
            Positioned(
              left: 18,
              bottom: widget.touch ? 190 : 22,
              width: 250,
              child: IgnorePointer(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Bar(
                      icon: '♥',
                      value: u.health,
                      max: 100,
                      colour: Hud.green,
                    ),
                    const SizedBox(height: 6),
                    Bar(
                      icon: '»',
                      value: u.stamina,
                      max: 100,
                      colour: Hud.accent,
                    ),
                  ],
                ),
              ),
            ),
            if (u.ammo != null)
              Positioned(
                right: 18,
                bottom: 22,
                child: IgnorePointer(child: _ammo(u)),
              ),
            if (u.message.isNotEmpty)
              Positioned(
                top: 0,
                bottom: 120,
                left: 0,
                right: 0,
                child: IgnorePointer(
                  child: Center(
                    child: HudPanel(
                      child: Text(
                        u.message,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ),
              ),
            if (u.locked && u.interactHint.isNotEmpty)
              Positioned(
                top: 0,
                bottom: 60,
                left: 0,
                right: 0,
                child: IgnorePointer(
                  child: Center(child: HudPanel(child: Text(u.interactHint))),
                ),
              ),
            if (!widget.touch && u.locked && !widget.paused && !u.aiming)
              const Center(
                child: IgnorePointer(
                  child: Icon(Icons.add, size: 22, color: Colors.white),
                ),
              ),
            // where the other players are (issue #15)
            if (u.locked && !widget.paused && !u.aiming)
              Positioned.fill(
                child: IgnorePointer(
                  child: PlayerMarkersLayer(camera: launch.game.camera, ui: u),
                ),
              ),
            // and where the ore is (issue #25)
            if (u.locked && !widget.paused && !u.aiming)
              Positioned.fill(
                child: IgnorePointer(
                  child: OreMarkersLayer(camera: launch.game.camera, ui: u),
                ),
              ),
            if (u.locked && !widget.paused && u.prospector != null)
              Positioned(
                bottom: widget.touch ? 182 : 104,
                left: 0,
                right: 0,
                child: IgnorePointer(
                  child: Center(child: ProspectorReadout(ui: u)),
                ),
              ),
            Positioned(
              bottom: widget.touch ? 100 : 22,
              left: 0,
              right: 0,
              child: IgnorePointer(
                child: Center(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final (i, stack) in u.hotbar.indexed)
                        Slot(stack: stack, index: i, active: i == u.hotbarSlot),
                    ],
                  ),
                ),
              ),
            ),
            // ---- panels and overlays
            if (u.panel == Panel.crafting)
              CraftingPanel(
                game: launch.game,
                onClose: widget.actions.closePanel,
              ),
            if (u.dead) _death(u),
            if (u.scoreboard || (widget.paused && u.panel == Panel.none))
              Positioned(
                top: 60,
                left: 0,
                right: 0,
                child: Center(child: _scoreboard(u)),
              ),
            if (u.netStatus != NetStatus.none) _netDown(u),
            if (showPause) _pause(u, role, roomCode, isGlobal),
          ],
        );
      },
    );
  }

  Widget _logoAndRoom(GameUiState u, String? roomCode, Role role) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Wordmark(small: true),
      if (roomCode != null) ...[
        const SizedBox(width: 14),
        HudPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                role == Role.host ? 'room code' : 'joined',
                style: const TextStyle(
                  fontSize: 10,
                  color: Colors.white60,
                  letterSpacing: 1,
                ),
              ),
              Text(
                roomCode,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  fontFamily: Hud.mono,
                  letterSpacing: 2,
                ),
              ),
              Text(
                '${u.players.length} / 4',
                style: const TextStyle(fontSize: 11, color: Colors.white60),
              ),
            ],
          ),
        ),
      ],
    ],
  );

  Widget _timer(GameUiState u) {
    final night = u.phase == Phase.night;
    final label = night
        ? 'night ${u.night} · ${u.zombies} out there'
        : u.night > 0
        ? 'day ${u.night + 1}'
        : 'sunset in';
    return HudPanel(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            u.timer,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              fontFamily: Hud.mono,
              color: night ? Hud.orange : Hud.ink,
            ),
          ),
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: Colors.white60),
          ),
        ],
      ),
    );
  }

  Widget _debug(GameUiState u) {
    final target = u.targetBlock == 0
        ? ''
        : ' · ${blockNames[u.targetBlock].replaceAll('_', ' ')}${u.canBreak ? '' : ' (needs a better pickaxe)'}';
    return HudPanel(
      child: Text(
        '${u.x.toStringAsFixed(1)}, ${u.y.toStringAsFixed(1)}, ${u.z.toStringAsFixed(1)}'
        ' · ${depthNote(u.y, u.surfaceY)} · ${depthBand(u.y.round())}'
        '$target · ${u.cameraMode == CameraMode.first ? '1st' : '3rd'} person · kills ${u.kills}',
        style: const TextStyle(
          fontSize: 12,
          fontFamily: Hud.mono,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _ammo(GameUiState u) {
    final a = u.ammo!;
    return HudPanel(
      child: Text(
        '${u.reloading ? '··' : a.mag} / ${a.reserve} ▮',
        style: const TextStyle(
          fontSize: 26,
          fontWeight: FontWeight.w800,
          fontFamily: Hud.mono,
        ),
      ),
    );
  }

  Widget _death(GameUiState u) => Container(
    color: const Color(0x99400000),
    alignment: Alignment.center,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'You died',
          style: TextStyle(fontSize: 42, fontWeight: FontWeight.w900),
        ),
        Text(
          'Respawning in ${u.respawnIn}',
          style: const TextStyle(fontSize: 18),
        ),
        Fine('Your gear is in a crate where you fell · score ${u.score}'),
      ],
    ),
  );

  Widget _scoreboard(GameUiState u) => HudPanel(
    padding: const EdgeInsets.all(12),
    child: DefaultTextStyle(
      style: const TextStyle(
        fontSize: 13,
        color: Hud.ink,
        fontFamily: Hud.mono,
      ),
      child: Table(
        defaultColumnWidth: const IntrinsicColumnWidth(),
        columnWidths: const {0: FixedColumnWidth(140)},
        children: [
          const TableRow(
            children: [
              _Th('Player'),
              _Th('Score'),
              _Th('Nights'),
              _Th('Kills'),
              _Th('Deaths'),
              _Th('Time'),
              _Th('Where'),
            ],
          ),
          for (final p in u.players)
            TableRow(
              decoration: p.you
                  ? const BoxDecoration(color: Color(0x22E8B23A))
                  : null,
              children: [
                _Td('${p.name}${p.you ? ' (you)' : ''}'),
                _Td('${p.score}'),
                _Td('${u.nightsSurvived}'),
                _Td('${p.kills}'),
                _Td('${p.deaths}'),
                _Td(formatTime(u.timeAlive)),
                _Where(p.where),
              ],
            ),
          TableRow(
            children: [
              _Td(
                'best ${u.bestScore} · nights × 100 + kills × 5 · arrows point from where you look',
                dim: true,
              ),
              for (var i = 0; i < 6; i++) const SizedBox.shrink(),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _netDown(GameUiState u) {
    final handover = u.netStatus == NetStatus.handover;
    final hostLeft = u.netStatus == NetStatus.hostLeft;
    final paused = u.netStatus == NetStatus.paused;
    return Container(
      color: const Color(0xCC000000),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            paused
                ? 'Game paused'
                : hostLeft || handover
                ? 'The host left'
                : 'Connection lost',
            style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Text(
            paused
                ? u.netError
                : handover
                ? 'The world moves to the next player in. ${u.netError}'
                : hostLeft
                ? 'The match is over: the host was running the world.'
                : (u.netError.isEmpty
                      ? 'The connection to the host dropped.'
                      : u.netError),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 14),
          OverlayButton('Back to menu', onPressed: _leaving ? null : _leave),
        ],
      ),
    );
  }

  Widget _pause(GameUiState u, Role role, String? roomCode, bool isGlobal) {
    final started = u.timeAlive > 2;
    final canInvite = role == Role.host && roomCode != null && !isGlobal;
    return GestureDetector(
      onTap: widget.actions.resume,
      child: Container(
        color: const Color(0xAA000000),
        alignment: Alignment.center,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Block Survival',
                style: TextStyle(fontSize: 36, fontWeight: FontWeight.w900),
              ),
              Text(
                widget.touch
                    ? 'Tap to ${started ? 'resume' : 'play'}'
                    : 'Click to ${started ? 'resume' : 'play'}',
                style: const TextStyle(fontSize: 18, color: Hud.accent),
              ),
              const SizedBox(height: 12),
              DefaultTextStyle(
                style: const TextStyle(
                  fontSize: 13,
                  color: Colors.white70,
                  height: 1.5,
                ),
                child: Column(
                  children: widget.touch
                      ? const [
                          Text(
                            'Left half: joystick · Right half: swipe to look',
                          ),
                          Text(
                            'Buttons: jump · sprint (hold) · dig · place · use',
                          ),
                          Text('Hotbar: tap a slot · Menu ☰: pause'),
                        ]
                      : const [
                          Text(
                            'WASD move · Shift sprint · Space jump · V camera · Tab scores',
                          ),
                          Text(
                            'Left dig / swing · Right place · 1–9 select · Q drop',
                          ),
                          Text(
                            'E inventory & crafting · F workbench / bed / loot · R reload · Esc pause',
                          ),
                        ],
                ),
              ),
              if (started) ...[
                const SizedBox(height: 14),
                GestureDetector(
                  onTap: () {},
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.center,
                    children: [
                      if (role == Role.host && widget.actions.saveWorld != null)
                        OverlayButton(
                          _saving.isEmpty ? 'Save world' : _saving,
                          onPressed: _saving == 'Saving…' ? null : _save,
                          secondary: true,
                        ),
                      if (canInvite)
                        OverlayButton(
                          _inviting ? 'Hide invitations' : 'Invite players',
                          onPressed: () =>
                              setState(() => _inviting = !_inviting),
                          secondary: true,
                        ),
                      OverlayButton(
                        _leaving
                            ? 'Saving…'
                            : role == Role.client
                            ? 'Leave game'
                            : 'Back to menu',
                        onPressed: _leaving ? null : _leave,
                      ),
                    ],
                  ),
                ),
              ],
              if (canInvite && _inviting) ...[
                const SizedBox(height: 12),
                GestureDetector(
                  onTap: () {},
                  child: InvitePanel(
                    api: widget.api,
                    code: roomCode,
                    joinedNames: u.players
                        .where((p) => !p.you)
                        .map((p) => p.name)
                        .toList(),
                    onClose: () => setState(() => _inviting = false),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Fine(
                  role == Role.host && roomCode == null
                      ? 'Want friends in? Start from the menu with Host for friends, then invite them from here.'
                      : isGlobal
                      ? (role == Role.host
                            ? 'You are hosting the global world; anyone can enter it from the lobby, and the next player in takes over when you leave.'
                            : 'Your gear and respawn point are saved with the world — it hands over to the next player in when the host leaves.')
                      : role == Role.client && started
                      ? "Your gear and respawn point are saved with the host's world — rejoin it to get them back."
                      : '',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Th extends StatelessWidget {
  const _Th(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    child: Text(
      text,
      style: const TextStyle(
        color: Colors.white60,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// the scoreboard's answer to "where are they?": an arrow relative to where
/// you look, the distance, and up/down when it matters
class _Where extends StatelessWidget {
  const _Where(this.where);

  final Where? where;

  @override
  Widget build(BuildContext context) {
    final w = where;
    if (w == null) return const _Td('—');
    final hint = verticalHint(w.dy);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Transform.rotate(
            angle: w.bearing * math.pi / 180,
            child: const Text(
              '▲',
              style: TextStyle(fontSize: 12, color: Hud.accent),
            ),
          ),
          const SizedBox(width: 6),
          Text('${w.distance} m', style: const TextStyle(color: Hud.ink)),
          if (hint.isNotEmpty)
            Text(
              ' · $hint',
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
        ],
      ),
    );
  }
}

class _Td extends StatelessWidget {
  const _Td(this.text, {this.dim = false});

  final String text;
  final bool dim;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    child: Text(text, style: TextStyle(color: dim ? Colors.white54 : Hud.ink)),
  );
}
