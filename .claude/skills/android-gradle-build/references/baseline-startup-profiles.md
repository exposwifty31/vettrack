# Baseline Profiles and Startup Profiles

Source: developer.android.com/topic/performance/baselineprofiles/* (overview, create, library, gradle plugin, measure, manual create/measure, debug, case study, dex-layout-optimizations, confirm-startup-profiles, baseline vs startup).

## Table of contents

1. [What Baseline Profiles are](#what-baseline-profiles-are)
2. [Baseline vs Startup Profiles vs Cloud Profiles](#baseline-vs-startup-profiles-vs-cloud-profiles)
3. [Profile generation vs release builds](#profile-generation-vs-release-builds)
4. [AGP version capabilities](#agp-version-capabilities)
5. [Creating a Baseline Profile](#creating-a-baseline-profile)
6. [Baseline Profiles for libraries](#baseline-profiles-for-libraries)
7. [Baseline Profile Gradle plugin configuration](#baseline-profile-gradle-plugin-configuration)
8. [Measuring effectiveness (Macrobenchmark)](#measuring-effectiveness-macrobenchmark)
9. [TTID / TTFD and capturing all code paths](#ttid--ttfd-and-capturing-all-code-paths)
10. [Manual profile rules and collection](#manual-profile-rules-and-collection)
11. [Profgen and profile installation mechanics](#profgen-and-profile-installation-mechanics)
12. [Debugging and verification](#debugging-and-verification)
13. [Startup Profiles (DEX layout)](#startup-profiles-dex-layout)
14. [Known issues and field results](#known-issues-and-field-results)

## What Baseline Profiles are

Baseline Profiles ship a list of hot/startup methods+classes with the app so ART can **AOT-compile** those code paths at install time (Profile Guided Optimization), skipping interpretation and JIT. Typical gains: ~30% faster code execution from first launch; app startup, scroll/jank, and overall runtime improve — which correlates with retention/ratings (Josh, Lyft, TikTok, Zomato, Google Calendar case studies).

Workflow: human-readable rules are generated per release → compiled into binary `assets/dexopt/baseline.prof` inside the APK/AAB (**compiled profile must be < 1.5 MB**) → Play ships the profile with the install → ART AOT-compiles listed methods at install → Cloud Profiles refine over time.

What to include: startup journeys plus critical in-app journeys (scrolling lists, navigation, registration/login/payment flows). Overly broad profiles can *hurt* startup (more disk access) — measure. When A/B-testing performance work, ship profiles for both arms so results aren't confounded by compilation state.

## Baseline vs Startup Profiles vs Cloud Profiles

| | Baseline Profile | Startup Profile | Cloud Profile |
|---|---|---|---|
| Consumed by | ART on device (install-time AOT) | D8/R8 at **build time** — DEX layout | ART (install-time AOT) |
| Effect | Pre-compiled hot paths (startup + beyond) | Startup classes packed into the primary `classes.dex` → ~15–30% faster startup on top of Baseline | Aggregated real-usage PGO |
| File | `baseline-prof.txt` → `baseline.prof` in APK | `startup-prof.txt` (build input only — no file in the APK) | Play-side |
| Journeys | Chosen by you (all critical CUJs) | Only tests collected with `includeInStartupProfile = true`; **libraries cannot contribute** | Automatic from users |
| Availability | Immediate, every install, Android 7+ (API 24+) | Immediate (build-time) | 1–2 days post-release, Android 9+, large user base |

Use **both** profile types plus Cloud Profiles. Baseline rules are generally a superset of startup rules.

Compilation behavior by platform: API 21–23 full AOT at install; API 24–27 partial AOT via `androidx.profileinstaller` on first run; API 28+ Play compiles Baseline (+Cloud) profiles during install and uploads usage profiles for aggregation.

## Profile generation vs release builds

- **Generating profiles**: the generation variant must have **R8 off** (`minifyEnabled false` / `-dontobfuscate -dontoptimize`) so rules match real method signatures. The Baseline Profile Gradle plugin creates `nonMinified<Type>` build types that handle this.
- **Release build**: keep `minifyEnabled true`; since AGP 8.2, D8/R8 rewrite the unobfuscated rules to match the optimized code (~30% more method coverage, ~15% perf). DEX layout optimization requires an R8-optimized release build.

## AGP version capabilities

| AGP | Baseline-profile features |
|---|---|
| 9.1 | Multiple arbitrary profile files in variant-aware dirs for **library** modules too. |
| 8.4 | Local installs of non-debuggable builds (Studio/`gradlew`) install profiles → local release ≈ production. |
| 8.3 | Variant-aware profile dirs for libraries; desugared classes included. |
| 8.2 | **R8 rule rewriting**; **Startup Profiles** for DEX layout. |
| 8.0 | Minimum recommended. Baseline Profile Gradle plugin single-task generation; full variant-aware source dirs for apps (`src/<variant>/generated/baselineProfiles/`). |
| 7.4 | Minimum supported: consume library profiles; own profile at `src/main/baseline-prof.txt`. |

Minimum toolchain: AGP 8.0+, `androidx.benchmark:benchmark-macro-junit4:1.4.1+`, `androidx.profileinstaller:profileinstaller:1.4.1+`.

## Creating a Baseline Profile

**Preferred — Studio Baseline Profile Generator module template** (Studio Iguana+/AGP 8.2+): File > New > New Module > *Baseline Profile Generator*. Creates the test module, build config, a startup generator + benchmark, and a run configuration. Generated profile is copied to `app/src/<variant>/generated/baselineProfiles/baseline-prof.txt`. CLI: `./gradlew :app:generateBaselineProfile` (or `generate<Variant>BaselineProfile`).

**Generator test shape** (`BaselineProfileRule` from Macrobenchmark):

```kotlin
class BaselineProfileGenerator {
    @get:Rule val baselineProfileRule = BaselineProfileRule()

    @Test
    fun appStartupAndUserJourneys() {
        baselineProfileRule.collect(
            packageName = PACKAGE_NAME,
            includeInStartupProfile = true   // only for startup-essential journeys
        ) {
            uiAutomator {
                startApp(PACKAGE_NAME)
                onElement { textAsString() == "COMPOSE LAZYLIST" }.click()
                onElement { viewIdResourceName == "myLazyColumn" }.also {
                    it.fling(Direction.DOWN); it.fling(Direction.UP)
                }
                pressBack()
            }
        }
    }
}
```

Abstract CUJ automation into shared helpers used by both the generator and the benchmarks. Non-startup journeys go in `rule` blocks **without** `includeInStartupProfile = true`.

**Manual plugin setup** (no template; AGP 8.1+): create a `com.android.test` module (`:baseline-profile`) with the `androidx.baselineprofile` plugin, `targetProjectPath ':app'`, optionally a Gradle-managed device (`systemImageSource 'aosp'` — root needed pre-API-33); apply `androidx.baselineprofile` in the app module and add `baselineProfile project(':baseline-profile')` to its dependencies; run `generateBaselineProfile`.

**AGP 7.3–7.4**: no plugin; run the test module task directly (`./gradlew :benchmark:pixel6Api31BenchmarkAndroidTest`), then copy the HRF from `[module]/build/outputs/managed_device_android_test_additional_output/[device]/<Class>-<method>-baseline-prof.txt` to `app/src/main/baseline-prof.txt`, and add the `profileinstaller` dependency.

## Baseline Profiles for libraries

Three modules: sample app, the library, and the profile test module. The test module targets the **sample app** (`targetProjectPath`). In the library's build file: apply `androidx.baselineprofile`, `baselineProfile project(':baseline-profile')`, and **filter** to the library's packages:

```groovy
baselineProfile { filter { include 'com.mylibrary.**' } }
```

`./gradlew :library:generateBaselineProfile` → profile at `library/src/main/generated/baselineProfiles`. Library profiles merge into consuming apps automatically. (Library support needs plugin 1.2.3+ or AGP 8.3+.)

## Baseline Profile Gradle plugin configuration

All inside `baselineProfile { }`:

- `managedDevices ['pixel6Api31']` + `useConnectedDevices false` — generate on a GMD instead of a plugged device (connected devices need root or API 33+).
- `mergeIntoMain` — `true`: one merged profile at `src/main/generated/baselineProfiles`, single `generateBaselineProfile` task (default for **libraries**); `false`: per-variant profiles under `src/<variant>/generated/baselineProfiles` with per-variant tasks (default for **apps**). Settable per variant.
- `automaticGenerationDuringBuild = true` — regenerate on every release assembly (runs the instrumentation tests; doubles build work). Disable ad hoc with `-Pandroid.baselineProfile.automaticGenerationDuringBuild=false`.
- `saveInSrc` — `true`: commit profiles under `src/`; `false`: keep in build intermediates.
- `warnings { maxAgpVersion / disabledVariants / multipleBuildTypesWithAgp80 / noBaselineProfileRulesGenerated / noStartupProfileRulesGenerated }` — toggle plugin warnings.
- `filter { include 'com.myapp.**'; exclude 'com.myapp.debug.**' }` — `pkg.**` = subpackages, `pkg.*` = one level, exact class names allowed; configurable globally, per flavor, per build type, per variant (variant filters add to flavor+type+global).
- The plugin creates `benchmark<Type>` and `nonMinified<Type>` build types. Customizable (e.g. `signingConfig`), but from plugin 1.2.4 these are always forced: not debuggable/jniDebuggable, `minifyEnabled false`, `shrinkResources false`, profileable, no test coverage.

## Measuring effectiveness (Macrobenchmark)

Compare `CompilationMode`s on a **physical device** (emulators mislead):

```kotlin
@Test fun startupNoCompilation() = startup(CompilationMode.None())                     // fresh install, no profiles — worst case
@Test fun startupPartialWithBaselineProfiles() =
    startup(CompilationMode.Partial(baselineProfileMode = BaselineProfileMode.Require)) // what users get
@Test fun startupPartialCompilation() = startup(
    CompilationMode.Partial(baselineProfileMode = BaselineProfileMode.Disable, warmupIteration = 3)) // JIT-warmed
@Test fun startupFullCompilation() = startup(CompilationMode.Full())                    // stability reference

private fun startup(compilationMode: CompilationMode) = benchmarkRule.measureRepeated(
    packageName = "com.example.macrobenchmark.target",
    metrics = listOf(StartupTimingMetric()),
    compilationMode = compilationMode,
    iterations = 10, startupMode = StartupMode.COLD,
    setupBlock = { pressHome() }
) { uiAutomator { startApp(packageName); onElement(5_000) { viewIdResourceName == "my-content" } } }
```

Also consider `FrameTimingMetric` for jank. Results export as JSON for CI.

**Isolating your custom profile from library profiles**: AGP always merges library profiles. To measure the delta of your own rules, create a `releaseWithoutCustomProfile` build type (initWith release) in both consumer and producer modules, and scope the `baselineProfile { variants { release { from(project(":baselineprofile")) } } }` dependency to `release` only.

**Reduce noise**: avoid network (and ideally disk) I/O during startup; architecture should support I/O-free startup for benchmarking (Hilt: fake I/O-bound bindings).

## TTID / TTFD and capturing all code paths

- **TTID** — first frame drawn. **TTFD** — app fully drawn and interactive; reported by `reportFullyDrawn()` (else TTID is used). Optimize both.
- Code that runs after first-draw but before "really ready" (e.g. async list population) is **excluded** from the profile unless TTFD is deferred: use `FullyDrawnReporter` (`getFullyDrawnReporter()`, add/release reporters around background loads).
- Compose: `ReportDrawn` (ready now), `ReportDrawnWhen { predicate }`, `ReportDrawnAfter { suspending work }`.

## Manual profile rules and collection

**HRF rule syntax** (`baseline-prof.txt`, one rule per line):

```
[FLAGS][CLASS_DESCRIPTOR]->[METHOD_SIGNATURE]     # method rule
[CLASS_DESCRIPTOR]                                 # class rule (startup preallocation)
```

- `FLAGS`: `H` hot, `S` startup, `P` post-startup (combinable, e.g. `HSPL...`).
- `CLASS_DESCRIPTOR`: DEX format — `Landroidx/compose/runtime/SlotTable;`.
- `METHOD_SIGNATURE`: name + param/return types in DEX descriptors: `B` byte, `C` char, `D` double, `F` float, `I` int, `J` long, `S` short, `V` void, `Z` boolean, `L<class>;` reference. E.g. `isPlaced()Z`.
- Wildcards supported: `HSPLandroidx/compose/ui/layout/**->**(**)**`.

Example rules:

```
HSPLandroidx/compose/runtime/ComposerImpl;->updateValue(Ljava/lang/Object;)V
PLandroidx/compose/runtime/CompositionImpl;->applyChanges()V
Landroidx/compose/runtime/ComposerImpl;
```

Library AAR rules merge at APK build into the binary profile.

**Manual collection without Macrobenchmark** (easiest on API 34+; lower APIs need root/AOSP emulator): install a non-debuggable, non-minified release build → disable ProfileInstaller (`adb shell am broadcast -a androidx.profileinstaller.action.SKIP_FILE ...`) → reset compile state (`cmd package compile -f -m verify` + `pm art clear-app-profiles`; API ≤33: `cmd package compile --reset`) → drive the CUJs manually, wait ≥5s → save (`androidx.profileinstaller.action.SAVE_PROFILE` broadcast, or root `killall -s SIGUSR1 <pkg>`), force-stop → dump to text (`adb shell pm dump-profiles --dump-classes-and-methods <pkg>`; API ≤33: `profman --dump-classes-and-methods --profile-file=... --apk=...`) → `adb pull` into `src/main/`.

**Manual measurement without Macrobenchmark** (API 28–30 sideload flow): measure baseline `am start-activity -W ... | grep TotalTime` after `compile --reset`; then zip `assets/dexopt/baseline.prof{,m}` from the APK as `primary.prof{,m}` into `release.dm` and `adb install-multiple release.apk release.dm`; verify with `dumpsys package dexopt` → expect `[status=speed-profile] [reason=install-dm]`; re-measure without resetting.

## Profgen and profile installation mechanics

- **Profgen-cli** (in `cmdline-tools`) compiles HRF → binary: `profgen bin ./baseline-prof.txt --apk ./release.apk --map ./obfuscation-map.txt --profile-format v0_1_0_p --output ./baseline.prof`. Formats are version-locked: `v0_1_5_s` (API 31+), `v0_1_0_p` (28–30; use this when bundling in assets), `v0_0_9_omr1` (27), `v0_0_5_o` (26), `v0_0_1_n` (24–25). The obfuscation map translates source symbols for R8-obfuscated builds. `profgen dumpProfile -p profile -a apk -o out.txt [--strict false]` decompiles a binary profile; `profgen extractProfile --apk app.apk --output-dex-metadata app.dm --profile-format V0_1_5_S` builds a `.dm` for `install-multiple` sideloading (per split APK, matching names).
- **Delivery**: API 28+ Play installs APK + DexMetadata (`.dm`) in one session; API 24+ the Jetpack **ProfileInstaller** library installs the packaged profile post-install (picked up by `bg-dexopt` when idle) — declare the `profileinstaller` dependency.
- Manual install broadcast (API 24+): `adb shell am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE <pkg>/androidx.profileinstaller.ProfileInstallReceiver` → force-stop → `cmd package compile -f -m speed-profile <pkg>`.

## Debugging and verification

**Is the profile in the artifact?** APK Analyzer (Build > Analyze APK): APK → `/assets/dexopt/baseline.prof`; AAB → `/BUNDLE-METADATA/com.android.tools.build.profiles/baseline.prof`. Check binary size < 1.5 MB there.

**Is it compiled on device?** Use `ProfileVerifier.getCompilationStatusAsync()` (log in `onResume`; wire to analytics in production to catch releases missing profiles). Result codes:

| Code | Meaning / action |
|---|---|
| `RESULT_CODE_COMPILED_WITH_PROFILE` | Working as intended. |
| `RESULT_CODE_ERROR_NO_PROFILE_EMBEDDED` | APK has no profile — wrong variant/build config. |
| `RESULT_CODE_NO_PROFILE` | Installed without profile (ProfileInstallerInitializer disabled?). |
| `RESULT_CODE_PROFILE_ENQUEUED_FOR_COMPILATION` | Awaiting background dexopt — don't benchmark yet; force with `adb shell cmd package compile -r bg-dexopt <pkg>`. |
| `RESULT_CODE_COMPILED_WITH_PROFILE_NON_MATCHING` | Store-installed profile only partially matches this binary — fewer methods compiled. |
| Cache-file / API-version errors | Disk/permission issues or API < 28. |

Without ProfileVerifier: `adb shell dumpsys package dexopt | grep -A 2 <pkg>` → `status=speed-profile` (compiled) vs `verify` (not yet); `reason=install-dm` (Play/manual at install), `bg-dexopt` (idle), `cmdline` (adb).

**Emulator test failures** in Now-in-Android-style setups (`AssertionError: ERRORS (not suppressed): EMULATOR`): benchmarks shouldn't run on emulators, but *generation* may — pass `-Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=BaselineProfile` (or a custom Studio run configuration).

## Startup Profiles (DEX layout)

Requirements: Macrobenchmark 1.2.0+, AGP 8.2+ (8.3+ for per-variant startup profiles; 8.1–8.2 need `baselineProfile { dexLayoutOptimization = true }`), **R8 enabled** (`minifyEnabled true`).

- Collected from generator tests with `includeInStartupProfile = true`; rules land in `src/<variant>/generated/baselineProfiles/startup-prof.txt`, consumed by AGP at build time.
- Cover real entry points: launcher activity, notification launches, deep links (`startIntent(Intent().apply { setPackage(packageName); setAction("com.example.app.NEWS_FEED") })`).
- Goal: startup code fits in the **first** `classes.dex`. Work down the entry-point funnel and stop before it overflows; move code off the startup path (inspect Perfetto traces / method tracing) before adding more journeys. Affects APK size — A/B test.
- Desugared-API compat classes always sit in the last DEX and don't participate.

**Confirming DEX layout worked**:
- AGP 8.8+: unzip the AAB's `BUNDLE-METADATA/com.android.tools/r8.json` → a `dexFiles` entry with `"startup": true`; checksums should match `sha256sum` of the DEX files.
- Any AGP: APK Analyzer → first `classes.dex` should contain the startup classes from `startup-prof.txt`. Studio warns when startup classes don't fit one DEX; R8 ≥ 8.3.21 prints diagnostics with `./gradlew assembleRelease --info`.

## Known issues and field results

- Generation may fail on some OEM devices (OnePlus: disable "Disable permission monitoring"); not supported on Firebase Test Lab / GMD Test Lab devices; Play **internal app sharing** doesn't support profiles (internal *testing track* does); non-Play channels may defer benefit to overnight bg-dexopt; disable battery optimizations on benchmark devices (Huawei).
- `generateBaselineProfile` on AGP ≤ 8.1/8.2 quirks: runs benchmarks too (filter with `enabledRules=BaselineProfile`), and the all-types task only generated for release (fixed 8.1/8.2).
- Google Calendar results (controlled release): ~20% faster startup, 42–60% fewer janky frames in profiled views; Cloud Profiles slightly narrow the delta over the first week. A/B via Play isn't possible for compile-time profiles — use off-cycle releases or local benchmarks (best case; no Cloud Profile effect).
