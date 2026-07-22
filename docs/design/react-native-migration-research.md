# Bare React Native migration research (Layer 3a)

> **Date:** 2026-07-22 · **Lead:** The Researcher · **Serves:** `docs/plans/master-plan-2026-07.md`
> Layer 3a → feeds ADR-008 (Layer 4) and the bare-RN migration (Layer 5).
>
> **Scope:** evidence for migrating VetTrack's native app from the Capacitor shell (and the retired
> Expo direction) to a **bare React Native CLI** app, per the owner's binding decision. This report
> answers the seven open questions the master plan posed. It does not re-litigate the decision; it
> flags one blocker-adjacent risk (Clerk, §2) that ADR-008 must explicitly resolve.
>
> **Method note:** web research from a remote session (WebSearch; several primary doc sites —
> clerk.com, reactnative.dev — block the fetcher, so those are corroborated via the repo's vendored
> Clerk skills and multiple secondary sources; items marked **[verify locally]** should be re-checked
> against the primary page during ADR-008 drafting).

## Executive summary

| # | Question | Finding | Risk for bare-RN |
|---|----------|---------|------------------|
| 1 | New Architecture default? | Yes — default since RN 0.76 (late 2024); legacy architecture disabled as of ~0.82. A new app today is New-Architecture-only. | ✅ None — enable, don't opt out |
| 2 | Clerk on bare RN | **No official bare-RN SDK.** Clerk's RN path is `@clerk/expo` (Expo SDK 53–55); native paths are ClerkKit (Swift) and clerk-android (Kotlin). | 🔴 **Blocker-adjacent — ADR-008 must pick a mitigation (§2)** |
| 3 | Offline storage (Dexie replacement) | `op-sqlite` (JSI) for relational/sync-queue data; `react-native-mmkv` for key-value. Both current 2026 consensus. | ✅ Low |
| 4 | NFC | `react-native-nfc-manager` — actively maintained, autolinks in bare RN (pod install on iOS), New-Arch config-plugin friction was Expo-side only. | ✅ Low–medium (real-device verification required) |
| 5 | SSE client parity | No native `EventSource` in RN — use `react-native-sse` (or equivalent); must verify custom headers + `Last-Event-ID` replay against the frozen outbox contract in a spike. | 🟡 Medium (frozen-surface parity spike required) |
| 6 | Build/release without EAS | Standard, well-trodden: Fastlane + GitHub Actions driving Xcode/Gradle directly; `fastlane match` for signing. | ✅ Low (CI cost watch) |
| 7 | Case studies | Documented Capacitor→RN migration playbook exists (dual-ship pattern); budget ~1 week per missing native plugin; 6+ week phased port with overlap period. | ✅ Informative |

**Bottom line:** bare RN is viable and the ecosystem pieces exist for everything VetTrack needs —
**except Clerk, which has no official non-Expo React Native SDK**. That single item is the decision
risk ADR-008 must explicitly resolve (three options in §2); everything else is normal engineering.

---

## 1. New Architecture (Fabric / TurboModules)

- The New Architecture (JSI + Fabric + TurboModules) is **the default since React Native 0.76**
  (late 2024) and the legacy architecture is **permanently disabled as of ~0.82** — a new bare app
  started in 2026 is New-Architecture-only, and community-package legacy support is disappearing.
- Consequence for VetTrack: no migration-era interop planning needed; instead, every native dependency
  chosen below must be checked for New-Arch (TurboModule/Fabric) support, and any custom native module
  (NFC edge cases, etc.) is written as a TurboModule from day one.
- Note for ADR-008 honesty: the RN core team's official guidance now steers new projects toward a
  framework (Expo is the prominently recommended one); the framework-less path remains officially
  documented ("Get Started Without a Framework", `npx @react-native-community/cli@latest init`) and the
  Community CLI is actively maintained (v20.x, releases current as of July 2026). Bare RN is supported,
  but it is the against-the-current choice — the ADR should own that trade-off explicitly.

