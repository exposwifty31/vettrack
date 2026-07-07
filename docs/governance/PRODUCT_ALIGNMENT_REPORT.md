# VetTrack — Product Alignment Report

**Phase:** 2 — Product Alignment Audit  
**Generated:** 2026-06-18  
**Governor:** Product Engineering Governor  
**Prerequisites:** [`PRODUCT_MODEL.md`](./PRODUCT_MODEL.md), [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md)

---

## Classification legend

| Class | Meaning |
|-------|---------|
| **CRITICAL** | Core product value; daily floor use or safety boundary; removing breaks the pitch |
| **IMPORTANT** | Strong product value for target hospitals; expected in sales/demo; moderate removal cost |
| **OPTIONAL** | Valuable for some clinics; product works without it; low urgency to extend |
| **LEGACY** | Still mounted but misaligned with post-2026 scope; redirects, stubs, or naming traps — maintain minimally |
| **REMOVE** | Candidate for deletion after explicit approval; no product value or actively misleading |

**Scoring dimensions (qualitative):**

- **Product value** — contribution to equipment-first ICU ops narrative  
- **Usage likelihood** — expected frequency for primary personas (floor tech, shift lead, admin)  
- **Maintenance cost** — ongoing engineering burden (coupling, frozen surfaces, tests, docs drift)  
- **Engineering complexity** — lines of code, workers, cross-cutting concerns  
- **Strategic relevance** — fit with orchestration-layer positioning vs removed ER/PIMS-replacement scope  

---

## Executive summary

| Class | Count | Share of audited surfaces |
|-------|-------|---------------------------|
| CRITICAL | 14 | ~28% |
| IMPORTANT | 18 | ~36% |
| OPTIONAL | 10 | ~20% |
| LEGACY | 8 | ~16% |
| REMOVE | 5 | ~10% |

**Alignment verdict:** The **live product is well-aligned** with the post-June 2026 equipment-first scope. Misalignment concentrates in **LEGACY/REMOVE residue** (stub workers, ER-era types/docs, redirect-only routes, disabled enforcement paths) rather than active CRITICAL surfaces.

**Highest-risk misalignment:** Maintaining **REMOVE/LEGACY** code without product decision creates agent/engineer confusion and inflates maintenance cost without shipping velocity.

---

## Platform foundation

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Multi-tenant auth (`clinicId`, Clerk, dev-bypass) | **CRITICAL** | High | Daily | Medium | High | High | Security boundary; no product without it |
| Role resolution from DB (`vt_users.role`) | **CRITICAL** | High | Every request | Low | Medium | High | Authorization source of truth |
| i18n (he/en, locale JSON) | **CRITICAL** | High | Daily (IL market) | Medium | Medium | High | Hebrew-default ICU UX is differentiator |
| Migrations at boot | **CRITICAL** | High | Every deploy | Low | Medium | High | Schema correctness gates schedulers |
| Health / readiness probes | **CRITICAL** | Medium | Ops | Low | Low | High | Railway deploy safety |
| Audit log (`logAudit`, closed union) | **CRITICAL** | High | Continuous | High | High | High | Traceability is sales narrative + compliance |
| Rate limiting + XSS sanitization | **CRITICAL** | Medium | Continuous | Low | Low | High | Production safety baseline |
| PWA shell + service worker | **CRITICAL** | High | Daily | High | High | High | Offline-first positioning; frozen Phase 9 |
| `@vettrack/contracts` parity gate | **IMPORTANT** | Medium | Release | Medium | Medium | High | Cross-repo mobile contract; not floor-facing |

---

