# ADR-009: Native push + Code Blue emergency alerting (APNs + FCM)

| Field | Value |
|-------|--------|
| **Date** | 2026-07-31 (accepted 2026-08-10) |
| **Status** | accepted |
| **Tags** | `#clinical-safety` `#integrations` `#worker` `#frontend-state` |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Emergency alerting — the wake mechanism for **Code Blue**, the most safety-critical feature — is
**broken on the shipped app today, on both platforms.** This is not a migration cost; it is an existing
production gap (gated RN plan, R3):

- **Client is Web Push (VAPID).** `src/hooks/use-push-notifications.tsx` speaks the browser Push API
  against a pure-`web-push` server (`server/lib/push.ts`). MDN browser-compat records `PushManager` as
  `webview_android: version_added: false` — **the Push API does not exist in the Android WebView that
  Capacitor embeds.** On iOS there is no APNs token path at all, so `aps-environment=production`
  (`ios/App/App/App.entitlements`) is a **vestigial entitlement** that carries no delivery.
- **No stack can hold a background socket** (plan #14, verified against Apple's UIKit background docs and
  RN's Android-only Headless JS). The persistent connection is owned by the OS, not the app process —
  true on Capacitor, RN, and native Swift/Kotlin alike. **Push is therefore the only mechanism** to wake
  a backgrounded device for a Code Blue.
- **iOS Critical Alerts is a different entitlement** (`com.apple.developer.usernotifications.critical-alerts`)
  that is **absent and was never applied for** — re-verified 2026-07-31; only ordinary push is present.
- **Android has no Critical Alerts equivalent** (plan #22): the ceiling is `IMPORTANCE_HIGH`; channels are
  immutable after creation; `setBypassDnd` bypasses DND but **not silent mode**; and full-screen intents
  are restricted since Android 14 to "calling and alarms only," with Play revoking the default grant.

This ADR fixes the **target architecture** so G0 can decide the path and G4 can build it. The BUILD
(schema, validators, send paths) is G4 work; this ADR is **proposed** now and moves to **accepted** when
that build lands.

## Decision

### 1. Native push transport, per platform
Adopt **APNs for iOS** and **FCM for Android**. Retire Web Push/VAPID for the native shells. (This is the
evidence-settled path — Capacitor's own docs route Android push through FCM; Web Push is unavailable in
the Android WebView.) The web PWA may keep Web Push where it actually works; it is out of scope here.

### 2. Push is an ALERT, never a state channel (binding — Clinical Safety Officer doctrine)
The **user-visible alert is the payload.** Push **never** carries authoritative Code Blue state and
**never** replaces SSE. Explicitly rejected: the "silent push wakes the app, app fetches over SSE"
pattern — Apple treats background notifications as low-priority, throttled (~2–3/hour), coalesced, and
delivery-not-guaranteed, so a silent-wake design would drop Code Blue alerts. On wake/reconnect the app
reconciles through the **existing** SSE replay + snapshot path. This preserves every frozen Code Blue
guarantee: session end stays **server-confirmed** (no optimistic local termination), no offline
queueing of emergency mutations, no polling recovery, and emergency endpoints stay out of every cache.

### 3. iOS urgency — Critical Alerts, with an honest fallback
Target **Critical Alerts**: payload `interruption-level: critical` + `aps.sound.critical = 1`; the user
must still grant `criticalAlert` at runtime. Gated on Apple approving the entitlement request (submitted
at G0; **no published criteria or SLA — treat approval as unbounded and possibly denied**). **If denied
or not yet granted:** fall back to `time-sensitive`, and state the locked/silent-device limitation
explicitly in the UX.

### 4. Android urgency — layered, with explicit honesty (owner decision, 2026-07-31)
Chosen: **layered graceful degradation.** Request `USE_FULL_SCREEN_INTENT` (justified as a medical
alarm) for the closest-to-Critical experience; **degrade to `IMPORTANCE_HIGH` heads-up + a loud custom
sound** wherever the full-screen grant is absent or revoked. Create the high-importance notification
channel **once** (channels are immutable after creation — get it right the first time). The UX must state
plainly that **Android cannot guarantee override of silent/DND** (no Critical Alerts equivalent). Accept
that **Play may reject the full-screen-intent declaration** — the `IMPORTANCE_HIGH` layer is the
load-bearing fallback and must stand on its own.

### 5. Server changes (specified here, BUILT at G4)
- `vt_push_subscriptions` (`server/schema/ops.ts`) is `NOT NULL` on `endpoint`/`p256dh`/`auth`, and
  `server/routes/push.ts` validates `endpoint` as a URL — **an APNs/FCM token is rejected at the Zod
  validator before the DB.** Requires a **migration** to a platform-tagged token model, a **branched
  validator**, and **two send paths** (APNs + FCM) with fan-out in every `sendPush*` caller including
  `server/workers/notification.worker.ts`.
- **Security (Security Master):** per-clinic isolation — every push-token query filters `clinicId`, with
  a cross-tenant negative test. APNs `.p8` auth key and FCM service-account credentials live in the
  secret manager / env (`env-bootstrap.ts` precedence), **never in source**; encrypt at rest consistent
  with the existing `AES-256-GCM` integration-credential posture.

## Consequences

**Positive.** Code Blue gains a real wake path on both platforms for the first time. Design stays inside
every frozen Code Blue guarantee — push is additive and cannot corrupt emergency state. iOS gets the
strongest alert the platform offers.

**Negative / risks.** (a) Android cannot guarantee silent-mode override — a device on silent may miss a
Code Blue; the honest-UX line is a mitigation, not a fix. (b) iOS Critical Alerts depends on an
**unbounded, possibly-denied** Apple approval; the `time-sensitive` fallback must be acceptable. (c) Net-new
server complexity + a schema migration + dual send paths. (d) Play may reject the full-screen-intent
declaration → the `IMPORTANCE_HIGH` fallback carries the requirement. (e) Web Push/VAPID retirement on
native must not break the web PWA path.

## Compliance

- [ ] **Owner action:** submit the iOS **Critical Alerts** entitlement request (G0 item 3). *(Owner tail — outside this PR.)*
- [x] Schema migration for the platform-tagged push-token model + `pnpm db:migrate` (G4).
      → `migrations/180_vt_push_subscriptions_native_tokens.sql`; verified against Postgres in a
      rolled-back transaction (native NULL-endpoint row valid, `platform` DEFAULT 'web' backfill, CHECK
      rejects unknown platform, partial UNIQUE(token) rejects dup). DB-gated regression:
      `tests/migrations/push-native-tokens.test.ts`.
- [x] `npx tsc --noEmit` and `pnpm architecture:gates` (touches `server/`). → `pnpm typecheck:server` +
      `pnpm contracts:typecheck` clean; architecture gates run in the implementing PR.
- [x] Security review: `clinicId` on every token query + a **cross-tenant negative test**; APNs/FCM
      secrets in the secret manager, not source. → subscribe/patch/delete + every `sendPush*` stay
      clinic-scoped; cross-tenant negative case in the DB-gated migration test; APNs `.p8` and FCM
      service-account creds read from env only (`push-apns.ts` / `push-fcm.ts`), never hardcoded.
- [ ] i18n parity for the new honest-limitation UX copy (`locales/en.json` + `locales/he.json`).
      *(G4-3 client work — no user-facing copy in this server PR.)*
- [ ] Device/browser verification of the alert on both platforms (Playwright drills where applicable);
      Code Blue frozen-guarantee regression check (server-confirmed end, no offline queueing).
      *(Needs real APNs/FCM creds + devices — owner tail.)*
- [x] Move this ADR **proposed → accepted** in the implementing G4 PR (this PR).
