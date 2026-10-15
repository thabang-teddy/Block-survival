package com.blocksurvival.net

import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.truncate

/**
 * MessagePack, encoded the way msgpackr's `pack()` does in the browser client
 * (see `shared/fixtures/protocol/messages.json`): maps always as map16, numbers
 * as the smallest int form when integral and float64 otherwise, strings UTF-8.
 * Decoding accepts the whole standard format.
 *
 * Direct port of `client/lib/net/msgpack.dart` (twin of the Unity port's
 * `unity-client/.../Net/Msgpack.cs`). The value model is deliberately generic —
 * `null` / [Boolean] / [Long] / [Double] / [String] / [ByteArray] /
 * `List<Any?>` / [MsgpackMap] — not typed message classes, so byte parity is
 * provable against the fixtures before any protocol ergonomics are layered on.
 */
class MsgpackError(message: String) : RuntimeException(message)

/**
 * An insertion-ordered string-keyed map. msgpack map key order is part of the
 * wire bytes, so this makes the ordering explicit rather than relying on a
 * particular map implementation's enumeration order. Twin of the Dart port's
 * use of Dart's insertion-ordered `Map` and the Unity port's `MsgpackMap`.
 */
class MsgpackMap {
    private val backing = ArrayList<Pair<String, Any?>>()

    val entries: List<Pair<String, Any?>> get() = backing
    val size: Int get() = backing.size

    fun put(key: String, value: Any?): MsgpackMap {
        backing.add(key to value)
        return this
    }

    operator fun get(key: String): Any? {
        for ((k, v) in backing) if (k == key) return v
        return null
    }

    fun containsKey(key: String): Boolean = backing.any { it.first == key }

    override fun equals(other: Any?): Boolean = other is MsgpackMap && other.backing == backing

    override fun hashCode(): Int = backing.hashCode()

    override fun toString(): String =
        backing.joinToString(", ", "{", "}") { (k, v) -> "$k: $v" }
}

object Msgpack {
    fun encode(value: Any?): ByteArray {
        val w = Writer()
        w.write(value)
        return w.toBytes()
    }

    fun decode(bytes: ByteArray): Any? {
        val r = Reader(bytes)
        val v = r.read()
        if (r.offset != bytes.size) throw MsgpackError("trailing bytes after message")
        return v
    }

    private class Writer {
        private val out = ByteArrayOutputStream()

        fun toBytes(): ByteArray = out.toByteArray()

        private fun u8(v: Int) = out.write(v and 0xff)

        private fun u16(v: Int) {
            out.write((v ushr 8) and 0xff)
            out.write(v and 0xff)
        }

        private fun u32(v: Long) {
            out.write(((v ushr 24) and 0xff).toInt())
            out.write(((v ushr 16) and 0xff).toInt())
            out.write(((v ushr 8) and 0xff).toInt())
            out.write((v and 0xff).toInt())
        }

        private fun i64(v: Long) {
            var shift = 56
            while (shift >= 0) {
                out.write(((v ushr shift) and 0xff).toInt())
                shift -= 8
            }
        }

        private fun f64(v: Double) = i64(java.lang.Double.doubleToRawLongBits(v))

        fun write(v: Any?) {
            when (v) {
                null -> u8(0xc0)
                is Boolean -> u8(if (v) 0xc3 else 0xc2)
                is Long -> writeInt(v)
                is Int -> writeInt(v.toLong())
                is Short -> writeInt(v.toLong())
                is Byte -> writeInt(v.toLong())
                is Double -> writeDouble(v)
                is Float -> writeDouble(v.toDouble())
                is String -> writeString(v)
                is ByteArray -> writeBin(v) // a Uint8Array in the browser: bin, never an array of ints
                is MsgpackMap -> {
                    // msgpackr always writes objects as map16
                    if (v.size > 0xffff) throw MsgpackError("map too large")
                    u8(0xde)
                    u16(v.size)
                    for ((key, value) in v.entries) {
                        write(key)
                        write(value)
                    }
                }
                is List<*> -> {
                    writeArrayHeader(v.size)
                    for (e in v) write(e)
                }
                else -> throw MsgpackError("cannot pack ${v::class}")
            }
        }

        private fun writeDouble(d: Double) {
            // msgpackr packs integral doubles as ints (JS has one number type).
            if (d.isFinite() && d == truncate(d) && abs(d) < 9007199254740992.0) {
                writeInt(d.toLong())
            } else {
                u8(0xcb)
                f64(d)
            }
        }

        private fun writeInt(i: Long) {
            if (i >= 0) {
                when {
                    i < 0x80 -> u8(i.toInt())
                    i < 0x100 -> { u8(0xcc); u8(i.toInt()) }
                    i < 0x10000 -> { u8(0xcd); u16(i.toInt()) }
                    i < 0x100000000L -> { u8(0xce); u32(i) }
                    else -> { u8(0xcf); i64(i) }
                }
            } else {
                when {
                    i >= -0x20 -> u8((i and 0xff).toInt())
                    i >= -0x80 -> { u8(0xd0); u8((i and 0xff).toInt()) }
                    i >= -0x8000 -> { u8(0xd1); u16((i and 0xffff).toInt()) }
                    i >= -0x80000000L -> { u8(0xd2); u32(i and 0xffffffffL) }
                    else -> { u8(0xd3); i64(i) }
                }
            }
        }

