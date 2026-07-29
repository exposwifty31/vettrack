# App Startup Analysis, Modularization, and Resources

Source: developer.android.com/topic/performance/appstartup/*, Gmail Wear OS case study, App Startup library (androidx.startup), topic/modularization/*, guide/topics/resources/providing-resources.

## Table of contents

1. [App startup analysis](#app-startup-analysis)
2. [Case study: Gmail Wear OS startup](#case-study-gmail-wear-os-startup)
3. [App Startup library (androidx.startup)](#app-startup-library-androidxstartup)
4. [Modularization](#modularization)
5. [App resources](#app-resources)

## App startup analysis

Measure with Macrobenchmark (`StartupTimingMetric`), inspect with system traces in Perfetto or Studio Profiler.

**Method**: for each expensive startup operation ask — how long does it take (benchmark it); is it critical to startup or can it wait until fully drawn; is it even expected (legacy/third-party init); can it move to the background (still costs CPU)? Optimize, re-measure, repeat.

**In the trace**:
- Measure major slices: `bindApplication`, `activityStart`, `Choreographer#doFrame`, initial composition, library loads, `Binder` transactions, resource loads. Investigate anything > ~20 ms, anything blocking the main thread, anything that needn't run at startup or can wait past first frame.
- **Main thread**: must stay responsive. Large `Runnable` (waiting for CPU) time vs `Running` = CPU contention (fewer cores → more expected). `Sleeping` = waiting on another thread — find it, check for lock contention. Blocked/uninterruptible sleep (orange) = often I/O — other processes' I/O contends too.
- **Expensive main-thread ops**: enable `StrictMode.ThreadPolicy` (`detectAll().penaltyDeath()`) on debug builds to catch disk/network on main early.
- **`OpenDexFilesFromOat*`** (alongside `bindApplication`) = DEX read time → reduce with R8 minification.
- **Binder transactions**: avoid during startup; defer, cache results, or move to background; keep unavoidable ones under the Vsync interval. Trace the `binder reply` thread and Ftrace events to see what delays them.
- **JIT activity** ("Jit thread pool" rows): heavy JIT right after first frame ⇒ extend Baseline Profile collection until the app is fully usable (e.g. wait for a key widget at the end of the generator test).

**TTID/TTFD**: TTID = first frame (system-reported); TTFD = interactive (`reportFullyDrawn()` — app's responsibility; see `baseline-startup-profiles.md`). Improvements: lazy/async loading for TTID; minimize binder calls; show a minimal-rendering placeholder early; ship a Startup Profile; use the App Startup library.

**UI/frame analysis**: prioritize slow composition/layout phases; frame data via `dumpsys gfxinfo`/`framestats` (trend tracking), JankStats (field), Macrobenchmark `FrameTimingMetric`, Perfetto FrameTimeline (API 31+), Studio jank detection. Main activity: lightweight initial composition ([Compose performance]), custom tracepoints, minimize startup bitmaps, defer non-visible UI via conditional composition:

```kotlin
var shouldLoad by remember { mutableStateOf(false) }
if (shouldLoad) { MyComposable() }
LaunchedEffect(Unit) { shouldLoad = true }
```

## Case study: Gmail Wear OS startup

Findings from a Perfetto pass (pin **Android App Startups** + main-thread rows): CPU contention from a spinner animation during startup → replaced with a static image + prolonged splash to defer shimmer (**−50% startup latency**); `OpenDexFilesFromOat*` + post-first-frame JIT → enabled R8 rewriting of Baseline Profiles (AGP 8.2+) (**−20%**). Process tips: automate trace collection/benchmarking in CI; A/B changes via Macrobenchmark and reject what doesn't move numbers.

## App Startup library (androidx.startup)

`androidx.startup:startup-runtime` replaces per-library init `ContentProvider`s (expensive, undefined order) with one `InitializationProvider` running explicit initializers.

```kotlin
class WorkManagerInitializer : Initializer<WorkManager> {
    override fun create(context: Context): WorkManager {
        WorkManager.initialize(context, Configuration.Builder().build())
        return WorkManager.getInstance(context)
    }
    override fun dependencies(): List<Class<out Initializer<*>>> = emptyList()
}

class ExampleLoggerInitializer : Initializer<ExampleLogger> {
    override fun create(context: Context) = ExampleLogger(WorkManager.getInstance(context))
    override fun dependencies() = listOf(WorkManagerInitializer::class.java)  // ordering
}
```

Manifest (discoverable = has `<meta-data>` under `InitializationProvider`, or is a dependency of a discoverable initializer):

```xml
<provider
    android:name="androidx.startup.InitializationProvider"
    android:authorities="${applicationId}.androidx-startup"
    android:exported="false"
    tools:node="merge">
    <meta-data android:name="com.example.ExampleLoggerInitializer" android:value="androidx.startup" />
</provider>
```

- Remove old init content providers when migrating.
- **Lazy init**: disable one initializer with `<meta-data android:name="..." tools:node="remove"/>` (also disables its dependents' auto-init of it), or the whole provider with `tools:node="remove"` on `<provider>`; then call manually: `AppInitializer.getInstance(context).initializeComponent(ExampleLoggerInitializer::class.java)` (dependencies initialize too).
- Lint checks: `./gradlew :app:lintDebug`.

## Modularization

### Why and when

Splitting a codebase into loosely-coupled modules buys: **reusability** (multiple apps from shared building blocks; per-flavor feature inclusion), **strict visibility control** (`internal`/`private` beyond module boundaries), **customizable delivery** (Play Feature Delivery), and helps scalability, ownership, encapsulation, testability, and build time (incremental/parallel/cached builds). Pitfalls: too fine-grained (per-module overhead, config sprawl), too coarse (a second monolith), unnecessary for small projects.

### Guiding principle

**Low coupling, high cohesion**: modules independent of each other's internals; each module a functionally-related system with clear responsibility. Two modules that must know each other's internals should probably be one; unrelated halves of a module should split.

### Module types (per recommended app architecture)

- **Data modules** — repository + data sources + models per domain. Expose the repository as the API; hide sources (`private`/`internal`).
- **Feature modules** — one screen/flow (UI + ViewModel); depend on data modules. (Distinct from Play Feature Delivery "feature modules".)
- **App modules** — entry points, root navigation, per-device-type (mobile/auto/wear/tv) to isolate platform deps; compiled into variants.
- **Common/core modules** — ui (design system), analytics, network, utils.
- **Test modules** — shared test code/fixtures, integration tests, cleaner build configs.

### Module-to-module communication

Avoid direct two-way coupling and cycles; a **mediator** (usually the module owning the navigation graph, i.e. an app module) forwards between features. Pass **primitive IDs, not objects**, via navigation args (`navController.navigate("checkout/$bookId")`; read with `SavedStateHandle.getStateFlow`); both features load from the shared data module — preserves single source of truth.

### Dependency inversion

Separate **abstraction modules** (interfaces + models = the API contract) from **implementation modules** (depend on the abstraction, implement it). High-level modules depend only on abstractions; the app module supplies the implementation via DI, possibly per build type:

```groovy
releaseImplementation project(':database:impl:firestore')
debugImplementation   project(':database:impl:room')
androidTestImplementation project(':database:impl:mock')
```

Benefits: interchangeability, decoupling, testability, faster builds (implementation changes don't recompile API consumers). Worth doing when: multiple capabilities/implementations, multiple apps, independent teams, large codebase.

### Best practices

- **Consistent configuration**: version catalogs + convention plugins to share build logic.
- **Expose as little as possible**: minimal public surface; prefer `implementation` over `api`.
- **Prefer plain Kotlin/JVM modules** over Android library modules where no Android resources/manifest are needed (less overhead). Module kinds: app modules (APK/AAB output), Android library modules (AAR), Kotlin/Java libraries.
- One source directory belongs to one source set/module.

## App resources

### Grouping (res/ subdirectories)

| Directory | Contents |
|---|---|
| `drawable/` | Bitmaps (PNG/9-patch/JPG/GIF) or drawable XML (state lists, shapes, animation drawables). |
| `mipmap/` | Launcher icons across densities. |
| `raw/` | Arbitrary files opened via `Resources.openRawResource(R.raw.name)`. If original filenames/hierarchy matter, use `assets/` + `AssetManager` (no resource IDs). |
| `values/` | Simple values — each `<resources>` child defines one resource (`<string>`, `<color>`, arrays). Filenames free-form (`strings.xml`, `arrays.xml` by convention). |
| `xml/` | Arbitrary XML read via `Resources.getXml()`; config files live here. |
| `font/` | TTF/OTF/TTC or `<font-family>` XML. |

Never place files directly in `res/` (compile error). Compose apps don't need `layout/`, `menu/`, `anim/`, `animator/`, `color/`.

### Alternative resources and qualifiers

Directory naming: `<resources_name>-<qualifier>[-<qualifier>...]` — qualifiers must appear in **precedence order**, one value per type, no nesting, case-insensitive. Always provide **default (unqualified) resources** for everything the app uses — missing defaults crash at runtime on unanticipated configurations, and newer-API qualifiers are invisible to older devices (a new qualifier implicitly adds a platform-version qualifier). Exception: density-qualified drawables need no default (system scales the best match).

Qualifier precedence (high → low): MCC/MNC (`mcc310-mnc004`) → language/script/region (`en`, `fr-rCA`, BCP-47 `b+sr+Latn+RS`) → grammatical gender (`feminine`, API 34+) → wide color gamut (`widecg`/`nowidecg`) → HDR (`highdr`/`lowdr`) → UI mode (`car`/`desk`/`television`/`appliance`/`watch`/`vrheadset`) → night mode (`night`/`notnight`) → density (`ldpi`/`mdpi`/`hdpi`/`xhdpi`/`xxhdpi`/`xxxhdpi`/`nodpi`/`tvdpi`/`anydpi`/`nnndpi`; 3:4:6:8:12:16 scaling ratio; `anydpi` wins for vectors) → touchscreen (`notouch`/`finger`) → keyboard availability (`keysexposed`/`keyshidden`/`keyssoft`) → input method (`nokeys`/`qwerty`/`12key`) → nav availability (`navexposed`/`navhidden`) → nav method (`nonav`/`dpad`/`trackball`/`wheel`) → platform version (`v21`...). (Layout/size/orientation qualifiers exist for View-based apps.)

**Best-match algorithm**: eliminate directories that *contradict* the device config (density never eliminated by contradiction — closest wins, prefer scale-down) → walk qualifiers by precedence; if any directory has the current qualifier, drop all that lack it → repeat until one remains. Qualifier **precedence beats match count**. Smaller-screen resources can serve larger screens, never the reverse (crash if only larger-screen resources match).

### Alias resources

Share one file across several configurations without duplication:

- Drawable: store `icon_ca.png` in `drawable/`, then per-locale `res/drawable-en-rCA/icon.xml`: `<bitmap android:src="@drawable/icon_ca"/>`.
- Values: `<string name="hi">@string/hello</string>`, `<color name="highlight">@color/red</color>`.

### Accessing resources

`R` class generated by AAPT: `[package.]R.<type>.<name>`. Compose: `stringResource(R.string.hello)`, `painterResource(R.drawable.my_icon)`. Non-UI code: `context.getString(R.string.hello_world)`, `Context.getResources()`. Platform resources: `android.R.drawable.ic_menu_info_details`.
