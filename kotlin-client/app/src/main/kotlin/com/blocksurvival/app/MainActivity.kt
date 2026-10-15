package com.blocksurvival.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Compose host for the vertical slice: a full-screen [GameSurfaceView] with
 * on-screen movement controls over it. Compose owns the UI (D2/D5); the GL
 * surface owns the world.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val input = InputState()
        setContent {
            Box(Modifier.fillMaxSize()) {
                AndroidView(
                    factory = { ctx -> GameSurfaceView(ctx, input) },
                    modifier = Modifier.fillMaxSize(),
                )
                Controls(input)
            }
        }
    }
}

@Composable
private fun HoldButton(
    label: String,
    onDown: () -> Unit,
    onUp: () -> Unit = {},
) {
    Box(
        modifier = Modifier
            .size(64.dp)
            .clip(CircleShape)
            .background(Color(0x66FFFFFF))
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    onDown()
                    waitForUpOrCancellation()
                    onUp()
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color.Black, fontSize = 16.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Controls(input: InputState) {
    Box(Modifier.fillMaxSize().padding(16.dp)) {
        Column(Modifier.align(Alignment.BottomStart)) {
            Row { HoldButton("W", onDown = { input.forward = true }, onUp = { input.forward = false }) }
            Row {
                HoldButton("A", onDown = { input.left = true }, onUp = { input.left = false })
                Spacer(Modifier.width(72.dp))
                HoldButton("D", onDown = { input.right = true }, onUp = { input.right = false })
            }
            Row { HoldButton("S", onDown = { input.back = true }, onUp = { input.back = false }) }
        }
        Column(Modifier.align(Alignment.BottomEnd)) {
            HoldButton("Jmp", onDown = { input.space = true; input.requestJump() }, onUp = { input.space = false })
            Spacer(Modifier.height(16.dp))
            HoldButton("Spr", onDown = { input.sprint = true }, onUp = { input.sprint = false })
        }
    }
}
