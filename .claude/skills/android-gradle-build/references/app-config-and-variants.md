# App Configuration, Manifest Merging, and Build Variants

Source: developer.android.com/build/configure-app-module, manage-manifests, build-variants, include-native-symbols, extend-agp. Groovy DSL first.

## Table of contents

1. [Application ID](#application-id)
2. [Namespace](#namespace)
3. [Manifest merging](#manifest-merging)
   - [Merge priorities](#merge-priorities)
   - [Merge conflict heuristics](#merge-conflict-heuristics)
   - [Merge rule markers](#merge-rule-markers)
   - [Merge policies per element](#merge-policies-per-element)
   - [Manifest placeholders](#manifest-placeholders)
4. [Build types](#build-types)
5. [Product flavors and flavor dimensions](#product-flavors-and-flavor-dimensions)
6. [Variant filtering](#variant-filtering)
7. [Creating and remapping source sets](#creating-and-remapping-source-sets)
8. [Per-variant dependencies and variant-aware matching](#per-variant-dependencies-and-variant-aware-matching)
9. [Signing configuration](#signing-configuration)
10. [Native debug symbols for Play Console](#native-debug-symbols-for-play-console)
11. [Extending AGP (advanced)](#extending-agp-advanced)

## Application ID

```groovy
android {
    defaultConfig {
        applicationId "com.example.myapp"
    }
}
```

- Uniquely identifies the app on device and in Play. **Never change after publishing** — Play treats a new ID as a different app; updates require the same ID + signing certificate.
- Rules: ≥2 segments, each segment starts with a letter, chars `[a-zA-Z0-9_]`.
- Keep it equal to the namespace unless you have a reason not to; define it **explicitly** (otherwise it silently tracks the namespace).
- Some platform APIs call it "package name" (`Context.getPackageName()` returns the application ID).
- Instrumented-test APK gets `<applicationId>.test` automatically (`testApplicationId` overrides).
- Per-variant IDs: redefine `applicationId` per flavor, or append with `applicationIdSuffix` in flavors and/or build types. Build type suffix applies **after** flavor suffix (`com.example.myapp` + `.free` + `.debug` → `com.example.myapp.free.debug`). Useful so debug and release installs coexist.
- In the manifest, `${applicationId}` placeholder always expands to the final ID for the current variant.

## Namespace

```groovy
android { namespace "com.example.myapp" }
```

- Kotlin/Java package for the generated `R` and `BuildConfig` classes. Must match the base package where app code lives; other packages import `R` from it.
- Changing the namespace does **not** change the application ID *if* the ID is explicitly defined; the merged manifest's `package` attribute ends up holding the application ID.
- Test namespace defaults to `<namespace>.test`; override with `testNamespace` (never equal to `namespace`).

## Manifest merging

The final APK/AAB has one `AndroidManifest.xml`, merged from: build-variant manifests, the app's main manifest, and library manifests.

### Merge priorities

Highest priority first:
1. **Build variant manifest** — within that: variant (`src/demoDebug/`) > build type (`src/debug/`) > product flavor (`src/demo/`); with flavor dimensions, dimension order in `flavorDimensions` sets priority.
2. **Main manifest** (`src/main/`).
3. **Library manifests** — in `dependencies` declaration order.

Lower priority merges *into* higher. A library module's own merged manifest does **not** include its dependencies' manifests. Build-file values (e.g. `minSdk`) override merged-manifest attributes — keep `<uses-sdk>` out of manifests.

### Merge conflict heuristics

Default per-attribute behavior:

| High-priority | Low-priority | Result |
|---|---|---|
| no value | no value | default value |
| no value | B | B |
| A | no value | A |
| A | A | A |
| A | B | **Conflict error** — needs a merge rule marker |

Special cases:
- `<manifest>` attributes never merge — highest priority wins.
- `android:required` on `<uses-feature>`/`<uses-library>` uses OR-merge (`true` wins).
- `<uses-sdk>`: higher priority wins, except a library with **higher `minSdk`** errors unless `overrideLibrary` is applied; a library with lower `targetSdkVersion` may cause the merger to add implicit system permissions (e.g. library `targetSdkVersion ≤ 3` adds `WRITE_EXTERNAL_STORAGE` + `READ_PHONE_STATE`; `≤ 15` using READ/WRITE_CONTACTS adds READ/WRITE_CALL_LOG).
- `<intent-filter>` never matches across manifests — each is kept and added to the parent.
- **Don't depend on default attribute values** — a lower-priority explicit value overrides an unstated default. State attributes explicitly.

### Merge rule markers

Declare `xmlns:tools="http://schemas.android.com/tools"` on `<manifest>`. Markers go in the **higher-priority** manifest. (App modules strip `tools` markers after merge; library modules keep them and they affect downstream merges.)

**Node markers** (`tools:node="..."` on an element):

| Marker | Effect |
|---|---|
| `merge` | Default. Merge attributes + children with the heuristics. |
| `mergeOnlyAttributes` | Merge attributes; drop lower-priority nested elements. |
| `remove` | Remove this element from the merged manifest (e.g. an unwanted library `<meta-data>`). |
| `removeAll` | Remove all elements of this type within the parent. |
| `replace` | Ignore the lower-priority element entirely; use this one as-is. |
| `strict` | Build failure on any difference (overrides heuristics). |

**Attribute markers** (comma-separated attribute lists):

| Marker | Effect |
|---|---|
| `tools:remove="android:attr,..."` | Drop those attributes from the merged result. |
| `tools:replace="android:attr,..."` | Always keep the higher-priority values for those attributes. |
| `tools:strict="android:attr,..."` | Fail on mismatch (default behavior anyway). |

Markers can be combined on one element. `tools:selector="com.example.lib1"` limits a marker to manifests coming from that library.

**overrideLibrary** — import a library whose `minSdk` is higher than the app's:

```xml
<uses-sdk tools:overrideLibrary="com.example.lib1, com.example.lib2"/>
```

**Inspect**: Android Studio → open manifest → **Merged Manifest** tab shows the result, sources, and merge errors. Full decision log: `<module>/build/outputs/logs/manifest-merger-<variant>-report.txt`.

### Merge policies per element

Match keys: `android:name` for most elements (`<activity>`, `<service>`, `<receiver>`, `<provider>`, `<permission>`, `<uses-permission>`, `<uses-library>`, `<meta-data>`, `<action>`, `<category>`, `<instrumentation>`, ...); singletons per parent for `<application>`, `<uses-sdk>`, `<supports-screen>`, `<data>`, `<grant-uri-permission>`, `<path-permission>`; `<screen>` matches on `android:screenSize`; `<uses-feature>` on `android:name` (else `android:glEsVersion`). Policies: **Merge** (most), **Merge children only** (`<manifest>`), **Keep** (`<intent-filter>`, custom elements are always included).

### Manifest placeholders

```groovy
android { defaultConfig { manifestPlaceholders = [hostName: "www.example.com"] } }
```

```xml
<data android:scheme="https" android:host="${hostName}" />
<action android:name="${applicationId}.TRANSMOGRIFY" />
```

`${applicationId}` is always provided and reflects the final per-variant ID.

## Build types

AGP creates `debug` (implicit `debuggable true`, generic debug keystore) and `release` by default.

```groovy
android {
    buildTypes {
        release {
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
        debug {
            applicationIdSuffix ".debug"
            debuggable true
        }
        staging {
            initWith debug            // copy config from another type, then override
            manifestPlaceholders = [hostName: "internal.example.com"]
            applicationIdSuffix ".debugStaging"
        }
    }
}
```

## Product flavors and flavor dimensions

Flavors are versions of the app (free/paid, demo/full). They support the same properties as `defaultConfig` (which is itself a `ProductFlavor`). **Every flavor must belong to a named dimension**; with one dimension AGP assigns automatically.

```groovy
android {
    flavorDimensions "version"
    productFlavors {
        demo { dimension "version"; applicationIdSuffix ".demo"; versionNameSuffix "-demo" }
        full { dimension "version"; applicationIdSuffix ".full"; versionNameSuffix "-full" }
    }
}
```

Variants = flavor(s) × build type, named `<flavor><BuildType>` (`demoDebug`, `fullRelease`, ...). Select via **Build > Select Build Variant**.

**Multiple dimensions**: `flavorDimensions "api", "mode"` — dimension order = priority (first is highest) when merging sources/configs. Variant names order flavors by dimension priority then build type: `minApi24DemoDebug` → APK `app-minApi24-demo-debug.apk`. A common per-API pattern assigns increasing `versionCode` offsets per `minSdk` flavor so the highest compatible variant wins.

## Variant filtering

Remove nonsensical combinations:

```groovy
androidComponents {
    beforeVariants { variantBuilder ->
        if (variantBuilder.productFlavors.containsAll([["api", "minApi21"], ["mode", "demo"]])) {
            variantBuilder.enable = false
        }
    }
}
// legacy Groovy variantFilter { variant -> ... setIgnore(true) } also exists
```

## Creating and remapping source sets

- `./gradlew sourceSets` (or Gradle tool window task) prints where Gradle expects files for every source set.
- Studio creates dirs on demand (File > New > ... with a Target Source Set), or create them manually: `src/debug/java/`, `src/demo/res/`, `src/demoDebug/`, test sets like `src/androidTestDemoDebug/`.
- A source directory can belong to only **one** source set.
- Combination source sets must include **all** flavor dimensions (variant source set = build type + every dimension).

Remap non-standard layouts:

```groovy
android {
    sourceSets {
        main {
            java.srcDirs = ['other/java']
            res.srcDirs = ['other/res1', 'other/res2']   // never a parent of another listed dir
            manifest.srcFile 'other/AndroidManifest.xml' // exactly one manifest per source set
        }
        androidTest { setRoot 'src/tests' }
    }
}
```

Build-time merge rules:
- All `java`/`kotlin` dirs compile together — the **same class defined in two applicable source sets is a "duplicate class" error** (e.g. `src/debug/Utility.kt` + `src/main/Utility.kt`). Each build type must define its own copy and `main/` must not have one.
- Manifests merge by the priority list above.
- `values/` XML files merge value-by-value; `res/` and `assets/` package with priority; library resources/manifests have the lowest priority.

## Per-variant dependencies and variant-aware matching

```groovy
dependencies {
    freeImplementation project(":mylibrary")
    testImplementation 'junit:junit:4.13.2'
    androidTestImplementation 'androidx.test.espresso:espresso-core:3.7.0'
}
```

AGP 3.0+ matches variants automatically: app `freeDebug` consumes library `freeDebug`. When a direct match is impossible you get `Could not resolve project :mylibrary`. Fixes:

- **App has a build type the library lacks** → in the app's build type: `matchingFallbacks = ['debug', 'qa', 'release']` (first available wins). No issue in the reverse direction.
- **Shared dimension, app has a flavor the library lacks** → in that app flavor: `matchingFallbacks = ['demo', 'trial']`. (Not in `defaultConfig`.)
- **Library has a dimension the app lacks** → in the app's `defaultConfig` (overridable per flavor): `missingDimensionStrategy 'minApi', 'minApi18', 'minApi23'` — first is the default chosen flavor. No issue in the reverse direction.

## Signing configuration

Gradle doesn't sign release builds unless configured. Debug is auto-signed with a generic debug keystore.

```groovy
android {
    signingConfigs {
        release {
            storeFile file("myreleasekey.keystore")
            storePassword System.getenv("KSTOREPWD")   // never hardcode passwords
            keyAlias "MyReleaseKey"
            keyPassword System.getenv("KEYPWD")
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
```

Alternatively load keystore details from a local properties file kept **out of source control** (VetTrack's shell uses `android/keystore.properties`). Keep keystore + key backed up; with Play App Signing a lost *upload* key can be reset via Play Console, a lost *app signing* key (pre-Aug-2021 apps without Play App Signing) cannot. Wear OS: watch and phone APKs must be signed with the same key.

## Native debug symbols for Play Console

Release builds strip native libraries; Play can't symbolicate native crashes without a symbols file.

AGP 4.1+ (AAB — included automatically; APK — file output at `app/build/outputs/native-debug-symbols/<variant>/native-debug-symbols.zip`, upload manually):

```groovy
android.buildTypes.release.ndk.debugSymbolLevel = 'SYMBOL_TABLE'   // or 'FULL' (adds files+line numbers; 1.6 GB limit)
```

AGP ≤ 4.0: zip `app/build/intermediates/cmake/universal/release/obj/` contents and upload; strip DWARF with `objcopy --strip-debug` if too large.

## Extending AGP (advanced)

- **Published variant configurations**: `<variant>ApiElements` (compile-time transitive deps exposed to consumers), `<variant>RuntimeElements` (runtime).
- **Custom resolution strategy** per variant classpath:

```groovy
android {
    applicationVariants.all { variant ->
        variant.getCompileConfiguration().resolutionStrategy { /* ... */ }
        variant.getRuntimeConfiguration().resolutionStrategy { /* ... */ }
        variant.getAnnotationProcessorConfiguration().resolutionStrategy { /* ... */ }
    }
}
```

Relevant configurations: `<variant>CompileClasspath`, `<variant>RuntimeClasspath`.
