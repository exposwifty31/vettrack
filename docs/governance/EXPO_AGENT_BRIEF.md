# Expo Agent Brief — VetTrack Governance → literate-dollop

> **Obsolete GitLab references (2026-07-07):** GitLab remote/CI and related docs are out of scope. Canonical: GitHub `origin` + GitHub Actions. Ignore GitLab rows in tables below.

**Type:** Cross-repo agent runbook  
**Generated:** 2026-06-19  
**Audience:** Agents and maintainers working in [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop)  
**Consumer repo:** `vettrack` (monolith — API, web, Capacitor)  
**Prerequisites:** [`LITERATE_DOLLOP_PARITY_REPORT.md`](./LITERATE_DOLLOP_PARITY_REPORT.md), [`PRODUCT_MODEL.md`](./PRODUCT_MODEL.md) §Mobile dual-track, literate-dollop [`docs/plans/mobile-strategy-master.md`](https://github.com/exposwifty31/literate-dollop/blob/main/docs/plans/mobile-strategy-master.md)

---

## 1. Current state

### VetTrack monolith (`vettrack`)

| Area | Status (2026-06-19) |
|------|---------------------|
| **Product scope** | Equipment-first post–June 2026 cut (migrations 142–143). ER/patient, medication formulary, pharmacy forecast removed — do not rebuild in RN. |
| **Web + API** | Production monolith: React PWA, Express, PostgreSQL, SSE realtime, Code Blue, offline Dexie sync. |
| **Capacitor (H0)** | **Active store path.** iOS 1.0.1 approved and auto-releasing (2026-06-18). Android submission in flight. |
| **Governance** | Product Engineering Governor Phases 0–6 complete under `docs/governance/`. Improvement plan in execution (Phase 7). |
| **Contracts** | **Consumes** `@vettrack/contracts` from literate-dollop via `github:` path dep — does not author contracts here. |
| **CI** | GitHub Actions active on `main`. Branch protection still pending (P0-2). See [`docs/devops/github-setup.md`](../devops/github-setup.md). |
| **Remote** | `origin` → GitHub `exposwifty31/vettrack` (canonical). |

### literate-dollop (Expo/RN)

| Area | Status (2026-06-18 audit) |
|------|----------------------------|
| **Repo health** | CI green on `main`; 59 vitest tests passing locally. |
| **Phase 1** | **Exit met** — `@vettrack/contracts`, `PendingSyncStore` (expo-sqlite), Clerk Expo auth. |
| **Phase 2** | VetTrackControl config plugin scaffolded; not yet landed on `main`. |
| **Phase 3** | **In progress** — NFC equipment scan vertical slice (`scan.tsx`, thin `sync-engine`, NFC adapter). |
| **Phases 4–7** | Not started (SSE, route parity waves, Capacitor kill-switch). |
| **Contracts parity** | `emergency.ts` + `pending-sync.ts` **byte-identical** to vettrack `node_modules/@vettrack/contracts`. |
| **Doc drift** | literate-dollop README/AGENTS still claim vettrack is GitLab-only / not on GitHub — **wrong** and causes agent misrouting. |

### Dual-track posture (by design)

```
vettrack (H0)          literate-dollop (H1–H7)
─────────────────      ─────────────────────────
Capacitor ship NOW  →  Expo greenfield horizon
Bundled PWA            Native RN rebuild
contracts CONSUMER  →  contracts AUTHOR
API unchanged          Copy patterns FROM monolith
```

Capacitor and Expo **coexist** until Horizon 7 kill-switch. Do not delete Capacitor paths in vettrack or assume Expo is production yet.

---

## 2. What has been done (vettrack governance, June 2026)

### Governor audit deliverables (Phases 0–6)

| Artifact | Purpose |
|----------|---------|
| [`PRODUCT_MODEL.md`](./PRODUCT_MODEL.md) | Product vision, personas, critical paths, mobile dual-track |
| [`PRODUCT_ALIGNMENT_REPORT.md`](./PRODUCT_ALIGNMENT_REPORT.md) | Live product vs stated scope |
| [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md) | Module/route/worker inventory |
| [`docs/devops/github-setup.md`](../devops/github-setup.md) | Branch/MR/remote drift audit |
| [`CI_CD_GOVERNANCE.md`](./CI_CD_GOVERNANCE.md) | Pipeline maturity, gate gaps |
| [`ENGINEERING_FRICTION_REPORT.md`](./ENGINEERING_FRICTION_REPORT.md) | Delivery friction ranked by product impact |
| [`PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md`](./PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md) | P0–P3 prioritized execution plan |
| [`FROZEN_SURFACE_CHANGE_PROTOCOL.md`](./FROZEN_SURFACE_CHANGE_PROTOCOL.md) | Checklist for SSE/PWA/Code Blue/authority changes |
| [`LITERATE_DOLLOP_PARITY_REPORT.md`](./LITERATE_DOLLOP_PARITY_REPORT.md) | Cross-repo lite governor pass on Expo repo |

### Completed improvement items (relevant to Expo)

| ID | Item | Status |
|----|------|--------|
| P0-3 | Contracts gate in GitLab CI | ✅ Done 2026-06-18 |
| P0-4 | Frozen-surface change protocol | ✅ Done 2026-06-18 |
| P0-5 | Capacitor legal pages + iOS resubmission | ✅ Done — iOS 1.0.1 approved |
| — | Cross-repo parity audit (literate-dollop) | ✅ Done 2026-06-18 |
| — | Mobile dual-track section in improvement plan | ✅ Done |
| — | `SECURITY.md`, `.github/CODEOWNERS`, `docs/devops/github-setup.md` | ✅ Added (governance rollout) |

### Still open (monolith — affects Expo indirectly)

| ID | Item | Expo impact |
|----|------|-------------|
| P0-1 | Single canonical `main` / remote | Agents must not assume GitLab-only vettrack |
| P0-2 | Branch protection on GitHub `main` | Safer API surface for RN to target |
| P1-9 | Contracts bump discipline doc | Required whenever `packages/contracts` changes |
| P2-8 | `docs/mobile/rn-parity-matrix.md` | Blocks confident H5 parity waves |
| P3-7 | Capacitor kill-switch criteria | Blocks H7 cutover planning |

---

## 3. What this means for Expo development

### You own the mobile future; the monolith owns the API floor

- **Implement Expo/RN only in literate-dollop.** Scaffolding `apps/expo` inside vettrack is explicitly rejected (maintenance mode).
- **Author shared contracts in literate-dollop** (`packages/contracts`). Every emergency/offline surface change must flow: literate-dollop → vettrack `package.json` bump → both `contracts-gate.sh` green.
- **Copy reference code from vettrack; do not fork behavior.** Port patterns (classifier, sync constants, API shapes) — rebuild UI natively, do not port `src/pages/**` wholesale.

### Horizon sequencing is now explicit

| Horizon | Your focus | Unblocked? |
|---------|------------|------------|
| **H1** | Workspace, contracts, Clerk Expo, PendingSyncStore | ✅ Complete |
| **H2** | VetTrackControl plugin, dev client builds | 🟡 Scaffold exists — land dev build |
| **H3** | NFC scan slice, offline queue → replay | 🟡 **Current priority** |
| **H4** | SSE + native push API | ⏸ Blocked until H3 exit + monolith endpoint |
| **H5** | RN parity waves | ⏸ Needs `rn-parity-matrix.md` in vettrack |
| **H6–H7** | Cutover banner, Capacitor retirement | ⏸ Product decision + kill-switch doc |

**Sequencing rule:** H0 (Capacitor) is complete enough that **H1 scaffold is unblocked**. Scale H3+ bedside work; do not wait for GitLab remote reconciliation — but **do** fix cross-repo doc lies (see recommendations).

### Frozen doctrine applies to you (non-negotiable)

| Invariant | Expo expectation |
|-----------|------------------|
| Code Blue never queued offline | `classifyEmergencyEndpoint` + `EMERGENCY_OFFLINE_BLOCK_MUTATIONS` from `@vettrack/contracts` |
| No Dexie in RN | expo-sqlite `PendingSyncStore` (ADR 001) |
| No SSE before H6 approval | Explicitly excluded in mobile master plan |
| No WebSockets | SSE only when ported; match web transport |
| `clinicId` tenancy | Client sends auth headers; server enforces — never trust JWT role |
| June 2026 scope cut | No ER/patient/hospitalization RN screens; trim LEGACY types (`patients.ts`, `billing.ts`) |
| Ward kiosk `/equipment/board` | **Web only** — never RN target |
| Hebrew copy | `locales/*.json` only — not in identifiers or source strings |

### Contracts are the integration contract

Byte parity on `emergency.ts` and `pending-sync.ts` is **verified today**. The highest-risk failure mode is **silent drift** when vettrack adds an emergency API path without updating contracts. Your tests (`code-blue-offline.test.ts`, contracts gate) are the RN-side guard; vettrack runs `tests/offline-phase-7-emergency-surface-parity.test.ts`.

### Capacitor coexistence on device

Both apps may use `vettrack://` scheme. During NFC QA, **uninstall Capacitor build** on test devices to avoid deep-link collision (documented in literate-dollop README).

---

## 4. Recommendations for the Expo agent

### P0 — Fix agent truth (do first)

| # | Action | Why |
|---|--------|-----|
| **E-P0-1** | Update literate-dollop `README.md` and `AGENTS.md`: vettrack **is** on GitHub (`exposwifty31/vettrack`); GitLab is secondary/stale until P0-1 resolves | Stops wrong-path pushes and "monolith not on GitHub" assumptions |
| **E-P0-2** | Link this brief + parity report from literate-dollop `AGENTS.md` | Single entry point for cross-repo context |
| **E-P0-3** | On every PR touching `packages/contracts`, run `pnpm contracts:gate` **and** note that vettrack must bump dep | Prevents F8 contracts drift |

### P1 — Complete active slice (H3)

| # | Action | Why |
|---|--------|-----|
| **E-P1-1** | Finish Phase 3 NFC exit: airplane-mode scan → queue in PendingSyncStore → online replay | Current milestone per porting-status |
| **E-P1-2** | Add PR template checkbox: "Emergency/offline surfaces changed → contracts + parity tests on both repos" | Mirrors vettrack P1-9 intent |
| **E-P1-3** | Document contracts bump procedure in literate-dollop `docs/` (symmetric to vettrack P1-9) | Makes cross-repo coupling explicit |
| **E-P1-4** | Land Phase 2 VetTrackControl plugin on `main` with passing `vettrack-control-plugin.test.ts` | Unblocks NFC hardware QA on dev client |

### P2 — Hygiene and planning

| # | Action | Why |
|---|--------|-----|
| **E-P2-1** | Mark `patients.ts` / `billing.ts` types as LEGACY or remove on next types pass | Aligns with June 2026 scope cut |
| **E-P2-2** | Request/co-author `docs/mobile/rn-parity-matrix.md` in **vettrack** before H5 | Referenced in native manual but file does not exist |
| **E-P2-3** | Defer full `api.ts` port (~1042 LOC) — keep scan-only API until parity matrix defines waves | Matches porting-status; avoids premature surface area |
| **E-P2-4** | Verify emergency-block telemetry parity with vettrack `api.ts` bounded enums before H4 | Parity report flags 🟡 gap |

### P3 — Horizon (do not start early)

| # | Action | When |
|---|--------|------|
| **E-P3-1** | SSE port | After H3 exit + explicit H4 approval in master plan |
| **E-P3-2** | Native push client | When vettrack lands `POST /api/push-subscriptions/native` (P3-5) |
| **E-P3-3** | Full Product Engineering Governor pass in literate-dollop | When Expo becomes primary delivery lane (P3-6) |
| **E-P3-4** | Capacitor kill-switch checklist | Coordinate with vettrack P3-7 before any H7 talk |

---

## 5. What not to do (agent guardrails)

| Action | Why |
|--------|-----|
| Move Expo app into vettrack monolith | Violates maintenance mode |
| Add Dexie to literate-dollop | ADR 001 forbids |
| Port SSE / BroadcastChannel / service worker patterns before H6 | Frozen doctrine |
| Queue Code Blue mutations offline | Critical safety invariant |
| Delete Capacitor references in vettrack | H0 still active; H7 requires written kill-switch |
| Rebuild ER/patient RN flows | Same June 2026 cut as web |
| Build RN ward kiosk (`/equipment/board`) | Locked web-only |
| Assume vettrack `origin` is GitLab | Causes merge/rebase incidents (F2) |
| Change `packages/contracts` without vettrack bump plan | Breaks installed package parity |

---

## 6. Verification commands (run before claiming done)

**literate-dollop:**

```bash
cd ~/literate-dollop
pnpm install --frozen-lockfile
pnpm contracts:gate
pnpm --filter vettrack-expo exec tsc --noEmit
pnpm test
```

**vettrack (after contracts change — coordinate with monolith maintainer):**

```bash
cd ~/vettrack
pnpm install   # picks up github: path dep bump
bash scripts/ci/contracts-gate.sh
npx tsc --noEmit
```

**Parity spot-check (contracts bytes):**

```bash
diff -u ~/literate-dollop/packages/contracts/src/emergency.ts \
        ~/vettrack/node_modules/@vettrack/contracts/src/emergency.ts
diff -u ~/literate-dollop/packages/contracts/src/pending-sync.ts \
        ~/vettrack/node_modules/@vettrack/contracts/src/pending-sync.ts
# Expect empty diff after bump
```

---

## 7. Canonical references

| Topic | Location |
|-------|----------|
| Parity audit (detailed) | [`LITERATE_DOLLOP_PARITY_REPORT.md`](./LITERATE_DOLLOP_PARITY_REPORT.md) |
| Monolith improvement backlog | [`PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md`](./PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md) |
| Product + mobile horizons | [`PRODUCT_MODEL.md`](./PRODUCT_MODEL.md) §Mobile dual-track |
| Monolith maintenance boundary | [`docs/MAINTENANCE_MODE.md`](../MAINTENANCE_MODE.md) |
| Capacitor ship manual | [`docs/mobile/native-mobile-implementation-manual.md`](../mobile/native-mobile-implementation-manual.md) |
| Expo master plan | [literate-dollop mobile-strategy-master.md](https://github.com/exposwifty31/literate-dollop/blob/main/docs/plans/mobile-strategy-master.md) |
| Porting status | [literate-dollop porting-status.md](https://github.com/exposwifty31/literate-dollop/blob/main/docs/porting-status.md) |
| Scope cut | [`docs/scope-change-2026.md`](../scope-change-2026.md) |
| Frozen web surfaces | [`CLAUDE.md`](../../CLAUDE.md) §Frozen architecture surfaces |

---

## 8. Next actions (suggested order)

1. **E-P0-1** — Sync literate-dollop docs with GitHub reality (pair with vettrack P0-1 when decided).
2. **E-P1-1** — Close Phase 3 NFC vertical slice exit criteria.
3. **E-P1-4** — Land VetTrackControl plugin for dev-client NFC QA.
4. **E-P1-3** — Publish contracts bump runbook in both repos.
5. **E-P2-2** — Author `rn-parity-matrix.md` before expanding API port beyond scan.

**Monolith pairing:** vettrack P0-1 (remote truth) and literate-dollop E-P0-1 should land together so agents on both sides share one narrative.
