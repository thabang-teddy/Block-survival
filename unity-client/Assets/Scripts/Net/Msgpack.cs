using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace BlockSurvival.Net
{
    /// MessagePack, encoded the way msgpackr's <c>pack()</c> does in the browser
    /// client (see <c>shared/fixtures/protocol/messages.json</c>): maps always as
    /// map16, numbers as the smallest int form when integral and float64
    /// otherwise, strings UTF-8. Decoding accepts the whole standard format.
    /// Twin of <c>client/lib/net/msgpack.dart</c>.
    public sealed class MsgpackError : Exception
    {
        public MsgpackError(string message) : base(message)
        {
        }
    }

    /// An insertion-ordered string-keyed map — msgpack map key order is part of
    /// the wire bytes, and a plain `Dictionary&lt;,&gt;`'s enumeration order is an
    /// implementation detail, not a guarantee, so this type makes the ordering
    /// explicit instead of relying on it.
    public sealed class MsgpackMap
    {
        private readonly List<KeyValuePair<string, object>> _entries = new List<KeyValuePair<string, object>>();

        public int Count => _entries.Count;

        public IReadOnlyList<KeyValuePair<string, object>> Entries => _entries;

        public void Add(string key, object value) => _entries.Add(new KeyValuePair<string, object>(key, value));

        public bool TryGet(string key, out object value)
        {
            foreach (var e in _entries)
            {
                if (e.Key == key)
                {
                    value = e.Value;
                    return true;
                }
            }
            value = null;
            return false;
        }
    }

    public static class Msgpack
    {
        public static byte[] Encode(object value)
        {
            var w = new Writer();
            w.Write(value);
            return w.ToBytes();
        }

        public static object Decode(byte[] bytes)
        {
            var r = new Reader(bytes);
            var v = r.Read();
            if (r.Offset != bytes.Length)
            {
                throw new MsgpackError("trailing bytes after message");
            }
            return v;
        }

        private sealed class Writer
        {
            private readonly MemoryStream _out = new MemoryStream();

            public byte[] ToBytes() => _out.ToArray();

            private void U8(int v) => _out.WriteByte((byte)v);

            private void U16(int v)
            {
                _out.WriteByte((byte)((v >> 8) & 0xff));
                _out.WriteByte((byte)(v & 0xff));
            }

            private void U32(long v)
            {
                _out.WriteByte((byte)((v >> 24) & 0xff));
                _out.WriteByte((byte)((v >> 16) & 0xff));
                _out.WriteByte((byte)((v >> 8) & 0xff));
                _out.WriteByte((byte)(v & 0xff));
            }

            private void I64(long v)
            {
                for (var shift = 56; shift >= 0; shift -= 8)
                {
                    _out.WriteByte((byte)((v >> shift) & 0xff));
                }
            }

            private void F64(double v)
            {
                var bits = BitConverter.DoubleToInt64Bits(v);
                I64(bits);
            }

            public void Write(object v)
            {
                switch (v)
                {
                    case null:
                        U8(0xc0);
                        break;
                    case bool b:
                        U8(b ? 0xc3 : 0xc2);
                        break;
                    case long i:
                        WriteInt(i);
                        break;
                    case int i32:
                        WriteInt(i32);
                        break;
                    case double d:
                        // msgpackr packs integral doubles as ints (JS has one number type)
                        if (!double.IsNaN(d) && !double.IsInfinity(d) &&
                            d == Math.Truncate(d) && Math.Abs(d) < 9007199254740992.0)
                        {
                            WriteInt((long)d);
                        }
                        else
                        {
                            U8(0xcb);
                            F64(d);
                        }
                        break;
                    case string s:
                        WriteString(s);
                        break;
                    case byte[] bin:
                        // a Uint8Array in the browser: bin, never an array of ints
                        WriteBin(bin);
                        break;
                    case MsgpackMap m:
                        // msgpackr always writes objects as map16
                        if (m.Count > 0xffff) throw new MsgpackError("map too large");
                        U8(0xde);
                        U16(m.Count);
                        foreach (var e in m.Entries)
                        {
                            Write(e.Key);
                            Write(e.Value);
                        }
                        break;
                    case System.Collections.IEnumerable list:
                        var items = new List<object>();
                        foreach (var item in list) items.Add(item);
                        WriteArrayHeader(items.Count);
                        foreach (var item in items) Write(item);
                        break;
                    default:
                        throw new MsgpackError($"cannot pack {v.GetType()}");
                }
            }

            private void WriteInt(long i)
            {
                if (i >= 0)
                {
                    if (i < 0x80) U8((int)i);
                    else if (i < 0x100) { U8(0xcc); U8((int)i); }
                    else if (i < 0x10000) { U8(0xcd); U16((int)i); }
                    else if (i < 0x100000000L) { U8(0xce); U32(i); }
                    else { U8(0xcf); I64(i); }
                }
                else
                {
                    if (i >= -0x20) U8((int)(i & 0xff));
                    else if (i >= -0x80) { U8(0xd0); U8((int)(i & 0xff)); }
                    else if (i >= -0x8000) { U8(0xd1); U16((int)(i & 0xffff)); }
                    else if (i >= -0x80000000L) { U8(0xd2); U32(i & 0xffffffffL); }
                    else { U8(0xd3); I64(i); }
                }
            }

            private void WriteString(string s)
            {
                var b = Encoding.UTF8.GetBytes(s);
                var n = b.Length;
                if (n < 32) U8(0xa0 | n);
                else if (n < 0x100) { U8(0xd9); U8(n); }
                else if (n < 0x10000) { U8(0xda); U16(n); }
                else { U8(0xdb); U32(n); }
                _out.Write(b, 0, b.Length);
            }

            private void WriteBin(byte[] b)
            {
                var n = b.Length;
                if (n < 0x100) { U8(0xc4); U8(n); }
                else if (n < 0x10000) { U8(0xc5); U16(n); }
                else { U8(0xc6); U32(n); }
                _out.Write(b, 0, b.Length);
            }

            private void WriteArrayHeader(int n)
            {
                if (n < 16) U8(0x90 | n);
                else if (n < 0x10000) { U8(0xdc); U16(n); }
                else { U8(0xdd); U32(n); }
            }
        }

        private sealed class Reader
        {
            private readonly byte[] _bytes;
            public int Offset;

            public Reader(byte[] bytes) => _bytes = bytes;

            private int U8()
            {
                if (Offset >= _bytes.Length) throw new MsgpackError("unexpected end");
                return _bytes[Offset++];
            }

            private int U16()
            {
                Need(2);
                var v = (_bytes[Offset] << 8) | _bytes[Offset + 1];
                Offset += 2;
                return v;
            }

            private long U32()
            {
                Need(4);
                long v = ((long)_bytes[Offset] << 24) | ((long)_bytes[Offset + 1] << 16) |
                          ((long)_bytes[Offset + 2] << 8) | _bytes[Offset + 3];
                Offset += 4;
                return v;
            }

            private long I64Raw()
            {
                Need(8);
                long v = 0;
                for (var k = 0; k < 8; k++) v = (v << 8) | _bytes[Offset + k];
                Offset += 8;
                return v;
            }

            private void Need(int n)
            {
                if (Offset + n > _bytes.Length) throw new MsgpackError("unexpected end");
            }

            public object Read()
            {
                var b = U8();
                if (b <= 0x7f) return (long)b;
                if (b >= 0xe0) return (long)(b - 0x100);
                if ((b & 0xe0) == 0xa0) return ReadStr(b & 0x1f);
                if ((b & 0xf0) == 0x90) return ReadArray(b & 0x0f);
                if ((b & 0xf0) == 0x80) return ReadMap(b & 0x0f);
                switch (b)
                {
                    case 0xc0: return null;
                    case 0xc2: return false;
                    case 0xc3: return true;
                    case 0xc4: return ReadBin(U8());
                    case 0xc5: return ReadBin(U16());
                    case 0xc6: return ReadBin((int)U32());
                    case 0xca:
                    {
                        Need(4);
                        var bits = ((long)_bytes[Offset] << 24) | ((long)_bytes[Offset + 1] << 16) |
                                   ((long)_bytes[Offset + 2] << 8) | _bytes[Offset + 3];
                        Offset += 4;
                        return (double)BitConverter.Int32BitsToSingle((int)bits);
                    }
                    case 0xcb:
                    {
                        var bits = I64Raw();
                        return BitConverter.Int64BitsToDouble(bits);
                    }
                    case 0xcc: return (long)U8();
                    case 0xcd: return (long)U16();
                    case 0xce: return U32();
                    case 0xcf:
                    {
                        Need(8);
                        ulong v = 0;
                        for (var k = 0; k < 8; k++) v = (v << 8) | _bytes[Offset + k];
                        Offset += 8;
                        return unchecked((long)v);
                    }
                    case 0xd0:
                    {
                        Need(1);
                        return (long)(sbyte)_bytes[Offset++];
                    }
                    case 0xd1:
                    {
                        Need(2);
                        var v = (short)((_bytes[Offset] << 8) | _bytes[Offset + 1]);
                        Offset += 2;
                        return (long)v;
                    }
                    case 0xd2:
                    {
                        Need(4);
                        var v = (int)(((uint)_bytes[Offset] << 24) | ((uint)_bytes[Offset + 1] << 16) |
                                       ((uint)_bytes[Offset + 2] << 8) | _bytes[Offset + 3]);
                        Offset += 4;
                        return (long)v;
                    }
                    case 0xd3: return I64Raw();
                    case 0xd9: return ReadStr(U8());
                    case 0xda: return ReadStr(U16());
                    case 0xdb: return ReadStr((int)U32());
                    case 0xdc: return ReadArray(U16());
                    case 0xdd: return ReadArray((int)U32());
                    case 0xde: return ReadMap(U16());
                    case 0xdf: return ReadMap((int)U32());
                    default:
                        throw new MsgpackError($"unsupported type byte 0x{b:x2}");
                }
            }

            private string ReadStr(int n)
            {
                Need(n);
                var s = Encoding.UTF8.GetString(_bytes, Offset, n);
                Offset += n;
                return s;
            }

            private byte[] ReadBin(int n)
            {
                Need(n);
                var b = new byte[n];
                Array.Copy(_bytes, Offset, b, 0, n);
                Offset += n;
                return b;
            }

            private List<object> ReadArray(int n)
            {
                var list = new List<object>(n);
                for (var i = 0; i < n; i++) list.Add(Read());
                return list;
            }

            private MsgpackMap ReadMap(int n)
            {
                var m = new MsgpackMap();
                for (var i = 0; i < n; i++)
                {
                    var k = Read();
                    if (!(k is string key)) throw new MsgpackError("map keys must be strings");
                    m.Add(key, Read());
                }
                return m;
            }
        }
    }
}
