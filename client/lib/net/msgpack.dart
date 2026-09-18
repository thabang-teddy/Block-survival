/// MessagePack, encoded the way msgpackr's `pack()` does in the browser client
/// (see shared/fixtures/protocol/messages.json): maps always as map16, numbers
/// as the smallest int form when integral and float64 otherwise, strings UTF-8.
/// Decoding accepts the whole standard format.
library;

import 'dart:convert';
import 'dart:typed_data';

final class MsgpackError extends FormatException {
  const MsgpackError(super.message);
}

Uint8List msgpackEncode(Object? value) {
  final w = _Writer();
  w.write(value);
  return w.bytes;
}

Object? msgpackDecode(Uint8List bytes) {
  final r = _Reader(bytes);
  final v = r.read();
  if (r.offset != bytes.length) {
    throw MsgpackError('trailing bytes after message');
  }
  return v;
}

final class _Writer {
  // copies each chunk: the scratch views below are reused per write
  final BytesBuilder _out = BytesBuilder();
  final ByteData _scratch = ByteData(8);

  Uint8List get bytes => _out.toBytes();

  void _u8(int v) => _out.addByte(v);

  void _u16(int v) {
    _scratch.setUint16(0, v);
    _out.add(Uint8List.sublistView(_scratch, 0, 2));
  }

  void _u32(int v) {
    _scratch.setUint32(0, v);
    _out.add(Uint8List.sublistView(_scratch, 0, 4));
  }

  void _i64(int v) {
    _scratch.setInt64(0, v);
    _out.add(Uint8List.sublistView(_scratch, 0, 8));
  }

  void write(Object? v) {
    switch (v) {
      case null:
        _u8(0xc0);
      case bool b:
        _u8(b ? 0xc3 : 0xc2);
      case int i:
        _int(i);
      case double d:
        // msgpackr packs integral doubles as ints (JS has one number type)
        if (d.isFinite &&
            d == d.truncateToDouble() &&
            d.abs() < 9007199254740992) {
          _int(d.toInt());
        } else {
          _u8(0xcb);
          _scratch.setFloat64(0, d);
          _out.add(Uint8List.sublistView(_scratch, 0, 8));
        }
      case String s:
        _string(s);
      case Uint8List b:
        // a Uint8Array in the browser: bin, never an array of ints
        _bin(b);
      case Map m:
        // msgpackr always writes objects as map16
        if (m.length > 0xffff) throw const MsgpackError('map too large');
        _u8(0xde);
        _u16(m.length);
        for (final e in m.entries) {
          write(e.key);
          write(e.value);
        }
      case List l:
        _arrayHeader(l.length);
        for (final e in l) {
          write(e);
        }
      default:
        throw MsgpackError('cannot pack ${v.runtimeType}');
    }
  }

  void _int(int i) {
    if (i >= 0) {
      if (i < 0x80) {
        _u8(i);
      } else if (i < 0x100) {
        _u8(0xcc);
        _u8(i);
      } else if (i < 0x10000) {
        _u8(0xcd);
        _u16(i);
      } else if (i < 0x100000000) {
        _u8(0xce);
        _u32(i);
      } else {
        _u8(0xcf);
        _i64(i);
      }
    } else {
      if (i >= -0x20) {
        _u8(i & 0xff);
      } else if (i >= -0x80) {
        _u8(0xd0);
        _u8(i & 0xff);
      } else if (i >= -0x8000) {
        _u8(0xd1);
        _u16(i & 0xffff);
      } else if (i >= -0x80000000) {
        _u8(0xd2);
        _u32(i & 0xffffffff);
      } else {
        _u8(0xd3);
        _i64(i);
      }
    }
  }

  void _string(String s) {
    final b = utf8.encode(s);
    final n = b.length;
    if (n < 32) {
      _u8(0xa0 | n);
    } else if (n < 0x100) {
      _u8(0xd9);
      _u8(n);
    } else if (n < 0x10000) {
      _u8(0xda);
      _u16(n);
    } else {
      _u8(0xdb);
      _u32(n);
    }
    _out.add(b);
  }

