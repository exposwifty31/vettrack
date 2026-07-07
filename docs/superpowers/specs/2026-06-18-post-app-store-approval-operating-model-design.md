# VetTrack — Post-App Store Approval Operating Model

**Date:** 2026-06-18  
**Status:** Approved  
**Context:** iOS 1.0.1 approved by Apple and auto-releasing (no manual release button needed). Solo maintainer, single clinic.

---

## Summary

iOS H0 is complete. This document defines the operating model for the period immediately following App Store approval: go-live verification, improvement plan revision, Android submission, and post-launch product instrumentation. The model runs three parallel tracks: iOS live verification, Android Play Store submission, and Expo/RN Horizon 1 scaffold in `literate-dollop`.

---

## Section 1 — Go-live ops (iOS 1.0.1)

### Release status
iOS 1.0.1 was submitted with "Automatically release after App Review approval." The status "Ready for Distribution" in App Store Connect confirms auto-release is in progress. No manual release action is required. The app will appear in the App Store within 24 hours of approval.

### Immediate actions (today)

| Step | Detail | Status gate |
|------|--------|------------|
| DSA compliance | App Store Connect → Business → Agreements → "Complete Compliance Requirements" — declare trader/non-trader status for EU Digital Services Act | Do before 24h window closes |
| Privacy URL | Version page → Trust & Safety → App Privacy — confirm privacy policy URL is populated | Required for listing completeness |
| App Store smoke test | Once app appears in App Store (not TestFlight), install and run Tier 1–2 routes: signin → home → equipment → code-blue | Within 24h of appearance |
| Production monitoring | Confirm Railway healthy, no crash spikes, SSE realtime connects on native build | First 24h post-release |

### Agreement status (observed 2026-06-18)
- Free Apps Agreement: **Active** (Jun 10 2026 – Jun 10 2027) — distribution unblocked
- Paid Apps Agreement: **New** (unsigned) — not needed for free app, no action required
- DSA compliance: **Pending** — action required

---

## Section 2 — Improvement plan revision

### Items to close

| Item | Disposition |
|------|------------|
| P0-5 — Capacitor legal pages + resubmission readiness | **Closed** — 16/16 gates passed (2026-06-16), App Review approved |
| H0 — Capacitor iOS ship | **Complete** — 1.0.1 auto-releasing |

### Priority restack

| Track | New allocation | Rationale |
|-------|---------------|-----------|
| `literate-dollop` H1 scaffold (Expo/RN) | **Full intensity — primary mobile workstream** | H0 complete; plan sequencing rule satisfied |
| Android Play Store submission | **Active parallel burst** (~1 day to get listing + AAB ready, then async review wait) | Runs alongside H1; no monolith feature work needed |
| Monolith maintenance | **Background only** — P0-2 branch protection (1–2h), security patches | Capacitor freeze confirmed; no new features |
| P0-1 (single canonical main / GitLab sync) | **Deferred** — acceptable risk for solo maintainer with no active contributors | Revisit before opening contributions |
| literate-dollop H1 allocation | Increased from 0–2 h/week to **full intensity** | Unblocked by H0 completion |

### Monolith maintenance freeze rules
- No new mobile-facing features on Capacitor path without explicit product sign-off
- Security patches and critical bug fixes proceed normally
- P0-2 (branch protection on GitHub `main`) is the only P0 item worth doing immediately — 1–2h, prevents accidental regressions while attention shifts to H1

---

## Section 3 — Android submission path

### Sequence

1. **Google Play Console** — verify `uk.vettrack.app` app entry exists; one-time $25 developer registration if not already done
2. **Signed AAB** — `cd android && ./gradlew bundleRelease` with release keystore (see `docs/mobile/release.md` §Android release)
3. **Play listing content** — populate `android/app/src/main/play/listings/en-US/` (short description, full description, screenshots, feature graphic 1024×500)
4. **Internal track** — submit to Internal Testing first (instant, no review); smoke test on real Android device
5. **Production promotion** — promote Internal → Production once verified

### Key reference
`docs/mobile/release.md` §Android release documents the full build and signing steps. No new server features required — same PWA bundle drives Android.

---

## Section 4 — Post-launch product motion

### What to do now (minimal, appropriate for solo/single-clinic)

| Action | Detail |
|--------|--------|
| App Analytics baseline | App Store Connect → Analytics tab — auto-enabled; monitor impressions, downloads, Day-1/7/28 retention |
| Promotional Text | Update the one-line Promotional Text in App Store Connect — Apple can update this without a new submission |
| Keywords | Verify keywords field is populated for search discovery |
| Clinic onboarding runbook | Document the Clerk sign-up → `ACCOUNT_PENDING_APPROVAL` → admin-approves flow as a 1-page `docs/` runbook for when new clinics are onboarded |

### What to defer (until multi-clinic scale)
- App Store Search Ads
- In-App Events
- Product Page Optimization (A/B testing)
- App Store marketing campaigns

---

## Weekly rhythm

| Priority | Allocation |
|----------|-----------|
| literate-dollop H1 Expo scaffold | Mon–Fri primary |
| Android Play Store submission | 1-day burst within this week, then async |
| Monolith P0-2 + patches | Background, ~1–2h total |
| iOS post-launch monitoring | First 24–48h only |

---

## Frozen constraints (unchanged)

These are not revisited by this operating model:

- Capacitor (`ios/`) not deleted until H7 kill-switch criteria met
- No new mobile-facing features on Capacitor during freeze without product sign-off
- literate-dollop Horizon 3+ bedside work blocked until Android submitted and H1 scaffold running
- Ward kiosk (`/equipment/board` display) stays web-only — not ported to RN

---

## References

### Governance & product
- `docs/governance/PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md` — source improvement plan (P0-5 now closed); weekly rhythm table
- `docs/governance/PRODUCT_MODEL.md` — product scope, critical paths, and frozen surfaces
- `docs/governance/ARCHITECTURE_MAP.md` — full system architecture map
- `docs/devops/github-setup.md` — branch protection, remote canon, CI gate status
- `docs/governance/PRODUCT_ALIGNMENT_REPORT.md` — product/engineering alignment findings

### Agent infrastructure
- `.agents/skills/product-engineering-governor/SKILL.md` — governor skill definition and audit phases
- `.claude/agents/product-engineering-governor.md` — governor agent configuration
- `.agents/skills/product-engineering-governor/code-tour-integration.md` — code tour integration guide

### Mobile
- `docs/mobile/native-ship-checklist.md` — H0 route matrix (PASS status preserved)
- `docs/mobile/release.md` — iOS + Android build and release steps
- `docs/mobile/native-mobile-implementation-manual.md` — H0–H7 sequencing rules
- `docs/MAINTENANCE_MODE.md` — Capacitor freeze and H7 kill-switch rules
