/// The minerals of the world (issue #25) — twin of `server/resources/js/world/ores.ts`.
///
/// One table serves three readers that must never disagree: the vein generator
/// (`underground.dart`) places ore by these depth bands, the item registry takes the
/// drop, hardness and pickaxe tier from here, and the HUD's minerals guide reads it
/// straight out to tell the player where to dig.
///
/// Order is part of the contract: vein selection walks this list accumulating
/// [OreDef.chance], so moving a row changes every world.
library;

import 'package:block_survival/world/palette.dart';

final class OreDef {
  const OreDef({
    required this.block,
    required this.drop,
    required this.minY,
    required this.maxY,
    required this.chance,
    required this.sizeMin,
    required this.sizeMax,
    required this.tier,
    required this.hardness,
    required this.note,
  });

  /// the block as it sits in the ground
  final int block;

  /// item id it drops when broken
  final String drop;

  /// lowest y a vein of this ore is placed at
  final int minY;

  /// highest y a vein of this ore is placed at
  final int maxY;

  /// chance a vein cell inside the band holds this ore (see veinCell)
  final double chance;

  /// blocks in one vein, inclusive
  final int sizeMin;
  final int sizeMax;

  /// pickaxe tier needed to break it (see items/registry)
  final int tier;

  /// seconds to break with bare hands, before the tool's speed divides it
  final double hardness;

  /// one line for the minerals guide
  final String note;
}

/// Bands are roughly Minecraft's, squeezed into this world's 0–127 band: bedrock is
/// y 0, the sea sits at 32 and the ground runs 24–52, so "deep" here means single
/// digits. Emerald has no upper limit worth fussing over — it can only ever appear
/// where there is stone that high, which is under mountains.
const List<OreDef> ores = [
  OreDef(
    block: Block.oreCoal,
    drop: 'coal',
    minY: 8,
    maxY: 60,
    chance: 0.22,
    sizeMin: 6,
    sizeMax: 14,
    tier: 1,
    hardness: 5,
    note: 'Everywhere below the soil — the first thing your wooden pickaxe can use.',
  ),
  OreDef(
    block: Block.oreCopper,
    drop: 'copper',
    minY: 6,
    maxY: 48,
    chance: 0.16,
    sizeMin: 5,
    sizeMax: 12,
    tier: 2,
    hardness: 5.5,
    note: 'Big shallow veins. A copper pickaxe is the cheap step up from stone.',
  ),
  OreDef(
    block: Block.oreIron,
    drop: 'iron',
    minY: 4,
    maxY: 44,
    chance: 0.14,
    sizeMin: 4,
    sizeMax: 9,
    tier: 2,
    hardness: 6,
    note: 'Common all the way down. Iron opens the rifle, walls and the deep ores.',
  ),
  OreDef(
    block: Block.oreLapis,
    drop: 'lapis',
    minY: 1,
    maxY: 26,
    chance: 0.05,
    sizeMin: 3,
    sizeMax: 7,
    tier: 2,
    hardness: 6,
    note: 'Deep and scattered. The lens of a prospector is cut from it.',
  ),
  OreDef(
    block: Block.oreGold,
    drop: 'gold',
    minY: 2,
    maxY: 28,
    chance: 0.05,
    sizeMin: 3,
    sizeMax: 7,
    tier: 4,
    hardness: 6.5,
    note: 'Needs an iron pickaxe. Gold tools dig faster than anything but diamond.',
  ),
  OreDef(
    block: Block.oreRedstone,
    drop: 'redstone',
    minY: 1,
    maxY: 15,
    chance: 0.07,
    sizeMin: 4,
    sizeMax: 9,
    tier: 4,
    hardness: 6.5,
    note: 'Right down at the bottom. Doubles a batch of rifle ammo and powers the prospector.',
  ),
  OreDef(
    block: Block.oreDiamond,
    drop: 'diamond',
    minY: 1,
    maxY: 12,
    chance: 0.03,
    sizeMin: 2,
    sizeMax: 5,
    tier: 4,
    hardness: 7.5,
    note: 'The last twelve blocks above bedrock, in ones and twos. The best pickaxe and sword.',
  ),
  OreDef(
    block: Block.oreEmerald,
    drop: 'emerald',
    minY: 28,
    maxY: 50,
    chance: 0.08,
    sizeMin: 1,
    sizeMax: 3,
    tier: 4,
    hardness: 7.5,
    note: 'Ones and twos, and only inside high ground — there is no stone that high anywhere else.',
  ),
];

final Map<int, OreDef> _byBlock = {for (final o in ores) o.block: o};

OreDef? oreOf(int block) => _byBlock[block];

bool isOre(int block) => _byBlock.containsKey(block);

/// the ores whose band contains [y], richest first — what the depth readout and the guide list
List<OreDef> oresAt(int y) =>
    ores.where((o) => y >= o.minY && y <= o.maxY).toList();

/// What the ore bands call this height. This is about the rock, not about where the
/// player is: the ground runs y 24–52, so standing on grass at y 37 is "shallow" —
/// shallow *rock*, the depth coal and copper live at. How far down the player actually
/// is comes from [depthNote], which needs the surface above them to say.
String depthBand(int y) {
  if (y <= 12) return 'bedrock depths';
  if (y <= 28) return 'deep rock';
  if (y <= 48) return 'shallow rock';
  return 'high ground';
}

/// How far under the surface the player is, for the HUD. [surfaceY] is the top block
/// of their column; anything at or above it (including a sky island, which is far
/// above the ground below) is out in the open.
String depthNote(double y, int surfaceY) {
  final under = (surfaceY - y).round();
  return under <= 0 ? 'above ground' : '$under m down';
}
