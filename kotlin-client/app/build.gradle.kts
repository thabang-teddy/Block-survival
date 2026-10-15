plugins {
    // AGP 9 has built-in Kotlin support, so `org.jetbrains.kotlin.android` is
    // no longer applied here (applying it is an error on AGP 9). The Compose
    // compiler plugin still registers its Kotlin compiler extension.
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "com.blocksurvival.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.blocksurvival.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(project(":world"))
    implementation(project(":physics"))
    implementation(project(":net"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.material3)
}
