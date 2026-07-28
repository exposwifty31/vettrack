# NFC Sticker E2E Audit — Phase 3.5 Spec

> Owner-approved design (2026-07-28, brainstorming session; decisions locked below). Grounding:
> owner-supplied NFC research report (operative digest kept program-side) + in-repo recon. This spec
> feeds the Phase-3.5 implementation plan. Companion plan doc: the distribution program's Phase 3.5
> section (program-side).

## Context & goal

VetTrack reads NFC in-app today (`@capgo/capacitor-nfc`, ScanScreen) and already defines what an NFC
entry means: `src/lib/deep-link-router.ts:80` navigates to
`/equipment/<id>?nfcAction=toggle&nfcTs=…` — the equipment page with an immediate custody-toggle
offer. This phase makes physical stickers ordered for equipment trigger that exact experience
from a phone's home screen on both platforms, and audits the whole chain end-to-end before fielding.

## Locked decisions (owner, 2026-07-28)

1. **Tap semantics** = the existing contract: navigate to `/equipment/<id>?nfcAction=toggle`.
2. **Audience** = staff only. No-app tap → Play jump (AAR) / browser sign-in wall — acceptable.
3. **Chip** = NTAG215, permanently locked after encoding (504B headroom; read-only forever; replaced
   equipment gets a new sticker). NTAG424 DNA rejected: tags are identification only — custody stays
   human-confirmed (ADR-006 posture); clone-resistance not required for an in-hospital staff fleet.
4. **URI strategy** = Approach A: https universal link on the sticker (record 1
   `https://vettrack.uk/equipment/<id>?nfcAction=toggle`, record 2 AAR `uk.vettrack.app`).
   Custom-scheme-only rejected: iOS background tag reading surfaces no notification for custom
   schemes. Key property: stickers are encoded once and never re-encoded — plumbing upgrades
   (entitlement/AASA/assetlinks) improve the experience server/app-side under the same URL.
5. **iOS Associated Domains entitlement** (`applinks:vettrack.uk`) ships in build 27 (folded into
   the imminent Apple resubmission — additive, zero UX change).

## NDEF payload spec

| # | Record | Content | Notes |
|---|--------|---------|-------|
| 1 | URI (well-known, prefix byte `0x04` = `https://`) | `vettrack.uk/equipment/<equipment-uuid>?nfcAction=toggle` | iOS background reading parses ONLY this record |
| 2 | AAR (Android Application Record) | `uk.vettrack.app` | Guarantees app launch on Android (no chooser); no-app → Play listing |

Total ≈ 120 bytes — fits NTAG215 (504B) with headroom. No `nfcTs` on the sticker (it is a
cache-buster the client adds; a static timestamp on a locked tag would be meaningless).

## Client routing (the one real code gap)

`deep-link-router.ts` today handles `vettrack://` hosts only. Universal/App Links arrive through the
same `@capacitor/app` `appUrlOpen` event but as `https://vettrack.uk/...` URLs. Change: extend the
router to map `https://vettrack.uk/equipment/<id>` (+ params passthrough) to the exact same
navigation as the `vettrack://` path — reuse, not new logic. Unit test: https URL → same route +
params as the custom-scheme equivalent; unknown hosts/paths untouched. The equipment page's
`nfcAction=toggle` handling is already param-driven and needs no change.

## Server plumbing (`/.well-known/`)

- **`apple-app-site-association`** — served with NO extension, `application/json`, no redirects.
  `appID = <TeamID>.uk.vettrack.app`, path rules for `/equipment/*`. Mind Apple's CDN caching
  (iOS 14+): first-time correctness matters; fixes may need app reinstall to observe.
- **`assetlinks.json`** — `application/json`, no redirects. Package `uk.vettrack.app` +
  SHA-256 fingerprints: the upload certificate immediately, and the Google app-signing
  certificate (Play Console → App integrity) added after the first AAB upload (it does not
  exist before). Android App-Link verification passes only once the cert of the installed build is
  listed.
- Served by the existing Express static/route layer on vettrack.uk; add a smoke test asserting both
  endpoints return 200, correct content-type, no redirect.

## iOS (build 27)

Add the Associated Domains capability with `applinks:vettrack.uk` to the app target (entitlements
file + App ID capability in the developer portal). Background-reading constraints acknowledged and
NOT worked around: screen lit, first NDEF record only, user must tap the system notification.
In-app ScanScreen remains the always-available fallback (already built).

## Android

Add a SECOND https intent-filter on MainActivity (separate from the `vettrack://` OAuth filter):
`VIEW` + `DEFAULT` + `BROWSABLE`, `android:autoVerify="true"`, `scheme=https`,
`host=vettrack.uk`, `pathPrefix=/equipment/` — scoped to `/equipment/` only so general
vettrack.uk links keep opening in the browser. Lands in the pre-AAB window (cheap while the shell is
still open for changes); verification goes green when assetlinks carries the right certs.