## Equipment operations (primary domain)

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Equipment list / detail / CRUD | **CRITICAL** | Very high | Daily | Very high | Very high (`equipment.ts` ~5.6k LOC) | Very high | Core value loop entry |
| Checkout / return / custody | **CRITICAL** | Very high | Daily | High | High | Very high | Defines operational state |
| Operational state (multi-axis) | **CRITICAL** | Very high | Daily | High | High | Very high | Differentiator vs simple asset lists |
| Waitlist + reservation TTL | **CRITICAL** | High | Frequent | Medium | Medium | Very high | Demand > supply is ICU reality |
| Staging queue + expiry worker | **IMPORTANT** | High | Frequent | Medium | Medium | High | Pre-use holding; clinical priority |
| Docks + dock-return | **IMPORTANT** | High | Frequent | Medium | Medium | High | FAST/charging workflows |
| Rooms / room radar | **IMPORTANT** | High | Frequent | Medium | Medium | High | Locate assets by location |
| QR print / equipment QR | **IMPORTANT** | Medium | Periodic | Low | Low | High | Onboarding hospitals to scan flows |
| NFC / RFID ingest | **IMPORTANT** | Medium | Clinic-dependent | Medium | Medium | High | Bedside native differentiation |
| Scan logs + activity feed | **IMPORTANT** | Medium | Frequent | Low | Medium | High | Audit trail for equipment movement |
| Alert acks + charge-alert worker | **IMPORTANT** | High | Frequent | Medium | Medium | High | Unplugged equipment escalation |
| Stale checkout sweep + push | **IMPORTANT** | High | Daily | Medium | Medium | High | Backlog item 3 — locale gap hurts EN users |
| Equipment folders | **OPTIONAL** | Low | Rare | Low | Low | Medium | Organizational convenience |
| Asset Copilot explain | **OPTIONAL** | Medium | Occasional | Medium | Medium | Medium | Explain-only assistant; safe to degrade |
| Operational metrics API | **OPTIONAL** | Medium | Admin | Low | Low | Medium | `/admin/metrics` — not floor-critical |
| Equipment condition staleness worker | **IMPORTANT** | Medium | Background | Low | Low | High | Supports readiness truth |
| Procedure-bound release worker | **LEGACY** | None | None | Low | Low | None | No-op after hospitalization removal; ticks every 30 min |
| `equipment.ts` monolith | — | — | — | **Very high** | **Very high** | — | Not a feature — **structural debt** affecting all CRITICAL equipment work |

---

## Emergency & ward visibility

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Code Blue sessions / logs / presence | **CRITICAL** | Very high | Emergency | Very high | High | Very high | Safety surface; frozen online-only |
| Code Blue wall display | **CRITICAL** | High | Emergency | High | Medium | Very high | Ward coordination during codes |
| Code Blue reconciliation scanner | **CRITICAL** | Medium | Background | Low | Low | High | Unreconciled session ops alert |
| Crash cart checks | **IMPORTANT** | High | Periodic | Low | Low | High | Kit verification workflow |
| Ward board (`/equipment/board`) | **CRITICAL** | Very high | Continuous (kiosk) | High | High | Very high | Hero investor slide; SSE-driven |
| Display snapshot API | **CRITICAL** | Very high | Continuous | Medium | Medium | Very high | SW cache bypass invariant |
| Code Blue history (admin) | **IMPORTANT** | Medium | Occasional | Low | Low | Medium | Post-incident review |
| Legacy emergency URL aliases | **LEGACY** | Low | Rare | Low | Low | Low | `/emergency-equipment-*` — keep redirects, no new work |

---

## Tasks (unified staff work model)

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Tasks UI (`/equipment/tasks`) | **CRITICAL** | High | Daily | Medium | Medium | High | Unified work queue for floor staff |
| `vt_appointments` CRUD (`/api/appointments`) | **CRITICAL** | High | Daily | Medium | High | High | Backend for Tasks; frozen internal name |
| Task start/complete (`/api/tasks`) | **CRITICAL** | High | Daily | Medium | Medium | High | Execution path separate from CRUD |
| Task dashboard / recall | **IMPORTANT** | Medium | Shift lead | Medium | Medium | Medium | Operational oversight |
| Task recommendations (intelligence) | **OPTIONAL** | Low | Occasional | Medium | Medium | Low | Nice-to-have; not demo-critical |
| Task automation (notification worker) | **OPTIONAL** | Low | Background | Medium | Medium | Low | Runs via CLI worker; niche rules |
| Task ownership admin queue + backfill | **OPTIONAL** | Low | Admin | Medium | Medium | Medium | Enforcement rollout tooling |
| `vt_tasks` operational log table | **LEGACY** | Low | Internal | Low | Low | Low | Insert-only audit trail; name collides with product "Tasks" |
| `animalId`/`ownerId` on appointment create schema | **LEGACY** | None | None | Low | Low | None | Patients removed; fields linger in Zod |

