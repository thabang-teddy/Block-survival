package com.blocksurvival.world

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.long
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPInputStream

/**
 * Spike S3 (worldgen half) / the world byte-parity contract: the Kotlin world
 * generator must reproduce `shared/fixtures/worldgen/` byte for byte — the same
 * contract `client/test/world/` enforces on the Dart port and
 * `unity-client/.../WorldGenFixtureTests.cs` on the C# port. A mismatch means
 * this client has drifted from `server/resources/js/world`, which breaks
 * cross-play.
 */
class WorldGenFixtureTest {
    private val seeds = longArrayOf(11, 1, 12345, 987654321, 2147483646)

    private val fixturesDir: File by lazy {
        File(System.getProperty("fixtures.dir") ?: "../../shared/fixtures", "worldgen")
    }

    private val cache = HashMap<String, JsonObject>()

    private fun load(name: String): JsonObject =
        cache.getOrPut(name) { Json.parseToJsonElement(File(fixturesDir, name).readText()).jsonObject }

    private fun JsonElement.d(): Double = (this as JsonPrimitive).double
    private fun JsonElement.l(): Long = (this as JsonPrimitive).long
    private fun JsonElement.i(): Int = (this as JsonPrimitive).int
    private fun JsonElement.b(): Boolean = (this as JsonPrimitive).boolean

