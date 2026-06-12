# VetTrack — Master Transformation Plan

**Date:** 2026-06-12
**Status:** Governing artifact for the transformation program (Phase 1 → Phase 2 workflow)
**Evidence base:** repository at `main` (HEAD `1c52f248`), `ARTIFACTS.md`, `docs/transformation/audit/PHASE_A_AUDIT.md`, `docs/audit/*`, `docs/devops/ci-cd.md`, `docs/setup/environment.md`, `docs/mobile/*`

This document consolidates the already-executed transformation program (Phase A audit → Phase B mandatory fixes → Phase C refactor → mobile/CI/PWA hardening milestones M0–M10) and governs the remaining work. Where prior artifacts already cover a topic, this plan references them rather than duplicating them.

---

## 1. Vision

VetTrack is a multi-tenant veterinary hospital operations platform (equipment tracking, medication workflows, inventory, scheduling, billing, PMS integrations). The transformation goal: a production-grade platform delivering a high-quality PWA, native iOS and Android apps (Capacitor), offline-first reliability, clinical-safety-correct realtime behavior, and app-store readiness — without breaking any frozen architecture contract (SSE realtime, Code Blue guarantees, authority enforcement envelope, i18n namespace freeze).

## 2. Current-state assessment

**Done and verified (evidence in `ARTIFACTS.md` M0–M10):**
- Phase C UI/UX refactor (T2.1–T4.3): unified NAV model, AppShell consolidation, canonical `/equipment/tasks` + `/equipment/board` routes, answer-first home, RTL logical properties, motion-safe a11y. 318/318 vitest passing at merge.
- Mobile foundation: Capacitor v8 shell (iOS `uk.vettrack.app`, Android minSdk 24), NFC (`@capgo/capacitor-nfc` + Web NFC fallback), camera plugin (feature-flagged), native system-browser OAuth (`src/lib/native-oauth.ts`) shipped in `1c52f248`.
- PWA: build-tag-versioned SW, emergency-endpoint cache denylist, manifest with shortcuts; split-version detection.
- Performance: ~35 DB indexes added (migrations 147–151); query staleTime tuned to SSE-driven model.
- Audit documentation: `docs/audit/routes.md` (49 route modules), `docs/audit/frontend-routes.md`, `docs/audit/db.md` (30+ tables).
- CI/CD: GitLab pipeline (typecheck → build → test → integration → architecture → deploy → playwright → release-gate), documented in `docs/devops/ci-cd.md`.

**In-flight / at-risk state (as of 2026-06-12):**
- App Store resubmission: rejection root cause (in-WebView OAuth) fixed by `1c52f248`, deployed directly to Railway (production = project `pacific-flow`, buildTag `1.1.2-mqa2zhbi`). **`1c52f248` is unpushed to origin** (GitLab access blocked) — production will regress on the next CI deploy unless pushed first.
- Uncommitted working tree: `capacitor://localhost` CORS allowlist + NativeClerkGate/api-origin work (required for bundled-shell "Option B" builds), iOS entitlements/privacy manifest, Google services configs, resubmission runbook. These exist only locally.
- Remaining runbook steps: device-test Apple/Google sign-in, promote reviewer account, archive build, resubmit (see `RESUBMISSION_RUNBOOK.md`).

**Known debt (evidence: `PHASE_A_AUDIT.md`, `docs/technical-debt.md`):**
- T1.4/T1.5 leftovers (arbitrary px values, bare buttons) — cosmetic, tracked.
- `pdf-parse@1.1.4` unmaintained.
- Mobile CI native jobs are docs-only (no Capacitor-aware runner provisioned).

## 3. Target architecture

Unchanged from current — the architecture is post-transformation and its load-bearing surfaces are **frozen by contract** (see `CLAUDE.md` "Frozen architecture surfaces"): SSE + outbox realtime, BroadcastChannel envelope, build-tag SW versioning, emergency cache denylist, `off|shadow|enforce` enforcement envelope, Strategy A safety net, i18n namespace freeze, closed audit/telemetry unions. Target-state work is **additive only**: native push (APNs/FCM), Option B bundled shell, mobile CI jobs.

## 4. UX strategy

Executed in Phase C (see `PHASE_A_AUDIT.md` for findings → `ARTIFACTS.md` M0 for execution): single nav model, 6-destination IA with legacy redirects, answer-first home, status-badge consistency, RTL-correct logical properties, ≥44px targets and motion-safe animation on clinical surfaces. Remaining UX strategy = hold the line: new surfaces consume `nav-model.ts`, `AppShell`, `StatusBadge`, typed `t.*` i18n; mobile is the source of truth — desktop aligns to mobile, never the reverse.

## 5. Mobile strategy

- **Option A (current production): remote-WebView shell** — `CAPACITOR_SERVER_URL=https://vettrack.uk`. Ships web fixes instantly without store review; this is the path that carried the App Review fix.
- **Option B (target): bundled shell** — `webDir: dist/public`, offline-capable. Blocked on committing the CORS allowlist + NativeClerkGate/api-origin work currently in the working tree.
- Native OAuth via system browser is mandatory on both paths (Apple/Google block WebView OAuth — Guideline 2.1a). Device verification is required before any resubmission; it cannot be exercised in CI.
- Full audit: `docs/mobile/native-ux-audit.md`. Release process: `docs/mobile/release.md`. Store metadata: `docs/mobile/store-metadata.md`.

## 6. Reliability strategy

Already implemented and frozen: outbox-backed SSE with replay + cursor reconciliation; offline-first Dexie + sync-engine with circuit breaker; Code Blue online-only mutations with loud failure; server-confirmed emergency state; fail-open carve-outs audited (`clinical_invariant_fail_open`); BullMQ recovery sweeps for inventory deduction and stale ownership. Strategy: do not touch; verify with the Phase 9 drills on any adjacent change.