---

## Shifts, authority & collaboration

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Home dashboard (`/home`) | **IMPORTANT** | High | Daily | Low | Low | High | Shift entry point |
| Shift import / sessions | **IMPORTANT** | Medium | Admin | Medium | Medium | High | Authority + scheduling foundation |
| Clinical check-in / check-out | **IMPORTANT** | High | Per shift | High | High | High | Modern authority path vs Strategy A |
| Authority evaluators (6 families) | **IMPORTANT** | High | Continuous | Very high | Very high | High | Gradual enforcement; frozen envelope |
| Strategy A shift-derived authority | **IMPORTANT** | High | Clinics w/o check-in | Medium | Medium | High | Explicit safety net — not retired |
| Shift chat (FAB + archive) | **OPTIONAL** | Medium | Clinic-dependent | Medium | Medium | Medium | Collaboration; not all hospitals use |
| Shift leaderboard analytics | **OPTIONAL** | Low | Occasional | Low | Low | Low | Gamification / ops insight |
| `/handoff` (ShiftSummarySheet) | **IMPORTANT** | Medium | End of shift | Low | Low | Medium | Active feature but **misnamed** vs removed ER handover — LEGACY naming |
| `er-mode-permissions.ts` | **LEGACY** | None | Rare | Low | Low | None | ER mode removed; still imported by `users.ts` |

---

## Inventory & procurement

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Containers + dispense | **IMPORTANT** | High | Frequent | High | High | High | Cabinet workflows at point of use |
| Emergency dispense + unresolved scan | **IMPORTANT** | High | Emergency | Medium | Medium | High | Clinical safety adjacent |
| Restock sessions | **IMPORTANT** | Medium | Periodic | Medium | Medium | Medium | Cabinet replenishment |
| Inventory items catalog | **IMPORTANT** | Medium | Admin | Medium | Medium | Medium | SKU management |
| Procurement / PO | **OPTIONAL** | Medium | Admin | Medium | Medium | Medium | Back-office; not floor-differentiating |
| Shadow inventory scheduler | **OPTIONAL** | Low | Background | Low | Low | Low | Reconciliation niche |
| Orphan dispense vs appointments validation | **LEGACY** | None | None | Low | Low | None | Returns empty blocks post-143 |
| Inventory-deduction worker + queue | **REMOVE** | None | None | Medium | Medium | None | No-op stub; registry parity only — candidate after job-runtime cleanup |

---

## Integrations & external systems

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Adapter registry + credential encryption | **IMPORTANT** | High | Per enterprise deal | High | High | Very high | Core "orchestration layer" pitch |
| Integration sync worker + cron | **IMPORTANT** | High | Background | High | High | Very high | Stickiness once wired |
| Inbound webhooks + HMAC | **IMPORTANT** | Medium | Clinic-dependent | Medium | Medium | High | Real-time PMS events |
| generic-pms / priza / vendor-x adapters | **IMPORTANT** | High | Sales-dependent | High | High | Very high | Revenue expansion path |
| Integration ops routes (retry, replay) | **OPTIONAL** | Low | Ops | Medium | Medium | Medium | Support tooling |
| Stale integrations guide (patient sync docs) | **LEGACY** | None | — | Low | — | None | Docs reference removed tables |

---

## Realtime, offline & notifications

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| SSE stream + outbox publisher | **CRITICAL** | Very high | Continuous | Very high | Very high | Very high | Frozen transport; ward + multi-tab |
| Realtime replay + telemetry | **CRITICAL** | High | Reconnect | High | High | High | Phase 9 recovery contract |
| Dexie offline cache + sync engine | **CRITICAL** | High | Daily | High | High | Very high | Floor connectivity gaps |
| Offline emergency block (Code Blue) | **CRITICAL** | Very high | Emergency | Medium | Medium | Very high | Safety invariant |
| Web push subscriptions | **IMPORTANT** | High | Time-sensitive | Medium | Medium | High | Waitlist, stale checkout, alerts |
| `notification.worker` (CLI process) | **IMPORTANT** | High | Background | High | Medium | High | **Deployment ambiguity** — may not run on Railway worker service |
| Role notification scheduler | **OPTIONAL** | Low | Background | Low | Low | Low | Smart role nudges |
| WhatsApp alert ingress | **OPTIONAL** | Medium | Clinic-dependent | Low | Low | Medium | Israel market channel |

