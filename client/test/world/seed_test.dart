import 'dart:math' as math;

import 'package:block_survival/world/island_gen.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the global world is the legacy island seed', () {
    expect(globalSeed, islandLarge.seed);
  });

  test(
    'newWorldSeed is a positive 31-bit seed that is never the global one',
    () {
      final rng = math.Random(1);
      for (var i = 0; i < 1000; i++) {
        final s = newWorldSeed(rng);
        expect(s, greaterThan(0));
        expect(s, lessThan(0x80000000));
        expect(s, isNot(globalSeed));
      }
    },
  );

  test('seedTag matches the browser format', () {
    expect(seedTag(0x1a2b3c), '#1a2b3c');
    expect(seedTag(11), '#00000b');
    expect(seedTag(0x7fffffff), '#ffffff');
  });
}