## Custody-model fit

The sticker is a custody *entry point*, deliberately not custody *logic* — and must stay that way.

**What NFC gives the custody flow:**

- Certain identification of the equipment item (UUID on the sticker) + the immediate toggle offer
  per the existing `nfcAction=toggle` contract.
- Actor identity comes from the authenticated session on the phone, **not** from the tag — every
  checkout/return is recorded against an authenticated human, with `clinicId`, role, and
  server-side rate limits. In this respect an NFC tap is equivalent to a QR scan, minus the
  camera friction.

**What NFC alone does not cover — and what does (all already built):**

1. **Docked ≠ returned.** For dock-equipped categories the docking event is the canonical return
   signal (P1–P3 docking model). A sticker tap can *offer* a return, but it complements the dock —
   it never replaces it.
2. **Tap ≠ physical possession.** One can tap a sticker without taking the equipment — custody
   remains a human-confirmed action backed by the existing safety nets: `staleCheckoutSweep`,
   `stale-returned-sweep`, the Equipment Coordinator escalation ladder, waitlist reservations.
3. **The tag is never authority** — exactly the ADR-006 spirit (set for RFID, equally binding
   here): a tag is evidence/identifier; NTAG215 is clonable, so by deliberate decision it never
   decides state. The server-side state machine is the truth.
4. **Offline:** a tap with no network still opens the app (the universal-link association is
   stored by the OS), the page renders from the Dexie cache, and the custody action joins the sync
   queue under the existing rules (the Code Blue offline exception is untouched).

Net: the sticker accelerates entry into a flow that is already correct — it neither adds nor
removes authority.

## Ops runbook (order → field)

1. **Order** NTAG215 stickers (quantity = owner input at order time; size/material suited to
   equipment surfaces; antenna-friendly placement zones).
2. **Encode** per batch: NXP TagWriter (from an ANDROID device — iOS encoders are limited for AAR
   records): record 1 URI + record 2 AAR per the payload spec, `<equipment-uuid>` from the
   equipment's VetTrack id.
3. **LOCK permanently** (lock bits) at the encoder — an unlocked sticker never ships to the floor.
4. **QA sample per batch** (before mass encoding the rest): one iPhone background-scan + one
   Android tap must both reach the right equipment page.
5. **Placement:** near where a phone naturally taps; antennas sit at the TOP of modern devices;
   avoid metal-backed surfaces or use on-metal sticker variants for metal equipment.

## Security posture (staff-only threat model)

- Tag = identification/deep-link only; custody authority stays human-confirmed (ADR-006 spirit).
- Permanent lock blocks overwriting (the report's top field risk).
- Param handling: the router honors known params only (`nfcAction` allowlist) — no free-form
  execution from tag data; keep it that way (assert in the router test).
- Cloning accepted as residual risk for an in-hospital fleet (NTAG424 deliberately rejected).
- Replay is moot for a static identification URL (no server-side action fires from the GET).

## E2E audit matrix (the audit itself; evidence per row)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | iPhone (app installed), screen lit, tap from home screen | System notification → tap → app opens `/equipment/<id>` with toggle offer |
| 2 | Android (app installed), tap from home screen | App opens directly (App Link or AAR), same screen |
| 3 | Android, app NOT installed | Play listing opens (AAR) |
| 4 | Any browser, signed out | vettrack.uk sign-in wall → after sign-in, equipment page |
| 5 | In-app ScanScreen scan of the same sticker | Existing in-app flow unchanged |
| 6 | Write attempt against a locked sticker | Rejected by the tag |
| 7 | AASA + assetlinks endpoints | 200, correct content-type, no redirects |
| 8 | Tap-toggle on equipment currently held by another user | UI/server respect the canonical server custody state — no silent override |
| 9 | Docked-category equipment: tap from home screen | Tap offers return, but the docking event remains the canonical return truth (docked ≠ returned preserved) |

## Sequencing vs the distribution program

- Entitlement → build 27 (Apple phase, imminent).
- Android https filter → pre-AAB window (Android phase, before T7's bundle).
- assetlinks Google-cert completion → after the first AAB upload (Android T11 gate).
- Sticker ORDER → owner, any time (decisions are locked).
- Encoding + fielding → after the Play listing is live (AAR target exists) + plumbing verified.
- Full audit matrix run → part of/after the physical-device session (H5/T8 hardware).

## Out of scope

NTAG424/SUN/SDM · visitor/anonymous experiences · deferred deep linking (Branch et al.; Firebase
Dynamic Links is discontinued) · App Clips · FCM/push (excluded from the ship, future 2.0) · any
change to in-app NFC reading or custody semantics.

## Success criteria

All nine audit-matrix rows green with recorded evidence on real hardware, stickers fielded locked,
and zero changes to frozen surfaces or custody semantics.
