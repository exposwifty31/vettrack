# VetTrack — Product Model

**Phase:** 0 — Product Discovery  
**Generated:** 2026-06-18  
**Governor:** Product Engineering Governor  
**Sources:** `README.md`, `CONTEXT.md`, `docs/scope-change-2026.md`, `docs/MAINTENANCE_MODE.md`, `docs/investor-deck/`, `src/app/routes.tsx`, `.cursor/plans/backlog-items-3-7-9-10-hyper-plan.md`

---

## Product vision

VetTrack is a **veterinary hospital operations platform** that sits **above** incumbent practice management systems (PIMS) as an **orchestration and operational intelligence layer**. After the June 2026 scope change (migrations 142–143), the product is **equipment-first**: track assets through custody, readiness, waitlist, staging, and emergency workflows — with offline-capable staff UX, multi-clinic tenancy, audit-heavy mutations, and external PMS adapters.

**One-line identity:** ICU-grade equipment and shift operations for veterinary hospitals — mobile-first PWA + Capacitor native shell, Hebrew-default bilingual UI, SSE realtime, Code Blue emergency surfaces, and integration adapters for existing systems of record.

**What VetTrack is not (post-2026):** A full PIMS replacement, ER patient board, medication formulary, or pharmacy forecast product. Those domains were removed from schema and UI; legacy routes redirect to equipment surfaces.

**Strategic posture:** Land **on top of** incumbent PIMS (IDEXX/Cornerstone, ezyVet, Provet, etc.) where hospitals keep their legal/billing system of record. Differentiate on **operational traceability**, **ward visibility**, **emergency coordination**, and **shift-time asset workflows** — not charting or invoicing alone.

---

## User personas

| Persona | Role(s) | Primary goals | Typical surfaces |
|--------|---------|---------------|------------------|
| **Floor technician** | `technician`, `vet_tech`, `lead_technician`, `senior_technician` | Find, check out, return, and stage equipment fast; respond to waitlist promotions; complete tasks | `/equipment`, `/my-equipment`, `/equipment/tasks`, `/alerts`, scan flows |
| **Veterinarian** | `vet` | Same as technician plus clinical authority for dispense/check-in gated actions | Equipment detail, tasks, Code Blue participation |
| **Shift lead / charge nurse** | `lead_technician`, `senior_technician`, `vet` | Ward visibility, staging priority, shift chat archive, operational metrics | `/equipment/board`, `/home`, shift chat, analytics |
| **Emergency responder** | Any on-shift role during Code Blue | Start/log/end emergency sessions; wall display; crash cart checks | `/code-blue`, `/code-blue/display`, `/crash-cart` |
| **Hospital administrator** | `admin` | Clinic config, users, shifts, asset types, docks, integrations, audit | `/admin`, `/admin/shifts`, `/settings`, `/audit-log` |
| **Operations / management** | `admin` | Dashboards, procurement, inventory oversight, KPI views | `/dashboard`, `/analytics`, `/procurement`, `/inventory` |
| **Ward display / kiosk** | Unattended display auth | Live board snapshot without interactive checkout | `/equipment/board` (SSE-driven; SW cache bypass) |
| **Native mobile user** | Any role on Capacitor shell | Same PWA flows with bundled assets + Clerk; NFC/QR at bedside | Capacitor iOS/Android (maintenance ship path) |

**Locale:** Hebrew default (`locales/he.json`); English supported. User-facing copy uses **Tasks / משימות**; internal `appointments` naming is frozen for compatibility.

**Tenancy:** Every persona operates inside a single `clinicId` security boundary. Cross-clinic data access is a defect.

---

## Core workflows

### 1. Equipment lifecycle (primary value loop)

