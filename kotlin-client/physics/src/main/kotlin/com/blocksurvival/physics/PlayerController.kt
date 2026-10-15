package com.blocksurvival.physics

import com.blocksurvival.world.JsMath.hypot
import com.blocksurvival.world.JsMath.jsCos
import com.blocksurvival.world.JsMath.jsSin
import com.blocksurvival.world.Updraft
import com.blocksurvival.world.UpdraftTuning
import com.blocksurvival.world.WorldStore
import com.blocksurvival.world.updraftAt

/**
 * First-person player — twin of `physics/playerController.ts`: mouse look,
 * WASD, sprint, jump, gravity, step-up, updraft lift, all resolved against the
 * voxel world with swept AABBs. Checked tick for tick against
 * `shared/fixtures/physics/walk.json`.
 */
object PlayerTuning {
    const val WIDTH = 0.6
    const val HEIGHT = 1.8
    const val EYE_HEIGHT = 1.62
    const val WALK_SPEED = 4.3
    const val SPRINT_SPEED = 7.0
    const val JUMP_SPEED = 8.0
    const val GRAVITY = 25.0
    const val STEP_HEIGHT = 0.55
    const val GROUND_ACCEL = 40.0
    const val AIR_ACCEL = 10.0
    const val MOUSE_SENSITIVITY = 0.0022

    /** px of look applied in one tick at most: more than this is a stall, not a move */
    const val MAX_LOOK_PER_TICK = 400.0

    /** below the bedrock at y = 0: put the player back on the pad */
    const val VOID_Y = -8.0
    const val MAX_STAMINA = 100.0
    const val STAMINA_DRAIN = 15.0
    const val STAMINA_REGEN = 12.0
    const val STAMINA_REGEN_DELAY = 1.0
}

/** normalise an angle into (-π, π] */
fun wrapAngle(angle: Double): Double {
    val twoPi = Math.PI * 2
    // JS % keeps the sign of the dividend; Kotlin's Double rem (%) does the same
    var a = angle % twoPi
    if (a > Math.PI) {
        a -= twoPi
    } else if (a <= -Math.PI) {
        a += twoPi
    }
    return a
}

/** the keys the controller reads, by the browser's KeyboardEvent.code names */
interface PlayerInput {
    fun isDown(code: String): Boolean
}

class KeySetInput(val down: Set<String> = emptySet()) : PlayerInput {
    override fun isDown(code: String): Boolean = down.contains(code)
}

class PlayerState(
    /** feet centre */
    var x: Double,
    var y: Double,
    var z: Double,
    var vx: Double = 0.0,
    var vy: Double = 0.0,
    var vz: Double = 0.0,
    var yaw: Double = 0.0,
    var pitch: Double = 0.0,
    var onGround: Boolean = false,
    var stamina: Double = PlayerTuning.MAX_STAMINA,
    /** true while actually sprinting this tick */
    var sprinting: Boolean = false,
    /** seconds since the player last sprinted */
    var sinceSprint: Double = 99.0,
    /** standing in an updraft shaft */
    var inUpdraft: Boolean = false,
)

typealias UpdraftsNear = (x: Double, z: Double) -> List<Updraft>

class PlayerController(private val world: WorldStore, x: Double, y: Double, z: Double) {
    val state = PlayerState(x = x, y = y, z = z)

    /** respawn point (the bed sets this) */
    var spawnX = x
    var spawnY = y
    var spawnZ = z
    private var jumpQueued = false

    /** the updraft shafts near a point (the terrain generator's; tests pass a fake) */
    var updrafts: UpdraftsNear = { _, _ -> emptyList() }

    val box: Box
        get() {
            val s = state
            val half = PlayerTuning.WIDTH / 2
            return Box(
                x = s.x - half,
                y = s.y,
                z = s.z - half,
                w = PlayerTuning.WIDTH,
                h = PlayerTuning.HEIGHT,
                d = PlayerTuning.WIDTH,
            )
        }

    /** would placing a solid block at this voxel overlap the player? */
    fun overlapsVoxel(x: Int, y: Int, z: Int): Boolean {
        val b = box
        return b.x < x + 1 && b.x + b.w > x &&
            b.y < y + 1 && b.y + b.h > y &&
            b.z < z + 1 && b.z + b.d > z
    }

    fun teleport(x: Double, y: Double, z: Double) {
        state.x = x
        state.y = y
        state.z = z
        state.vx = 0.0
        state.vy = 0.0
        state.vz = 0.0
    }

    fun queueJump() {
        jumpQueued = true
    }

    private fun updateVitals(dt: Double, wantSprint: Boolean, moving: Boolean) {
        val s = state
        s.sprinting = wantSprint && moving && s.stamina > 0 && s.onGround
        if (s.sprinting) {
            s.stamina = maxOf(0.0, s.stamina - PlayerTuning.STAMINA_DRAIN * dt)
            s.sinceSprint = 0.0
        } else {
            s.sinceSprint += dt
            if (s.sinceSprint > PlayerTuning.STAMINA_REGEN_DELAY) {
                s.stamina = minOf(PlayerTuning.MAX_STAMINA, s.stamina + PlayerTuning.STAMINA_REGEN * dt)
            }
        }
    }

