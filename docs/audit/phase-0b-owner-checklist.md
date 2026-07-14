# Phase 0B — Owner Checklist (reviewer-reachability + App Store submission gate)

> **Source:** `docs/plans/consolidated-audit-10x/phase-0-1.plan.md` §"Phase 0B". These are `Tier: Owner` items — **binary config/account/build/device/hardware checks, NOT RED→GREEN code cards.** "Done" = the pass/fail verification stated on each line. They can run in parallel with the Phase 1 code work; **T-16 (on-device exit drill) gates leaving Phase 0.**
>
> **Status:** Phase 0A code fixes (T-01…T-05) are DONE + merged on `executing-audit-10x-consolidated-plan` (proof log 2026-07-12). This checklist is the remaining, human-executed half of Phase 0.

## Why this exists
Phase 0 is "stabilize + ship-ready." Beyond the 5 code fixes, App Store re-submission needs a **reviewer who can actually reach the emergency flows** (App Review 2.1) and a bundle that satisfies 4.8 / privacy / permission rules. An agent cannot create Apple accounts, sign device builds, or serve AASA — hence Owner.

## Checklist

| # | Item | Action | Verify (pass/fail) |
|---|---|---|---|
| **T-06** ⭐ | **Rostered reviewer account** (highest value) | Create a synthetic tenant + a `vet`/`senior_technician` account with an **active roster shift spanning the review window**. | Account **starts + ends a Code Blue with no `INSUFFICIENT_CLINICAL_AUTHORITY` 403.** Without this, App Review hits a dead wall at the core flow. |
| **T-07** | **Build via the native script** | Build **only** with `pnpm cap:build:native` (never plain `pnpm build && cap sync`). | Login works in the **shipped binary** (bakes `VITE_CLERK_PUBLISHABLE_KEY` + `VITE_API_ORIGIN`; a plain build silently falls into dev-bypass → crash on `useUser`/`ClerkProvider`). |
| **T-08** | **Sign in with Apple** (conditional) | **If** the app keeps a third-party/social login (Clerk Google OAuth), SIWA **must render + complete in the bundled shell** (mandatory under 4.8). If login is email/password-only → **N/A**. | SIWA round-trip on device (when applicable). |
| **T-09** | **Privacy manifest** | Add Sentry to `PrivacyInfo.xcprivacy`; ASC privacy answers include **Crash Data / Diagnostics**. | Manifest + ASC answers present. |
| **T-10** | **Camera usage string** | Broaden `NSCameraUsageDescription` (also used for QR scanning). | `Info.plist` string mentions **scanning**. |
| **T-11** | **Localized permission prompts** | Add Hebrew `InfoPlist.strings` (the app is Hebrew-default). | `he` permission prompts present. |
| **T-12** | **Offline cold-start** | First launch offline shows **"connect to sign in"**, not a blank screen. | Airplane-mode first-launch check. |
| **T-13** | **Universal Links** (split per CodeRabbit `R-AS-08a/b/c`) | Serve **AASA** at `vettrack.uk/.well-known/apple-app-site-association`; entitlements live; App-Store check. | AASA reachable + entitlement + associated-domains verified. |
| **T-14** | **Pre-flight scripts** | Run `pnpm auth:preflight` + `pnpm validate:prod` + `verify:resubmission`; bump `ios/.last-shipped-build` after upload. | All three green; build number bumped. |
| **T-15** | **App Review notes** | Frame VetTrack as **internal veterinary equipment/ops tracking** in the review notes. | Notes submitted. |

## T-16 · Phase 0 exit gate — on-device drill (BLOCKS leaving Phase 0)

Real device, shipped-style build:
1. **Sign in** (SIWA if social login is retained — T-08/R-AS-03; else email/password).
2. **Start a Code Blue.**
3. **Dismiss the outcome sheet** (exercises the now-fixed **T-01** — Cancel must dismiss without ending the session).
4. **End the session.**

Proves reviewer access + the T-01 fix + OAuth in one pass. **Phase 0 is not "done" until this passes on device.**

## Notes
- T-06 and T-16 are the two that most directly de-risk App Review — prioritize them.
- The T-01 code fix this drill validates is already merged; the drill confirms it behaves in the shipped WKWebView (no browser-back to escape a stuck sheet).
- Agent-side Phase 1 code work proceeds in parallel and does not depend on 0B.
