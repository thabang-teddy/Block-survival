package com.blocksurvival.physics

import com.blocksurvival.world.TerrainGenerator
import com.blocksurvival.world.WORLD_CHUNKS_Y
import com.blocksurvival.world.WorldStore
import com.blocksurvival.world.raycastVoxels
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Spike S3 (physics half): the Kotlin physics / raycast port must reproduce
 * `shared/fixtures/physics/{aabb,raycast,walk}.json` tick for tick and case for
 * case — the same contract `client/test/physics/` enforces on the Dart port and
 * `unity-client/.../PhysicsFixtureTests.cs` on the C# port. A mismatch means a
 * player would see a different world shape than their peers, or walk through a
 * wall one of them sees as solid.
 */
class PhysicsFixtureTest {
    private val seed = 11L
    private val dt = 1.0 / 60

    private val fixturesDir: File by lazy {
        File(System.getProperty("fixtures.dir") ?: "../../shared/fixtures", "physics")
    }

    private fun load(name: String): JsonObject =
        Json.parseToJsonElement(File(fixturesDir, name).readText()).jsonObject

    private fun JsonElement.d(): Double = (this as JsonPrimitive).double
    private fun JsonElement.i(): Int = (this as JsonPrimitive).int
    private fun JsonElement.b(): Boolean = (this as JsonPrimitive).boolean

    private fun streamedWorld(radius: Int): Pair<WorldStore, TerrainGenerator> {
        val terrain = TerrainGenerator(seed)
        val world = WorldStore()
        world.setGenerator({ cx, cy, cz -> terrain.generateChunk(cx, cy, cz) }, WORLD_CHUNKS_Y)
        for (cx in -radius..radius) {
            for (cz in -radius..radius) {
                world.loadColumn(cx, cz)
            }
        }
        return world to terrain
    }

    @Test
    fun moveBox_matches_aabb_fixture() {
        val fx = load("aabb.json")
        val world = WorldStore()
        for (row in fx["blocks"]!!.jsonArray) {
            val r = row.jsonArray
            world.setBlock(r[0].i(), r[1].i(), r[2].i(), r[3].i())
        }
        val failures = ArrayList<String>()
        var i = 0
        val cases = fx["cases"]!!.jsonArray
        for (c in cases) {
            val co = c.jsonObject
            val boxArr = co["box"]!!.jsonArray
            val box = Box(boxArr[0].d(), boxArr[1].d(), boxArr[2].d(), boxArr[3].d(), boxArr[4].d(), boxArr[5].d())
            val move = co["move"]!!.jsonArray
            val result = moveBox(world, box, move[0].d(), move[1].d(), move[2].d())
            val e = co["result"]!!.jsonArray
            val ok = e[0].d() == result.box.x && e[1].d() == result.box.y && e[2].d() == result.box.z &&
                (e[3].i() != 0) == result.hitX && (e[4].i() != 0) == result.hitY && (e[5].i() != 0) == result.hitZ
            if (!ok) failures.add("case $i")
            i++
        }
        println("aabb: ${cases.size - failures.size}/${cases.size} cases match")
        assertTrue("aabb failures: ${failures.joinToString()}", failures.isEmpty())
    }

    @Test
    fun raycastVoxels_matches_raycast_fixture() {
        val fx = load("raycast.json")
        val radius = fx["radius"]!!.i()
        val (world, _) = streamedWorld(radius)
        val failures = ArrayList<String>()
        var i = 0
        val rays = fx["rays"]!!.jsonArray
        for (r in rays) {
            val ro = r.jsonObject
            val origin = ro["origin"]!!.jsonArray
            val dir = ro["dir"]!!.jsonArray
            val hit = raycastVoxels(
                world,
                origin[0].d(), origin[1].d(), origin[2].d(),
                dir[0].d(), dir[1].d(), dir[2].d(),
                ro["maxDist"]!!.d(), ro["ignoreWater"]!!.b(),
            )
            val expected = ro["hit"]
            if (expected == null || expected is JsonNull) {
                if (hit != null) failures.add("ray $i expected no hit")
            } else {
                val e = expected.jsonArray
                val ok = hit != null && e[0].i() == hit.x && e[1].i() == hit.y && e[2].i() == hit.z &&
                    e[3].i() == hit.nx && e[4].i() == hit.ny && e[5].i() == hit.nz &&
                    e[6].d() == hit.distance && e[7].i() == hit.block
                if (!ok) failures.add("ray $i")
            }
            i++
        }
        println("raycast: ${rays.size - failures.size}/${rays.size} rays match")
        assertTrue("raycast failures: ${failures.take(20).joinToString()}", failures.isEmpty())
    }

    @Test
    fun playerController_matches_walk_fixture_tick_for_tick() {
        val fx = load("walk.json")
        val radius = fx["radius"]!!.i()
        val fxDt = fx["dt"]!!.d()
        val (world, terrain) = streamedWorld(radius)
        val spawn = terrain.spawn()
        val spawnObj = fx["spawn"]!!.jsonObject
        val failures = ArrayList<String>()
        if (spawnObj["x"]!!.d() != spawn.x || spawnObj["y"]!!.d() != spawn.y || spawnObj["z"]!!.d() != spawn.z) {
            failures.add("spawn mismatch")
        }
        if (kotlin.math.abs(fxDt - dt) > 1e-12) failures.add("dt mismatch")

        val player = PlayerController(world, spawn.x, spawn.y, spawn.z)
        player.updrafts = { x, z -> terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3) }

        val ticks = fx["ticks"]!!.jsonArray
        var tickIndex = 0
        for (tick in ticks) {
            val t = tick.jsonObject
            val keys = t["keys"]!!.jsonArray.map { (it as JsonPrimitive).content }.toSet()
            val teleport = t["teleport"]
            if (teleport != null && teleport !is JsonNull) {
                val tp = teleport.jsonObject
                player.teleport(tp["x"]!!.d(), tp["y"]!!.d(), tp["z"]!!.d())
            }
            val look = t["look"]
            if (look != null && look !is JsonNull) {
                val l = look.jsonArray
                player.look(l[0].d(), l[1].d())
            }
            if (t["jump"]!!.b()) player.queueJump()
            player.update(fxDt, KeySetInput(keys), t["frozen"]!!.b())

            val expected = t["state"]!!.jsonArray
            val s = player.state
            val actual = doubleArrayOf(
                s.x, s.y, s.z, s.vx, s.vy, s.vz, s.yaw, s.pitch,
                if (s.onGround) 1.0 else 0.0, s.stamina, if (s.sprinting) 1.0 else 0.0,
                s.sinceSprint, if (s.inUpdraft) 1.0 else 0.0,
            )
            for (f in actual.indices) {
                if (expected[f].d() != actual[f]) failures.add("tick $tickIndex field $f (want ${expected[f].d()} got ${actual[f]})")
            }
            tickIndex++
        }
        println("walk: ${ticks.size} ticks, ${failures.size} field mismatches")
        assertTrue("walk failures:\n" + failures.take(20).joinToString("\n"), failures.isEmpty())
    }
}