    /** Apply one tick of mouse delta (px), capped so a stall is not a spin. */
    fun look(dxIn: Double, dyIn: Double) {
        val s = state
        val cap = PlayerTuning.MAX_LOOK_PER_TICK
        val dx = maxOf(-cap, minOf(cap, dxIn))
        val dy = maxOf(-cap, minOf(cap, dyIn))
        s.yaw = wrapAngle(s.yaw - dx * PlayerTuning.MOUSE_SENSITIVITY)
        s.pitch -= dy * PlayerTuning.MOUSE_SENSITIVITY
        val limit = Math.PI / 2 - 0.01
        s.pitch = maxOf(-limit, minOf(limit, s.pitch))
    }

    /** `frozen` (dead / in a menu): keys are ignored, only gravity applies */
    fun update(dt: Double, input: PlayerInput, frozen: Boolean = false) {
        val s = state
        fun down(code: String): Boolean = !frozen && input.isDown(code)
        // ---- wish direction in world space (yaw 0 looks down -Z)
        var fwd = 0.0
        var side = 0.0
        if (down("KeyW")) fwd += 1
        if (down("KeyS")) fwd -= 1
        if (down("KeyD")) side += 1
        if (down("KeyA")) side -= 1
        val rawLen = hypot(fwd, side)
        val len = if (rawLen == 0.0) 1.0 else rawLen
        fwd /= len
        side /= len
        val sinY = jsSin(s.yaw)
        val cosY = jsCos(s.yaw)
        val wishX = -sinY * fwd + cosY * side
        val wishZ = -cosY * fwd - sinY * side
        updateVitals(dt, down("ShiftLeft"), fwd != 0.0 || side != 0.0)
        val speed = if (s.sprinting) PlayerTuning.SPRINT_SPEED else PlayerTuning.WALK_SPEED
        val accel = (if (s.onGround) PlayerTuning.GROUND_ACCEL else PlayerTuning.AIR_ACCEL) * dt
        s.vx += maxOf(-accel, minOf(accel, wishX * speed - s.vx))
        s.vz += maxOf(-accel, minOf(accel, wishZ * speed - s.vz))

        // ---- vertical
        val shaft = if (frozen) null else updraftAt(updrafts(s.x, s.z), s.x, s.y, s.z)
        s.inUpdraft = shaft != null
        if (shaft != null) {
            // the shaft carries you: ease towards rise / sink / hover, never past its top
            val want = if (down("Space")) {
                UpdraftTuning.RISE
            } else if (down("ShiftLeft")) {
                -UpdraftTuning.SINK
            } else {
                0.0
            }
            val step = UpdraftTuning.ACCEL * dt
            s.vy += maxOf(-step, minOf(step, want - s.vy))
            if (s.vy > 0 && s.y + s.vy * dt > shaft.topY) {
                s.vy = maxOf(0.0, (shaft.topY - s.y) / dt)
            }
        } else {
            if (jumpQueued && s.onGround && !frozen) s.vy = PlayerTuning.JUMP_SPEED
            s.vy -= PlayerTuning.GRAVITY * dt
            s.vy = maxOf(s.vy, -50.0)
        }
        jumpQueued = false

        move(s.vx * dt, s.vy * dt, s.vz * dt)
        if (s.y < PlayerTuning.VOID_Y) teleport(spawnX, spawnY, spawnZ)
    }

    private fun move(dx: Double, dy: Double, dz: Double) {
        val s = state
        val start = box
        var r = moveBox(world, start, dx, dy, dz)
        // step-up: blocked horizontally while grounded → try again from one step higher
        if ((r.hitX || r.hitZ) && s.onGround) {
            val raised = moveBox(world, start, 0.0, PlayerTuning.STEP_HEIGHT, 0.0)
            if (!raised.hitY) {
                val stepped = moveBox(world, raised.box, dx, 0.0, dz)
                val settled = moveBox(world, stepped.box, 0.0, -PlayerTuning.STEP_HEIGHT, 0.0)
                val gained = hypot(stepped.box.x - raised.box.x, stepped.box.z - raised.box.z)
                val original = hypot(r.box.x - start.x, r.box.z - start.z)
                if (gained > original + 1e-3 && settled.hitY && !boxIntersectsSolid(world, settled.box)) {
                    r = MoveResult(settled.box, hitX = stepped.hitX, hitY = true, hitZ = stepped.hitZ)
                }
            }
        }
        val half = PlayerTuning.WIDTH / 2
        s.x = r.box.x + half
        s.y = r.box.y
        s.z = r.box.z + half
        if (r.hitX) s.vx = 0.0
        if (r.hitZ) s.vz = 0.0
        if (r.hitY) {
            s.onGround = dy <= 0
            s.vy = 0.0
        } else {
            s.onGround = false
        }
    }
}
