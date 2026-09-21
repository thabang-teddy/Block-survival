import 'package:block_survival/items/inventory.dart';
import 'package:block_survival/items/recipes.dart';
import 'package:block_survival/items/registry.dart';
import 'package:block_survival/world/ores.dart';
import 'package:block_survival/world/palette.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('block items exist for every placeable block and nothing else', () {
    expect(getItem('grass').block, Block.grass);
    expect(getItem('planks').kind, ItemKind.block);
    expect(items.containsKey('water'), isFalse);
    expect(items.containsKey('bedrock'), isFalse);
    expect(getItem('torch').kind, ItemKind.prop);
    expect(getItem('torch').block, Block.torch);
    expect(items.length, 44); // 20 placeable blocks + 24 others, as on the web
  });

  test('drops and break times follow the web rules', () {
    expect(dropForBlock(Block.grass), 'dirt');
    expect(dropForBlock(Block.stone), 'cobble');
    expect(dropForBlock(Block.oreIron), 'iron');
    expect(dropForBlock(Block.water), isNull);
    expect(breakTime(Block.stone, null), double.infinity);
    expect(breakTime(Block.stone, 'pickaxe_wood'), closeTo(5 / 1.5, 1e-9));
    expect(breakTime(Block.dirt, null), 0.75);
    expect(breakTime(Block.bedrock, 'pickaxe_iron'), double.infinity);
  });

  // issue #25: the same ladder the web client's minerals test pins
  test('every mineral drops, and the deep ones are gated behind iron', () {
    for (final o in ores) {
      expect(dropForBlock(o.block), o.drop, reason: '${o.drop} drop');
      expect(items.containsKey(o.drop), isTrue, reason: '${o.drop} item');
      expect(breakTime(o.block, null), double.infinity);
    }
    expect(breakTime(Block.oreCoal, 'pickaxe_wood'), lessThan(double.infinity));
    expect(breakTime(Block.oreCopper, 'pickaxe_wood'), double.infinity);
    expect(
      breakTime(Block.oreCopper, 'pickaxe_stone'),
      lessThan(double.infinity),
    );
    for (final ore in [
      Block.oreGold,
      Block.oreRedstone,
      Block.oreDiamond,
      Block.oreEmerald,
    ]) {
      expect(breakTime(ore, 'pickaxe_copper'), double.infinity);
      expect(breakTime(ore, 'pickaxe_iron'), lessThan(double.infinity));
    }
    // gold digs faster than iron but cannot touch what iron opens
    expect(
      breakTime(Block.stone, 'pickaxe_gold'),
      lessThan(breakTime(Block.stone, 'pickaxe_iron')),
    );
    expect(breakTime(Block.oreDiamond, 'pickaxe_gold'), double.infinity);
    expect(mineTierOf('pickaxe_gold'), lessThan(mineTierOf('pickaxe_iron')));
  });

  test('a prospector senses, and the attuned one senses further', () {
    expect(getItem('prospector').senseRange, greaterThan(0));
    expect(
      getItem('prospector_far').senseRange!,
      greaterThan(getItem('prospector').senseRange!),
    );
  });

  test('every mineral has a recipe to go into', () {
    final used = {for (final r in recipes) ...r.inputs.map((i) => i.id)};
    for (final o in ores) {
      expect(used.contains(o.drop), isTrue, reason: '${o.drop} is unused');
    }
  });

  test('inventory stacks, overflows and removes like the web one', () {
    final inv = Inventory();
    var changes = 0;
    inv.addListener(() => changes++);
    expect(inv.add('log', 70), 0);
    expect(inv.get(0), const ItemStack('log', 64));
    expect(inv.get(1), const ItemStack('log', 6));
    expect(inv.count('log'), 70);
    expect(inv.add('sword', 1), 0);
    expect(inv.get(2), const ItemStack('sword', 1));
    expect(inv.remove('log', 10), isTrue);
    expect(inv.get(1), isNull, reason: 'removed from the last slot first');
    expect(inv.get(0), const ItemStack('log', 60));
    expect(inv.remove('log', 61), isFalse);
    expect(inv.takeFromSlot(2, 5), 1);
    inv.swap(0, 8);
    expect(inv.get(8), const ItemStack('log', 60));
    expect(inv.hotbar().length, hotbarSize);
    expect(changes, greaterThan(4));
  });

  test('crafting: hand vs bench, status and consumption', () {
    final inv = Inventory();
    expect(recipesFor(CraftContext.hand).map((r) => r.id), [
      'planks',
      'stick',
      'workbench',
      'pickaxe_wood',
    ]);
    expect(
      recipesFor(CraftContext.bench).any((r) => r.id == 'workbench'),
      isFalse,
    );
    final planks = getRecipe('planks');
    expect(craftStatus(inv, planks, nearBench: false), CraftStatus.missing);
    inv.add('log', 1);
    expect(craftStatus(inv, planks, nearBench: false), CraftStatus.ok);
    expect(craft(inv, planks, nearBench: false), 0);
    expect(inv.count('log'), 0);
    expect(inv.count('planks'), 4);
    expect(
      craftStatus(inv, getRecipe('torch'), nearBench: false),
      CraftStatus.needsBench,
    );
    expect(craft(inv, getRecipe('torch'), nearBench: false), isNull);
  });
}
