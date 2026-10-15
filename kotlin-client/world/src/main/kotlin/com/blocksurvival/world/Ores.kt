package com.blocksurvival.world

import kotlin.math.roundToInt

/**
 * The minerals of the world (issue #25) — twin of
 * `server/resources/js/world/ores.ts`. Order is part of the contract: vein
 * selection walks this list accumulating [OreDef.chance], so moving a row
 * changes every world.
 */
class OreDef(
    /** the block as it sits in the ground */
    val block: Int,
    /** item id it drops when broken */
    val drop: String,
    /** lowest y a vein of this ore is placed at */
    val minY: Int,
    /** highest y a vein of this ore is placed at */
    val maxY: Int,
    /** chance a vein cell inside the band holds this ore */
    val chance: Double,
    /** blocks in one vein, inclusive */
    val sizeMin: Int,
    val sizeMax: Int,
    /** pickaxe tier needed to break it */
    val tier: Int,
    /** seconds to break with bare hands, before the tool's speed divides it */
    val hardness: Double,
    /** one line for the minerals guide */
    val note: String,
)

val ores: List<OreDef> = listOf(
    OreDef(Block.ORE_COAL, "coal", 8, 60, 0.22, 6, 14, 1, 5.0,
        "Everywhere below the soil — the first thing your wooden pickaxe can use."),
    OreDef(Block.ORE_COPPER, "copper", 6, 48, 0.16, 5, 12, 2, 5.5,
        "Big shallow veins. A copper pickaxe is the cheap step up from stone."),
    OreDef(Block.ORE_IRON, "iron", 4, 44, 0.14, 4, 9, 2, 6.0,
        "Common all the way down. Iron opens the rifle, walls and the deep ores."),
    OreDef(Block.ORE_LAPIS, "lapis", 1, 26, 0.05, 3, 7, 2, 6.0,
        "Deep and scattered. The lens of a prospector is cut from it."),
    OreDef(Block.ORE_GOLD, "gold", 2, 28, 0.05, 3, 7, 4, 6.5,
        "Needs an iron pickaxe. Gold tools dig faster than anything but diamond."),
    OreDef(Block.ORE_REDSTONE, "redstone", 1, 15, 0.07, 4, 9, 4, 6.5,
        "Right down at the bottom. Doubles a batch of rifle ammo and powers the prospector."),
    OreDef(Block.ORE_DIAMOND, "diamond", 1, 12, 0.03, 2, 5, 4, 7.5,
        "The last twelve blocks above bedrock, in ones and twos. The best pickaxe and sword."),
    OreDef(Block.ORE_EMERALD, "emerald", 28, 50, 0.08, 1, 3, 4, 7.5,
        "Ones and twos, and only inside high ground — there is no stone that high anywhere else."),
)

private val oresByBlock: Map<Int, OreDef> = ores.associateBy { it.block }

fun oreOf(block: Int): OreDef? = oresByBlock[block]

fun isOre(block: Int): Boolean = oresByBlock.containsKey(block)

/** the ores whose band contains [y], richest first */
fun oresAt(y: Int): List<OreDef> = ores.filter { y >= it.minY && y <= it.maxY }

fun depthBand(y: Int): String = when {
    y <= 12 -> "bedrock depths"
    y <= 28 -> "deep rock"
    y <= 48 -> "shallow rock"
    else -> "high ground"
}

fun depthNote(y: Double, surfaceY: Int): String {
    val under = (surfaceY - y).roundToInt()
    return if (under <= 0) "above ground" else "$under m down"
}
