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

// Android app module (Jetpack Compose + OpenGL ES) — the vertical slice.
// See docs/PLAN.md §7.
include(":app")