1. **Discover** — list, filter, scan (QR/NFC), room radar (`/rooms`, `/locations`)
2. **Check out** — assign custody to staff; operational state axes update on `vt_equipment`
3. **Use / stage** — staging queue with clinical priority and expiry workers
4. **Return / dock** — return to dock or room; triggers waitlist promotion when applicable
5. **Waitlist** — queue when demand exceeds supply; promotion on return with reservation TTL
6. **Alerts** — stale checkout nudges, charge alerts, expiry checks (BullMQ + push)

### 2. Tasks (unified clinical task model)

Staff work items on `vt_appointments`, rendered as **Tasks** at `/equipment/tasks`. Internal API and table names remain `appointments` (Phase 6 §17).

### 3. Code Blue (mission-critical emergency)

Equipment-centric emergency log: session start, log entries, presence, server-confirmed end. Wall display and history. **Online-only mutations** — never queued offline.

### 4. Ward board (live visibility)

`/equipment/board` — display snapshot via `/api/display/snapshot`; SSE-driven updates; never cached in service worker.

### 5. Inventory & procurement

Containers, items, dispense events, restock, purchase orders. Orphan dispense enforcement against appointments is currently disabled post-143.

### 6. Shifts & authority

Shift sessions, clinical check-in, shift chat archive. Authority evaluators (`off | shadow | enforce`) with Strategy A safety net for legacy shift-derived authority.

### 7. Integrations (adapter layer)

`server/integrations/` — encrypted credentials, sync log, generic PMS adapter registry. Syncs external records where columns still exist; patient/animal tables removed from active UI.

### 8. Admin & compliance

User approval states, role from DB (not JWT), immutable audit log for critical actions, operational metrics dashboards.

---

## Critical paths

Paths where failure directly impacts patient safety, shift operations, or revenue trust:

| Path | Why critical | Failure mode if broken |
|------|--------------|------------------------|
| **Auth + tenancy** (`resolveAuthUser`, `clinicId` on every query) | Security boundary | Cross-clinic data leak |
| **Equipment checkout/return** | Core daily workflow | Wrong asset custody; waitlist stuck |
| **Code Blue mutations** | Emergency coordination | Silent offline queue (explicitly forbidden) |
| **SSE realtime + outbox** | Ward board, multi-tab consistency | Stale board; split-brain UX |
| **PWA offline sync** (non-emergency) | Floor connectivity gaps | Lost mutations; staff rework |
| **Push notifications** (waitlist, stale checkout, charge alert) | Time-sensitive ops | Missed asset availability |
| **Migrations at boot** (`runMigrations`) | Schema correctness | Server refuses schedulers; partial deploy |
| **Clerk auth (production)** | Identity | No sign-in; no production use |
| **Redis + BullMQ (production)** | Background jobs | Alerts, integrations, push fan-out stall |

**Can fail safely (degraded but not dangerous):**

| Path | Safe degradation |
|------|------------------|
| Analytics / management dashboards | Read-only insights missing; ops continue |
| Asset Copilot explain | Assistant unavailable; equipment ops unaffected |
| Integration sync (non-blocking) | Manual ops; audit log shows sync failures |
| Nightly E2E / simulation workflows | CI signal only; not runtime |
| Expo/RN horizon (`literate-dollop`) | Separate repo; Capacitor path unaffected |
| Authority evaluators in `shadow` | Would-have-blocked audited; mutation proceeds |

---

## Revenue drivers

VetTrack is pre-scale from a public revenue disclosure standpoint (investor materials explicitly avoid fabricated percentages). **Inferred commercial model** from product architecture and positioning:

| Driver | Mechanism |
|--------|-----------|
| **Multi-clinic SaaS** | Per-clinic tenancy; hospital/group deployments on Railway |
| **Operational layer upsell** | Sold **alongside** incumbent PIMS — reduces equipment loss, wait time, and emergency coordination friction |
| **Native mobile (Capacitor)** | Bedside QR/NFC workflows; App Store distribution path in maintenance |
| **Enterprise integrations** | Adapter registry + encrypted credentials — stickiness once wired to PIMS/LIMS |
| **Audit & traceability** | Immutable audit for compliance-sensitive hospitals (specialty/ICU positioning) |

