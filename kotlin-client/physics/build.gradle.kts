plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    // Physics fixtures (raycast, walk) are generated against a real streamed
    // seed-11 world, so the physics module depends on :world for WorldStore,
    // Raycast and TerrainGenerator — exactly as the Unity port's
    // BlockSurvival.Physics assembly references BlockSurvival.World.
    implementation(project(":world"))

    testImplementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}

tasks.test {
    systemProperty(
        "fixtures.dir",
        rootProject.projectDir.parentFile.resolve("shared/fixtures").absolutePath,
    )
    testLogging { events("passed", "skipped", "failed") }
}