  void _bin(Uint8List b) {
    final n = b.length;
    if (n < 0x100) {
      _u8(0xc4);
      _u8(n);
    } else if (n < 0x10000) {
      _u8(0xc5);
      _u16(n);
    } else {
      _u8(0xc6);
      _u32(n);
    }
    _out.add(b);
  }

  void _arrayHeader(int n) {
    if (n < 16) {
      _u8(0x90 | n);
    } else if (n < 0x10000) {
      _u8(0xdc);
      _u16(n);
    } else {
      _u8(0xdd);
      _u32(n);
    }
  }
}

final class _Reader {
  _Reader(this._bytes) : _data = ByteData.sublistView(_bytes);

  final Uint8List _bytes;
  final ByteData _data;
  int offset = 0;

  int _u8() {
    if (offset >= _bytes.length) throw const MsgpackError('unexpected end');
    return _bytes[offset++];
  }

  int _u16() {
    _need(2);
    final v = _data.getUint16(offset);
    offset += 2;
    return v;
  }

  int _u32() {
    _need(4);
    final v = _data.getUint32(offset);
    offset += 4;
    return v;
  }

  void _need(int n) {
    if (offset + n > _bytes.length) throw const MsgpackError('unexpected end');
  }

  Object? read() {
    final b = _u8();
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if (b & 0xe0 == 0xa0) return _str(b & 0x1f);
    if (b & 0xf0 == 0x90) return _array(b & 0x0f);
    if (b & 0xf0 == 0x80) return _map(b & 0x0f);
    switch (b) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return _bin(_u8());
      case 0xc5:
        return _bin(_u16());
      case 0xc6:
        return _bin(_u32());
      case 0xca:
        _need(4);
        final v = _data.getFloat32(offset);
        offset += 4;
        return v;
      case 0xcb:
        _need(8);
        final v = _data.getFloat64(offset);
        offset += 8;
        return v;
      case 0xcc:
        return _u8();
      case 0xcd:
        return _u16();
      case 0xce:
        return _u32();
      case 0xcf:
        _need(8);
        final v = _data.getUint64(offset);
        offset += 8;
        return v;
      case 0xd0:
        _need(1);
        return _data.getInt8(offset++);
      case 0xd1:
        _need(2);
        final v = _data.getInt16(offset);
        offset += 2;
        return v;
      case 0xd2:
        _need(4);
        final v = _data.getInt32(offset);
        offset += 4;
        return v;
      case 0xd3:
        _need(8);
        final v = _data.getInt64(offset);
        offset += 8;
        return v;
      case 0xd9:
        return _str(_u8());
      case 0xda:
        return _str(_u16());
      case 0xdb:
        return _str(_u32());
      case 0xdc:
        return _array(_u16());
      case 0xdd:
        return _array(_u32());
      case 0xde:
        return _map(_u16());
      case 0xdf:
        return _map(_u32());
      default:
        throw MsgpackError('unsupported type byte 0x${b.toRadixString(16)}');
    }
  }

  String _str(int n) {
    _need(n);
    final s = utf8.decode(Uint8List.sublistView(_bytes, offset, offset + n));
    offset += n;
    return s;
  }

  Uint8List _bin(int n) {
    _need(n);
    final b = Uint8List.fromList(
      Uint8List.sublistView(_bytes, offset, offset + n),
    );
    offset += n;
    return b;
  }

  List<Object?> _array(int n) => List.generate(n, (_) => read());

  Map<String, Object?> _map(int n) {
    final m = <String, Object?>{};
    for (var i = 0; i < n; i++) {
      final k = read();
      if (k is! String) throw const MsgpackError('map keys must be strings');
      m[k] = read();
    }
    return m;
  }
}