    private fun sha256Hex(bytes: ByteArray): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes)
        return hash.joinToString("") { "%02x".format(it) }
    }

    private fun gunzip(gz: ByteArray): ByteArray =
        GZIPInputStream(ByteArrayInputStream(gz)).use { it.readBytes() }

    private fun check(failures: MutableList<String>, label: String, cond: Boolean) {
        if (!cond) failures.add(label)
    }

    private fun report(name: String, total: Int, failures: List<String>) {
        println("$name: ${total - failures.size}/$total checks passed")
        assertTrue("$name failures:\n" + failures.take(25).joinToString("\n"), failures.isEmpty())
    }

    // ------------------------------------------------------------- primitives

    @Test
    fun rng_matches_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        val rng = load("primitives.json")["rng"]!!.jsonObject
        for ((seedStr, values) in rng) {
            val next = createRng(seedStr.toLong())
            for (expected in values.jsonArray) {
                total++
                check(failures, "rng seed $seedStr", next() == expected.d())
            }
        }
        report("rng", total, failures)
    }

    @Test
    fun hashInt_matches_fixture() {
        val failures = ArrayList<String>()
        val rows = load("primitives.json")["hashInt"]!!.jsonArray
        for (row in rows) {
            val r = row.jsonArray
            val a = r[0].l(); val b = r[1].l(); val c = r[2].l(); val d = r[3].l(); val expected = r[4].l()
            check(failures, "hashInt($a,$b,$c,$d)", hashInt(a, b, c, d) == expected)
        }
        report("hashInt", rows.size, failures)
    }

    @Test
    fun perlin_matches_fixture() {
        val failures = ArrayList<String>()
        val perlinObj = load("primitives.json")["perlin"]!!.jsonObject
        val perlin = PerlinNoise(perlinObj["seed"]!!.l())
        val samples = perlinObj["samples"]!!.jsonArray
        for (row in samples) {
            val r = row.jsonArray
            val x = r[0].d(); val y = r[1].d(); val z = r[2].d(); val expected = r[3].d()
            check(failures, "perlin($x,$y,$z)=${perlin.noise(x, y, z)} want $expected", perlin.noise(x, y, z) == expected)
        }
        report("perlin", samples.size, failures)
    }

    @Test
    fun fractal2_matches_fixture() {
        val failures = ArrayList<String>()
        val n2 = fractal2(PerlinNoise(11L xor 0x5eedL))
        val rows = load("primitives.json")["fractal2"]!!.jsonArray
        for (row in rows) {
            val r = row.jsonArray
            val x = r[0].d(); val z = r[1].d(); val seed = r[2].d(); val freq = r[3].d(); val expected = r[4].d()
            check(failures, "fractal2($x,$z,$seed,$freq)=${n2(x, z, seed, freq)} want $expected", n2(x, z, seed, freq) == expected)
        }
        report("fractal2", rows.size, failures)
    }

    @Test
    fun hypot_matches_fixture() {
        val failures = ArrayList<String>()
        val rows = load("primitives.json")["hypot"]!!.jsonArray
        for (row in rows) {
            val r = row.jsonArray
            val x = r[0].d(); val z = r[1].d(); val expected = r[2].d()
            check(failures, "hypot($x,$z)=${JsMath.hypot(x, z)} want $expected", JsMath.hypot(x, z) == expected)
        }
        report("hypot", rows.size, failures)
    }

    @Test
    fun trig_matches_fixture() {
        val failures = ArrayList<String>()
        val rows = load("primitives.json")["trig"]!!.jsonArray
        for (row in rows) {
            val r = row.jsonArray
            val a = r[0].d(); val expSin = r[1].d(); val expCos = r[2].d()
            check(failures, "sin($a)=${JsMath.jsSin(a)} want $expSin", JsMath.jsSin(a) == expSin)
            check(failures, "cos($a)=${JsMath.jsCos(a)} want $expCos", JsMath.jsCos(a) == expCos)
        }
        report("trig", rows.size * 2, failures)
    }

    // ------------------------------------------------------------- per-seed

    @Test
    fun spawn_and_padHeight_match_fixture() {
        val failures = ArrayList<String>()
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val gen = TerrainGenerator(seed)
            val ground = GroundModel(seed)
            val spawn = gen.spawn()
            val s = fx["spawn"]!!.jsonObject
            check(failures, "spawn.x seed $seed", s["x"]!!.d() == spawn.x)
            check(failures, "spawn.y seed $seed", s["y"]!!.d() == spawn.y)
            check(failures, "spawn.z seed $seed", s["z"]!!.d() == spawn.z)
            check(failures, "padHeight seed $seed", fx["padHeight"]!!.l().toInt() == ground.padHeight)
        }
        report("spawn+padHeight", seeds.size * 4, failures)
    }

    @Test
    fun heights_and_naturalHeights_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val ground = GroundModel(seed)
            for (row in fx["heights"]!!.jsonArray) {
                val r = row.jsonArray
                total++
                check(failures, "height(${r[0].i()},${r[1].i()}) seed $seed", r[2].i() == ground.height(r[0].i(), r[1].i()))
            }
            for (row in fx["naturalHeights"]!!.jsonArray) {
                val r = row.jsonArray
                total++
                check(failures, "naturalHeight(${r[0].i()},${r[1].i()}) seed $seed", r[2].i() == ground.naturalHeight(r[0].i(), r[1].i()))
            }
        }
        report("heights+naturalHeights", total, failures)
    }

    @Test
    fun trees_match_fixture() {
        val failures = ArrayList<String>()
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val ground = GroundModel(seed)
            val expected = fx["trees"]!!.jsonArray.map { val r = it.jsonArray; Triple(r[0].i(), r[1].i(), r[2].i()) }
            val actual = ArrayList<Triple<Int, Int, Int>>()
            for (x in -64 until 64) {
                for (z in -64 until 64) {
                    val h = ground.treeHeight(x, z, ground::height)
                    if (h != 0) actual.add(Triple(x, z, h))
                }
            }
            check(failures, "trees seed $seed (${actual.size} vs ${expected.size})", actual == expected)
        }
        report("trees", seeds.size, failures)
    }

    @Test
    fun islands_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            for (entry in fx["islands"]!!.jsonArray) {
                val e = entry.jsonObject
                val ix = e["ix"]!!.i(); val iz = e["iz"]!!.i()
                val expected = e["island"]
                val actual = islandAtCell(seed, ix, iz)
                total++
                if (expected == null || expected is JsonNull) {
                    check(failures, "island($ix,$iz) seed $seed should be null", actual == null)
                    continue
                }
                val exp = expected.jsonObject
                if (actual == null) {
                    failures.add("island($ix,$iz) seed $seed unexpectedly null")
                    continue
                }
                val p = exp["params"]!!.jsonObject
                val ok = exp["x"]!!.i() == actual.x && exp["z"]!!.i() == actual.z && exp["baseY"]!!.i() == actual.baseY &&
                    p["size"]!!.i() == actual.params.size && p["seed"]!!.l() == actual.params.seed &&
                    p["maxHeight"]!!.i() == actual.params.maxHeight && p["depth"]!!.i() == actual.params.depth &&
                    p["padRadius"]!!.i() == actual.params.padRadius && p["lake"]!!.b() == actual.params.lake &&
                    p["treeDensity"]!!.d() == actual.params.treeDensity
                check(failures, "island($ix,$iz) seed $seed fields", ok)
            }
        }
        report("islands", total, failures)
    }

    @Test
    fun templates_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val templates = IslandTemplates()
            for (entry in fx["templates"]!!.jsonArray) {
                val e = entry.jsonObject
                val ix = e["ix"]!!.i(); val iz = e["iz"]!!.i()
                val island = islandAtCell(seed, ix, iz)
                total++
                if (island == null) {
                    failures.add("template island($ix,$iz) seed $seed null")
                    continue
                }
                val t = templates.get(island)
                val boundsOk = e["minX"]!!.i() == t.minX && e["minY"]!!.i() == t.minY && e["minZ"]!!.i() == t.minZ &&
                    e["maxX"]!!.i() == t.maxX && e["maxY"]!!.i() == t.maxY && e["maxZ"]!!.i() == t.maxZ &&
                    e["padHeight"]!!.i() == t.padHeight && e["voxelCount"]!!.i() == t.voxelCount
                // re-read through the public accessor in the order the dump script hashed it
                val ext = t.ext
                val yLo = t.yLo
                val yHi = t.yHi
                val bytes = ByteArray((ext * 2 + 1) * (yHi - yLo + 1) * (ext * 2 + 1))
                var i = 0
                for (z in -ext..ext) {
                    for (y in yLo..yHi) {
                        for (x in -ext..ext) {
                            bytes[i++] = t.get(x, y, z).toByte()
                        }
                    }
                }
                check(failures, "template($ix,$iz) seed $seed bounds", boundsOk)
                check(failures, "template($ix,$iz) seed $seed sha256", (e["sha256"] as JsonPrimitive).content == sha256Hex(bytes))
            }
        }
        report("templates", total * 2, failures)
    }

    @Test
    fun updrafts_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val gen = TerrainGenerator(seed)
            for (entry in fx["updrafts"]!!.jsonArray) {
                val e = entry.jsonObject
                val island = islandAtCell(seed, e["ix"]!!.i(), e["iz"]!!.i())
                total++
                if (island == null) {
                    failures.add("updraft island null seed $seed")
                    continue
                }
                val u = gen.updraftOf(island)
                val ok = e["x"]!!.d() == u.x && e["z"]!!.d() == u.z && e["bottomY"]!!.i() == u.bottomY &&
                    e["topY"]!!.i() == u.topY && e["radius"]!!.d() == u.radius
                check(failures, "updraft(${e["ix"]!!.i()},${e["iz"]!!.i()}) seed $seed", ok)
            }
        }
        report("updrafts", total, failures)
    }

    @Test
    fun updraftsNear_match_fixture() {
        val failures = ArrayList<String>()
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val gen = TerrainGenerator(seed)
            val expected = fx["updraftsNear"]!!.jsonArray.map {
                val e = it.jsonObject
                listOf(e["x"]!!.d(), e["z"]!!.d(), e["bottomY"]!!.d(), e["topY"]!!.d(), e["radius"]!!.d(), e["ix"]!!.d(), e["iz"]!!.d())
            }.sortedWith(compareBy({ it[5] }, { it[6] }))
            val actual = gen.updraftsNear(-160.0, -160.0, 159.0, 159.0).map {
                listOf(it.x, it.z, it.bottomY.toDouble(), it.topY.toDouble(), it.radius, it.ix.toDouble(), it.iz.toDouble())
            }.sortedWith(compareBy({ it[5] }, { it[6] }))
            check(failures, "updraftsNear seed $seed (${actual.size} vs ${expected.size})", actual == expected)
        }
        report("updraftsNear", seeds.size, failures)
    }

    @Test
    fun islandsNear_match_fixture() {
        val failures = ArrayList<String>()
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val expected = fx["islandsNear"]!!.jsonArray.map { val r = it.jsonArray; r[0].i() to r[1].i() }
                .sortedWith(compareBy({ it.first }, { it.second }))
            val actual = islandsNear(seed, -100.0, -100.0, 100.0, 100.0).map { it.ix to it.iz }
                .sortedWith(compareBy({ it.first }, { it.second }))
            check(failures, "islandsNear seed $seed (${actual.size} vs ${expected.size})", actual == expected)
        }
        report("islandsNear", seeds.size, failures)
    }

    @Test
    fun underground_caves_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val caves = CaveModel(seed, (PAD_RADIUS + PAD_BLEND).toDouble())
            for (row in fx["underground"]!!.jsonObject["caves"]!!.jsonArray) {
                val r = row.jsonArray
                total++
                val got = caves.open(r[0].i(), r[1].i(), r[2].i(), r[3].i())
                check(failures, "cave(${r[0].i()},${r[1].i()},${r[2].i()},${r[3].i()}) seed $seed", r[4].b() == got)
            }
        }
        report("caves", total, failures)
    }

    @Test
    fun underground_veins_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val field = VeinField(seed)
            for (entry in fx["underground"]!!.jsonObject["veins"]!!.jsonArray) {
                val e = entry.jsonObject
                val gx = e["gx"]!!.l(); val gy = e["gy"]!!.l(); val gz = e["gz"]!!.l()
                val expected = e["vein"]
                val actual = field.inCell(gx, gy, gz)
                total++
                if (expected == null || expected is JsonNull) {
                    check(failures, "vein($gx,$gy,$gz) seed $seed should be null", actual == null)
                    continue
                }
                val exp = expected.jsonObject
                if (actual == null) {
                    failures.add("vein($gx,$gy,$gz) seed $seed unexpectedly null")
                    continue
                }
                val expectedOffsets = exp["offsets"]!!.jsonArray.map { it.i().toByte() }.toByteArray()
                val ok = exp["block"]!!.i() == actual.ore.block && exp["x"]!!.i() == actual.x &&
                    exp["y"]!!.i() == actual.y && exp["z"]!!.i() == actual.z && expectedOffsets.contentEquals(actual.offsets)
                check(failures, "vein($gx,$gy,$gz) seed $seed", ok)
            }
        }
        report("veins", total, failures)
    }

    @Test
    fun chunks_match_fixture() {
        val failures = ArrayList<String>()
        var total = 0
        for (seed in seeds) {
            val fx = load("seed-$seed.json")
            val gen = TerrainGenerator(seed)
            for (entry in fx["chunks"]!!.jsonArray) {
                val e = entry.jsonObject
                val cx = e["cx"]!!.i(); val cy = e["cy"]!!.i(); val cz = e["cz"]!!.i()
                val shaToken = e["sha256"]
                val data = gen.generateChunk(cx, cy, cz)
                total++
                if (shaToken == null || shaToken is JsonNull) {
                    check(failures, "chunk($cx,$cy,$cz) seed $seed should be empty", data == null)
                    continue
                }
                if (data == null) {
                    failures.add("chunk($cx,$cy,$cz) seed $seed unexpectedly empty")
                    continue
                }
                val expectedSha = (shaToken as JsonPrimitive).content
                check(failures, "chunk($cx,$cy,$cz) seed $seed sha256", expectedSha == sha256Hex(data))
                val packed = e["data"]
                if (packed != null && packed !is JsonNull) {
                    val expectedBytes = gunzip(Base64.getDecoder().decode((packed as JsonPrimitive).content))
                    check(failures, "chunk($cx,$cy,$cz) seed $seed bytes", expectedBytes.contentEquals(data))
                }
            }
        }
        report("chunks", total, failures)
    }
}