---

## Admin, analytics & internal tooling

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Admin hub (`/admin`) | **IMPORTANT** | High | Admin | Medium | Medium | High | Clinic configuration |
| User management + Clerk sync | **CRITICAL** | High | Admin | Medium | Medium | High | Tenancy + onboarding |
| Admin asset types / docks | **IMPORTANT** | High | Setup | Low | Low | High | Equipment ontology |
| Audit log UI | **IMPORTANT** | Medium | Compliance | Low | Low | High | Sales / trust |
| Analytics dashboard | **OPTIONAL** | Medium | Management | Medium | Medium | Medium | Insight; degrades safely |
| Outcome KPI ROI (`outcome-kpi-roi`) | **LEGACY** | Low | Rare | Medium | Medium | Low | ER triage metrics orphaned; route redirects to `/analytics` |
| Management dashboard | **OPTIONAL** | Medium | Management | Medium | Medium | Medium | Executive view |
| Operational metrics dashboard | **OPTIONAL** | Medium | Admin | Low | Low | Medium | Internal ops |
| Outbox health / DLQ admin | **OPTIONAL** | Low | Ops | Low | Low | Medium | Platform reliability tooling |
| Cursor bug-fixer dispatch | **OPTIONAL** | None (internal) | Rare | Low | Low | None | Engineering meta-tool in admin UI |
| Stability runner (`/api/stability`) | **REMOVE** | None | Dev only | Low | Low | None | Dev/stability harness; redirect `/stability` → `/home` |
| Test API routes (`/api/test/*`) | **OPTIONAL** | None | Dev/CI | Low | Low | None | Keep for CI; not product |

---

## Mobile & distribution

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Capacitor iOS/Android (bundled) | **IMPORTANT** | High | Bedside | High | High | High | Maintenance ship path; App Store |
| Capacitor Clerk native auth | **IMPORTANT** | High | Native users | Medium | Medium | High | Production native sign-in |
| Marketing landing + legal pages | **IMPORTANT** | Medium | Acquisition | Low | Low | High | **Legal pages gap** blocks store URLs |
| Expo/RN (`literate-dollop`) | **OPTIONAL** | Horizon | — | External | External | Medium | Out of repo; contracts only consumed here |

---

## Infrastructure workers & jobs

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| Event outbox publisher | **CRITICAL** | Very high | Continuous | Medium | Medium | Very high | Realtime backbone |
| Charge-alert job (BullMQ) | **IMPORTANT** | High | Event-driven | Low | Low | High | Equipment plugged-in safety |
| Expiry-check cron | **IMPORTANT** | Medium | Daily | Low | Low | Medium | Inventory expiry |
| Stale check-in sweep | **IMPORTANT** | Medium | Daily | Low | Low | Medium | Clinical check-in TTL |
| Integration worker | **IMPORTANT** | High | Background | Medium | Medium | High | PMS sync |
| Equipment waitlist reservation worker | **IMPORTANT** | High | Continuous | Low | Low | High | TTL enforcement |
| Staging expiry worker | **IMPORTANT** | Medium | Continuous | Low | Low | High | Staging queue hygiene |
| Stale task ownership sweep | **OPTIONAL** | Low | Background | Medium | Medium | Medium | Enforcement rollout |
| Task ownership backfill worker | **OPTIONAL** | Low | One-shot | Low | Low | Low | Migration tooling |
| Procedure-bound release worker | **REMOVE** | None | None | Low | Low | None | No-op; unregister from schedulers |
| Inventory-deduction worker | **REMOVE** | None | None | Medium | Medium | None | No-op; registry dead weight |

---

## Removed product surfaces (redirect-only)

