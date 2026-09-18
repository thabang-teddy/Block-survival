/// Block palette — twin of `server/resources/js/world/palette.ts`. Block ids are
/// the bytes stored in chunks, so the numbering is part of the save format and
/// the wire protocol; never renumber.
library;

const int air = 0;

abstract final class Block {
  static const int air = 0;
  static const int grass = 1;
  static const int dirt = 2;
  static const int stone = 3;
  static const int cobble = 4;
  static const int sand = 5;
  static const int gravel = 6;
  static const int log = 7;
  static const int planks = 8;
  static const int leaves = 9;
  static const int water = 10;
  static const int glass = 11;
  static const int snow = 12;
  static const int oreIron = 13;
  static const int oreCoal = 14;
  static const int torch = 15;
  static const int workbench = 16;
  static const int bed = 17;
  static const int reinforcedWall = 18;

  /// the unbreakable floor of the world at y = 0
  static const int bedrock = 19;
}

const List<String> blockNames = [
  'air',
  'grass',
  'dirt',
  'stone',
  'cobble',
  'sand',
  'gravel',
  'log',
  'planks',
  'leaves',
  'water',
  'glass',
  'snow',
  'ore_iron',
  'ore_coal',
  'torch',
  'workbench',
  'bed',
  'reinforced_wall',
  'bedrock',
];

/// (top, side, bottom) colours in linear RGB 0..1
typedef Rgb = (double, double, double);

final class BlockDef {
  const BlockDef({
    required this.top,
    required this.side,
    required this.bottom,
    required this.alpha,
    required this.seeThrough,
    required this.solid,
    this.prop = false,
    this.light = false,
  });

  const BlockDef.uniform(
    Rgb c, {
    required this.alpha,
    required this.seeThrough,
    required this.solid,
    this.prop = false,
    this.light = false,
  }) : top = c,
       side = c,
       bottom = c;

  final Rgb top;
  final Rgb side;
  final Rgb bottom;

  /// 1 = opaque
  final double alpha;

  /// faces of neighbours are still drawn against this block
  final bool seeThrough;

  /// blocks player movement
  final bool solid;

  /// drawn as a placed model instead of chunk faces
  final bool prop;

  /// gives off light
  final bool light;
}

const List<BlockDef> blockDefs = [
  BlockDef.uniform((0, 0, 0), alpha: 0, seeThrough: true, solid: false),
  BlockDef(
    top: (0.40, 0.66, 0.24),
    side: (0.52, 0.36, 0.20),
    bottom: (0.52, 0.36, 0.20),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.52, 0.36, 0.20),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.52, 0.52, 0.52),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.44, 0.44, 0.46),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.86, 0.80, 0.58),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.58, 0.55, 0.52),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef(
    top: (0.70, 0.58, 0.36),
    side: (0.40, 0.28, 0.15),
    bottom: (0.70, 0.58, 0.36),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.72, 0.56, 0.34),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform((0.24, 0.52, 0.18), alpha: 1, seeThrough: true, solid: true),
  BlockDef.uniform(
    (0.22, 0.48, 0.85),
    alpha: 0.75,
    seeThrough: true,
    solid: false,
  ),
  BlockDef.uniform(
    (0.75, 0.88, 0.95),
    alpha: 0.35,
    seeThrough: true,
    solid: true,
  ),
  BlockDef.uniform(
    (0.95, 0.96, 0.98),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.62, 0.55, 0.48),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.30, 0.30, 0.30),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (1.0, 0.55, 0.10),
    alpha: 1,
    seeThrough: true,
    solid: false,
    prop: true,
    light: true,
  ),
  BlockDef.uniform(
    (0.58, 0.44, 0.26),
    alpha: 1,
    seeThrough: true,
    solid: true,
    prop: true,
  ),
  BlockDef.uniform(
    (0.35, 0.45, 0.30),
    alpha: 1,
    seeThrough: true,
    solid: false,
    prop: true,
  ),
  BlockDef(
    top: (0.36, 0.38, 0.40),
    side: (0.30, 0.32, 0.35),
    bottom: (0.30, 0.32, 0.35),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
  BlockDef.uniform(
    (0.18, 0.18, 0.20),
    alpha: 1,
    seeThrough: false,
    solid: true,
  ),
];

BlockDef? blockDef(int id) =>
    id >= 0 && id < blockDefs.length ? blockDefs[id] : null;

bool isSolid(int id) => blockDef(id)?.solid ?? false;
bool isSeeThrough(int id) => blockDef(id)?.seeThrough ?? true;
bool isTranslucent(int id) => (blockDef(id)?.alpha ?? 0) < 1 && id != air;
bool isProp(int id) => blockDef(id)?.prop ?? false;