**Value metrics hospitals care about (product-outcome proxies):**

- Time to locate and check out critical equipment
- Waitlist time-to-promotion accuracy
- Code Blue session reconciliation latency
- Stale checkout / charge-alert response rates
- Integration sync success rate per clinic

---

## Operational risks

| Risk | Severity | Notes |
|------|----------|-------|
| **Cross-clinic data leak** | Critical | Any query missing `eq(table.clinicId, clinicId)` |
| **Offline Code Blue queueing** | Critical | Frozen invariant — must fail loud |
| **Emergency endpoint SW caching** | Critical | Code Blue/snapshot/realtime must bypass cache |
| **CI/CD suspended** | High | `MAINTENANCE_MODE.md` — local verification is merge contract; regressions may reach `main` |
| **Split contracts repo** | High | `@vettrack/contracts` from `literate-dollop`; parity drift breaks mobile/offline contracts |
| **Scope confusion (removed ER/patients)** | High | Reintroducing removed domains without decision wastes velocity |
| **Redis absent in prod** | High | Workers disabled; alerts and integrations stall |
| **Hebrew-only hardcoded server copy** | Medium | e.g. stale checkout push — backlog item 3 |
| **Capacitor legal pages gap** | Medium | `docs/mobile/README.md` flags privacy/terms before store URLs |
| **Frozen surface refactors** | Medium | SSE/PWA/authority changes carry Phase 9 regression cost |
| **Dual CI (GitHub + GitLab)** | Low–Medium | Workflow drift when only one remote is active |

---

## Strategic differentiators

1. **Equipment operational state model** — multi-axis state (custody, readiness, staging, condition) vs simple in/out lists
2. **Offline-first PWA** with explicit emergency carve-out — staff workflows survive connectivity; Code Blue does not silently queue
3. **Outbox-backed SSE realtime** — monotonic cursor, replay, ward board without WebSocket complexity
4. **Integration adapter architecture** — orchestration above PIMS without requiring rip-and-replace
5. **Clinical authority evaluators** — gradual enforcement (`shadow` → `enforce`) per clinic
6. **Bilingual ICU UX** — Hebrew-default, RTL-capable, bedside scan workflows
7. **Audit-heavy mutations** — closed `AuditActionType` union; operational traceability as product feature

---

## Roadmap priorities

Derived from maintenance mode, scope change, backlog plans, and mobile ship docs — **product-outcome ordered**:

### P0 — Ship confidence & safety

- Preserve frozen realtime / Code Blue / PWA invariants on every change
- Local + architecture gate contract (`contracts-gate.sh`, `tsc`, `pnpm test`) until CI remotes resume
- Capacitor resubmission path (`RESUBMISSION_RUNBOOK.md`, legal pages gap)
- Tenancy and auth correctness on all new queries

### P1 — Floor velocity & reliability

- Stale-checkout sweep: locale-aware push + regression tests (backlog item 3)
- Waitlist promotion and reservation TTL reliability
- Push notification delivery metrics and bounded retries
- Integration sync observability per clinic

### P2 — Maintainability & onboarding

- Dead code / knip hygiene (backlog item 9 — run before larger refactors)
- Governance docs under `docs/governance/` (this initiative)
- Code tours for new maintainers (`.tours/` after Phase 1)
- Shared locale helpers (`resolve-user-locale`) consolidation

### P3 — Horizon (explicitly not current blocker)

- Expo/RN in `exposwifty31/literate-dollop` — contracts authoring lives there
- Re-expansion into patient/ER domains — **requires explicit product decision** (removed June 2026)
- Pharmacy forecast / medication tasks — removed; do not resurrect without decision

### Mobile dual-track — Expo evolution (cross-repo)