| Feature | Class | Product value | Usage | Maint. cost | Complexity | Strategic | Justification |
|---------|-------|---------------|-------|-------------|------------|-----------|---------------|
| ER mode / ER board | **REMOVE** | None | None | Low (redirects) | — | None | Schema dropped 142; `/er` → `/equipment` |
| Patients / hospitalizations UI | **REMOVE** | None | None | Low | — | None | Explicit scope cut |
| Medication tasks / formulary | **REMOVE** | None | None | Low | — | None | Schema dropped 143 |
| Pharmacy forecast | **REMOVE** | None | None | Low | — | None | Removed |
| Billing UI | **REMOVE** | None | None | Low | — | None | Redirect to equipment |
| Pilot mode gating | **REMOVE** | None | None | Low | — | None | Deleted; build-info imports linger as **LEGACY** |

**Recommendation:** Keep SPA redirects indefinitely (cheap, prevents broken bookmarks). Do **not** rebuild these domains without explicit product decision.

---

## Misalignment matrix (actionable)

| Issue | Current class | Product impact if ignored | Suggested disposition |
|-------|---------------|---------------------------|------------------------|
| `equipment.ts` monolith | Structural | Slows every equipment feature | IMPORTANT — split when touching, not cosmetic refactor |
| Stub workers ticking | REMOVE | Wastes CPU; confuses agents | REMOVE after approval — unregister no-ops |
| `appointments` vs Tasks naming | LEGACY | Onboarding friction | LEGACY — document; rename internal only with Phase 6 §17 exception |
| `vt_tasks` table name | LEGACY | Confusion with `vt_appointments` | LEGACY — rename in future migration if worth cost |
| Notification worker split deploy | IMPORTANT | Push may silently fail | IMPORTANT — verify Railway runs `pnpm worker` or merge process |
| Stale checkout Hebrew-only push | IMPORTANT | EN holders get wrong copy | IMPORTANT — backlog item 3 (P1) |
| Outcome KPI ER fields | LEGACY | Misleading analytics | LEGACY — trim metrics or label deprecated |
| Design handoff / integrations docs | LEGACY | Wrong agent context | LEGACY — doc update only (high ROI) |
| Dual CI (GitHub + GitLab) | OPTIONAL | Drift | OPTIONAL — pick single gate when remotes resume |

---

## Feature investment guidance

### Protect (do not weaken)

All **CRITICAL** surfaces, especially: tenancy, equipment custody, Code Blue online path, SSE/outbox, offline sync (non-emergency), ward board SW bypass.

### Invest next (product ROI)

1. Stale-checkout locale + tests (IMPORTANT → CRITICAL adjacency for i18n market)  
2. Notification worker deployment clarity (IMPORTANT reliability)  
3. Waitlist / push delivery observability (CRITICAL adjacency)  
4. Capacitor legal pages + resubmission (IMPORTANT ship path)  
5. Integration sync health per clinic (IMPORTANT enterprise)  

### Triage down (minimal touch)

OPTIONAL: task recommendations, shift leaderboard, cursor-bug-fixer, stability API, shadow inventory, procurement depth.

### Plan removal (approval required)

REMOVE: `procedureBoundReleaseWorker`, `inventory-deduction` stub chain, `/api/stability` product exposure, orphaned ER permission paths after caller audit.

### Do not resurrect without product decision

REMOVE domains: ER patients, medication formulary, pharmacy forecast, billing UI, pilot gating.

---

## Classification rollup by domain

| Domain | CRITICAL | IMPORTANT | OPTIONAL | LEGACY | REMOVE |
|--------|----------|-----------|----------|--------|--------|
| Platform foundation | 8 | 1 | 0 | 0 | 0 |
| Equipment ops | 5 | 9 | 3 | 1 | 0 |
| Emergency / ward | 5 | 2 | 0 | 1 | 0 |
| Tasks | 3 | 2 | 3 | 2 | 0 |
| Shifts / authority | 0 | 4 | 2 | 2 | 0 |
| Inventory | 0 | 5 | 2 | 1 | 1 |
| Integrations | 0 | 5 | 1 | 1 | 0 |
| Realtime / offline | 5 | 2 | 2 | 0 | 0 |
| Admin / analytics | 1 | 4 | 6 | 1 | 1 |
| Mobile | 0 | 3 | 1 | 0 | 0 |
| Workers | 1 | 7 | 2 | 0 | 2 |
| Removed surfaces | 0 | 0 | 0 | 0 | 6 |

---

## Next phase

**Phase 3 — GitHub governance** → [`docs/devops/github-setup.md`](../devops/github-setup.md) (branches, PRs, required checks).
