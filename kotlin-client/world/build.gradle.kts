plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
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
