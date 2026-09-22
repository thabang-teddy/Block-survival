/// Item definitions — twin of `items/registry.ts`: every placeable block,
/// tool, weapon and material. Block items share the id of their block name.
library;

import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';

enum ItemKind { block, tool, weapon, material, prop }

final class ItemDef {
  const ItemDef({
    required this.id,
    required this.name,
    required this.kind,
    required this.maxStack,
    required this.colour,
    this.block,
    this.model,
    this.mineTier,
    this.mineSpeed,
    this.senseRange,
  });

  final String id;
  final String name;
  final ItemKind kind;
  final int maxStack;

  /// block placed when used (block and prop items)
  final int? block;

  /// GLB under /assets used for the held view-model and drops
  final String? model;

  /// How hard a block this may break: 1 wood, 2 stone, 3 copper, 4 iron, 5 diamond.
  /// Separate from [mineSpeed] on purpose — gold digs faster than iron but, like
  /// Minecraft's, is too soft for the ores iron opens up.
  final int? mineTier;

  /// how many times faster than bare hands this digs (bare hands = 1)
  final double? mineSpeed;

  /// prospector only: how far it senses ore, in metres (issue #25)
  final double? senseRange;

  /// swatch colour for the HUD icon, linear RGB
  final Rgb colour;
}

String _model(String name) => '/assets/Assets/$name.glb';

ItemDef _blockItem(String name) {
  final id = blockNames.indexOf(name);
  return ItemDef(
    id: name,
    name: name.replaceAll('_', ' '),
    kind: ItemKind.block,
    maxStack: 64,
    block: id,
    colour: blockDefs[id].top,
  );
}

const Set<String> _notPlaceable = {
  'air',
  'water',
  'bedrock',
  'torch',
  'workbench',
  'bed',
};

final Map<String, ItemDef> items = {
  for (final n in blockNames)
    if (!_notPlaceable.contains(n)) n: _blockItem(n),
  'stick': const ItemDef(
    id: 'stick',
    name: 'stick',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.55, 0.40, 0.22),
  ),
  'coal': const ItemDef(
    id: 'coal',
    name: 'coal',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.15, 0.15, 0.15),
  ),
  'iron': const ItemDef(
    id: 'iron',
    name: 'iron',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.80, 0.78, 0.74),
  ),
  'copper': const ItemDef(
    id: 'copper',
    name: 'copper',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.80, 0.50, 0.30),
  ),
  'gold': const ItemDef(
    id: 'gold',
    name: 'gold',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.95, 0.80, 0.30),
  ),
  'redstone': const ItemDef(
    id: 'redstone',
    name: 'redstone',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.80, 0.16, 0.16),
  ),
  'lapis': const ItemDef(
    id: 'lapis',
    name: 'lapis',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.22, 0.38, 0.85),
  ),
  'diamond': const ItemDef(
    id: 'diamond',
    name: 'diamond',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.45, 0.90, 0.92),
  ),
  'emerald': const ItemDef(
    id: 'emerald',
    name: 'emerald',
    kind: ItemKind.material,
    maxStack: 64,
    colour: (0.24, 0.85, 0.46),
  ),
  'pickaxe_wood': ItemDef(
    id: 'pickaxe_wood',
    name: 'wooden pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    mineTier: 1,
    mineSpeed: 1.5,
    colour: (0.55, 0.40, 0.22),
  ),
  'pickaxe_stone': ItemDef(
    id: 'pickaxe_stone',
    name: 'stone pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    mineTier: 2,
    mineSpeed: 2.5,
    colour: (0.5, 0.5, 0.5),
  ),
  'pickaxe_copper': ItemDef(
    id: 'pickaxe_copper',
    name: 'copper pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    mineTier: 3,
    mineSpeed: 3.2,
    colour: (0.80, 0.50, 0.30),
  ),
  'pickaxe_iron': ItemDef(
    id: 'pickaxe_iron',
    name: 'iron pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    mineTier: 4,
    mineSpeed: 4,
    colour: (0.8, 0.78, 0.74),
  ),
  // soft: it flies through stone but cannot bite the ores iron opens (Minecraft's gold)
  'pickaxe_gold': ItemDef(
    id: 'pickaxe_gold',
    name: 'golden pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    mineTier: 2,
    mineSpeed: 6.5,
    colour: (0.95, 0.80, 0.30),
  ),
  'pickaxe_diamond': ItemDef(
    id: 'pickaxe_diamond',
    name: 'diamond pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    mineTier: 5,
    mineSpeed: 7,
    colour: (0.45, 0.90, 0.92),
  ),
  // the finder of issue #25, in three rungs: a whittled one you can have in the first
  // minute, then lapis and redstone to see further, then emerald
  'prospector': const ItemDef(
    id: 'prospector',
    name: 'prospector',
    kind: ItemKind.tool,
    maxStack: 1,
    senseRange: 16,
    colour: (0.55, 0.40, 0.22),
  ),
  'prospector_tuned': const ItemDef(
    id: 'prospector_tuned',
    name: 'tuned prospector',
    kind: ItemKind.tool,
    maxStack: 1,
    senseRange: 32,
    colour: (0.22, 0.38, 0.85),
  ),
  'prospector_far': const ItemDef(
    id: 'prospector_far',
    name: 'attuned prospector',
    kind: ItemKind.tool,
    maxStack: 1,
    senseRange: 64,
    colour: (0.24, 0.85, 0.46),
  ),
  'sword': ItemDef(
    id: 'sword',
    name: 'sword',
    kind: ItemKind.weapon,
    maxStack: 1,
    model: _model('Sword'),
    colour: (0.85, 0.65, 0.20),
  ),
  'sword_diamond': ItemDef(
    id: 'sword_diamond',
    name: 'diamond sword',
    kind: ItemKind.weapon,
    maxStack: 1,
    model: _model('Sword'),
    colour: (0.45, 0.90, 0.92),
  ),
  'rifle': ItemDef(
    id: 'rifle',
    name: 'rifle',
    kind: ItemKind.weapon,
    maxStack: 1,
    model: _model('Rifle'),
    colour: (0.62, 0.52, 0.34),
  ),
  'ammo': const ItemDef(
    id: 'ammo',
    name: 'rifle ammo',
    kind: ItemKind.material,
    maxStack: 120,
    colour: (0.75, 0.62, 0.30),
  ),
  'torch': ItemDef(
    id: 'torch',
    name: 'torch',
    kind: ItemKind.prop,
    maxStack: 64,
    model: _model('Torch'),
    block: Block.torch,
    colour: (1.0, 0.55, 0.10),
  ),
  'workbench': ItemDef(
    id: 'workbench',
    name: 'workbench',
    kind: ItemKind.prop,
    maxStack: 8,
    model: _model('Workbench'),
    block: Block.workbench,
    colour: (0.58, 0.44, 0.26),
  ),
  'bed': ItemDef(
    id: 'bed',
    name: 'bed',
    kind: ItemKind.prop,
    maxStack: 1,
    model: _model('Bed'),
    block: Block.bed,
    colour: (0.35, 0.45, 0.30),
  ),
};

