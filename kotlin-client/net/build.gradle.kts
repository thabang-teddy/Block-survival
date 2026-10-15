plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    // Tests read shared/fixtures/*.json directly via kotlinx-serialization's
    // JsonElement API (no @Serializable classes, so no compiler plugin needed).
    testImplementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}

tasks.test {
    // shared/fixtures lives at the repo root, one level above kotlin-client/.
    systemProperty(
        "fixtures.dir",
        rootProject.projectDir.parentFile.resolve("shared/fixtures").absolutePath,
    )
    testLogging { events("passed", "skipped", "failed") }
}
