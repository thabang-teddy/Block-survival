package com.blocksurvival.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Base64

/**
 * Spike S2 / the net byte-parity contract: the Kotlin msgpack codec must
 * reproduce every message shape in `shared/fixtures/protocol/messages.json`
 * byte for byte — the same contract `client/test/net/` enforces on the Dart
 * port and `unity-client/.../ProtocolFixtureTests.cs` on the C# port. A
 * mismatch here means this client can't actually talk to the host / browser /
 * Flutter / Unity peers.
 */
class ProtocolFixtureTest {
    private data class Fixture(val side: String, val name: String, val message: Any?, val expected: ByteArray) {
        val key: String get() = "$side/$name"
    }

    private val fixtures: List<Fixture> by lazy { loadFixtures() }

    private fun loadFixtures(): List<Fixture> {
        val dir = System.getProperty("fixtures.dir")
            ?: File("../../shared/fixtures").absolutePath
        val file = File(dir, "protocol/messages.json")
        val root = Json.parseToJsonElement(file.readText()).jsonObject
        val messages = root["messages"]?.jsonArray ?: error("no messages array in $file")
        return messages.map { entry ->
            val obj = entry.jsonObject
            Fixture(
                side = (obj["side"] as JsonPrimitive).content,
                name = (obj["name"] as JsonPrimitive).content,
                message = fromJson(obj["message"] ?: JsonNull),
                expected = Base64.getDecoder().decode((obj["base64"] as JsonPrimitive).content),
            )
        }
    }

    /** JSON → the generic msgpack value model, mirroring the C# port's FromJToken. */
    private fun fromJson(e: JsonElement): Any? = when (e) {
        is JsonNull -> null
        is JsonObject -> MsgpackMap().also { m -> e.forEach { (k, v) -> m.put(k, fromJson(v)) } }
        is JsonArray -> e.map { fromJson(it) }
        is JsonPrimitive -> when {
            e.isString -> e.content
            else -> e.booleanOrNull ?: run {
                val c = e.content
                // Json.NET classifies Integer vs Float by the literal; a JS number
                // serialized to JSON has a '.'/'e'/'E' only when it is non-integral.
                if (c.contains('.') || c.contains('e') || c.contains('E')) c.toDouble() else c.toLong()
            }
        }
    }

    private fun valuesEqual(a: Any?, b: Any?): Boolean {
        if (a == null || b == null) return a == null && b == null
        return when (a) {
            is Long -> b is Long && a == b
            is Double -> b is Double && a.equals(b) // bit-based, like the C# port
            is String -> b is String && a == b
            is Boolean -> b is Boolean && a == b
            is ByteArray -> b is ByteArray && a.contentEquals(b)
            is List<*> -> b is List<*> && a.size == b.size && a.indices.all { valuesEqual(a[it], b[it]) }
            is MsgpackMap -> b is MsgpackMap && a.size == b.size &&
                a.entries.indices.all {
                    a.entries[it].first == b.entries[it].first &&
                        valuesEqual(a.entries[it].second, b.entries[it].second)
                }
            else -> false
        }
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString(" ") { "%02x".format(it) }

    @Test
    fun encode_matches_fixture_bytes() {
        val failures = fixtures.mapNotNull { fx ->
            val actual = Msgpack.encode(fx.message)
            if (actual.contentEquals(fx.expected)) null
            else "${fx.key}\n  expected: ${hex(fx.expected)}\n  actual:   ${hex(actual)}"
        }
        println("encode: ${fixtures.size - failures.size}/${fixtures.size} messages byte-identical")
        assertTrue("encode mismatches:\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    @Test
    fun decode_matches_fixture_message() {
        val failures = fixtures.mapNotNull { fx ->
            val decoded = Msgpack.decode(fx.expected)
            if (valuesEqual(fx.message, decoded)) null else "${fx.key}: decoded value != fixture message"
        }
        println("decode: ${fixtures.size - failures.size}/${fixtures.size} messages match")
        assertTrue("decode mismatches:\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    @Test
    fun decode_then_reencode_is_byte_identical() {
        val failures = fixtures.mapNotNull { fx ->
            val reencoded = Msgpack.encode(Msgpack.decode(fx.expected))
            if (reencoded.contentEquals(fx.expected)) null else "${fx.key}: round-trip re-encode drifted"
        }
        println("round-trip: ${fixtures.size - failures.size}/${fixtures.size} messages byte-identical")
        assertTrue("round-trip mismatches:\n${failures.joinToString("\n")}", failures.isEmpty())
    }
}
