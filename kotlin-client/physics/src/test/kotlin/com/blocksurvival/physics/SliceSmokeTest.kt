package com.blocksurvival.physics

import com.blocksurvival.world.TerrainGenerator
import com.blocksurvival.world.WORLD_CHUNKS_Y
import com.blocksurvival.world.WorldStore
import com.blocksurvival.world.meshChunk
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The device-free analogue of the Unity port's PlayMode smoke test (its §7):
 * composes the real ported pieces headlessly — streams the real seed-11 world
 * around spawn, meshes it, and drives the real [PlayerController] with real
 * swept-AABB collision — and asserts the slice is actually walkable, before
 * anyone trusts the GL app visually. No GL, no Android, no device.
 */
class SliceSmokeTest {
    private val seed = 11L
    private val dt = 1.0 / 60

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
    fun seed11_streams_meshes_and_is_walkable() {
        val radius = 2
        val (world, terrain) = streamedWorld(radius)

        // --- the world streamed in
        assertTrue("expected chunks to load around spawn", world.chunkCount > 0)

        // --- the mesher produced drawable geometry for the spawn area
        var opaqueVerts = 0
        var meshedChunks = 0
        for ((cx, cy, cz) in world.chunkKeys.toList()) {
            val mesh = meshChunk(world, cx, cy, cz)
            if (!mesh.isEmpty) meshedChunks++
            opaqueVerts += mesh.opaque?.vertexCount ?: 0
        }
        assertTrue("expected at least one meshed chunk", meshedChunks > 0)
        assertTrue("expected opaque geometry (the ground/pad)", opaqueVerts > 0)

        // --- a player on the real pad, with real collision
        val spawn = terrain.spawn()
        val player = PlayerController(world, spawn.x, spawn.y, spawn.z)
        player.updrafts = { x, z -> terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3) }

        // settle onto the pad (gravity + collision), a few ticks of no input
        repeat(30) { player.update(dt, KeySetInput()) }
        assertTrue("player should come to rest on the pad", player.state.onGround)
        assertFalse(
            "player must not be embedded in a solid block",
            boxIntersectsSolid(world, player.box),
        )
        val restY = player.state.y
        val startZ = player.state.z

        // walk forward (yaw 0 => world -Z) for one simulated second
        repeat(60) { player.update(dt, KeySetInput(setOf("KeyW"))) }
        val movedZ = startZ - player.state.z
        assertTrue("walking forward should move the player in -Z (moved=$movedZ)", movedZ > 1.0)
        assertTrue(
            "player should stay on the flat pad while walking (restY=$restY y=${player.state.y})",
            kotlin.math.abs(player.state.y - restY) < 1.0,
        )
        assertFalse(
            "player must not walk into a solid block",
            boxIntersectsSolid(world, player.box),
        )

        println(
            "slice: ${world.chunkCount} chunks, $meshedChunks meshed, $opaqueVerts opaque verts; " +
                "walked ${"%.2f".format(movedZ)} m in -Z, rest y=${"%.2f".format(player.state.y)}, onGround=${player.state.onGround}",
        )
    }
}