Sources: [Stallion — RN New Architecture 2026](https://stalliontech.io/react-native-new-architecture),
[SoftAims — New Architecture 2026 guide](https://softaims.com/blog/react-native-new-architecture-2026),
[reactnative.dev — Get Started Without a Framework](https://reactnative.dev/docs/getting-started-without-a-framework) **[verify locally — site blocks remote fetcher]**,
[@react-native-community/cli releases](https://github.com/react-native-community/cli/releases).

## 2. Clerk auth on bare React Native — THE decision risk

**Finding:** Clerk has **no official bare-RN SDK**. The official mobile matrix (corroborated by the
20 vendored Clerk skills in this repo, `.claude/skills/clerk*`):

- `@clerk/expo` (Core 3, supports Expo SDK 53–55 as of June 2026) — hooks + prebuilt native components
  that render SwiftUI on iOS / Jetpack Compose on Android. Expo projects only, per Clerk's docs.
- ClerkKit / ClerkKitUI — native **Swift** SDK.
- clerk-android (`clerk-android-api` / `clerk-android-ui`) — native **Kotlin** SDK; its own skill says
  "Do not use for Expo or React Native projects".

**Options for ADR-008** (pick one, with a spike before committing):

1. **`@clerk/expo` inside the bare app via `install-expo-modules`.** Expo modules can be installed into
   a bare RN app; this would likely make `@clerk/expo` run. Pragmatically strongest (keeps Clerk's
   maintained RN surface, session semantics identical to literate-dollop Phase 1's proven pattern) but
   partially dilutes "no Expo" — the app would carry the expo-modules runtime while still building via
   plain Xcode/Gradle with no EAS and no Expo framework/router. **Not confirmed in official docs from
   this session [verify locally + spike].**
2. **Custom auth against Clerk's Frontend API** (the pattern the native Swift/Kotlin SDKs wrap).
   Fully Expo-free, but VetTrack owns token lifecycle, SSO redirects, and session refresh — a
   security-sensitive build that Security Master must veto-review, and ongoing maintenance against
   Clerk API evolution.
3. **Community wrapper** (e.g. `billyjacoby/clerk-react-native`) — exists, unofficial, unmaintained
   risk. Not recommended for an auth surface.

Recommendation to carry into ADR-008: **spike option 1 first** (one day: bare RN 0.8x app +
`install-expo-modules` + `@clerk/expo` sign-in against the dev instance). If it works cleanly, take it
and state plainly in the ADR that "bare RN CLI + expo-modules runtime, no Expo framework/EAS" is the
actual architecture. Fall back to option 2 only if the spike fails.

Sources: [Clerk — React authentication SDKs](https://clerk.com/react-authentication),
[Clerk Expo SDK reference](https://clerk.com/docs/reference/expo/overview) **[verify locally — clerk.com blocks remote fetcher]**,
[@clerk/expo on npm](https://www.npmjs.com/package/@clerk/expo),
repo-vendored `.claude/skills/clerk/SKILL.md` (mobile routing matrix), `.claude/skills/clerk-android/SKILL.md`,
[billyjacoby/clerk-react-native](https://github.com/billyjacoby/clerk-react-native).

## 3. Offline storage (replacing Dexie / expo-sqlite)

2026 consensus split by workload:

- **`op-sqlite`** — JSI-based SQLite, the current performance leader; right home for the
  PendingSyncStore port (literate-dollop Phase 1 proved the store contract on expo-sqlite; the
  contract in `@vettrack/contracts/pending-sync` is storage-agnostic, so re-homing it is an adapter
  swap, not a redesign) and for the equipment/rooms offline caches (today Dexie/IndexedDB).
- **`react-native-mmkv`** — JSI key-value, ~30× faster than AsyncStorage; right home for small flags
  (session hints, build-tag, feature flags). Not a database.
- `react-native-sqlite-storage` — mature but legacy-leaning; no reason to pick it for a new app.
- Check at spike time: op-sqlite maintenance status and New-Arch compatibility on the chosen RN version.

Sources: [DEV — Best SQLite solutions for RN 2026](https://dev.to/eira-wexford/best-sqlite-solutions-for-react-native-app-development-in-2026-3b5l),
[OneUptime — SQLite in RN](https://oneuptime.com/blog/post/2026-01-15-react-native-sqlite/view),
[npm-compare — mmkv vs sqlite-storage](https://npm-compare.com/react-native-mmkv,react-native-sqlite-storage).

## 4. NFC / RFID

- **`react-native-nfc-manager`** (revtel) is the de-facto standard: Android + iOS, autolinks in bare RN
  (iOS needs `pod install`), actively maintained. The known New-Architecture friction (issue #757,
  `@expo/config-plugins` pin) was an **Expo config-plugin** problem — irrelevant to a bare app.
- VetTrack specifics: the tag-read semantics live in our own layer (literate-dollop's `nfc-platform.ts`
  adapter shape ports conceptually; the Capacitor `@capgo/capacitor-nfc` usage in `src/infrastructure/platform/`
  defines the contract to re-implement). RFID stays server-side (HMAC vendor-controller ingest,
  ADR-005/006) — **no RFID client work moves to RN at all**.
- Real-device verification on both platforms is the gate (same rule as the Capacitor shell today).

Sources: [react-native-nfc-manager](https://github.com/revtel/react-native-nfc-manager),
[issue #757 — config-plugins/New-Arch](https://github.com/revtel/react-native-nfc-manager/issues/757),
[npm — react-native-nfc-manager](https://www.npmjs.com/package/react-native-nfc-manager).

## 5. Realtime client parity (SSE + collab)

- RN has **no built-in `EventSource`**. Candidate: **`react-native-sse`** (binaryminds) — supports
  custom headers and reconnection polling; alternatives `react-native-event-source` /
  `react-native-eventsource` are older polyfill wrappers.
- **Frozen-surface constraint:** the client must reproduce the exact behaviors CLAUDE.md freezes —
  `Last-Event-ID` replay on reconnect, monotonic `id:` cursor handling, `reset_state:last_event_pruned`
  → full snapshot resync, keepalive routing that never invalidates query caches. A dedicated spike must
  verify the chosen lib exposes last-event-id round-tripping (or wrap it); this is a parity port of
  `useRealtimeReconciliation` semantics, not a re-design. Realtime Guardian owns review.
- **Socket.io collab channel:** `socket.io-client` works in RN out of the box; ephemeral-only rule
  carries over unchanged.
- BroadcastChannel-based cross-tab gossip has no RN equivalent and doesn't need one (single "tab");
  the build-tag/split-version detector needs an RN-appropriate substitute decision at port time.

Sources: [react-native-sse](https://github.com/binaryminds/react-native-sse),
[npm — react-native-sse](https://www.npmjs.com/package/react-native-sse),
[react-native-event-source](https://github.com/jordanbyron/react-native-event-source).

## 6. Build & release without EAS

- Standard 2026 pattern for bare RN: **GitHub Actions driving Fastlane lanes** that run Xcode/Gradle
  directly — `fastlane match` for iOS signing, Play tracks / TestFlight upload lanes, `setup_ci` on
  runners. Abundant current guides; nothing exotic.
- VetTrack already ships via GitHub Actions (Railway deploy; Capacitor shell built by script), so this
  is an extension of existing CI practice, not a new platform.
- Cost note from the case study below: watch macOS runner spend; ~50 builds/month is the cited
  break-even for a self-hosted Mac mini.

Sources: [Fastlane + GitHub Actions for RN, pt 1](https://medium.com/@malikchohra/ci-cd-pipeline-for-react-native-apps-use-fastlane-and-github-actions-40f9ad2036d0),
[pt 2 — implementation](https://medium.com/@malikchohra/ci-cd-pipeline-for-react-native-apps-use-fastlane-and-github-actions-dcf101edc423),
[DEV — complete RN CI/CD guide](https://dev.to/dainyjose/complete-cicd-guide-for-react-native-apps-using-github-actions-4hh1).

## 7. Case studies (Capacitor/hybrid → RN)

Most directly comparable found: the **mushi-mushi Capacitor→React-Native migration doc** — a written
playbook from a shipped migration:

- Week-1 audit of every Capacitor plugin in use; **budget ~1 week per missing plugin** to wrap a
  TurboModule.
- Phased feature porting (core daily-use screens first), closed beta on TestFlight + Play Internal.
- **Dual-ship**: keep the Capacitor build live ~2 weeks while the RN build proves itself, then sunset.
  This maps exactly onto VetTrack's situation — the Capacitor app stays the shipped product until the
  RN app passes its own gates (the "kill-switch as a separate later gate" principle survives the
  Expo→bare pivot).
- Fastlane match + setup_ci; iOS workflow proven on a feature branch before main; daily error-report
  review drives the polish list.

General-landscape sources agree on the shape: hybrid→RN migrations succeed when done as staged verticals
with an overlap period, and fail when attempted as big-bang rewrites.

Sources: [mushi-mushi — Capacitor→RN migration](https://github.com/kensaurus/mushi-mushi/blob/master/docs/migrations/capacitor-to-react-native.md),
[ABN AMRO — mobile stack debate](https://medium.com/abn-amro-developer/mobile-development-debate-capacitor-flutter-nativeapp-kmp-pwa-react-native-3f1fc510e64e),
[edana — Capacitor use cases](https://edana.ch/en/2025/07/31/should-you-still-choose-capacitor-today-for-which-types-of-mobile-projects-does-it-remain-relevant/).

## 8. Resolved before this report

- **`@vettrack/contracts` is framework-free** — verified in-repo 2026-07-22: `packages/contracts/package.json`
  declares zero dependencies; `grep` over `src/` (emergency.ts, pending-sync.ts, index.ts) shows zero
  non-relative imports. It ports to the bare-RN app as-is via the same `workspace:`/package consumption
  pattern; gate with `bash scripts/ci/contracts-gate.sh`.

## What ADR-008 must decide (handoff to The Architect)

1. **Clerk path** — option 1/2/3 from §2, after the one-day spike.
2. RN version pin + New-Architecture statement (§1) and the honest "against upstream framework
   guidance" trade-off note.
3. Storage pair (op-sqlite + MMKV) as the PendingSyncStore/caches home (§3).
4. SSE client choice + the frozen-contract parity spike as a Layer 5 phase-1 exit criterion (§5).
5. CI shape (Fastlane + GitHub Actions; runner strategy) (§6).
6. Dual-ship sunset pattern for Capacitor (§7) — restating that the kill-switch remains a separate
   owner-gated decision.
