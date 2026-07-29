# Dependencies, Version Resolution, and Annotation Processors

Source: developer.android.com/build/dependencies, version-conflict resolution, annotation-processors. Groovy DSL first.

## Table of contents

1. [Dependency basics and semantic versioning](#dependency-basics-and-semantic-versioning)
2. [Gradle scopes (configurations)](#gradle-scopes-configurations)
3. [Declaring dependencies](#declaring-dependencies)
4. [Version catalogs](#version-catalogs)
5. [Transitive version conflicts and resolution](#transitive-version-conflicts-and-resolution)
6. [Bill of Materials (BOM) resolution](#bill-of-materials-bom-resolution)
7. [Annotation processors](#annotation-processors)

## Dependency basics and semantic versioning

Builds depend on libraries, plugins, subprojects, the Android SDK, compilers, and Gradle itself. Each dependency can pull **transitive dependencies**; upgrading one dependency can cascade.

Maven artifacts are identified as `group:artifact:version`. Most libraries follow **semantic versioning** `major.minor.patch`:

- `major` change → possible breaking API/behavior changes — test thoroughly.
- `minor` (features) / `patch` (fixes) → intended to stay compatible.
- Experimental/opt-in APIs may break even in minor/patch releases.

A library may impose a minimum `minSdk` or `compileSdk`. The app's **effective `minSdk`** is the highest `minSdk` requested by the app and all direct + transitive dependencies. Some libraries require a companion Gradle plugin (e.g. Room's KSP, Compose compiler).

## Gradle scopes (configurations)

Scopes control which classpath a dependency lands on:

- `implementation` — available to this module only; **preferred**. Reduces recompilation and hides transitive deps from consumers.
- `api` — exposed to consumers of this module (leaks transitive deps; slower builds). Use only for types in your public API.
- `compileOnly` — compile classpath only (e.g. annotation definitions).
- `annotationProcessor` / `kapt` / `ksp` — processor classpath.
- `testImplementation` / `androidTestImplementation` — host / instrumented test classpaths.
- Variant-prefixed forms: `freeImplementation`, `debugImplementation`, `releaseImplementation`, etc.

## Declaring dependencies

```groovy
dependencies {
    implementation 'com.example:library1:1.2.3'
    api 'com.example:library2:1.1.1'
    implementation project(':mylibrary')                       // local module
    implementation fileTree(dir: 'libs', include: ['*.jar'])   // local jars
    testImplementation 'junit:junit:4.13.2'
    androidTestImplementation 'androidx.test.espresso:espresso-core:3.7.0'
}
```

## Version catalogs

`gradle/libs.versions.toml` centralizes versions across modules:

```toml
[versions]
exampleLib = "1.2.3"
examplePlugin = "2.3.4"

[libraries]
example-library = { group = "com.example", name = "library", version.ref = "exampleLib" }

[plugins]
example-plugin = { id = "com.example.plugin", version.ref = "examplePlugin" }
```

Usage in a module build file:

```groovy
plugins { alias(libs.plugins.example.plugin) }
dependencies { implementation libs.example.library }
```

Catalog entries only become resolution candidates if actually referenced. Recommended for multi-module projects to keep versions consistent.

## Transitive version conflicts and resolution

When the graph contains multiple versions of the same library, **Gradle picks the newest version by default** — even overriding the version you requested directly. A major-version jump chosen this way (e.g. A requests C `1.0.3`, B requests C `2.1.1` → resolved to `2.1.1`) can break the older requester at runtime.

Inspect resolution with:

```bash
./gradlew app:dependencies
```

In the tree, `com.sample:library.c:1.4.1 -> 2.1.1` means the requested version was overridden. Usually harmless (backward compat), but it's the first place to look when behavior changes after an upgrade. Resolution strategy can be customized (`resolutionStrategy`), but newest-wins usually works.

Requested versions come from three sources — all become candidates:
1. **Direct specification** — `implementation("androidx.compose.ui:ui:1.7.3")`.
2. **Version catalog** — the referenced entry's version.
3. **BOM** — see below.

## Bill of Materials (BOM) resolution

```groovy
dependencies {
    implementation platform('androidx.compose:compose-bom:2024.10.00')
    implementation 'androidx.compose.ui:ui'      // version comes from the BOM
}
```

- **All** library versions listed in the BOM become resolution candidates — including for transitive dependencies that appear in the BOM, even if you never declare them directly.
- Libraries in the BOM that nothing depends on are ignored.
- If another dependency requests a *lower* version of a BOM-listed library, the BOM version wins; if it requests a *higher* version, the higher one wins (newest-wins still applies).
- Version catalogs can hold the BOM version and version-less library aliases together.

## Annotation processors

Processors must be on the **processor classpath**, not the compile classpath, or the build fails with `Error: Annotation processors must be explicitly declared now.`

```groovy
dependencies {
    compileOnly 'com.google.dagger:dagger:<version>'                      // annotations only
    annotationProcessor 'com.google.dagger:dagger-compiler:<version>'     // the processor
}
```

(For Kotlin use `kapt`, or preferably `ksp` where supported. AGP 3.0+ dropped the `android-apt` plugin.)

### Passing arguments to processors

Primitive key-value args:

```groovy
android {
    defaultConfig {
        javaCompileOptions {
            annotationProcessorOptions {
                argument 'key1', 'value1'
            }
        }
    }
}
```

File/directory args (AGP 3.2+) must go through Gradle's `CommandLineArgumentProvider` so incremental build and build-cache correctness are preserved. The provider class annotates each argument with build-property type annotations (`@InputFiles`, `@PathSensitive(RELATIVE)`, `@OutputDirectory`) and returns `-Akey=value` strings from `asArguments()`; register it via `annotationProcessorOptions.compilerArgumentProvider`. Processor authors normally supply this class.

### Disabling the compile-classpath error check

If compile-classpath deps contain processors you don't need:

```groovy
javaCompileOptions { annotationProcessorOptions { includeCompileClasspath false } }
// or with kapt:
kapt { includeCompileClasspath false }
```

Setting it to `true` (allowing processors on the compile classpath) is deprecated and will be removed.