## 7. Testing strategy

- Unit/integration: vitest (`pnpm test`) — baseline 318 passing, 51 skipped by design.
- Type safety: `npx tsc --noEmit` must stay at zero errors (run after every file change).
- Realtime/PWA: Playwright drills (`tests/phase-9-drills.spec.ts`) — required for Phase-9-adjacent changes.
- DB-integration and live-server suites are opt-in (need `DATABASE_URL` / running server).
- i18n parity + no-Hebrew-in-source tests enforce the bilingual invariant.
- Gap: native iOS/Android build validation and device OAuth testing are manual (no Capacitor CI runner) — documented as deferred, below.

## 8. Deployment strategy

- Normal path: GitLab CI deploy job (`railway up` wrapper) → Railway production (`pacific-flow` / service `VetTrack`).
- Contingency path (used 2026-06-12): direct `railway up` from a clean worktree when GitLab is unreachable. **Constraint:** anything deployed directly must be pushed to origin before the next CI deploy, or production regresses.
- Migrations apply at server startup (`runMigrations()`); generated SQL committed in `migrations/`.

## 9. Rollout strategy

- Web: continuous via CI deploy; SW build-tag forces coherent client upgrade (split-version detector + update banner).
- Enforcement features: per-clinic `off → shadow → enforce` graduation with bounded counters; never skip shadow.
- iOS: Option A means most changes need no store release; store releases only for native-shell changes (icons, plugins, entitlements). Resubmission runbook governs the current release.
- Android: store release deferred until after iOS approval (metadata ready in `docs/mobile/store-metadata.md`).

## 10. Risk analysis

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| `1c52f248` unpushed → next CI deploy regresses production OAuth fix | High | Medium | Push to origin as soon as GitLab access returns; until then do not trigger CI deploys |
| Uncommitted Option-B work lost (CORS allowlist, NativeClerkGate) | High | Medium | Commit to a branch promptly; work is local-only today |
| App Review re-rejection (untested device OAuth) | High | Medium | Device-test Apple/Google sign-in per `RESUBMISSION_RUNBOOK.md` before resubmitting |
| No native CI → silent Capacitor build breakage | Medium | Medium | Provision Capacitor-aware runner (deferred); until then manual `npx cap sync` check per release |
| Frozen-surface regression via well-meaning refactor | High | Low | `CLAUDE.md` doctrine + architecture CI stage + Phase 9 drills |
| `pdf-parse` unmaintained dependency | Low | Low | Replace when touched; no CVE pressure today |

## 11. Migration phases

| Phase | Scope | Status |
|---|---|---|
| Phase A | Full UX/architecture audit | ✅ 2026-06-09 (`PHASE_A_AUDIT.md`) |
| Phase B | Mandatory fixes (i18n violations, dual-shell) | ✅ prior session |
| Phase C | Refactor T2.1–T4.3 | ✅ merged (`b9fb3474`, `61c3e3f9`) |
| M1–M10 | Mobile/CI/PWA/perf hardening | ✅ (`ARTIFACTS.md`) |
| **R1** | App Store resubmission (push `1c52f248`, commit Option-B work, device test, resubmit) | 🔶 in progress — blocked on GitLab access + device |
| **R2** | Native push (APNs/FCM on Capacitor) | ⏸ deferred |
| **R3** | Mobile CI native jobs (runner provisioning) | ⏸ deferred |
| **R4** | Option B bundled-shell release | ⏸ deferred until R1 + CORS work lands |

### Remaining recommendations (rationale / impact / effort / risk / dependencies)

1. **Push `1c52f248` and commit the Option-B working-tree changes.** Rationale: production-deployed code not in origin is the single largest operational risk. Impact: removes regression-on-deploy hazard. Effort: minutes. Risk: none. Dependencies: GitLab account access (currently blocked — external).
2. **Device-test native OAuth, then resubmit to App Review.** Rationale: the rejection class (2.1a) can only be cleared on-device. Impact: store availability. Effort: hours. Risk: low. Dependencies: physical iOS device, item 1 recommended first.
3. **APNs/FCM native push (R2).** Rationale: VAPID web push does not deliver to Capacitor shells. Impact: parity for native users. Effort: days. Risk: medium (cert management). Dependencies: store presence (R1).
4. **Capacitor CI runner (R3).** Rationale: native builds currently unvalidated by CI. Impact: catches plugin/Gradle/Xcode breakage pre-release. Effort: days (infra). Risk: low. Dependencies: runner provisioning (external).
5. **Lighthouse + device screenshot QA.** Rationale: PWA score and store screenshots unverified. Effort: hours. Risk: none. Dependencies: running app + devices.

## 12. Success criteria

1. `npx tsc --noEmit` → 0 errors; `pnpm test` → no failures (baseline 318 pass / 51 skipped). **Verifiable now.**
2. All Phase 1 deliverables exist and reflect repo reality (`docs/master-plan.md`, `docs/mobile/native-ux-audit.md`, `docs/audit/{routes,db}.md`, `docs/devops/ci-cd.md`, `docs/setup/environment.md`, `ARTIFACTS.md`).
3. No frozen-surface contract violated (architecture CI stage green; Phase 9 drills green on adjacent changes).
4. R1 complete: `1c52f248` in origin/main, Option-B work committed, app approved on the App Store.
5. Deferred items (R2–R4, Lighthouse, device QA) explicitly tracked in `ARTIFACTS.md` "Remaining Work" — never silently dropped.
