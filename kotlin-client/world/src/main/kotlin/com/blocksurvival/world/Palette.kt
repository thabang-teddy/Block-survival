package com.blocksurvival.world

/**
 * Block palette — twin of `server/resources/js/world/palette.ts`. Block ids are
 * the bytes stored in chunks, so the numbering is part of the save format and
 * the wire protocol; never renumber.
 */
const val AIR = 0

/** Block ids. Mirrors Dart's `Block` abstract-final class of constants. */
object Block {
    const val AIR = 0
    const val GRASS = 1
    const val DIRT = 2
    const val STONE = 3
    const val COBBLE = 4
    const val SAND = 5
    const val GRAVEL = 6
    const val LOG = 7
    const val PLANKS = 8
    const val LEAVES = 9
    const val WATER = 10
    const val GLASS = 11
    const val SNOW = 12
    const val ORE_IRON = 13
    const val ORE_COAL = 14
    const val TORCH = 15
    const val WORKBENCH = 16
    const val BED = 17
    const val REINFORCED_WALL = 18

    /** the unbreakable floor of the world at y = 0 */
    const val BEDROCK = 19

    // issue #25: the rest of the Overworld ores, found underground by depth
    const val ORE_COPPER = 20
    const val ORE_GOLD = 21
    const val ORE_REDSTONE = 22
    const val ORE_LAPIS = 23
    const val ORE_DIAMOND = 24
    const val ORE_EMERALD = 25
}

val blockNames = listOf(
    "air", "grass", "dirt", "stone", "cobble", "sand", "gravel", "log", "planks",
    "leaves", "water", "glass", "snow", "ore_iron", "ore_coal", "torch", "workbench",
    "bed", "reinforced_wall", "bedrock", "ore_copper", "ore_gold", "ore_redstone",
    "ore_lapis", "ore_diamond", "ore_emerald",
)

/** (r, g, b) colour in linear RGB 0..1 */
data class Rgb(val r: Double, val g: Double, val b: Double)

class BlockDef(
    /** top-face colour */
    val top: Rgb,
    val side: Rgb,
    val bottom: Rgb,
    /** 1 = opaque */
    val alpha: Double,
    /** faces of neighbours are still drawn against this block */
    val seeThrough: Boolean,
    /** blocks player movement */
    val solid: Boolean,
    /** drawn as a placed model instead of chunk faces */
    val prop: Boolean = false,
    /** gives off light */
    val light: Boolean = false,
) {
    companion object {
        fun uniform(
            c: Rgb,
            alpha: Double,
            seeThrough: Boolean,
            solid: Boolean,
            prop: Boolean = false,
            light: Boolean = false,
        ): BlockDef = BlockDef(c, c, c, alpha, seeThrough, solid, prop, light)
    }
}

val blockDefs: List<BlockDef> = listOf(
    BlockDef.uniform(Rgb(0.0, 0.0, 0.0), alpha = 0.0, seeThrough = true, solid = false),
    BlockDef(
        top = Rgb(0.40, 0.66, 0.24),
        side = Rgb(0.52, 0.36, 0.20),
        bottom = Rgb(0.52, 0.36, 0.20),
        alpha = 1.0, seeThrough = false, solid = true,
    ),
    BlockDef.uniform(Rgb(0.52, 0.36, 0.20), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.52, 0.52, 0.52), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.44, 0.44, 0.46), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.86, 0.80, 0.58), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.58, 0.55, 0.52), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef(
        top = Rgb(0.70, 0.58, 0.36),
        side = Rgb(0.40, 0.28, 0.15),
        bottom = Rgb(0.70, 0.58, 0.36),
        alpha = 1.0, seeThrough = false, solid = true,
    ),
    BlockDef.uniform(Rgb(0.72, 0.56, 0.34), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.24, 0.52, 0.18), alpha = 1.0, seeThrough = true, solid = true),
    BlockDef.uniform(Rgb(0.22, 0.48, 0.85), alpha = 0.75, seeThrough = true, solid = false),
    BlockDef.uniform(Rgb(0.75, 0.88, 0.95), alpha = 0.35, seeThrough = true, solid = true),
    BlockDef.uniform(Rgb(0.95, 0.96, 0.98), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.62, 0.55, 0.48), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.30, 0.30, 0.30), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(1.0, 0.55, 0.10), alpha = 1.0, seeThrough = true, solid = false, prop = true, light = true),
    BlockDef.uniform(Rgb(0.58, 0.44, 0.26), alpha = 1.0, seeThrough = true, solid = true, prop = true),
    BlockDef.uniform(Rgb(0.35, 0.45, 0.30), alpha = 1.0, seeThrough = true, solid = false, prop = true),
    BlockDef(
        top = Rgb(0.36, 0.38, 0.40),
        side = Rgb(0.30, 0.32, 0.35),
        bottom = Rgb(0.30, 0.32, 0.35),
        alpha = 1.0, seeThrough = false, solid = true,
    ),
    BlockDef.uniform(Rgb(0.18, 0.18, 0.20), alpha = 1.0, seeThrough = false, solid = true),
    // the ores of issue #25: stone-grey with the metal's tint
    BlockDef.uniform(Rgb(0.62, 0.42, 0.28), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.85, 0.70, 0.25), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.62, 0.18, 0.18), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.20, 0.32, 0.68), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.42, 0.82, 0.85), alpha = 1.0, seeThrough = false, solid = true),
    BlockDef.uniform(Rgb(0.22, 0.72, 0.40), alpha = 1.0, seeThrough = false, solid = true),
)

fun blockDef(id: Int): BlockDef? = if (id in blockDefs.indices) blockDefs[id] else null

fun isSolid(id: Int): Boolean = blockDef(id)?.solid ?: false
fun isSeeThrough(id: Int): Boolean = blockDef(id)?.seeThrough ?: true
fun isTranslucent(id: Int): Boolean = (blockDef(id)?.alpha ?: 0.0) < 1.0 && id != AIR
fun isProp(id: Int): Boolean = blockDef(id)?.prop ?: false