ItemDef getItem(String id) {
  final def = items[id];
  if (def == null) throw ArgumentError.value(id, 'id', 'unknown item');
  return def;
}

/// What a broken block drops (null = nothing).
String? dropForBlock(int id) => switch (id) {
  Block.air || Block.water => null,
  Block.grass => 'dirt',
  Block.stone => 'cobble', // Minecraft convention; cobble is the wall block
  _ => oreOf(id)?.drop ?? blockNames[id],
};

/// seconds to break by hand, before the tool's speed divides it
final Map<int, double> _hardness = {
  Block.grass: 0.9,
  Block.dirt: 0.75,
  Block.sand: 0.75,
  Block.gravel: 0.9,
  Block.snow: 0.4,
  Block.leaves: 0.35,
  Block.glass: 0.5,
  Block.log: 3,
  Block.planks: 2.2,
  Block.stone: 5,
  Block.cobble: 4.5,
  Block.torch: 0.2,
  Block.workbench: 1.5,
  Block.bed: 1.0,
  Block.reinforcedWall: 9,
  for (final o in ores) o.block: o.hardness,
};

/// The pickaxe tier a block demands; anything missing can be broken by hand. Ores
/// bring their own from the ore table, which is what gates the deep ones behind iron.
final Map<int, int> _mineTier = {
  Block.stone: 1,
  Block.cobble: 1,
  Block.reinforcedWall: 2,
  for (final o in ores) o.block: o.tier,
};

/// The pickaxe tier [itemId] has (0 = not a pickaxe, which still breaks soil and wood).
int mineTierOf(String? itemId) =>
    itemId == null ? 0 : (items[itemId]?.mineTier ?? 0);

/// Seconds to break `block` holding `item` (infinity = cannot).
double breakTime(int block, String? heldItemId) {
  final base = _hardness[block];
  if (base == null) return double.infinity;
  final def = heldItemId == null ? null : items[heldItemId];
  if ((_mineTier[block] ?? 0) > (def?.mineTier ?? 0)) return double.infinity;
  return base / (def?.mineSpeed ?? 1);
}
