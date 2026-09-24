const r = (id, output, inputs, bench) => ({
    id,
    output: { id: output[0], count: output[1] },
    inputs: inputs.map(([iid, count]) => ({ id: iid, count })),
    bench,
});
export const RECIPES = [
    r('planks', ['planks', 4], [['log', 1]], false),
    r('stick', ['stick', 4], [['planks', 2]], false),
    r('workbench', ['workbench', 1], [['planks', 4]], false),
    r('torch', ['torch', 4], [['stick', 1], ['coal', 1]], true),
    r('pickaxe_wood', ['pickaxe_wood', 1], [['planks', 3], ['stick', 2]], false),
    r('pickaxe_stone', ['pickaxe_stone', 1], [['cobble', 3], ['stick', 2]], true),
    r('pickaxe_copper', ['pickaxe_copper', 1], [['copper', 3], ['stick', 2]], true),
    r('pickaxe_iron', ['pickaxe_iron', 1], [['iron', 3], ['stick', 2]], true),
    r('pickaxe_gold', ['pickaxe_gold', 1], [['gold', 3], ['stick', 2]], true),
    r('pickaxe_diamond', ['pickaxe_diamond', 1], [['diamond', 3], ['stick', 2]], true),
    r('sword', ['sword', 1], [['iron', 2], ['stick', 1]], true),
    r('sword_diamond', ['sword_diamond', 1], [['diamond', 2], ['stick', 1]], true),
    r('prospector', ['prospector', 1], [['planks', 4], ['stick', 2]], true),
    r('prospector_tuned', ['prospector_tuned', 1], [['prospector', 1], ['lapis', 2], ['redstone', 2], ['iron', 1]], true),
    r('prospector_far', ['prospector_far', 1], [['prospector_tuned', 1], ['emerald', 2]], true),
    r('glass', ['glass', 4], [['sand', 4], ['coal', 1]], true),
    r('reinforced_wall', ['reinforced_wall', 4], [['cobble', 4], ['iron', 1]], true),
    r('bed', ['bed', 1], [['planks', 3], ['leaves', 3]], true),
    r('rifle', ['rifle', 1], [['iron', 8], ['planks', 2], ['coal', 2]], true),
    r('ammo', ['ammo', 30], [['iron', 1], ['coal', 1]], true),
    r('ammo_redstone', ['ammo', 60], [['iron', 1], ['redstone', 1]], true),
];
export function recipesFor(context) {
    return context === 'hand' ? RECIPES.filter(r => !r.bench) : RECIPES.filter(r => r.id !== 'workbench');
}
export const getRecipe = (id) => {
    const rec = RECIPES.find(x => x.id === id);
    if (!rec)
        throw new Error(`unknown recipe: ${id}`);
    return rec;
};
export function craftStatus(inv, recipe, nearBench) {
    if (recipe.bench && !nearBench)
        return 'needsBench';
    return recipe.inputs.every(i => inv.count(i.id) >= i.count) ? 'ok' : 'missing';
}
export function craft(inv, recipe, nearBench) {
    if (craftStatus(inv, recipe, nearBench) !== 'ok')
        return null;
    for (const i of recipe.inputs)
        inv.remove(i.id, i.count);
    const overflow = inv.add(recipe.output.id, recipe.output.count);
    return { overflow };
}
//# sourceMappingURL=recipes.js.map