/// Physics contract with the browser client: swept AABBs, the voxel raycast and
/// the player controller replay shared/fixtures/physics/*.json exactly.
library;

import 'dart:convert';
import 'dart:io';

import 'package:block_survival/physics/aabb.dart';
import 'package:block_survival/physics/player_controller.dart';
import 'package:block_survival/world/raycast.dart';
import 'package:block_survival/world/terrain_gen.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _load(String name) {
  for (final p in [
    '../shared/fixtures/physics/$name',
    'shared/fixtures/physics/$name',
  ]) {
    final f = File(p);
    if (f.existsSync()) {
      return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  throw StateError('physics fixture $name not found from ${Directory.current}');
}

double _d(Object? v) => (v as num).toDouble();

/// the seed-11 world with `radius` chunk columns around the origin loaded
(World, TerrainGenerator) _streamed(int seed, int radius) {
  final terrain = TerrainGenerator(seed);
  final world = World()..setGenerator(terrain.generateChunk, worldChunksY);
  for (var cx = -radius; cx <= radius; cx++) {
    for (var cz = -radius; cz <= radius; cz++) {
      world.loadColumn(cx, cz);
    }
  }
  return (world, terrain);
}

void main() {
  test('moveBox matches every aabb.json case', () {
    final f = _load('aabb.json');
    final world = World();
    for (final b in (f['blocks'] as List).cast<List>()) {
      world.setBlock(b[0] as int, b[1] as int, b[2] as int, b[3] as int);
    }
    for (final c in (f['cases'] as List).cast<Map>()) {
      final bx = (c['box'] as List).map(_d).toList();
      final mv = (c['move'] as List).map(_d).toList();
      final want = (c['result'] as List).map(_d).toList();
      final r = moveBox(
        world,
        Box(x: bx[0], y: bx[1], z: bx[2], w: bx[3], h: bx[4], d: bx[5]),
        mv[0],
        mv[1],
        mv[2],
      );
      expect(
        [
          r.box.x,
          r.box.y,
          r.box.z,
          r.hitX ? 1.0 : 0.0,
          r.hitY ? 1.0 : 0.0,
          r.hitZ ? 1.0 : 0.0,
        ],
        want,
        reason: 'box $bx move $mv',
      );
    }
  });

  test('raycastVoxels matches every raycast.json ray', () {
    final f = _load('raycast.json');
    final (world, _) = _streamed(f['seed'] as int, f['radius'] as int);
    var hits = 0;
    for (final r in (f['rays'] as List).cast<Map>()) {
      final o = (r['origin'] as List).map(_d).toList();
      final d = (r['dir'] as List).map(_d).toList();
      final hit = raycastVoxels(
        world,
        o[0],
        o[1],
        o[2],
        d[0],
        d[1],
        d[2],
        _d(r['maxDist']),
        ignoreWater: r['ignoreWater'] as bool,
      );
      final want = r['hit'] as List?;
      final label =
          'ray from $o along $d (max ${r['maxDist']}, water ${r['ignoreWater']})';
      if (want == null) {
        expect(hit, isNull, reason: '$label should miss');
        continue;
      }
      expect(hit, isNotNull, reason: '$label should hit');
      hits++;
      expect(
        [hit!.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.distance, hit.block],
        [
          want[0],
          want[1],
          want[2],
          want[3],
          want[4],
          want[5],
          _d(want[6]),
          want[7],
        ],
        reason: label,
      );
    }
    expect(hits, greaterThan(50));
  });

  test('the player controller replays walk.json tick for tick', () {
    final f = _load('walk.json');
    final (world, terrain) = _streamed(f['seed'] as int, f['radius'] as int);
    final spawn = f['spawn'] as Map;
    final player = PlayerController(
      world,
      _d(spawn['x']),
      _d(spawn['y']),
      _d(spawn['z']),
    )..updrafts = (x, z) => terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3);
    final dt = _d(f['dt']);
    final fields = (f['stateFields'] as List).cast<String>();
    var i = 0;
    for (final tick in (f['ticks'] as List).cast<Map>()) {
      final tp = tick['teleport'] as Map?;
      if (tp != null) player.teleport(_d(tp['x']), _d(tp['y']), _d(tp['z']));
      final look = tick['look'] as List?;
      if (look != null) player.look(_d(look[0]), _d(look[1]));
      if (tick['jump'] == true) player.queueJump();
      player.update(
        dt,
        KeySetInput((tick['keys'] as List).cast<String>().toSet()),
        frozen: tick['frozen'] == true,
      );
      final s = player.state;
      final got = [
        s.x,
        s.y,
        s.z,
        s.vx,
        s.vy,
        s.vz,
        s.yaw,
        s.pitch,
        s.onGround ? 1.0 : 0.0,
        s.stamina,
        s.sprinting ? 1.0 : 0.0,
        s.sinceSprint,
        s.inUpdraft ? 1.0 : 0.0,
      ];
      final want = (tick['state'] as List).map(_d).toList();
      for (var k = 0; k < fields.length; k++) {
        expect(
          got[k],
          want[k],
          reason: 'tick $i (${tick['keys']}) field ${fields[k]}',
        );
      }
      i++;
    }
    expect(i, greaterThan(800));
  });

  test('wrapAngle keeps the browser convention', () {
    expect(wrapAngle(0), 0);
    expect(wrapAngle(3.5), closeTo(3.5 - 2 * 3.141592653589793, 1e-12));
    expect(wrapAngle(-3.5), closeTo(-3.5 + 2 * 3.141592653589793, 1e-12));
    expect(wrapAngle(-3.141592653589793), closeTo(3.141592653589793, 1e-12));
    expect(wrapAngle(-1.5), -1.5);
  });
}
