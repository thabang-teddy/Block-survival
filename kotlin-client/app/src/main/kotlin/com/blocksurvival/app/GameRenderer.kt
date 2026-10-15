package com.blocksurvival.app

import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import com.blocksurvival.physics.PlayerController
import com.blocksurvival.physics.PlayerTuning
import com.blocksurvival.world.MeshData
import com.blocksurvival.world.TerrainGenerator
import com.blocksurvival.world.VERTEX_FLOATS
import com.blocksurvival.world.WORLD_CHUNKS_Y
import com.blocksurvival.world.WorldStore
import com.blocksurvival.world.meshChunk
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.cos
import kotlin.math.sin

/**
 * The vertical slice's renderer: streams the real seed-11 world around spawn,
 * meshes every non-empty chunk into GLES 3.0 VBOs (via the ported [meshChunk]),
 * and drives the ported [PlayerController] every frame with real swept-AABB
 * collision — a controllable camera in the real voxel world. Not the game: the
 * radius loads once and never follows the player.
 */
class GameRenderer(private val input: InputState) : GLSurfaceView.Renderer {
    private val seed = 11L
    private val radius = 3

    private lateinit var world: WorldStore
    private lateinit var terrain: TerrainGenerator
    private lateinit var player: PlayerController

    private var program = 0
    private var uViewProj = 0

    private class Draw(val vao: Int, val indexCount: Int)
    private val opaqueDraws = ArrayList<Draw>()
    private val translucentDraws = ArrayList<Draw>()

    private val proj = FloatArray(16)
    private val view = FloatArray(16)
    private val viewProj = FloatArray(16)
    private var lastNanos = 0L

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES30.glClearColor(0.53f, 0.70f, 0.92f, 1f) // sky
        GLES30.glEnable(GLES30.GL_DEPTH_TEST)
        // the mesher's winding is three.js CCW-from-outside; draw both sides
        GLES30.glDisable(GLES30.GL_CULL_FACE)
        program = buildProgram()
        uViewProj = GLES30.glGetUniformLocation(program, "uViewProj")

        terrain = TerrainGenerator(seed)
        world = WorldStore()
        world.setGenerator({ cx, cy, cz -> terrain.generateChunk(cx, cy, cz) }, WORLD_CHUNKS_Y)
        for (cx in -radius..radius) {
            for (cz in -radius..radius) {
                world.loadColumn(cx, cz)
            }
        }
        for ((cx, cy, cz) in world.chunkKeys.toList()) {
            val mesh = meshChunk(world, cx, cy, cz)
            mesh.opaque?.let { opaqueDraws.add(upload(it)) }
            mesh.translucent?.let { translucentDraws.add(upload(it)) }
        }

