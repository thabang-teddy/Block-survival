/// Golden-fixture contract with the browser client: for every seed in
/// shared/fixtures/worldgen/, ground heights, trees, island placement, island
/// templates, updrafts and whole chunks must be byte-identical.
library;

import 'dart:typed_data';

import 'package:block_survival/world/ground_gen.dart';
import 'package:block_survival/world/island_field.dart';
import 'package:block_survival/world/island_template.dart';
import 'package:block_survival/world/terrain_gen.dart';
import 'package:block_survival/world/underground.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';

/// the template re-read through `get`, in the same order the dump script used
Uint8List templateBytes(IslandTemplate t) {
  final bytes = Uint8List(t.sx * t.sy * t.sx);
  var i = 0;
  for (var z = -t.ext; z <= t.ext; z++) {
    for (var y = t.yLo; y <= t.yHi; y++) {
      for (var x = -t.ext; x <= t.ext; x++) {
        bytes[i++] = t.get(x, y, z);
      }
    }
  }
  return bytes;
}

void main() {
  for (final seed in seedsInManifest()) {
    group('seed $seed', () {
      final f = loadJson('seed-$seed.json');
      final gen = TerrainGenerator(seed);
      final ground = GroundModel(seed);

      test('spawn pad', () {
        expect(ground.padHeight, f['padHeight']);
        final spawn = f['spawn'] as Map;
        expect(gen.spawn().y, num2d(spawn['y']));
      });

      test('ground heights', () {
        for (final row in (f['heights'] as List).cast<List>()) {
          final [x, z, h] = row.cast<int>();
          expect(ground.height(x, z), h, reason: 'height($x, $z)');
        }
        for (final row in (f['naturalHeights'] as List).cast<List>()) {
          final [x, z, h] = row.cast<int>();
          expect(
            ground.naturalHeight(x, z),
            h,
            reason: 'naturalHeight($x, $z)',
          );
        }
      });

      test('tree placement in the 128×128 square around the origin', () {
        final got = <List<int>>[];
        for (var x = -64; x < 64; x++) {
          for (var z = -64; z < 64; z++) {
            final h = ground.treeHeight(x, z, ground.height);
            if (h != 0) got.add([x, z, h]);
          }
        }
        final want = (f['trees'] as List)
            .map((r) => (r as List).cast<int>())
            .toList();
        expect(got, want);
      });

      test('island cells', () {
        for (final cell in (f['islands'] as List).cast<Map>()) {
          final got = islandAtCell(seed, cell['ix'] as int, cell['iz'] as int);
          final want = cell['island'] as Map?;
          if (want == null) {
            expect(
              got,
              isNull,
              reason: 'cell ${cell['ix']},${cell['iz']} should be empty',
            );
            continue;
          }
          expect(
            got,
            isNotNull,
            reason: 'cell ${cell['ix']},${cell['iz']} should hold an island',
          );
          expect(got!.x, want['x']);
          expect(got.z, want['z']);
          expect(got.baseY, want['baseY']);
          final params = want['params'] as Map;
          expect(got.params.size, params['size']);
          expect(got.params.seed, params['seed']);
          expect(got.params.maxHeight, params['maxHeight']);
          expect(got.params.depth, params['depth']);
          expect(got.params.padRadius, params['padRadius']);
          expect(got.params.lake, params['lake']);
          expect(got.params.treeDensity, num2d(params['treeDensity']));
        }
        final near = islandsNear(
          seed,
          -100,
          -100,
          100,
          100,
        ).map((i) => [i.ix, i.iz]).toList();
        expect(
          near,
          (f['islandsNear'] as List)
              .map((r) => (r as List).cast<int>())
              .toList(),
        );
      });

      test('island templates', () {
        final templates = IslandTemplates();
        for (final want in (f['templates'] as List).cast<Map>()) {
          final island = islandAtCell(
            seed,
            want['ix'] as int,
            want['iz'] as int,
          )!;
          final t = templates.get(island);
          final label = 'island ${island.ix},${island.iz}';
          expect(
            [t.minX, t.minY, t.minZ, t.maxX, t.maxY, t.maxZ],
            [
              want['minX'],
              want['minY'],
              want['minZ'],
              want['maxX'],
              want['maxY'],
              want['maxZ'],
            ],
            reason: '$label bounds',
          );
          expect(t.padHeight, want['padHeight'], reason: '$label padHeight');
          expect(t.voxelCount, want['voxelCount'], reason: '$label voxelCount');
          expect(
            sha256Hex(templateBytes(t)),
            want['sha256'],
            reason: '$label blocks',
          );
        }
      });

      test('updrafts', () {
        for (final want in (f['updrafts'] as List).cast<Map>()) {
          final island = islandAtCell(
            seed,
            want['ix'] as int,
            want['iz'] as int,
          )!;
          final u = gen.updraftOf(island);
          expect(
            [u.x, u.z, u.bottomY, u.topY, u.radius],
            [
              num2d(want['x']),
              num2d(want['z']),
              want['bottomY'],
              want['topY'],
              num2d(want['radius']),
            ],
            reason: 'updraft of ${island.ix},${island.iz}',
          );
        }
        final near = gen
            .updraftsNear(-160, -160, 159, 159)
            .map((u) => [u.ix, u.iz])
            .toList();
        expect(
          near,
          (f['updraftsNear'] as List)
              .map((u) => [(u as Map)['ix'], u['iz']])
              .toList(),
        );
      });

      // issue #25: sampled on their own so a mismatch lands on one function
      // instead of a whole chunk
      test('caves are carved in the same places', () {
        final caves = CaveModel(seed, padRadius + padBlend);
        final samples = (f['underground'] as Map)['caves'] as List;
        for (final row in samples.cast<List>()) {
          final x = row[0] as int;
          final y = row[1] as int;
          final z = row[2] as int;
          final h = row[3] as int;
          expect(
            caves.open(x, y, z, h),
            row[4] as bool,
            reason: 'cave at $x,$y,$z under h $h',
          );
        }
      });

      test('ore veins land in the same cells, with the same shape', () {
        final field = VeinField(seed);
        final samples = (f['underground'] as Map)['veins'] as List;
        for (final row in samples.cast<Map>()) {
          final gx = row['gx'] as int;
          final gy = row['gy'] as int;
          final gz = row['gz'] as int;
          final got = field.inCell(gx, gy, gz);
          final want = row['vein'] as Map?;
          final label = 'vein cell $gx,$gy,$gz';
          if (want == null) {
            expect(got, isNull, reason: '$label should be empty');
            continue;
          }
          expect(got, isNotNull, reason: '$label should hold a vein');
          expect(
            [got!.ore.block, got.x, got.y, got.z],
            [want['block'], want['x'], want['y'], want['z']],
            reason: '$label ore and centre',
          );
          expect(
            got.offsets.toList(),
            (want['offsets'] as List).cast<int>(),
            reason: '$label shape',
          );
        }
      });

      test('chunks are byte-identical', () {
        for (final want in (f['chunks'] as List).cast<Map>()) {
          final cx = want['cx'] as int;
          final cy = want['cy'] as int;
          final cz = want['cz'] as int;
          final got = gen.generateChunk(cx, cy, cz);
          final wantData = unpackChunk(want['data'] as String?);
          if (wantData == null) {
            expect(got, isNull, reason: 'chunk $cx,$cy,$cz should be all air');
            continue;
          }
          expect(
            got,
            isNotNull,
            reason: 'chunk $cx,$cy,$cz should have blocks',
          );
          expect(
            sha256Hex(got!),
            want['sha256'],
            reason: 'chunk $cx,$cy,$cz hash',
          );
          expect(got, wantData, reason: 'chunk $cx,$cy,$cz bytes');
        }
      });
    });
  }
}
