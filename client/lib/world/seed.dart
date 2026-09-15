/// World seeds — twin of `server/resources/js/world/seed.ts`. A player's own world
/// gets a random seed; the shared global world is always the classic seed.
library;

import 'dart:math' as math;

enum WorldKind { own, global }

/// the legacy island's seed (islandLarge.seed); asserted in test/world/seed_test.dart
const int globalSeed = 11;

/// a fresh 31-bit seed for a new own world; never the global one
int newWorldSeed([math.Random? random]) {
  final rng = random ?? math.Random.secure();
  for (;;) {
    final seed = (rng.nextDouble() * 0x7fffffff).floor();
    if (seed != globalSeed && seed > 0) return seed;
  }
}

/// short tag a player can recognise a world by ("#1a2b3c")
String seedTag(int seed) {
  final hex = (seed & 0xFFFFFFFF).toRadixString(16).padLeft(6, '0');
  return '#${hex.substring(hex.length - 6)}';
}
