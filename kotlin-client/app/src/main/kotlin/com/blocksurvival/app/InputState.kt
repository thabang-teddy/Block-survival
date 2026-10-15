package com.blocksurvival.app

import com.blocksurvival.physics.PlayerInput

/**
 * Touch / on-screen control state, read by the GL thread's [GameRenderer] and
 * written by the UI thread (Compose controls + the surface's touch handler).
 * Implements [PlayerInput] so it feeds the ported controller through the same
 * `KeyboardEvent.code` interface every client uses.
 */
class InputState : PlayerInput {
    @Volatile var forward = false
    @Volatile var back = false
    @Volatile var left = false
    @Volatile var right = false
    @Volatile var sprint = false
    @Volatile var space = false

    @Volatile private var jumpRequested = false

    private val lookLock = Any()
    private var lookDx = 0.0
    private var lookDy = 0.0

    override fun isDown(code: String): Boolean = when (code) {
        "KeyW" -> forward
        "KeyS" -> back
        "KeyA" -> left
        "KeyD" -> right
        "ShiftLeft" -> sprint
        "Space" -> space
        else -> false
    }

    fun requestJump() {
        jumpRequested = true
    }

    /** One-shot: true once per jump press, consumed by the render loop. */
    fun consumeJump(): Boolean {
        val j = jumpRequested
        jumpRequested = false
        return j
    }

    fun addLook(dx: Double, dy: Double) {
        synchronized(lookLock) {
            lookDx += dx
            lookDy += dy
        }
    }

    /** Accumulated look delta since the last call, then reset. */
    fun drainLook(): Pair<Double, Double> = synchronized(lookLock) {
        val r = lookDx to lookDy
        lookDx = 0.0
        lookDy = 0.0
        r
    }
}
