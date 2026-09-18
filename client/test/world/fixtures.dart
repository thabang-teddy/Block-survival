/// Loads `shared/fixtures/worldgen/` — the contract between the TypeScript and
/// Dart world generators. Regenerate with `npm run fixtures:worldgen` in server/.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// `flutter test` runs with the package root as cwd; CI checks out the monorepo
Directory fixtureDir() {
  for (final candidate in [
    '../shared/fixtures/worldgen',
    'shared/fixtures/worldgen',
  ]) {
    final dir = Directory(candidate);
    if (dir.existsSync()) return dir;
  }
  throw StateError(
    'shared/fixtures/worldgen not found from ${Directory.current.path}',
  );
}

Map<String, dynamic> loadJson(String name) =>
    jsonDecode(File('${fixtureDir().path}/$name').readAsStringSync())
        as Map<String, dynamic>;

List<int> seedsInManifest() =>
    (loadJson('manifest.json')['seeds'] as List).cast<int>();

Uint8List? unpackChunk(String? packed) => packed == null
    ? null
    : Uint8List.fromList(gzip.decode(base64Decode(packed)));

String sha256Hex(List<int> bytes) => sha256.convert(bytes).toString();

/// JSON numbers come back as int or double; the generator wants a double
double num2d(Object? v) => (v as num).toDouble();