VetTrack ships mobile on **two intentional tracks**. This monolith owns **Horizon 0 (Capacitor)**; Expo/RN evolution is **canonical in [`literate-dollop`](https://github.com/exposwifty31/literate-dollop)**. Full parity audit: [`LITERATE_DOLLOP_PARITY_REPORT.md`](./LITERATE_DOLLOP_PARITY_REPORT.md).

| Track | Where | Product role | Gate |
|-------|-------|--------------|------|
| **H0 — Capacitor** | `vettrack` | Store ship path today (bundled PWA) | `RESUBMISSION_RUNBOOK.md`, legal pages |
| **H1–H3 — Expo foundation + bedside** | `literate-dollop` | Greenfield RN; NFC scan slice in progress | Phase 1 exit ✅; Phase 3 vertical slice |
| **H4–H5 — Parity + native push** | literate-dollop + API here | RN matches web workflows | `rn-parity-matrix` (to author), `POST /api/push-subscriptions/native` |
| **H6–H7 — Cutover** | both | Mobile web banner → Capacitor retirement | Written kill-switch; 2 RN release cycles |

**Sequencing:** Capacitor checklist and P0 ship confidence **before** scaling Horizon 2+ work. literate-dollop may absorb **0–2 h/week** on H1 scaffold only while Capacitor moves.

**Monolith obligations for Expo (not implementation here):**

- Keep `@vettrack/contracts` in sync via `contracts-gate.sh` on every emergency/offline surface change
- Stable `/api/users/me`, Clerk production config, tenancy on any new native push route (H4)
- Do **not** delete Capacitor until Horizon 7 go/no-go

**Canonical runbooks:** [`docs/mobile/native-mobile-implementation-manual.md`](../mobile/native-mobile-implementation-manual.md), literate-dollop [`docs/plans/mobile-strategy-master.md`](https://github.com/exposwifty31/literate-dollop/blob/main/docs/plans/mobile-strategy-master.md).

---

## Discovery answers

### What creates value?

- **Staff find and use the right equipment faster** during high-pressure shifts
- **Ward visibility** reduces phone/tag chaos on the floor
- **Code Blue coordination** with server-confirmed state and wall display
- **Traceability** (audit, scan logs, integration sync history) for accountability
- **Operating above existing PIMS** without forcing system-of-record migration

### What is mission critical?

- Multi-tenant auth and `clinicId` enforcement
- Equipment checkout/return/waitlist integrity
- Code Blue online-only execution path
- SSE realtime + outbox ordering for board and emergency state
- Production: PostgreSQL, Redis, Clerk, migrations at boot

### What can fail safely?

- Analytics, Copilot explain, non-blocking integration sync delays
- CI nightly simulations (when merge gates suspended)
- Horizon mobile (Expo) work in separate repo
- Shadow-mode authority evaluators (audited, non-blocking)

### What slows delivery today?

| Friction | Product impact |
|----------|----------------|
| **Suspended remote CI** | Slower feedback; relies on local discipline |
| **Frozen architecture surfaces** | High regression cost for realtime/PWA/Code Blue touches |
| **Dual remote/CI definitions** (GitHub + GitLab) | Drift risk; unclear single gate |
| **Contracts split across repos** | Mobile/offline changes need cross-repo coordination |
| **Scope change residue** | Legacy redirects, stub workers, naming traps (`appointments` vs Tasks) confuse agents and engineers |
| **Large monolith** (~44 route modules, broad domains) | Long onboarding; ownership ambiguity |
| **Maintenance mode split** | Capacitor here, Expo there — two mobile narratives |
| **Cross-repo mobile docs** | literate-dollop says vettrack is GitLab-only; vettrack remotes disagree — see parity report |

---

## Next phase

Governance Phases 0–6 complete. **Phase 7** — controlled execution per [`PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md`](./PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md). Cross-repo mobile: [`LITERATE_DOLLOP_PARITY_REPORT.md`](./LITERATE_DOLLOP_PARITY_REPORT.md).
