/// The building blocks must match V8 bit for bit before anything above them
/// can (docs/flutter-client-plan.md §2 S2). Failures here point at one function.
library;

import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/noise.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';

void main() {
  final p = loadJson('primitives.json');

  test('mulberry32 matches createRng for every sampled seed', () {
    final rng = p['rng'] as Map<String, dynamic>;
    for (final entry in rng.entries) {
      final next = createRng(int.parse(entry.key));
      final want = (entry.value as List).map(num2d).toList();
      final got = List.generate(want.length, (_) => next());
      expect(got, want, reason: 'seed ${entry.key}');
    }
  });

  test('hashInt matches for negative and 31-bit inputs', () {
    for (final row in (p['hashInt'] as List).cast<List>()) {
      final [a, b, c, d, want] = row.cast<int>();
      expect(hashInt(a, b, c, d), want, reason: 'hashInt($a, $b, $c, $d)');
    }
  });

  test('Perlin noise matches at fractional, negative and huge coordinates', () {
    final perlin = PerlinNoise((p['perlin'] as Map)['seed'] as int);
    for (final row in ((p['perlin'] as Map)['samples'] as List).cast<List>()) {
      final [x, y, z, want] = row.map(num2d).toList();
      expect(perlin.noise(x, y, z), want, reason: 'noise($x, $y, $z)');
    }
  });

  test('fractal2 matches', () {
    final n2 = fractal2(PerlinNoise((p['perlin'] as Map)['seed'] as int));
    for (final row in (p['fractal2'] as List).cast<List>()) {
      final [x, z, seed, freq, want] = row.map(num2d).toList();
      expect(n2(x, z, seed, freq), want, reason: 'n2($x, $z, $seed, $freq)');
    }
  });

  test('Math.hypot matches V8 (Kahan-summed, scaled)', () {
    for (final row in (p['hypot'] as List).cast<List>()) {
      final [x, z, want] = row.map(num2d).toList();
      expect(hypot(x, z), want, reason: 'hypot($x, $z)');
    }
  });

  test('Math.sin / Math.cos match fdlibm', () {
    for (final row in (p['trig'] as List).cast<List>()) {
      final [a, sinWant, cosWant] = row.map(num2d).toList();
      expect(jsSin(a), sinWant, reason: 'sin($a)');
      expect(jsCos(a), cosWant, reason: 'cos($a)');
    }
  });

  test('Math.round rounds halves towards +infinity', () {
    expect(jsRound(2.5), 3);
    expect(jsRound(-2.5), -2);
    expect(jsRound(-3.5), -3);
    expect(jsRound(0.49999999999999994), 0);
    expect(jsRound(-0.4), 0);
  });
}
