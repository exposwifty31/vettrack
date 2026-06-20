# literate-dollop — Lite Governor Parity Report

**Type:** Cross-repo governance (lite Product Engineering Governor pass)  
**Generated:** 2026-06-18  
**Audited repo:** [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) (local: `~/literate-dollop`)  
**Consumer repo:** `vettrack` (this monolith)  
**Companion:** [`PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md`](./PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md) §Mobile dual-track

---

## Executive summary

| Signal | Status | Severity |
|--------|--------|----------|
| **Expo repo health** | CI green on `main`; 59 vitest tests passing locally | ✅ Good |
| **`@vettrack/contracts` byte parity** | `emergency.ts` + `pending-sync.ts` match installed package in vettrack | ✅ Good |
| **Phase 1 exit gate** | Contracts + PendingSyncStore + Clerk Expo all landed | ✅ Complete |
| **Phase 3 NFC slice** | Scan screen, sync-engine thin port, NFC adapter — in progress on `main` | 🟡 Active |
| **Emergency classifier doctrine** | Same mutation list via contracts; platform storage differs (expected) | ✅ Aligned |
| **Cross-repo doc truth** | literate-dollop claims vettrack is GitLab-only / not on GitHub; vettrack governance found `origin` = GitHub | 🔴 **Critical** confusion |
| **Scope residue in Expo types** | `patients.ts` hospitalization union ported — LEGACY vs June 2026 cut | 🟡 Low |
| **Full API port** | `api.ts` partial (~scan only); hooks deferred | 🟡 Expected per porting plan |
| **rn-parity-matrix** | Referenced in vettrack mobile manual; **not authored in either repo** | 🟡 Gap |

**Verdict:** Expo evolution is **on track** for Horizon 1–3. The highest-risk gap is **documentation / remote policy drift** between repos, not contracts or emergency blocking logic.

---

## Repo snapshot (2026-06-18)

| Metric | literate-dollop | vettrack (consumer) |
|--------|-----------------|---------------------|
| **Canonical remote** | `origin` → GitHub `exposwifty31/literate-dollop` | `origin` → GitHub `exposwifty31/vettrack` (71 commits ahead of GitLab per governance audit) |
| **`main` tip** | `a5a701d` — milestone 1 foundation import | `5a8eabd4` (GitHub) |
| **CI** | `.github/workflows/ci.yml` — contracts gate + typecheck + 59 tests | GitHub Actions + GitLab CI (dual; see governance) |
| **Contracts dep** | Authored in `packages/contracts/` | `"github:exposwifty31/literate-dollop#main&path:packages/contracts"` |
| **Mobile ship** | EAS (`uk.vettrack.expo`) | Capacitor (`uk.vettrack.app`) |

---

## Phase status vs master plan

