package com.blocksurvival.app

import android.content.Context
import android.opengl.GLSurfaceView
import android.view.MotionEvent

/** The GLES 3.0 surface hosting [GameRenderer]; one-finger drag = look. */
class GameSurfaceView(context: Context, input: InputState) : GLSurfaceView(context) {
    private val input = input
    private var lastX = 0f
    private var lastY = 0f

    init {
        setEGLContextClientVersion(3)
        // Some emulators / drivers can't match an ES3 config with the default
        // chooser and throw "eglChooseConfig failed"; request an explicit
        // RGBA8888 + 16-bit depth config.
        setEGLConfigChooser(8, 8, 8, 8, 16, 0)
        // Hosted in a Compose AndroidView: raise this SurfaceView above the
        // (opaque) window background so the world is visible, while the Compose
        // control overlay still draws on top of it.
        setZOrderMediaOverlay(true)
        setRenderer(GameRenderer(input))
        renderMode = RENDERMODE_CONTINUOUSLY
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = event.x
                lastY = event.y
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.x - lastX
                val dy = event.y - lastY
                lastX = event.x
                lastY = event.y
                input.addLook(dx.toDouble(), dy.toDouble())
            }
        }
        return true
    }
}
