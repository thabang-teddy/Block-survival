pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "kotlin-client"

// Pure-Kotlin/JVM logic modules — no Android dependency, fixture-testable on the
// JVM with no device or emulator (the analogue of the Flutter port's pure lib/
// and the Unity port's `noEngineReferences: true` assemblies).
include(":world")
include(":net")
include(":physics")

// Android app module (Jetpack Compose + OpenGL ES). Enabled once the pure-logic
// spikes are GO and the slice is built — see docs/PLAN.md §4 (P1).
// include(":app")