        val spawn = terrain.spawn()
        player = PlayerController(world, spawn.x, spawn.y, spawn.z)
        player.updrafts = { x, z -> terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3) }
        lastNanos = System.nanoTime()
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES30.glViewport(0, 0, width, height)
        val aspect = if (height == 0) 1f else width.toFloat() / height
        Matrix.perspectiveM(proj, 0, 70f, aspect, 0.1f, 300f)
    }

    override fun onDrawFrame(gl: GL10?) {
        val now = System.nanoTime()
        var dt = (now - lastNanos) / 1_000_000_000.0
        lastNanos = now
        if (dt > 1.0 / 30) dt = 1.0 / 30
        if (dt < 0) dt = 0.0

        val (lx, ly) = input.drainLook()
        if (lx != 0.0 || ly != 0.0) player.look(lx, ly)
        if (input.consumeJump()) player.queueJump()
        player.update(dt, input)

        val s = player.state
        val cp = cos(s.pitch)
        val fx = (-sin(s.yaw) * cp).toFloat()
        val fy = sin(s.pitch).toFloat()
        val fz = (-cos(s.yaw) * cp).toFloat()
        val ex = s.x.toFloat()
        val ey = (s.y + PlayerTuning.EYE_HEIGHT).toFloat()
        val ez = s.z.toFloat()
        Matrix.setLookAtM(view, 0, ex, ey, ez, ex + fx, ey + fy, ez + fz, 0f, 1f, 0f)
        Matrix.multiplyMM(viewProj, 0, proj, 0, view, 0)

        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
        GLES30.glUseProgram(program)
        GLES30.glUniformMatrix4fv(uViewProj, 1, false, viewProj, 0)

        GLES30.glDisable(GLES30.GL_BLEND)
        GLES30.glDepthMask(true)
        for (d in opaqueDraws) drawEntry(d)

        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA)
        GLES30.glDepthMask(false)
        for (d in translucentDraws) drawEntry(d)
        GLES30.glDepthMask(true)
        GLES30.glDisable(GLES30.GL_BLEND)
    }

    private fun drawEntry(d: Draw) {
        GLES30.glBindVertexArray(d.vao)
        GLES30.glDrawElements(GLES30.GL_TRIANGLES, d.indexCount, GLES30.GL_UNSIGNED_INT, 0)
        GLES30.glBindVertexArray(0)
    }

    private fun upload(mesh: MeshData): Draw {
        val vao = IntArray(1)
        GLES30.glGenVertexArrays(1, vao, 0)
        val bufs = IntArray(2)
        GLES30.glGenBuffers(2, bufs, 0)
        GLES30.glBindVertexArray(vao[0])

        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, bufs[0])
        val vb = ByteBuffer.allocateDirect(mesh.vertices.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        vb.put(mesh.vertices)
        vb.position(0)
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, mesh.vertices.size * 4, vb, GLES30.GL_STATIC_DRAW)

        val stride = VERTEX_FLOATS * 4
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, stride, 0)
        GLES30.glEnableVertexAttribArray(1)
        GLES30.glVertexAttribPointer(1, 3, GLES30.GL_FLOAT, false, stride, 12)
        GLES30.glEnableVertexAttribArray(2)
        GLES30.glVertexAttribPointer(2, 4, GLES30.GL_FLOAT, false, stride, 24)

        GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, bufs[1])
        val ib = ByteBuffer.allocateDirect(mesh.indices.size * 4).order(ByteOrder.nativeOrder()).asIntBuffer()
        ib.put(mesh.indices)
        ib.position(0)
        GLES30.glBufferData(GLES30.GL_ELEMENT_ARRAY_BUFFER, mesh.indices.size * 4, ib, GLES30.GL_STATIC_DRAW)

        GLES30.glBindVertexArray(0)
        return Draw(vao[0], mesh.indices.size)
    }

    private fun buildProgram(): Int {
        val vs = compile(GLES30.GL_VERTEX_SHADER, VERTEX_SRC)
        val fs = compile(GLES30.GL_FRAGMENT_SHADER, FRAGMENT_SRC)
        val p = GLES30.glCreateProgram()
        GLES30.glAttachShader(p, vs)
        GLES30.glAttachShader(p, fs)
        GLES30.glLinkProgram(p)
        val ok = IntArray(1)
        GLES30.glGetProgramiv(p, GLES30.GL_LINK_STATUS, ok, 0)
        if (ok[0] == 0) {
            val log = GLES30.glGetProgramInfoLog(p)
            GLES30.glDeleteProgram(p)
            error("program link failed: $log")
        }
        GLES30.glDeleteShader(vs)
        GLES30.glDeleteShader(fs)
        return p
    }

    private fun compile(type: Int, src: String): Int {
        val sh = GLES30.glCreateShader(type)
        GLES30.glShaderSource(sh, src)
        GLES30.glCompileShader(sh)
        val ok = IntArray(1)
        GLES30.glGetShaderiv(sh, GLES30.GL_COMPILE_STATUS, ok, 0)
        if (ok[0] == 0) {
            val log = GLES30.glGetShaderInfoLog(sh)
            GLES30.glDeleteShader(sh)
            error("shader compile failed: $log")
        }
        return sh
    }

    private companion object {
        const val VERTEX_SRC = """#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
out vec3 vNormal;
void main() {
    gl_Position = uViewProj * vec4(aPos, 1.0);
    vColor = aColor;
    vNormal = aNormal;
}
"""
        const val FRAGMENT_SRC = """#version 300 es
precision mediump float;
in vec4 vColor;
in vec3 vNormal;
out vec4 fragColor;
const vec3 L = vec3(0.37, 0.91, 0.28);
void main() {
    float nl = dot(normalize(vNormal), L) * 0.5 + 0.5; // half-lambert for depth
    fragColor = vec4(vColor.rgb * (0.45 + 0.55 * nl), vColor.a);
}
"""
    }
}
