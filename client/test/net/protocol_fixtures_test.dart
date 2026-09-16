/// Wire-protocol contract with the browser client: every message in
/// shared/fixtures/protocol/messages.json (packed by msgpackr) must decode to
/// the same value here, and re-encode to the same bytes.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:block_survival/net/msgpack.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _load() {
  for (final p in [
    '../shared/fixtures/protocol/messages.json',
    'shared/fixtures/protocol/messages.json',
  ]) {
    final f = File(p);
    if (f.existsSync()) {
      return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
    }
  }
  throw StateError('protocol fixtures not found from ${Directory.current}');
}

/// JSON gives ints for integral numbers; the wire does the same
Object? _normalise(Object? v) => switch (v) {
  Map m => {for (final e in m.entries) e.key as String: _normalise(e.value)},
  List l => l.map(_normalise).toList(),
  double d when d == d.truncateToDouble() => d.toInt(),
  _ => v,
};

void main() {
  final fixtures = _load();

  test('protocol constants match', () {
    expect(fixtures['version'], protocolVersion);
    final c = fixtures['constants'] as Map;
    expect(c['INPUT_HZ'], inputHz);
    expect(c['SNAPSHOT_HZ'], snapshotHz);
    expect(c['INTERPOLATION_DELAY'], interpolationDelay);
    expect(c['MAX_PLAYERS'], maxPlayers);
    expect(c['ROOM_CODE_LENGTH'], roomCodeLength);
  });

  for (final row in (fixtures['messages'] as List).cast<Map>()) {
    final name = '${row['side']}/${row['name']}';
    final bytes = base64Decode(row['base64'] as String);
    final expected = _normalise(row['message']);

    test(
      '$name: msgpack decodes to the message and re-encodes identically',
      () {
        final decoded = msgpackDecode(bytes);
        expect(_normalise(decoded), expected);
        expect(msgpackEncode(decoded), bytes, reason: 'raw map re-encode');
      },
    );

    test('$name: typed message round-trips byte for byte', () {
      final Uint8List again;
      if (row['side'] == 'client') {
        final m = decodeClient(bytes);
        again = encodeClient(m);
      } else {
        final m = decodeHost(bytes);
        again = encodeHost(m);
      }
      expect(again, bytes);
    });
  }

  test('msgpack covers the formats the browser might emit', () {
    final sample = <String, Object?>{
      'neg': -1000000,
      'big': 1 << 40,
      'u8': 200,
      'u16': 65000,
      'i8': -100,
      'i16': -30000,
      'f': 1.5,
      'long': 'x' * 300,
      'bin': Uint8List.fromList([1, 2, 3]),
      'arr16': List.filled(20, 1),
      'nested': {
        'a': [null, true, false],
      },
    };
    final out = msgpackDecode(msgpackEncode(sample)) as Map;
    expect(out['neg'], -1000000);
    expect(out['big'], 1 << 40);
    expect(out['u8'], 200);
    expect(out['u16'], 65000);
    expect(out['i8'], -100);
    expect(out['i16'], -30000);
    expect(out['f'], 1.5);
    expect(out['long'], 'x' * 300);
    expect(out['bin'], [1, 2, 3]);
    expect((out['arr16'] as List).length, 20);
    expect((out['nested'] as Map)['a'], [null, true, false]);
    // standard fixmap input (not msgpackr's map16) is accepted too
    expect(
      msgpackDecode(
        Uint8List.fromList([0x81, 0xa1, 0x74, 0xa3, 0x62, 0x79, 0x65]),
      ),
      {'t': 'bye'},
    );
    expect(
      () => msgpackDecode(Uint8List.fromList([0xde, 0x00])),
      throwsA(isA<MsgpackError>()),
    );
  });

  test('room codes match the browser rules', () {
    expect(isRoomCode('ABCDEF'), isTrue);
    expect(isRoomCode('ABCDEI'), isFalse, reason: 'no I');
    expect(isRoomCode('ABCDE'), isFalse);
    expect(normalizeRoomCode(' ab-cd ef gh '), 'ABCDEF');
    expect(isRoomCode(makeRoomCode()), isTrue);
  });
}
