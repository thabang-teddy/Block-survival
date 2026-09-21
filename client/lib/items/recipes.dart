/// Recipe table and the pure crafting rules — twin of `items/recipes.ts`. By
/// hand you can only make planks, sticks, a workbench and a wooden pickaxe; a
/// workbench within reach makes everything except another workbench.
library;

import 'package:block_survival/items/inventory.dart';

final class Recipe {
  const Recipe(this.id, this.output, this.inputs, {required this.bench});

  final String id;
  final ItemStack output;
  final List<ItemStack> inputs;
  final bool bench;
}

const List<Recipe> recipes = [
  Recipe('planks', ItemStack('planks', 4), [ItemStack('log', 1)], bench: false),
  Recipe('stick', ItemStack('stick', 4), [
    ItemStack('planks', 2),
  ], bench: false),
  Recipe('workbench', ItemStack('workbench', 1), [
    ItemStack('planks', 4),
  ], bench: false),
  Recipe('torch', ItemStack('torch', 4), [
    ItemStack('stick', 1),
    ItemStack('coal', 1),
  ], bench: true),
  Recipe('pickaxe_wood', ItemStack('pickaxe_wood', 1), [
    ItemStack('planks', 3),
    ItemStack('stick', 2),
  ], bench: false),
  Recipe('pickaxe_stone', ItemStack('pickaxe_stone', 1), [
    ItemStack('cobble', 3),
    ItemStack('stick', 2),
  ], bench: true),
  Recipe('pickaxe_copper', ItemStack('pickaxe_copper', 1), [
    ItemStack('copper', 3),
    ItemStack('stick', 2),
  ], bench: true),
  Recipe('pickaxe_iron', ItemStack('pickaxe_iron', 1), [
    ItemStack('iron', 3),
    ItemStack('stick', 2),
  ], bench: true),
  Recipe('pickaxe_gold', ItemStack('pickaxe_gold', 1), [
    ItemStack('gold', 3),
    ItemStack('stick', 2),
  ], bench: true),
  Recipe('pickaxe_diamond', ItemStack('pickaxe_diamond', 1), [
    ItemStack('diamond', 3),
    ItemStack('stick', 2),
  ], bench: true),
  Recipe('sword', ItemStack('sword', 1), [
    ItemStack('iron', 2),
    ItemStack('stick', 1),
  ], bench: true),
  Recipe('sword_diamond', ItemStack('sword_diamond', 1), [
    ItemStack('diamond', 2),
    ItemStack('stick', 1),
  ], bench: true),
  // issue #25: the lens that finds ore, and the emerald that widens its reach
  Recipe('prospector', ItemStack('prospector', 1), [
    ItemStack('lapis', 2),
    ItemStack('redstone', 2),
    ItemStack('iron', 1),
  ], bench: true),
  Recipe('prospector_far', ItemStack('prospector_far', 1), [
    ItemStack('prospector', 1),
    ItemStack('emerald', 2),
  ], bench: true),
  Recipe('glass', ItemStack('glass', 4), [
    ItemStack('sand', 4),
    ItemStack('coal', 1),
  ], bench: true),
  Recipe('reinforced_wall', ItemStack('reinforced_wall', 4), [
    ItemStack('cobble', 4),
    ItemStack('iron', 1),
  ], bench: true),
  Recipe('bed', ItemStack('bed', 1), [
    ItemStack('planks', 3),
    ItemStack('leaves', 3),
  ], bench: true),
  Recipe('rifle', ItemStack('rifle', 1), [
    ItemStack('iron', 8),
    ItemStack('planks', 2),
    ItemStack('coal', 2),
  ], bench: true),
  Recipe('ammo', ItemStack('ammo', 30), [
    ItemStack('iron', 1),
    ItemStack('coal', 1),
  ], bench: true),
  // redstone burns hotter than coal: the same iron goes twice as far
  Recipe('ammo_redstone', ItemStack('ammo', 60), [
    ItemStack('iron', 1),
    ItemStack('redstone', 1),
  ], bench: true),
];

enum CraftContext { hand, bench }

/// what the crafting panel lists: hand recipes anywhere, everything but the bench at a bench
List<Recipe> recipesFor(CraftContext context) => context == CraftContext.hand
    ? recipes.where((r) => !r.bench).toList()
    : recipes.where((r) => r.id != 'workbench').toList();

Recipe getRecipe(String id) => recipes.firstWhere(
  (r) => r.id == id,
  orElse: () => throw ArgumentError.value(id, 'id', 'unknown recipe'),
);

enum CraftStatus { ok, missing, needsBench }

CraftStatus craftStatus(
  Inventory inv,
  Recipe recipe, {
  required bool nearBench,
}) {
  if (recipe.bench && !nearBench) return CraftStatus.needsBench;
  return recipe.inputs.every((i) => inv.count(i.id) >= i.count)
      ? CraftStatus.ok
      : CraftStatus.missing;
}

/// Consume the inputs and add the output; the count that did not fit is
/// returned so the caller can drop it. Null when the recipe cannot be crafted.
int? craft(Inventory inv, Recipe recipe, {required bool nearBench}) {
  if (craftStatus(inv, recipe, nearBench: nearBench) != CraftStatus.ok) {
    return null;
  }
  for (final i in recipe.inputs) {
    inv.remove(i.id, i.count);
  }
  return inv.add(recipe.output.id, recipe.output.count);
}
