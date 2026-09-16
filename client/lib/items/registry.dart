/// Item definitions — twin of `items/registry.ts`: every placeable block,
/// tool, weapon and material. Block items share the id of their block name.
library;

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
    this.pickaxeTier,
  });

  final String id;
  final String name;
  final ItemKind kind;
  final int maxStack;

  /// block placed when used (block and prop items)
  final int? block;

  /// GLB under /assets used for the held view-model and drops
  final String? model;

  /// pickaxe tier: 1 wood, 2 stone, 3 iron
  final int? pickaxeTier;

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
  'pickaxe_wood': ItemDef(
    id: 'pickaxe_wood',
    name: 'wooden pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    pickaxeTier: 1,
    colour: (0.55, 0.40, 0.22),
  ),
  'pickaxe_stone': ItemDef(
    id: 'pickaxe_stone',
    name: 'stone pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    pickaxeTier: 2,
    colour: (0.5, 0.5, 0.5),
  ),
  'pickaxe_iron': ItemDef(
    id: 'pickaxe_iron',
    name: 'iron pickaxe',
    kind: ItemKind.tool,
    maxStack: 1,
    model: _model('Pickaxe'),
    pickaxeTier: 3,
    colour: (0.8, 0.78, 0.74),
  ),
  'sword': ItemDef(
    id: 'sword',
    name: 'sword',
    kind: ItemKind.weapon,
    maxStack: 1,
    model: _model('Sword'),
    colour: (0.85, 0.65, 0.20),
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
  Block.oreCoal => 'coal',
  Block.oreIron => 'iron',
  _ => blockNames[id],
};

/// seconds to break by hand
const Map<int, double> _hardness = {
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
  Block.oreCoal: 5,
  Block.oreIron: 6,
  Block.torch: 0.2,
  Block.workbench: 1.5,
  Block.bed: 1.0,
  Block.reinforcedWall: 9,
};
const Set<int> _needsPickaxe = {
  Block.stone,
  Block.cobble,
  Block.oreCoal,
  Block.oreIron,
  Block.reinforcedWall,
};
const List<double> _pickaxeSpeed = [1, 1.5, 2.5, 4];

/// Seconds to break `block` holding `item` (infinity = cannot).
double breakTime(int block, String? heldItemId) {
  final base = _hardness[block];
  if (base == null) return double.infinity;
  final tier = heldItemId == null ? 0 : (items[heldItemId]?.pickaxeTier ?? 0);
  if (_needsPickaxe.contains(block) && tier == 0) return double.infinity;
  return base / _pickaxeSpeed[tier];
}
