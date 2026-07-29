# R8 App Optimization

Source: developer.android.com/topic/performance/app-optimization/* (enable, full-mode, packageScope, configuration analyzer, choose libraries, adopt incrementally, resource shrinking, test/troubleshoot, library authors). Keep-rule syntax itself lives in `keep-rules.md`.

## Table of contents

1. [What R8 does](#what-r8-does)
2. [Enabling optimization](#enabling-optimization)
3. [Getting the most out of R8](#getting-the-most-out-of-r8)
4. [AGP / R8 version behavior changes](#agp--r8-version-behavior-changes)
5. [R8 full mode](#r8-full-mode)
6. [Adopting R8 incrementally](#adopting-r8-incrementally)
7. [packageScope — optimize specific packages](#packagescope--optimize-specific-packages)
8. [R8 Configuration Analyzer](#r8-configuration-analyzer)
9. [Choosing R8-friendly libraries](#choosing-r8-friendly-libraries)
10. [Resource shrinking](#resource-shrinking)
11. [Testing the optimization](#testing-the-optimization)
12. [Troubleshooting](#troubleshooting)
13. [Optimization for library authors](#optimization-for-library-authors)

## What R8 does

R8 is the app optimizer, run for builds with minification enabled. Benefits: faster startup, less memory, better rendering/runtime performance, fewer ANRs. Phases:

- **Code shrinking (tree shaking)** — removes unreachable code, starting from manifest entry points.
- **Logical optimizations** — method inlining, class/interface merging, rewriting for efficiency.
- **Obfuscation (minification)** — shortens class/field/method names (`com.example.MyActivity` → `a.b.a`).
- **Resource shrinking** — since AGP 8.12, resources join the optimization pipeline (see below).

Always enable for release builds; usually not for tests or debug (slower builds, harder debugging). Tools that post-process R8's DEX output can break its optimizations and Baseline Profile correctness.

## Enabling optimization

**Legacy DSL (AGP < 9.3 — applies to VetTrack's AGP 8.13):**

```groovy
android {
    buildTypes {
        release {
            minifyEnabled true          // code optimization
            shrinkResources true        // resource shrinking (requires minifyEnabled)
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

> Older projects may still reference `proguard-android.txt` — it contains `-dontoptimize` and blocks most optimizations. **Migrate to `proguard-android-optimize.txt`.** (VetTrack's `android/app/build.gradle` currently uses the legacy file with `minifyEnabled false`.)

**New DSL (AGP 9.3+):** `release { optimization { enable = true } }` — enables code+resource optimization, includes default Android keep rules (opt out with `optimization.keepRules.includeDefault = false`), and reads keep rules from the `src/<variant>/keepRules/*.keep` source set.

## Getting the most out of R8

- Enable **full mode** (remove `android.enableR8.fullMode=false` from `gradle.properties` if present).
- Keep obfuscation, optimization, and shrinking all on in production.
- Enable resource shrinking; on AGP 8.12–8.13 also `android.r8.optimizedResourceShrinking=true` for the integrated code+resource reference graph (default from AGP 9.0).
- Refine keep rules to be as narrow as possible (see `keep-rules.md`), audited with the Configuration Analyzer.
- Also create Startup Profiles for DEX layout (see `baseline-startup-profiles.md`).
- Obfuscated stack traces: retrace with `mapping.txt` (see [Troubleshooting](#troubleshooting)).

## AGP / R8 version behavior changes

| AGP | Change |
|---|---|
| 9.3 | New `optimization {}` DSL; `keepRules` source set (`src/<variant>/keepRules/*.keep`); KMP consumer-rules support. Legacy DSL still works. |
| 9.1 | Classes **repackaged by default** (moved to unnamed top-level package) — `-repackageclasses` no longer needed; opt out with `-dontrepackage`. |
| 9.0 | Optimized resource shrinking on by default; library **global options filtered out** of consumer rules; Kotlin null checks optimized by default (`-processkotlinnullchecks`); experimental `packageScope`; `proguard-android.txt` support **dropped** (use `-optimize` variant). |
| 8.12 | Optimized resource shrinking opt-in (`android.r8.optimizedResourceShrinking`); Logcat auto-retracing. |
| 8.6 | Filename + line-number retracing by default for all minSdk. |
| 8.0 | **Full mode by default** (opt out `android.enableR8.fullMode=false`). |
| 7.0 | Full mode available opt-in. |

## R8 full mode

Default since AGP 8.0. Stricter assumptions about reflection → more optimization, but may need extra keep rules. Key behavior differences vs compat mode:

1. **Attributes stripped unless the owner is kept** — `Signature` (generics after type erasure), `InnerClasses`/`EnclosingMethod`, runtime-visible annotations are retained only for classes/members matched by a keep rule. Reflection-heavy libraries (Gson `TypeToken`) break without e.g.:
   ```
   -keepattributes Signature
   -keep,allowobfuscation,allowshrinking,allowoptimization class com.google.gson.reflect.TypeToken { *; }
   -keep,allowobfuscation,allowshrinking,allowoptimization class * extends com.google.gson.reflect.TypeToken
   ```
   (Gson ≥ 2.11.0 bundles these.)
2. **Default constructor not implicitly kept** — `Class.getDeclaredConstructor().newInstance()` needs an explicit `{ <init>(); }` keep.
3. **Access modification enabled** — R8 may widen visibility (private→public) for inlining; reflection relying on specific visibility needs keeps.
4. **Kotlin metadata** — if `kotlin.reflect` is used, keep `-keepattributes RuntimeVisibleAnnotations` and `-keep class kotlin.Metadata { *; }` or reflection fails (`KotlinReflectionInternalError`).

## Adopting R8 incrementally

For a large codebase turning R8 on for the first time:

1. **Tree shaking only** first — temporarily add `-dontobfuscate` and `-dontoptimize` (never ship these).
2. Optionally start in **compat mode**: `android.enableR8.fullMode = false` (temporary).
3. Fix issues, then remove the temporary flags to restore obfuscation/optimization/full mode.
4. **Limit scope, not the whole feature**: if one area breaks, add a *temporary* package-wide keep (`-keep class com.myapp.json.** { *; }` or for a reflective library `-keep class com.somelibrary.** { *; }`) instead of disabling R8 globally. Never `-keep **` / `-keep com.myapp.**`.
5. Later replace package-wide keeps with targeted rules (interface-implementers / annotation-based patterns) or remove the reflection/library that required them.

## packageScope — optimize specific packages

AGP 9.0+, full mode only, **for apps not yet using R8** (suboptimal if R8 already on — refine keep rules instead). Scopes optimization to safe packages first:

```groovy
// gradle.properties: android.r8.gradual.support=true
android {
    buildTypes {
        release {
            optimization {
                enable = true
                packageScope = ["androidx.**", "kotlin.**", "kotlinx.**"]
            }
        }
    }
}
```

Transition path: start with AndroidX/Kotlin → add stable Google/OkHttp-style packages (prioritize by APK Analyzer size, avoid reflection/serialization/JNI-heavy libs) → test each addition → add app packages → finally remove `packageScope` for whole-app full mode.

## R8 Configuration Analyzer

R8 ≥ 9.3.7-dev / AGP ≥ 9.3.0-alpha05. Reports **shrinking / optimization / obfuscation scores** (percent of codebase R8 may touch) and per-keep-rule impact.

- Standalone task: `./gradlew :app:analyzeReleaseR8Config` → `app/build/reports/r8/r8-config-analyzer-release.html` (fast, skips APK build).
- Auto during release builds → `build/outputs/mapping/release/configanalyzer.html`; disable with `android.experimental.r8.enableR8ConfigurationAnalyzer=false`.
- AGP ≤ 9.2: `./gradlew assembleRelease -Dcom.android.tools.r8.dumpkeepradiushtmltodirectory=<dir>`.

Use it to: find the broadest keep rules and what they block; trace third-party consumer rules that hurt optimization (contact maintainers, or filter — see below); detect **subsumed rules** (overlapping rules where a broad one swallows a narrow one — keep whichever is correct, delete the other); prune **unused** and **identical** rules. Default AGP rules also appear — don't change those.

## Choosing R8-friendly libraries

- **Prefer codegen over reflection** (KSP-based: Room, Hilt, Moshi-codegen, kotlinx.serialization). Reflection signs: `kotlin.reflect`/`java.lang.reflect` imports, `Class.forName`, `classLoader.getClass`, runtime annotation reads, method calls by name string.
- Check the library's issue tracker for minification issues before adopting.
- Avoid libraries that require copy-pasted or package-wide keep rules; good libraries bundle minimal consumer rules.
- After adding a library, build with optimization enabled and test; file bugs on incompatible libraries.
- **Filter bad consumer rules** (keep rules are additive; a library's `-dontobfuscate` etc. affects the whole app):
  ```groovy
  // AGP 8.4+
  buildTypes { release { optimization.keepRules { it.ignoreFrom("com.somelibrary:somelibrary") } } }
  // AGP 7.3–8.3: it.ignoreExternalDependencies("com.somelibrary:somelibrary")
  ```
- **Gson case study**: `Gson().fromJson(json, User::class.java)` constructs app classes via open-ended reflection — R8 renames fields / removes constructors → runtime crash. Mitigate with `@SerializedName` on fields (works with Gson ≥ 2.11 bundled rules) or migrate to codegen serialization.

## Resource shrinking

`shrinkResources true` (with `minifyEnabled true`) removes unreferenced resources. Optimized resource shrinking (AGP 8.12+ flag, 9.0+ default) treats resources as part of the reference graph — removes resources referenced only from unused code; size wins of 50%+ reported for multi-form-factor apps.

**Keep/discard specific resources** — an XML keep file, e.g. `res/raw/my.package.keep.xml` (global scope — use a unique, package-prefixed filename; not packaged into the app):

```xml
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@layout/l_used*_c,@layout/l_used_a,@layout/l_used_b*"
    tools:discard="@layout/unused2" />
```

Keeping is rarely needed (`Resources.getIdentifier()` dynamic lookups are the main case). Per-variant removal: put a `my.package.<variant>.keep.xml` in each variant's res dir.

**Remove unused alternative resources** (e.g. library translations for locales the app doesn't support):

```groovy
android { defaultConfig { resConfigs "en", "fr" } }
```

(AABs already deliver only device-matching language/density/ABI splits.)

**Resource merging** (independent of shrinking, can't be disabled): identical name+type+qualifier duplicates merge with priority Dependencies → Main → Build flavor → Build type (rightmost wins). Duplicates within the same source set are a merge error.

**Troubleshooting shrinking**: the Build window logs `Removed unused resources: ... Removed XX%`; `<module>/build/outputs/mapping/release/resources.txt` explains reachability chains ("root reachable resources", format-string matches like `ic_plus_anim_%1$d` that keep resources conservatively — use `tools:discard` if you know they're safe).

## Testing the optimization

Locally:
- Benchmark before/after (Macrobenchmark — see `baseline-startup-profiles.md`).
- Exercise all critical user journeys on the release build (UI Automator).

In production:
- Track Android vitals in Play Console.
- Use **staged rollouts** — keep-rule gaps in rarely-used code often only surface in the field; watch crash regressions.

## Troubleshooting

**Crashes after enabling R8** — almost always broken reflection. Signals: `ClassNotFoundException`, `NoSuchMethodException`, `NoSuchFieldException`, `NoClassDefFoundError`, `NoSuchMethodError`, `NoSuchFieldError`; code using `Class.forName(...)`, `Something::class.constructors`, `kotlin.reflect`/`java.lang.reflect`. **Fix: add a targeted keep rule** (`keep-rules.md`).

**Which rules actually applied** — merged report of every rule from app + all libraries: `app/build/outputs/mapping/configuration.txt`.

**Why is this code kept** — `-whyareyoukeeping` (see `keep-rules.md` → Troubleshooting rules).

**Deobfuscating stack traces** — Studio Otter 3 / AGP 9.0 Logcat auto-retraces. Manually:

```bash
$ANDROID_HOME/cmdline-tools/latest/bin/retrace app/build/outputs/mapping/<variant>/mapping.txt trace.txt
```

`mapping.txt` is bundled in AABs; it's **overwritten every build — archive a copy per release**. Play/Crashlytics use it to deobfuscate user crashes.

## Optimization for library authors

Two rule types:
- **Consumer keep rules** — bundled with the AAR/JAR, applied automatically to consuming apps. Declare via `consumerProguardFiles 'consumer-proguard-rules.pro'` (AAR) or ship in the JAR at `META-INF/proguard/<file>.pro`. Must cover everything the library reflects on.
- **Library build keep rules** (`proguardFiles`) — only if optimizing the library artifact itself; must keep the public API.

Hard requirements for Android-appropriate libraries:
- **No broad/package-wide keep rules** in consumer rules (bloats every consuming app).
- **No global options** in consumer rules (`-dontobfuscate`, `-allowaccessmodification`, `-repackageclasses`, `-include`, `-injars`, `-printmapping`, `-applymapping`, dictionaries, etc. — AGP 9.0 filters them out anyway).
- **Prefer codegen**; if reflection is unavoidable, reflect only into specific interface implementers/subclasses or runtime-annotated code, so targeted consumer rules are possible.
- **Support full mode.**
- Keep `RuntimeVisibleAnnotations` in consumer rules if annotations are read at runtime; declare needed attributes explicitly even if `proguard-android-optimize.txt` overlaps.
- Whole-program optimization at the **app** level always beats library-time optimization; apps shouldn't blanket-keep "pre-obfuscated" libraries. If optimizing an AAR build anyway, `-repackageclasses '<your.package>.internal'` (never bare `'internal'`).
- **Version-targeted rules** (advanced): place rules under `META-INF/com.android.tools/r8-from-<X>-upto-<Y>/` (in `classes.jar` for AARs) to serve different R8 versions; `<Y>` exclusive; legacy locations (`proguard.txt` in AAR root / `META-INF/proguard/`) used as fallback.
