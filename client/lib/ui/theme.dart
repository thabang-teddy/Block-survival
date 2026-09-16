/// The web client's look (`ui/hud.css`) as Flutter tokens: an ink-on-dark-panel
/// HUD over the sky, one amber accent, an orange for the wordmark and a green
/// for health.
library;

import 'package:flutter/material.dart';

abstract final class Hud {
  static const ink = Color(0xFFF2F0E8);
  static const panel = Color(0xB8101418);
  static const accent = Color(0xFFE8B23A);
  static const orange = Color(0xFFD9772A);
  static const green = Color(0xFF6FB04A);
  static const sky = Color(0xFF87B4D8);
  static const danger = Color(0xFFE85A4A);
  static const mono = 'monospace';

  static const shadow = [Shadow(blurRadius: 3, color: Colors.black)];
}

ThemeData buildTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: Hud.sky,
    colorScheme: base.colorScheme.copyWith(
      primary: Hud.accent,
      secondary: Hud.orange,
      surface: const Color(0xFF14181C),
      error: Hud.danger,
    ),
    textTheme: base.textTheme.apply(bodyColor: Hud.ink, displayColor: Hud.ink),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Hud.accent,
        foregroundColor: Colors.black,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Hud.ink,
        side: const BorderSide(color: Colors.white38),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: Color(0x66000000),
      border: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
    ),
  );
}

/// the `.menu-card`: a dark panel centred on the sky, with the wordmark
class MenuCard extends StatelessWidget {
  const MenuCard({
    super.key,
    required this.children,
    this.tagline = 'Build by day. Hold the line by night.',
    this.maxWidth = 720,
  });

  final List<Widget> children;
  final String tagline;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: Container(
              padding: const EdgeInsets.fromLTRB(28, 24, 28, 24),
              decoration: BoxDecoration(
                color: const Color(0xEE14181C),
                borderRadius: BorderRadius.circular(12),
                boxShadow: const [
                  BoxShadow(blurRadius: 30, color: Colors.black54),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Wordmark(),
                  const SizedBox(height: 4),
                  Text(
                    tagline,
                    style: const TextStyle(color: Hud.accent, fontSize: 15),
                  ),
                  const SizedBox(height: 16),
                  ...children,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// BLOCK / SURVIVAL, as the HUD logo
class Wordmark extends StatelessWidget {
  const Wordmark({super.key, this.small = false});

  final bool small;

  @override
  Widget build(BuildContext context) {
    final big = small ? 22.0 : 34.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'BLOCK',
          style: TextStyle(
            fontSize: big,
            fontWeight: FontWeight.w900,
            height: 0.9,
            letterSpacing: 1,
            color: Colors.white,
            shadows: const [
              Shadow(offset: Offset(0, 3), color: Color(0xFF2B2B2B)),
              Shadow(blurRadius: 12, color: Colors.black54),
            ],
          ),
        ),
        Text(
          'SURVIVAL',
          style: TextStyle(
            fontSize: big * 0.7,
            fontWeight: FontWeight.w900,
            height: 1,
            letterSpacing: 1,
            color: Hud.orange,
            shadows: const [
              Shadow(offset: Offset(0, 3), color: Color(0xFF2B2B2B)),
            ],
          ),
        ),
      ],
    );
  }
}

/// the `.fine` print
class Fine extends StatelessWidget {
  const Fine(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(color: Colors.white60, fontSize: 12.5, height: 1.4),
  );
}

/// the `.error` line
class ErrorLine extends StatelessWidget {
  const ErrorLine(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => text.isEmpty
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(text, style: const TextStyle(color: Hud.danger)),
        );
}

/// a `.link` button
class LinkButton extends StatelessWidget {
  const LinkButton(this.text, {super.key, required this.onPressed});

  final String text;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: onPressed,
    style: TextButton.styleFrom(
      foregroundColor: Hud.accent,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    ),
    child: Text(
      text,
      style: const TextStyle(decoration: TextDecoration.underline),
    ),
  );
}
