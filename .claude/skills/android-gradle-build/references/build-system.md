# Gradle Build System Fundamentals

Source: developer.android.com/build (Gradle build overview, Android build structure, Configure your build, Java versions in Android builds). Snippets are shown in Groovy DSL first (VetTrack's `android/` shell uses Groovy); Kotlin DSL (`.kts`) equivalents differ mainly in `=` assignments and `create("name")`/`getByName("name")` syntax.

## Table of contents

1. [What is a build?](#what-is-a-build)
2. [The three build phases](#the-three-build-phases)
3. [Configuration DSLs](#configuration-dsls)
4. [Android project file structure](#android-project-file-structure)
5. [Key build files](#key-build-files)
6. [Android SDK settings (compileSdk / minSdk / targetSdk)](#android-sdk-settings)
7. [Sample app-module build script](#sample-app-module-build-script)
8. [Gradle properties files](#gradle-properties-files)
9. [Source sets](#source-sets)
10. [Java/JDK versions in Android builds](#javajdk-versions-in-android-builds)

## What is a build?

A build system transforms source code into an executable application. Gradle uses a **task-based** approach:

- **Tasks** encapsulate commands that translate inputs into outputs. Task inputs can be files, directories, or values encoded as Java types; outputs must be files/directories. Wiring one task's output into another task's input links them (ordering).
- **Plugins** define tasks and their configuration. Applying the **Android Gradle Plugin (AGP)** registers all tasks needed to build an APK or Android Library. `java-library` builds jars; plugins like `protobuf` extend other plugins.
- Gradle prefers **convention over configuration**: plugins ship good defaults; you configure via a declarative DSL that specifies *what* to build, not *how*.
- Keep build logic and task declarations **in plugins**, not in build files. Build files should be data declarations — no function definitions or conditionals.

## The three build phases

1. **Initialization** — determines which projects/subprojects are in the build and sets up classpaths. Driven by the settings file.
2. **Configuration** — registers tasks for each project and executes build files to apply the build specification. Configuration code has **no access** to data or files produced during execution.
3. **Execution** — builds the app. The output of configuration is a Directed Acyclic Graph (DAG) of tasks. Gradle runs out-of-date tasks in graph order; a task whose inputs haven't changed since its last execution is skipped (incremental build).

## Configuration DSLs

Build files use a declarative Kotlin-script or Groovy DSL (Google recommends Kotlin for new projects; VetTrack's Capacitor shell is Groovy). Each DSL block is backed by a function that takes a configuration lambda plus a same-named property, e.g.:

```groovy
android {
    namespace = 'com.example.app'
    compileSdk 36
    defaultConfig {
        applicationId 'com.example.app'
        minSdkVersion 23
        targetSdkVersion 36
    }
}
```

> AGP 9.3+ adds an expanded `compileSdk { version = release(36) { minorApiLevel = 1 } }` block form for minor API levels. **Not applicable on AGP 8.x** (VetTrack is on 8.13.0).

## Android project file structure

| Folder/File | Use |
|---|---|
| `.gradle/` | Gradle project cache. **Don't touch.** |
| `.idea/` | Android Studio metadata. **Don't touch.** |
| `build.gradle(.kts)` (root) | Root build file — should only contain plugin declarations (`apply false`) to set a common plugin classpath. |
| `gradle.properties` | Gradle execution configuration: heap size, caching, parallel execution, temporary AGP feature flags. |
| `gradlew` / `gradlew.bat` | Gradle wrapper — downloads the pinned Gradle distribution and forwards commands to it. |
| `local.properties` | Local machine config (`sdk.dir`, `cmake.dir`, `ndk.symlinkdir`). **Exclude from source control.** Reserved for AGP — don't add custom properties here. |
| `settings.gradle(.kts)` | Build initialization: project name, included subprojects, `pluginManagement.repositories`, `dependencyResolutionManagement.repositories`, version catalog imports. |
| `gradle/libs.versions.toml` | Version Catalog — central dependency/plugin version variables. |
| `gradle/wrapper/gradle-wrapper.properties` | `distributionUrl` pins the Gradle version. Tip: use the same Gradle version across projects to avoid multiple daemons. |
| `app/` (or any subproject) | Module. Needs a `build.gradle(.kts)` and an `include` in settings. |
| `app/src/main/java|kotlin/` | Source code (mixed Java/Kotlin allowed under `java/`). |
| `app/src/main/res/` | Android resources (see `startup-modularization-resources.md` → Resources). |
| `app/src/main/AndroidManifest.xml` | App metadata: components, permissions, device compatibility. |
| `app/src/androidTest/` | Instrumented (device) tests. |
| `app/src/test/` | Host (JVM) tests. |
| `app/proguard-rules.pro` | R8 configuration rules (see `keep-rules.md`). |

## Key build files

### settings.gradle

```groovy
pluginManagement {
    repositories { gradlePluginPortal(); google(); mavenCentral() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "My Application"
include ':app'
```

- `pluginManagement.repositories` — where Gradle finds plugins.
- `dependencyResolutionManagement.repositories` — where all modules find library dependencies. (Capacitor's shell adds `flatDir` repos per-module instead — a legacy pattern.)

### Top-level build.gradle

Should only declare plugin versions with `apply false` (never use `apply false` in subprojects):

```groovy
plugins {
    id 'com.android.application' version '<agp-version>' apply false
    id 'com.android.library' version '<agp-version>' apply false
    id 'org.jetbrains.kotlin.android' version '<kotlin-version>' apply false
}
```

(Capacitor's shell uses the older `buildscript { dependencies { classpath 'com.android.tools.build:gradle:X' } }` form — equivalent.)

### Module-level build.gradle

Declares plugins, the `android {}` block, and `dependencies {}`. Configures packaging options, build types, product flavors, and overrides of `main/` manifest values. See [Sample app-module build script](#sample-app-module-build-script).

### Sync

After editing build files, Android Studio requires a Gradle sync (**Sync Now**). Unsynced changes disable run configurations.

## Android SDK settings

| Property | Meaning |
|---|---|
| `compileSdk` | Which Android + Java APIs are available **at compile time**. Use the latest SDK. Guard newer platform APIs with version checks or AndroidX compat libraries. |
| `minSdk` | Lowest Android version the app supports; restricts which devices can install. Lint warns on APIs above `minSdk`. |
| `targetSdk` | (1) Sets **runtime behavior** — devices newer than `targetSdk` run the app in compatibility mode for that level; (2) attests which version you tested. Google Play enforces minimum target API policies. |

`compileSdk` and `targetSdk` are independent; `compileSdk` gives API access, `targetSdk` sets runtime behavior. Build-file values **override** manifest `<uses-sdk>` — leave `<uses-sdk>` out of the manifest and define these only in the build file.

## Sample app-module build script

```groovy
plugins { id 'com.android.application' }

// JDK used to compile sources; also defaults sourceCompatibility/targetCompatibility/jvmTarget.
kotlin { jvmToolchain 17 }

android {
    namespace 'com.example.myapp'          // for generated R/BuildConfig classes
    compileSdk 36

    defaultConfig {
        applicationId 'com.example.myapp'  // unique app identity — never change after publishing
        minSdk 23
        targetSdk 36
        versionCode 1                      // integer, must increase per Play upload
        versionName "1.0"                  // user-facing
    }

    buildTypes {
        release {
            minifyEnabled true             // enables R8 code shrinking
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    // Product flavors are optional; see app-config-and-variants.md
}

dependencies {
    implementation project(':lib')
    implementation 'androidx.appcompat:appcompat:1.7.1'
    implementation fileTree(dir: 'libs', include: ['*.jar'])
}
```

## Gradle properties files

- **`gradle.properties`** — project-wide Gradle settings (daemon heap size, caching, parallelism) plus AGP feature flags (e.g. `android.enableR8.fullMode`).
- **`local.properties`** — machine-local paths (`sdk.dir`, `cmake.dir`, deprecated `ndk.dir`, Windows-only `ndk.symlinkdir` for short NDK paths). Reserved for AGP; define your own local properties in a separate file you load manually.

## Source sets

Android Studio creates the `main/` source set (code/resources shared by all variants). Optional additional source sets narrow scope:

| Directory | Applies to |
|---|---|
| `src/main/` | All variants |
| `src/<buildType>/` | One build type (e.g. `src/debug/`) |
| `src/<productFlavor>/` | One flavor |
| `src/<flavor1Flavor2>/` | A combination of flavors across dimensions |
| `src/<productFlavorBuildType>/` | One exact variant (e.g. `src/demoDebug/`) |

Priority when the same file/setting exists in several source sets (left overrides right):

> build variant > build type > product flavor > main > library dependencies

Full merge rules and how to create/remap source sets: see `app-config-and-variants.md` → Source sets.

## Java/JDK versions in Android builds

Several distinct JDK choices exist in one build:

- **JDK running Android Studio** — use the bundled JetBrains Runtime (JBR); don't set `STUDIO_JDK`.
- **JDK running Gradle** — from Studio settings when launched from the IDE; from `JAVA_HOME` (else `PATH` `java`) in a terminal. Keep them the same for consistency. Different JDK/Gradle combos spawn extra daemons (CPU/RAM cost). Studio's Gradle-JDK setting lives in `.idea/gradle.xml` (`gradleJvm`); prefer the `GRADLE_LOCAL_JAVA_HOME` macro. The JDK must be ≥ the version AGP requires (AGP 8.x requires **JDK 17** — a lower JDK fails with "Android Gradle plugin requires Java 17 to run").
- **Java toolchain JDK** — compiles Java sources, runs javadoc/unit tests. Defaults to the Gradle JDK; pin it explicitly for reproducible builds:
  ```groovy
  java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
  ```
- **`sourceCompatibility`** — which Java *language features* are available in Java source (doesn't affect Kotlin). Defaults to the toolchain version.
- **`targetCompatibility`** — Java class-format version of the generated bytecode. Must be ≥ `sourceCompatibility`; in practice set both to the same value:
  ```groovy
  android {
      compileOptions {
          sourceCompatibility JavaVersion.VERSION_17
          targetCompatibility JavaVersion.VERSION_17
      }
      kotlinOptions { jvmTarget = '17' }   // only needed for Kotlin < 2.2
  }
  ```

### Which Java APIs can app code use?

Determined by `compileSdk`, not by the JDK. Java APIs missing at `minSdk` may still be usable via **desugaring**.

| Android | Java level supported |
|---|---|
| 14 (API 34) | 17 |
| 13 (API 33) | 11 |
| 12 (API 32) | 11 |
| 11 and lower | see per-version docs |
