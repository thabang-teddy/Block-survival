/// Small HUD parts shared by the overlay and the panels — twins of `Slot`,
/// `Bar`, `ItemIcon` in `ui/Hud.tsx` / `ui/ItemIcon.tsx`.
library;

import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:block_survival/world/palette.dart';
import 'package:flutter/material.dart';

Color colourOf(Rgb c) => Color.fromARGB(
  255,
  (c.$1 * 255).round(),
  (c.$2 * 255).round(),
  (c.$3 * 255).round(),
);

/// the web renders items from their GLBs; until the glTF loader lands (P1)
/// the icon is the item's swatch colour with its initial
class ItemIcon extends StatelessWidget {
  const ItemIcon(this.def, {super.key, this.large = false});

  final ItemDef def;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final size = large ? 44.0 : 26.0;
    final colour = colourOf(def.colour);
    final dark = colour.computeLuminance() < 0.35;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: colour,
        borderRadius: BorderRadius.circular(size * 0.18),
        border: Border.all(color: Colors.white24),
        boxShadow: const [BoxShadow(blurRadius: 2, color: Colors.black45)],
      ),
      alignment: Alignment.center,
      child: Text(
        def.name.substring(0, 1).toUpperCase(),
        style: TextStyle(
          fontSize: size * 0.5,
          fontWeight: FontWeight.w800,
          color: dark ? Colors.white70 : Colors.black54,
        ),
      ),
    );
  }
}

class Slot extends StatelessWidget {
  const Slot({
    super.key,
    required this.stack,
    required this.index,
    required this.active,
    this.showKey = true,
    this.onTap,
    this.picked = false,
  });

  final ItemStack? stack;
  final int index;
  final bool active;
  final bool showKey;
  final VoidCallback? onTap;
  final bool picked;

  @override
  Widget build(BuildContext context) {
    final def = stack == null ? null : getItem(stack!.id);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 46,
        height: 46,
        margin: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          color: picked ? const Color(0x66E8B23A) : const Color(0x88000000),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: active ? Hud.accent : Colors.white24,
            width: active ? 2 : 1,
          ),
        ),
        child: Stack(
          children: [
            if (showKey)
              Positioned(
                left: 3,
                top: 1,
                child: Text(
                  '${index + 1}',
                  style: const TextStyle(fontSize: 9, color: Colors.white54),
                ),
              ),
            if (def != null) Center(child: ItemIcon(def)),
            if (stack != null && stack!.count > 1)
              Positioned(
                right: 3,
                bottom: 1,
                child: Text(
                  '${stack!.count}',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    fontFamily: Hud.mono,
                    shadows: Hud.shadow,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class Bar extends StatelessWidget {
  const Bar({
    super.key,
    required this.icon,
    required this.value,
    required this.max,
    required this.colour,
  });

  final String icon;
  final double value;
  final double max;
  final Color colour;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      SizedBox(
        width: 22,
        child: Text(
          icon,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 15, shadows: Hud.shadow),
        ),
      ),
      const SizedBox(width: 6),
      Expanded(
        child: Container(
          height: 16,
          decoration: BoxDecoration(
            color: const Color(0x8C000000),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: Colors.white24),
          ),
          clipBehavior: Clip.antiAlias,
          child: Align(
            alignment: Alignment.centerLeft,
            child: FractionallySizedBox(
              widthFactor: (value / max).clamp(0.0, 1.0),
              child: Container(color: colour),
            ),
          ),
        ),
      ),
      const SizedBox(width: 6),
      SizedBox(
        width: 34,
        child: Text(
          '${value.round()}',
          textAlign: TextAlign.right,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            fontFamily: Hud.mono,
            shadows: Hud.shadow,
          ),
        ),
      ),
    ],
  );
}

/// the translucent dark box behind HUD text
class HudPanel extends StatelessWidget {
  const HudPanel({super.key, required this.child, this.padding});

  final Widget child;
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding ?? const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      color: Hud.panel,
      borderRadius: BorderRadius.circular(6),
    ),
    child: child,
  );
}

/// the `.overlay` / `.restart` button
class OverlayButton extends StatelessWidget {
  const OverlayButton(
    this.text, {
    super.key,
    required this.onPressed,
    this.secondary = false,
  });

  final String text;
  final VoidCallback? onPressed;
  final bool secondary;

  @override
  Widget build(BuildContext context) => secondary
      ? OutlinedButton(onPressed: onPressed, child: Text(text))
      : FilledButton(onPressed: onPressed, child: Text(text));
}