Source: literate-dollop [`docs/plans/mobile-strategy-master.md`](https://github.com/exposwifty31/literate-dollop/blob/main/docs/plans/mobile-strategy-master.md), [`docs/porting-status.md`](https://github.com/exposwifty31/literate-dollop/blob/main/docs/porting-status.md).

| Phase | Scope | Status | Evidence |
|-------|-------|--------|----------|
| **PR1** | Monorepo + contracts + CI | ✅ Done | `pnpm-workspace.yaml`, CI green |
| **1** | PendingSyncStore, emergency seam, Clerk Expo | ✅ **Exit met** | `pending-sync-store.integration.test.ts`, `code-blue-offline.test.ts` (13 cases), `@clerk/clerk-expo` in auth layouts |
| **2** | VetTrackControl config plugin | 🟡 Scaffold | `plugins/vettrack-control/`, `vettrack-control-plugin.test.ts`; branch `feat/phase-2-vettrack-control` at same commit as `main` |
| **3** | NFC equipment scan vertical slice | 🟡 **In progress** | `scan.tsx`, `nfc-platform.ts`, `sync-engine.ts` thin port, `equipment-scan-api.test.ts` |
| **4–5** | SSE + route parity waves | ⏸ Not started | No SSE in Expo per frozen doctrine until post–H6 |
| **6** | Capacitor kill-switch | ⏸ Decision gate | Documented; no criteria file yet (vettrack P3-7) |

### Phase 1 exit criteria checklist

| Criterion | Met? | Notes |
|-----------|------|-------|
| `@vettrack/contracts` v0.1.0+ in `packages/contracts`, imported by Expo | ✅ | |
| `PendingSyncStore` (expo-sqlite) + integration test | ✅ | ADR 001 |
| `@clerk/clerk-expo` sign-in + API auth headers | ✅ | `clerk-provider.tsx`, `get-auth-headers.ts`, sign-in screen |

---

## Contracts parity

### Package files

| File | literate-dollop | vettrack `node_modules/@vettrack/contracts` |
|------|-----------------|---------------------------------------------|
| `emergency.ts` | source of truth | **Identical** (diff empty) |
| `pending-sync.ts` | source of truth | **Identical** (diff empty) |

### Gate scripts (intentional asymmetry)

| Repo | `contracts-gate.sh` runs |
|------|---------------------------|
| **literate-dollop** | `pnpm --filter @vettrack/contracts typecheck` + `tests/contracts/*` |
| **vettrack** | `contracts:typecheck` + `tests/offline-phase-7-emergency-surface-parity.test.ts` |

Both gates are valid; **neither runs the other's full suite**. Recommendation: vettrack P1-9 — document bump procedure requiring both gates green when `packages/contracts` changes.

### vettrack import shim

`shared/emergency-surfaces.manifest.ts` re-exports from `@vettrack/contracts` — correct pattern; preserves test import paths.

---

## Frozen doctrine parity

| Invariant | vettrack | literate-dollop | Aligned? |
|-----------|----------|-----------------|----------|
| Code Blue never queued offline | `offline-emergency-block.ts` + `api.ts` classifier | `offline-emergency-block.ts` + `api.ts` + `code-blue-offline.test.ts` | ✅ |
| Classifier uses `EMERGENCY_OFFLINE_BLOCK_MUTATIONS` | via `@vettrack/contracts` | via `@vettrack/contracts` | ✅ |
| Local buffer ≤200, never posted | sessionStorage (web) | AsyncStorage (RN) | ✅ (platform-appropriate) |
| Telemetry on block | `api.ts` call site (bounded enum) | Deferred / thinner in Expo `api.ts` | 🟡 Verify H4 telemetry parity |
| SSE / SW / BroadcastChannel | Full Phase 9 stack | **Explicitly excluded** until post–H6 | ✅ By design |
| Offline store | Dexie | expo-sqlite PendingSyncStore (ADR 001) | ✅ By design |
| `clinicId` tenancy | Server enforced | Client must send auth headers; server unchanged | ✅ |

### Emergency block implementation note

`offline-emergency-block.ts` is **82 lines (Expo)** vs **125 lines (vettrack)** — not a contracts drift issue. Vettrack adds Phase 9 commentary, `safeStorageGetItem` session scope, and sync `recordEmergencyBlockLocally`; Expo uses AsyncStorage async API. **Classifier logic is equivalent** (same contract constants).

---

## Porting status alignment

Per literate-dollop `docs/porting-status.md` (milestone 1 + Phase 3):

### Landed in literate-dollop

- Locales, i18n core, domain types, restock reducer, shift-chat types (Hebrew labels stripped)
- Phase 3: `network.ts`, `equipment-id.ts`, `equipment-scan` API, thin `sync-engine`, `use-sync`, NFC platform, `/scan` screen

### Correctly deferred

- Full `api.ts` (~1042 LOC vettrack) — scan endpoints only for Phase 3
- `use-auth`, `use-push-notifications`, `use-settings`, shift-chat hooks — blocked on full API + RN rewrites
- All `src/pages/**` UI — rebuild native, not port

### Scope residue (align with June 2026 cut)

| Item | Location | Class | Action |
|------|----------|-------|--------|
| `patients.ts` (`HospitalizationStatus`) | `apps/expo/src/types/` | LEGACY | Trim on next types cleanup or mark deprecated in porting-status |
| `billing.ts` types | `apps/expo/src/types/` | LEGACY | Same — no RN UI planned for removed billing surface |

---

## CI / delivery comparison

| Aspect | literate-dollop | vettrack |
|--------|-----------------|----------|
| Merge gate | CI on PR/push `main` | CI + Playwright (branch protection **missing**) |
| Contracts in gate | ✅ | ✅ (GitHub); ❌ GitLab |
| Native build in CI | EAS manual (`eas build`) | Capacitor manual; Android job in open MR !20 |
| Test count (default) | 59 vitest | `pnpm test` (excludes DB/live-server) |
| Last `main` CI | ✅ success 2026-06-17 | ✅ success 2026-06-18 |

**literate-dollop is ahead on mobile CI clarity** (single remote, single workflow). vettrack is ahead on E2E depth (Playwright Phase 9 drills) but enforcement is weaker.

---

## Cross-repo documentation contradictions

| Document | Claims | Observed (vettrack governance) | Fix owner |
|----------|--------|----------------------------------|-----------|
| literate-dollop `README.md` | vettrack is GitLab maintenance, **not on GitHub** | `origin` = `exposwifty31/vettrack` on GitHub; active merges | Update literate-dollop README + AGENTS |
| `MAINTENANCE_MODE.md` | `origin` = GitLab only; remove GitHub remote | GitHub is active delivery remote | vettrack P0-1 |
| `CONTRIBUTING.md` | GitLab canonical | Diverges from practice | vettrack P1-6 |

These contradictions directly cause agent wrong-path behavior (F2-class for mobile + monolith).

---

## Risk register (cross-repo)

| ID | Risk | Likelihood | Severity | Mitigation |
|----|------|------------|----------|------------|
| X1 | Contracts changed in literate-dollop without vettrack bump | Medium | High | P1-9 bump discipline + PR template checkbox |
| X2 | Emergency surface added in vettrack API without contracts update | Low | Critical | `emergency-surface-inventory.test.ts` + dual gates |
| X3 | `vettrack://` scheme collision (Capacitor + Expo on same device) | Medium | Medium | Documented in literate-dollop README — uninstall Capacitor during NFC QA |
| X4 | Premature Capacitor deletion | Low | Critical | P3-7 kill-switch criteria |
| X5 | RN ships without parity matrix | Medium | High | P2-8 `rn-parity-matrix.md` |
| X6 | Stale mobile narrative in agents | High | Medium | This report + PRODUCT_MODEL §Mobile dual-track |

---

## Recommendations (ranked)

### P0 — Cross-repo truth

| # | Action | Repo | Effort |
|---|--------|------|--------|
| X-P0-1 | Reconcile vettrack canonical remote (P0-1 in improvement plan) | vettrack | M |
| X-P0-2 | Update literate-dollop `README.md` + `AGENTS.md` to describe **actual** vettrack remotes after P0-1 decision | literate-dollop | S |

### P1 — Contract hygiene

| # | Action | Repo | Effort |
|---|--------|------|--------|
| X-P1-1 | Document contracts bump: change in literate-dollop → merge `main` → bump vettrack `package.json` → both `contracts-gate.sh` | both | S |
| X-P1-2 | Add PR checkbox on both repos: "Emergency/offline surfaces changed → contracts + parity tests" | both | S |
| X-P1-3 | Complete Phase 3 NFC slice exit (airplane-mode scan → queue → replay) per porting-status | literate-dollop | M |

### P2 — Parity planning

| # | Action | Repo | Effort |
|---|--------|------|--------|
| X-P2-1 | Author `docs/mobile/rn-parity-matrix.md` (vettrack) | vettrack | M |
| X-P2-2 | Trim or deprecate LEGACY types (`patients.ts`, `billing.ts`) in Expo types layer | literate-dollop | S |
| X-P2-3 | Land Phase 2 VetTrackControl plugin dev build | literate-dollop | M |

### P3 — Horizon

| # | Action | Repo | Effort |
|---|--------|------|--------|
| X-P3-1 | Native push API when literate-dollop starts H4 | vettrack | M |
| X-P3-2 | Full governor Phases 0–6 inside literate-dollop when Expo becomes primary lane | literate-dollop | L |
| X-P3-3 | Horizon 7 kill-switch checklist | both | S |

---

## What not to do

| Action | Why |
|--------|-----|
| Move Expo app into vettrack monolith | Violates maintenance mode |
| Add Dexie to literate-dollop | ADR 001 forbids |
| Port SSE to Expo before H6 approval | Frozen doctrine in mobile master plan |
| Delete Capacitor in vettrack while Expo is Phase 3 | H0 still active ship path |
| Rebuild ER/patient RN screens | Same June 2026 scope cut as web |

---

## Verification commands (both repos)

**literate-dollop:**

```bash
cd ~/literate-dollop
pnpm install --frozen-lockfile
pnpm contracts:gate
pnpm --filter vettrack-expo exec tsc --noEmit
pnpm test
```

**vettrack (after contracts bump):**

```bash
cd ~/vettrack
pnpm install
bash scripts/ci/contracts-gate.sh
npx tsc --noEmit
```

---

## Governance links

| Artifact | Location |
|----------|----------|
| Mobile dual-track plan | [`PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md`](./PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md) |
| Product model (Expo subsection) | [`PRODUCT_MODEL.md`](./PRODUCT_MODEL.md) |
| Capacitor ship manual | [`docs/mobile/native-mobile-implementation-manual.md`](../mobile/native-mobile-implementation-manual.md) |
| literate-dollop master plan | [mobile-strategy-master.md](https://github.com/exposwifty31/literate-dollop/blob/main/docs/plans/mobile-strategy-master.md) |
| Porting status | [porting-status.md](https://github.com/exposwifty31/literate-dollop/blob/main/docs/porting-status.md) |

**Next:** Execute vettrack P0-1 (remote truth) and X-P0-2 (literate-dollop doc sync) as a pair; then P1-9 contracts bump discipline.
