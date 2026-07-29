# R8 Keep Rules — Syntax, Options, and Patterns

Source: developer.android.com/topic/performance/app-optimization/{keep-rules-overview, add-keep-rules, global-options, additional-rule-types, keep-rules-best-practices, keep-rule-examples, troubleshooting-rules, variant keep rules}.

## Table of contents

1. [When keep rules are needed](#when-keep-rules-are-needed)
2. [Where rules live](#where-rules-live)
3. [Rule anatomy](#rule-anatomy)
4. [Keep options](#keep-options)
5. [Keep option modifiers](#keep-option-modifiers)
6. [Class specification](#class-specification)
7. [Member specification](#member-specification)
8. [Types in rules (primitives, generics, arrays)](#types-in-rules)
9. [Wildcards](#wildcards)
10. [Conditional keep rules (-if)](#conditional-keep-rules--if)
11. [Global options](#global-options)
12. [Keep attributes](#keep-attributes)
13. [Additional rule types (assumptions and log stripping)](#additional-rule-types)
14. [Best practices](#best-practices)
15. [Worked examples (reflection, JNI, popular libraries)](#worked-examples)
16. [Per-variant keep rules](#per-variant-keep-rules)
17. [Troubleshooting rules (-checkdiscard, -whyareyoukeeping)](#troubleshooting-rules)

## When keep rules are needed

R8 preserves all *direct* calls but cannot see indirect usage. Common cases requiring keeps:

- **Reflection** — `Class.getDeclaredMethod()`, `Class.getAnnotation()`, `Class.forName`, Kotlin reflection. Symptoms of a missing rule: `ClassNotFoundException` / `NoSuchMethodException` / `NoSuchFieldException` at runtime.
- **JNI** — native code calling Java/Kotlin methods by name string.

Narrow rules = maximum optimization. If a library forces broad rules, consider replacing the library.

## Where rules live

- AGP < 9.3 (VetTrack): `proguard-rules.pro` in the module root, declared via `proguardFiles` next to `getDefaultProguardFile('proguard-android-optimize.txt')` (keep the default file — and migrate off legacy `proguard-android.txt`, which contains `-dontoptimize`).
- AGP 9.3+: `src/<variant>/keepRules/*.keep` source set; default Android rules included unless `optimization.keepRules.includeDefault = false`.
- Libraries: consumer rules file (see `r8-optimization.md` → library authors).
- Rules are **additive** across app + all libraries; the merged set is written to `app/build/outputs/mapping/configuration.txt`.

## Rule anatomy

```
-<keep_option>[,<modifier>,...] <class_specification> {
    <member_specifications>;
}
```

Example — keep one method, still allowing optimization:

```
-keepclassmembers,allowoptimization class com.example.MyClass {
  void someSpecificMethod();
}
```

## Keep options

| Option | Description |
|---|---|
| `keepclassmembers` | Preserve specified members **only if** the class survives shrinking. Enables the most optimization — **prefer this**. |
| `keep` | Preserve class + specified members; blocks all optimization on matches. Use only with modifiers. |
| `keepclasseswithmembers` | Keep class + members only if the class has **all** listed members. |
| `keepclassmembernames` | Prevent renaming of members only (removal still allowed). Often misunderstood — prefer `-keepclassmembers,allowshrinking`. |
| `keepnames` | Prevent renaming of class+members; removal allowed. Prefer `-keep,allowshrinking`. |
| `keepclasseswithmembernames` | Prevent renaming if members exist; removal allowed. Prefer `-keepclasseswithmembers,allowshrinking`. |

## Keep option modifiers

| Modifier | Effect |
|---|---|
| `allowoptimization` | Optimization allowed; no rename/remove. |
| `allowobfuscation` | Renaming allowed; no remove/optimize. |
| `allowshrinking` | Removal allowed if unreferenced; no rename/optimize. |
| `includedescriptorclasses` | Also keep classes appearing in kept members' signatures (param/return/field types). |
| `allowaccessmodification` | Visibility changes allowed. |
| `allowrepackage` | Moving to other packages allowed. |

## Class specification

- **Fully qualified Java names** always (`com.google.android.material.button.MaterialButton`, `java.lang.String`). Inspect actual generated names via APK Analyzer or Studio: Tools > Kotlin > Show Kotlin Bytecode > Decompile.
- **Annotation on the class**: `-keep class @com.example.MyAnnotation com.example.MyClass`; multiple annotations = class must have all; `-keep class @A @B *`.
- **Subclasses/implementers**: `-keep class * extends Bar` / `-keep class * implements Bar` — interchangeable; matches subtypes, **not** `Bar` itself.
- **Access modifiers**: `-keep public class com.example.api.** { public protected *; }`; modifiers also work on members (`public static void *(...)`). `!` inverts a modifier — avoid (over-broad).
- **Kotlin `internal`** compiles to `public` in bytecode — write `public` in rules. **Kotlin `suspend`** functions compile with return type `java.lang.Object` and a trailing `kotlin.coroutines.Continuation` parameter — match that signature or use `(...)`.

## Member specification

Members listed limit the rule to those members. **Omitting the member block keeps only the default constructor** (`-keep class X` ≡ `-keep class X { void <init>(); }`).

- Methods: `[modifiers] [return_type] name(param_types);` — e.g. `public java.lang.String getUserId();`. All methods: `<methods>;`
- Constructors: `<init>(param_types);` — e.g. `public <init>(com.example.repository.UserDataRepository);`, all public: `public <init>(...);`
- Fields: `[modifiers] [type] name;` — e.g. `private java.lang.String userId;`. All fields: `<fields>;`
- Annotation-scoped members: `@com.example.MyAnnotation <methods>;` — combine with class-level annotation matching:
  ```
  -keep class @com.example.ClassAnnotation * {
    @com.example.MethodAnnotation <methods>;
    @com.example.FieldAnnotation <fields>;
  }
  ```
- **Negated name patterns** (AGP 9.2+): `public *** !*ForTesting(...);` keeps all public methods except `*ForTesting`.
- **Top-level Kotlin functions** live in `<FileName>Kt` classes: `-keep class com.example.myapp.utils.MyClassKt { public static boolean isEmailValid(java.lang.String); }`

## Types in rules

- Primitives: `boolean, byte, short, char, int, long, float, double`. Kotlin `Int` → `int`; `Int?` → `java.lang.Integer`.
- **Generics are erased**: `T` → `java.lang.Object` (or its bound, e.g. `java.lang.Number`); `List<Product>` → `java.util.List`. Match the erased signature. When app types appear as generic bounds, `includedescriptorclasses` keeps the bound class too.
- Arrays: append `[]` per dimension — `java.lang.String[]`, `int[][]`, `byte[]`.

## Wildcards

| Wildcard | Scope | Meaning |
|---|---|---|
| `**` | classes+members | Any name including package separators (`com.example.**` = package + subpackages). |
| `*` | classes+members | Any name segment without `.`; alone it aliases `**`. |
| `?` | classes+members | Single character (`UserV?`). |
| `***` | members | Any type (primitive, class, array). |
| `...` | members | Any parameter list. |
| `%` | members | Any primitive type. |

## Conditional keep rules (-if)

```
-if <class_specification>
-keep... <rule using backreferences>
```

Wildcards in the `-if` spec are captured; `<1>`, `<2>`... reference them in the following rule. The rule activates only when the condition matches — minimizes retention.

Canonical examples:

```
# Jetpack Navigation NavArgs (fromBundle called reflectively)
-if public class ** implements androidx.navigation.NavArgs
-keepclassmembers public class <1> {
    public static ** fromBundle(android.os.Bundle);
}

# Gson models using @SerializedName
-if class ** { @com.google.gson.annotations.SerializedName <fields>; }
-keep class <1> {
    @com.google.gson.annotations.SerializedName <fields>;
    <init>(...);
}

# Substring capture: com.example.PrefixXPostfix → keep com.example.PrefixYPostfix
-if class com.example.*X*
-keep class com.example.<1>Y<2>
```

## Global options

**Enable more optimization:**

- `-repackageclasses [pkg]` — move classes into one package (default: unnamed root) → smaller DEX. Default since AGP 9.1 (`-dontrepackage` opts out). Omit the package-name argument for smallest output.
- `-allowaccessmodification` — visibility widening for deeper inlining. Enabled by `proguard-android-optimize.txt`; default in full mode since AGP 8.2.
- `-processkotlinnullchecks [keep|remove_message|remove]` (AGP 9.0+) — rewrite Kotlin Intrinsics null checks; default `remove_message` (check kept as `getClass()`, message string dropped).

**Limit optimization (debug/dev only — never ship):**

- `-dontoptimize`, `-dontshrink`, `-dontobfuscate`.

Library authors must never put global options in consumer rules.

## Keep attributes

`-keepattributes <comma-list>`. In full mode, attributes are only retained for explicitly kept classes/members. Kept by default via `proguard-android-optimize.txt` (some need newer AGP): `AnnotationDefault` (7.1+), `EnclosingMethod`, `InnerClasses`, `LineNumberTable` (8.6+), `RuntimeVisibleAnnotations`, `RuntimeVisibleParameterAnnotations`, `RuntimeVisibleTypeAnnotations`, `Signature`, `SourceFile` (8.2+).

Reflection dependencies: `getEnclosingMethod()`/`getDeclaredClasses()` → `EnclosingMethod` + `InnerClasses`; `getTypeParameters()` → `Signature`; `getAnnotation()` → `RuntimeVisibleAnnotations` (also keep the annotation class and annotated classes).

Rarely needed extra attributes: `MethodParameters`, `Exceptions`, `RuntimeInvisible*` (mostly for library *builds*, not apps/consumer rules). Keep as few attributes as possible — each one limits a global optimization. Debug-info attributes (`LocalVariableTable`) are governed by release/debug mode, not `-keepattributes`.

## Additional rule types

**Assumptions** (force optimizations beyond analysis — can break the app; test hard):

- `-assumevalues <class_spec> { <member_spec> return <value|min..max>; }` — assert a field/return value at runtime. Values: `true/false/null/@NonNull` (R8 ≥ 9.0.24), ints, ranges (`26..2147483647`), string constants (R8 ≥ 9.1.13), static field refs. Classic use: `public static final boolean IS_OPTIMIZED_VERSION return true;` to strip debug branches. (`Build.SDK_INT` is assumed automatically from `minSdk`.)
- `-assumenosideeffects <class_spec> { <member_spec>; }` — calls may be removed entirely (typical: strip a `DebugLogger.log(...)`).

**Other optimizations:**

- `-convertchecknotnull <class_spec> { <member_spec>; }` (AGP 9.0+) — replace null-check helper calls (any method that throws on null first arg) with `firstArg.getClass()`, dropping message-string allocations.
- `-maximumremovedandroidloglevel <level> [<class_spec>]` — strip `android.util.Log` calls at/below level: VERBOSE 2, DEBUG 3, INFO 4, WARNING 5, ERROR 6, ASSERT 7. Multiple rules for the same method → the minimum level wins. Scope to classes/methods or app-wide.

## Best practices

Do:
- Always specify a concrete class, base class, or annotated class:
  ```
  -keepclassmembers class com.example.MyClass { void someSpecificMethod(); }
  -keepclassmembers ** extends com.example.MyBaseClass { void someSpecificMethod(); }
  -keepclassmembers @com.example.MyAnnotation class ** { void someSpecificMethod(); }
  ```
- Prefer **annotation-driven** keeps (annotate reflected code, target the annotation) — explicit code↔rule link, robust to refactors (androidx.annotation works this way). Name annotations by intent (`@DisplayComponent`).
- Declare member specs; avoid `{ *; }` unless strictly needed.
- Maintain rules for **everything** accessed reflectively, even if R8 currently happens to retain it.
- Use `-assumenosideeffects`/`-convertchecknotnull` for null-check/log stripping wins.

Avoid:
- Long-term package-wide keeps (`-keep class com.example.pkg.** { *; }`) — temporary escape hatch only.
- Libraries that require copy-pasted (especially package-wide) rules.
- `!` inversion (accidentally matches nearly everything).

## Worked examples

**Reflection: class loaded by name string** (`Class.forName(name).getDeclaredConstructor().newInstance()` on implementers of a library interface) — library consumer rule:

```
-keep class * implements com.example.library.StartupTask { <init>(); }
```

**Reflection: `::class.java` passed to the library** (class is referenced, but its no-arg constructor is invoked reflectively) — allow rename+removal, keep the constructor:

```
-keep,allowobfuscation,allowshrinking class * implements com.example.library.StartupTask
-keepclassmembers class * implements com.example.library.StartupTask { <init>(); }
```

**Reflection by method annotation** (event-bus style `method.isAnnotationPresent(OnEvent)` + `invoke`):

```
-keepattributes RuntimeVisibleAnnotations
-keep @interface com.example.library.OnEvent
-keepclassmembers class * { @com.example.library.OnEvent <methods>; }
```

**Reflection by class annotation** (`taskClass.isAnnotationPresent(...)` + `getMethod("execute")`):

```
-keepattributes RuntimeVisibleAnnotations
-keep @interface com.example.library.ReflectiveExecutor
-keepclassmembers @com.example.library.ReflectiveExecutor class * { public void execute(); }
```

**Optional-dependency probing** (`Class.forName("...VideoEventTracker")` to soft-enable a feature) — the optional library's consumer rule:

```
-keep class com.example.analytics.video.VideoEventTracker { <init>(); }
```

Missing this doesn't crash — the feature silently disappears; hard to catch in testing.

**Reflection into private members** (avoid; blocks library upgrades) — if unavoidable, keep the exact member, never `{ *; }`:

```
-keepclassmembers class com.example.LibraryClass { private java.lang.String secretMessage; }
```

**JNI upcalls** (native → Java by name): `proguard-android-optimize.txt` already guards *downcalls* with `-keepclasseswithmembernames,includedescriptorclasses class * { native <methods>; }`. For upcalled methods, keep the method and its signature types, and the members native code touches:

```
-keepclassmembers,includedescriptorclasses class com.example.JniBridge {
    public void onNativeEvent(com.example.model.NativeData);
}
-keep class com.example.model.NativeData { <init>(java.lang.Integer, java.lang.String); }
```

Failure mode: `UnsatisfiedLinkError`/`NoSuchMethodError` originating outside ART. Tip: isolate JNI-facing code in a dedicated package.

**Parcelable**: use `@Parcelize` (kotlin-parcelize) — the plugin generates `CREATOR` + required keep rules. Hand-written `Parcelable` needs manual keeps for `CREATOR` and the `Parcel` constructor.

**Popular libraries** (recent versions bundle their own rules — don't copy these; syntax reference only):
- Gson: `-keepattributes Signature`, non-transient model fields (`!transient <fields>;`), `TypeToken` + subclasses with `allowobfuscation,allowshrinking,allowoptimization` (bundled since 2.11.0 for `@SerializedName` models).
- Retrofit ≥ 2.10.0 bundles rules; generic return types need `Signature` + a conditional keep of return-type classes; data models still need converter-side keeps.
- Coroutines + reflection: `-keepattributes Signature` + `-keep class kotlin.coroutines.Continuation` (suspend signatures).

## Per-variant keep rules

AGP < 9.3 — `proguardFile` inside a flavor adds to the release-block files:

```groovy
android {
    buildTypes { release { minifyEnabled true; shrinkResources true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro' } }
    flavorDimensions "version"
    productFlavors {
        flavor1 { }
        flavor2 { proguardFile 'flavor2-rules.pro' }   // flavor2 uses all three files
    }
}
```

AGP 9.3+: place per-flavor rules in `app/src/<flavor>/keepRules/*.keep`.

## Troubleshooting rules

- `-checkdiscard <class_spec>` — **build fails** if the matched class/member survives. Inlining can hide survival; pair with `-keep,allowshrinking class com.example.foo { *; }` to forbid inlining/merging so the check is meaningful.
- `-whyareyoukeeping <class_spec>` — prints the shortest retention path (keep rule from app/library/AAPT, or transitive reference from kept code/XML) to the console. **Local debugging only — don't commit** (slows the build).
