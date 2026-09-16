/// Inventory + crafting panel — twin of `ui/CraftingPanel.tsx`: recipes on
/// the left, requirements on the right, the 36-slot inventory underneath (tap
/// a slot, then another, to swap).
library;

import 'package:block_survival/game/game.dart';
import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/items/recipes.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/ui/hud/widgets.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:flutter/material.dart';

class CraftingPanel extends StatefulWidget {
  const CraftingPanel({super.key, required this.game, required this.onClose});

  final Game game;
  final VoidCallback onClose;

  @override
  State<CraftingPanel> createState() => _CraftingPanelState();
}

class _CraftingPanelState extends State<CraftingPanel> {
  Recipe? _selected;
  int? _picked;

  @override
  Widget build(BuildContext context) {
    final game = widget.game;
    final bench = game.nearWorkbench;
    final list = recipesFor(bench ? CraftContext.bench : CraftContext.hand);
    // opening after walking away from the bench must not keep a hidden recipe selected
    final selected = list.contains(_selected) ? _selected! : list.first;
    return GestureDetector(
      onTap: widget.onClose,
      child: Container(
        color: const Color(0x99000000),
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () {},
          child: ListenableBuilder(
            listenable: game.inventory,
            builder: (context, _) {
              final inv = game.inventory;
              final status = craftStatus(inv, selected, nearBench: bench);
              final out = getItem(selected.output.id);
              return Container(
                constraints: const BoxConstraints(
                  maxWidth: 720,
                  maxHeight: 640,
                ),
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xF2101418),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.white12),
                ),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Text(
                            bench ? 'Workbench' : 'Crafting',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: bench
                                  ? const Color(0x336FB04A)
                                  : const Color(0x33FFFFFF),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              bench
                                  ? 'workbench in reach'
                                  : 'no workbench nearby',
                              style: const TextStyle(fontSize: 11),
                            ),
                          ),
                          const Spacer(),
                          IconButton(
                            onPressed: widget.onClose,
                            icon: const Icon(Icons.close),
                            tooltip: 'Close',
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 5,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                for (final r in list)
                                  _RecipeRow(
                                    recipe: r,
                                    status: craftStatus(
                                      inv,
                                      r,
                                      nearBench: bench,
                                    ),
                                    selected: r == selected,
                                    onTap: () => setState(() => _selected = r),
                                  ),
                                if (!bench)
                                  const Padding(
                                    padding: EdgeInsets.all(8),
                                    child: Fine(
                                      'Build a workbench for tools, weapons, glass, walls and torches.',
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            flex: 4,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  children: [
                                    ItemIcon(out, large: true),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        '${out.name}${selected.output.count > 1 ? ' ×${selected.output.count}' : ''}',
                                        style: const TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 10),
                                for (final i in selected.inputs)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 6),
                                    child: Row(
                                      children: [
                                        ItemIcon(getItem(i.id)),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(getItem(i.id).name),
                                        ),
                                        Text(
                                          '${inv.count(i.id)} / ${i.count}',
                                          style: TextStyle(
                                            fontFamily: Hud.mono,
                                            fontWeight: FontWeight.w700,
                                            color: inv.count(i.id) >= i.count
                                                ? Hud.green
                                                : Hud.danger,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                const SizedBox(height: 8),
                                FilledButton(
                                  onPressed: status == CraftStatus.ok
                                      ? () => game.craftRecipe(selected.id)
                                      : null,
                                  child: Text(switch (status) {
                                    CraftStatus.ok => 'Craft',
                                    CraftStatus.needsBench =>
                                      'Needs a workbench',
                                    CraftStatus.missing => 'Missing materials',
                                  }),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        children: [
                          for (final (i, stack) in inv.all().indexed)
                            Slot(
                              stack: stack,
                              index: i,
                              active: false,
                              showKey: i < hotbarSize,
                              picked: _picked == i,
                              onTap: () => _onSlotTap(i, stack),
                            ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      const Fine(
                        'Tap a slot, then another, to move items · E / Esc close',
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  void _onSlotTap(int i, ItemStack? stack) {
    final picked = _picked;
    if (picked == null) {
      if (stack != null) setState(() => _picked = i);
      return;
    }
    widget.game.moveSlot(picked, i);
    setState(() => _picked = null);
  }
}

class _RecipeRow extends StatelessWidget {
  const _RecipeRow({
    required this.recipe,
    required this.status,
    required this.selected,
    required this.onTap,
  });

  final Recipe recipe;
  final CraftStatus status;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final def = getItem(recipe.output.id);
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? const Color(0x33E8B23A) : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          children: [
            Opacity(
              opacity: status == CraftStatus.ok ? 1 : 0.55,
              child: ItemIcon(def),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${def.name}${recipe.output.count > 1 ? ' ×${recipe.output.count}' : ''}',
                style: TextStyle(
                  color: status == CraftStatus.ok ? Hud.ink : Colors.white54,
                ),
              ),
            ),
            if (recipe.bench)
              const Tooltip(
                message: 'needs a workbench',
                child: Icon(Icons.handyman, size: 14, color: Colors.white54),
              ),
          ],
        ),
      ),
    );
  }
}