        private fun writeString(s: String) {
            val b = s.toByteArray(Charsets.UTF_8)
            val n = b.size
            when {
                n < 32 -> u8(0xa0 or n)
                n < 0x100 -> { u8(0xd9); u8(n) }
                n < 0x10000 -> { u8(0xda); u16(n) }
                else -> { u8(0xdb); u32(n.toLong()) }
            }
            out.write(b)
        }

        private fun writeBin(b: ByteArray) {
            val n = b.size
            when {
                n < 0x100 -> { u8(0xc4); u8(n) }
                n < 0x10000 -> { u8(0xc5); u16(n) }
                else -> { u8(0xc6); u32(n.toLong()) }
            }
            out.write(b)
        }

        private fun writeArrayHeader(n: Int) {
            when {
                n < 16 -> u8(0x90 or n)
                n < 0x10000 -> { u8(0xdc); u16(n) }
                else -> { u8(0xdd); u32(n.toLong()) }
            }
        }
    }

    private class Reader(private val bytes: ByteArray) {
        var offset = 0

        private fun u8(): Int {
            if (offset >= bytes.size) throw MsgpackError("unexpected end")
            return bytes[offset++].toInt() and 0xff
        }

        private fun need(n: Int) {
            if (offset + n > bytes.size) throw MsgpackError("unexpected end")
        }

        private fun u16(): Int {
            need(2)
            val v = ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)
            offset += 2
            return v
        }

        private fun u32(): Long {
            need(4)
            val v = ((bytes[offset].toLong() and 0xff) shl 24) or
                ((bytes[offset + 1].toLong() and 0xff) shl 16) or
                ((bytes[offset + 2].toLong() and 0xff) shl 8) or
                (bytes[offset + 3].toLong() and 0xff)
            offset += 4
            return v
        }

        private fun i64Raw(): Long {
            need(8)
            var v = 0L
            for (k in 0 until 8) v = (v shl 8) or (bytes[offset + k].toLong() and 0xff)
            offset += 8
            return v
        }

        fun read(): Any? {
            val b = u8()
            if (b <= 0x7f) return b.toLong()
            if (b >= 0xe0) return (b - 0x100).toLong()
            if ((b and 0xe0) == 0xa0) return readStr(b and 0x1f)
            if ((b and 0xf0) == 0x90) return readArray(b and 0x0f)
            if ((b and 0xf0) == 0x80) return readMap(b and 0x0f)
            return when (b) {
                0xc0 -> null
                0xc2 -> false
                0xc3 -> true
                0xc4 -> readBin(u8())
                0xc5 -> readBin(u16())
                0xc6 -> readBin(u32().toInt())
                0xca -> {
                    need(4)
                    val bits = ((bytes[offset].toInt() and 0xff) shl 24) or
                        ((bytes[offset + 1].toInt() and 0xff) shl 16) or
                        ((bytes[offset + 2].toInt() and 0xff) shl 8) or
                        (bytes[offset + 3].toInt() and 0xff)
                    offset += 4
                    Float.fromBits(bits).toDouble()
                }
                0xcb -> Double.fromBits(i64Raw())
                0xcc -> u8().toLong()
                0xcd -> u16().toLong()
                0xce -> u32()
                0xcf -> i64Raw() // uint64 read raw; matches the Dart/C# ports' 64-bit wrap
                0xd0 -> { need(1); bytes[offset++].toLong() } // int8 (Kotlin Byte is already signed)
                0xd1 -> {
                    need(2)
                    val v = (((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)).toShort()
                    offset += 2
                    v.toLong()
                }
                0xd2 -> {
                    need(4)
                    val v = ((bytes[offset].toInt() and 0xff) shl 24) or
                        ((bytes[offset + 1].toInt() and 0xff) shl 16) or
                        ((bytes[offset + 2].toInt() and 0xff) shl 8) or
                        (bytes[offset + 3].toInt() and 0xff)
                    offset += 4
                    v.toLong()
                }
                0xd3 -> i64Raw()
                0xd9 -> readStr(u8())
                0xda -> readStr(u16())
                0xdb -> readStr(u32().toInt())
                0xdc -> readArray(u16())
                0xdd -> readArray(u32().toInt())
                0xde -> readMap(u16())
                0xdf -> readMap(u32().toInt())
                else -> throw MsgpackError("unsupported type byte 0x${b.toString(16)}")
            }
        }

        private fun readStr(n: Int): String {
            need(n)
            val s = String(bytes, offset, n, Charsets.UTF_8)
            offset += n
            return s
        }

        private fun readBin(n: Int): ByteArray {
            need(n)
            val b = bytes.copyOfRange(offset, offset + n)
            offset += n
            return b
        }

        private fun readArray(n: Int): List<Any?> {
            val list = ArrayList<Any?>(n)
            for (i in 0 until n) list.add(read())
            return list
        }

        private fun readMap(n: Int): MsgpackMap {
            val m = MsgpackMap()
            for (i in 0 until n) {
                val k = read()
                if (k !is String) throw MsgpackError("map keys must be strings")
                m.put(k, read())
            }
            return m
        }
    }
}
