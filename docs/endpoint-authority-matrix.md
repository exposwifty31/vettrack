# VetTrack Endpoint Authority Matrix

**Status:** Phase 0 alignment document.
**Source:** read from `server/routes/*.ts` and `server/app/routes.ts` on the current branch; target gates from `docs/authority-model.md`; ER allowlist disposition from `docs/operational-modes.md` §1.4.
**Audience:** Engineers planning Phase 2A–2C migrations and Phase 4 ER/Code Blue hardening.

This document lists **every handler** registered in `server/routes/*.ts`. The "Current gate" column reflects code as it stands; the "Target gate" column reflects the model in `docs/authority-model.md`.

## Conventions

| Column | Meaning |
|---|---|
| Current gate | Middleware applied. `auth` = `requireAuth`. `auth+role(min)` = `requireAuth + requireEffectiveRole(min)`. `admin` = `requireAuth + requireAdmin`. `none` = no auth middleware. Validation/idempotency middleware omitted unless relevant to authority. |
| Target gate | Phase 2A → 2C target per authority model. `clin(role+)` = active-shift clinical role at minimum (see "Active-shift semantics" below). `sys-admin` = `systemRole = Admin`. `clin(role+) ∨ sys-admin` = either. `auth-only` = no clinical role required. |
| Audit (route) | Does the route file call `logAudit`? |
| Audit (service) | Does an obvious downstream service call `logAudit`? Best-effort grep. |
| ER allowlist | Disposition when ER Mode is `enforced`: `IN` (already allowlisted in `shared/er-mode-access.ts`), `IN-target` (Plan v2 says should be allowlisted; not yet), `OUT` (intentionally blocked when enforced), `OUT-admin-carveout` (admin-page; reachable for `systemRole = Admin`), `PDN-8` (decision needed). |
| Notes | Plan v2 PR references; PDN tags; known issues. |

Mount prefixes are in `server/app/routes.ts`. Paths below are relative to those prefixes.

### Active-shift semantics applied to every `clin(role+)` row

Wherever the **Target gate** column says `clin(role+) on active shift`, the **source of authority differs by clinicalRole**:

- **Technicians / Senior Technicians** — derived from the **imported EZShift schedule** per `authority-model.md §3`. A user is active when their EZShift-derived `vt_shifts` row covers `NOW()` AND its labels map to the required `shiftRole` per `authority-model.md §3.5`.
- **Vets** — derived from **manual check-in** per `authority-model.md §4`. A user is active when they have an open Vet check-in session with a specific `operationalRole` (Senior Vet / ER/ICU Vet / Hospitalization Vet / Receiving Vet / On-call Vet). Vets are **NOT** in EZShift.
- **Students** — derived from manual VetTrack configuration. Students are not in EZShift and do not check in like Vets. See **PDN-A7**.

Both are **scheduled / explicit-check-in** authority, not **attendance-confirmed** authority. Backend re-resolves on every request; FE state is advisory.

In target-gate notation:

- `clin(tech+)` / `clin(senior_tech+)` — EZShift-derived (`authority-model.md §3`).
- `clin(vet)` — any active Vet check-in (operational role unspecified).
- `clin(senior_vet)` / `clin(er_icu_vet)` / `clin(hospitalization_vet)` / `clin(receiving_vet)` / `clin(on_call_vet)` — specific operational role on active check-in (`authority-model.md §4`).
- `clin(any_vet_op_role except on_call)` — any active Vet check-in **except** on-call (since on-call alone does not confer full authority).
- `sys-admin` — `systemRole = Admin`, orthogonal to clinical authority.

Endpoint-level open questions tied to active-shift (cross-reference for individual rows):

- **PDN-A1** EZShift identity-matching. Affects every Tech/Senior-Tech `clin(...)` row.
- **PDN-A2** Unrecognised EZShift labels default to `shiftRole = null`.
- **PDN-A4** Grace period at shift boundaries.
- **PDN-A7** Students manual-assignment semantics.
- **PDN-V1** Vet check-in subsystem must exist before any `clin(senior_vet)` / operational-role-specific row can be enforced. Until Phase 2.5 lands, all rows referencing operational Vet roles use the coarser `clin(vet)` as a placeholder; the column **Target gate** explicitly says `(after Phase 2.5)` for operational-role-specific values.
- **PDN-V5** On-call Vet authority transition. Affects whether `clin(on_call_vet)` can ever match a `clin(any_vet_op_role except on_call)` row through assignment.
- **PDN-V10**, **PDN-V11**, **PDN-V12** — Vet operational-role corner cases; see `authority-model.md §8.3`.

---

## /api/activity — server/routes/activity.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | activity.ts:46 | auth | clin(tech+) for read across clinic; auth-only for own | n/a (read) | n/a | PDN-8 | Activity feed used on Home + Patient detail. |
| GET | `/my-scan-count` | activity.ts:159 | auth | auth-only (self) | n/a (read) | n/a | PDN-8 | Per-user metric. |

---

## /api/admin (admin-medication-integrity, admin-outbox-health, admin-outbox-dlq) — server/routes/

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/medication-integrity` | admin-medication-integrity.ts:33 | admin | sys-admin | no | no | OUT-admin-carveout | Limited flag detection per audit findings. |
| POST | `/outbox/dlq/retry` | admin-outbox-dlq.ts:56 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/outbox/dlq/drop` | admin-outbox-dlq.ts:145 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| GET | `/outbox-health` | admin-outbox-health.ts:26 | admin | sys-admin | no | n/a | OUT-admin-carveout | Ops dashboard. |

---

## /api/alert-acks — server/routes/alert-acks.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | alert-acks.ts:55 | auth | clin(tech+) | n/a | n/a | PDN-8 (equipment workflow) | |
| POST | `/` | alert-acks.ts:86 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| PATCH | `/:id/resolve` | alert-acks.ts:195 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |

---

## /api/analytics — server/routes/analytics.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | analytics.ts:49 | admin | sys-admin | no | n/a | OUT-admin-carveout | |
| GET | `/billing` | analytics.ts:174 | admin | sys-admin | no | n/a | OUT-admin-carveout | |
| GET | `/outcome-kpi-roi` | analytics.ts:363 | admin | sys-admin | no | n/a | OUT-admin-carveout | Outcome KPI dashboard. |
| GET | `/shift-completion` | analytics.ts:387 | admin | sys-admin | no | n/a | OUT-admin-carveout | Shift leaderboard. |

---

## /api/animals — server/routes/animals.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/active` | animals.ts:36 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | Used by pending-emergencies reconciliation. |

---

## /api/appointments — server/routes/appointments.ts

(see Plan v2 §3.A on the matrix; routes are tasks under the product model)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/` | appointments.ts:220 | auth+role(technician) + idempotency | per task-creation matrix (Phase 3A) | no | yes (appointments.service.ts) | PDN-8 (Medication Hub group) | Creation matrix enforced server-side in Phase 3A. |
| GET | `/` | appointments.ts:495 | auth+role(technician) | clin(tech+); Student → own only | n/a | n/a | PDN-8 | |
| GET | `/meta` | appointments.ts:540 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | Returns vets + technicians + shifts; replaced by eligible-assignees endpoint in Phase 3A. |
| PATCH | `/:id` | appointments.ts:647 | auth+role(technician) + idempotency | clin(tech+) with ownership; Vet/Senior-Tech override per task model | no | yes | PDN-8 | |
| DELETE | `/:id` | appointments.ts:733 | auth+role(technician) | clin(tech+) with ownership or Vet/Senior-Tech override | n/a | yes | PDN-8 | |

---

## /api/audit-logs — server/routes/audit-logs.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | audit-logs.ts:34 | admin | sys-admin | n/a (read) | n/a | OUT-admin-carveout | Needs indexes (Phase 5). |

---

## /api/billing — server/routes/billing.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | billing.ts:280 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | Plan v2 lists Billing in allowlist. |
| GET | `/summary` | billing.ts:315 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | |
| GET | `/leakage-report` | billing.ts:379 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | |
| POST | `/leakage-report/one-pager` | billing.ts:435 | auth+role(vet) | clin(vet+) | yes | n/a | IN-target | |
| GET | `/leakage-summary` | billing.ts:482 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | |
| GET | `/leakage-report.csv` | billing.ts:516 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | |
| GET | `/shift-total` | billing.ts:550 | auth | clin(tech+) (Home page widget) | n/a | n/a | IN-target | Home page calls this; consider lowering target if Home is allowed off-shift. |
| GET | `/export.csv` | billing.ts:594 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | |
| GET | `/:id` | billing.ts:629 | auth+role(vet) | clin(vet+) | n/a | n/a | IN-target | |
| POST | `/` | billing.ts:648 | auth+role(vet) + idempotency | clin(vet+) on active shift | yes | n/a | IN-target | Manual charge entry. |
| POST | `/:id/reverse` | billing.ts:737 | admin + idempotency | sys-admin | yes | n/a | IN-target | |
| PATCH | `/:id/void` | billing.ts:836 | admin + idempotency | sys-admin | yes | n/a | IN-target | |
| PATCH | `/bulk-sync` | billing.ts:898 | admin + idempotency | sys-admin | no | n/a | IN-target | |
| GET | `/inventory-jobs` | billing.ts:933 | admin | sys-admin (retry permissions PDN-4) | n/a | n/a | OUT-admin-carveout | |
| POST | `/inventory-jobs/:id/retry` | billing.ts:976 | admin + idempotency | PDN-4 (performing tech vs admin) | no | n/a | OUT-admin-carveout | |

---

## /api/code-blue — server/routes/code-blue.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/events` | code-blue.ts:81 | auth | auth-only (legacy fire-and-forget) | yes | n/a | IN-target | Legacy event endpoint, not used by new sessions flow. |
| PATCH | `/events/:id` | code-blue.ts:119 | auth | auth-only (legacy) | yes | n/a | IN-target | |
| GET | `/events` | code-blue.ts:164 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | History — admin only. |
| POST | `/sessions` | code-blue.ts:185 | auth | auth-only (trigger) | yes | n/a | IN-target | Code Blue trigger. Student trigger-only enforced via clinicalRole check inside handler (target). |
| GET | `/sessions/active` | code-blue.ts:280 | auth | auth-only | n/a | n/a | IN-target | Polled every 2s. |
| POST | `/sessions/:id/logs` | code-blue.ts:361 | auth | auth-only (PDN-CB1 for Student log entries) | yes | n/a | IN-target | Phase 1 PR 1.6 removes auto-checkout side-effect when category=equipment. |
| PATCH | `/sessions/:id/presence` | code-blue.ts:443 | auth | auth-only | no | n/a | IN-target | Heartbeat; no audit by design. |
| PATCH | `/sessions/:id/end` | code-blue.ts:492 | auth + manager-only inline check | Phase 1 PR 1.5: assigned `clinicalRole = vet` manager AND (15-min OR earlyStopReason). **Phase 4 PR 4.7 (after Phase 2.5):** assigned active-check-in Vet manager (any operational role per `authority-model.md §4.2`) AND (15-min OR earlyStopReason). Senior Vet is **not strictly required** for early closure. | yes | n/a | IN-target | Phase 1 PR 1.5: server-side 15-min gate + require `vet`-typed manager. Active-shift verification + operational-role enforcement are Phase 4 work and depend on Phase 2.5. |
| GET | `/history` | code-blue.ts:594 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | Endpoint exists (audit had reported 404 — incorrect). FE wiring to be verified. |
| GET | `/reconciliation` | code-blue.ts:620 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/sessions/:id/dispenses` | code-blue.ts:667 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| PATCH | `/sessions/:id/reconcile` | code-blue.ts:720 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/sessions/:id/manual-billing` | code-blue.ts:831 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |

---

## /api/containers — server/routes/containers.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/bootstrap-defaults` | containers.ts:75 | auth+role(technician) | clin(tech+) on active shift | n/a | n/a | IN | |
| GET | `/` | containers.ts:94 | auth+role(technician) | clin(tech+) | n/a | n/a | IN | |
| POST | `/` | containers.ts:169 | auth+role(admin) | sys-admin (PDN-7 future Senior Tech) | yes | n/a | IN | Create container. |
| POST | `/:id/restock` | containers.ts:207 | auth+role(technician) | clin(tech+ or senior-tech+) on active shift | n/a | n/a | IN | |
| POST | `/:id/blind-audit` | containers.ts:226 | auth+role(technician) | clin(tech+ or senior-tech+) on active shift | n/a | n/a | IN | |
| POST | `/:id/dispense` | containers.ts:277 | auth+role(technician) + dispenseIdempotency | clin(tech+) on active shift | yes | n/a | IN | |
| PATCH | `/emergency/:eventId/complete` | containers.ts:630 | auth+role(technician) | clin(tech+) on active shift | n/a | n/a | IN | Emergency dispense completion. |

---

## /api/crash-cart — server/routes/crash-cart.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/items` | crash-cart.ts:64 | auth | clin(tech+) (current is auth-only) | n/a | n/a | PDN-8 | Listed under Code Blue scope; allowlist disposition needs confirmation. |
| POST | `/items` | crash-cart.ts:105 | admin | sys-admin | no | n/a | PDN-8 | |
| PATCH | `/items/:id` | crash-cart.ts:144 | admin | sys-admin | no | n/a | PDN-8 | |
| DELETE | `/items/:id` | crash-cart.ts:173 | admin | sys-admin | no | n/a | PDN-8 | |
| POST | `/checks` | crash-cart.ts:196 | auth | clin(tech+ or senior-tech+) on active shift | no | n/a | PDN-8 | Phase 2B.2 tightens gate. **No audit entry today.** |
| GET | `/checks/latest` | crash-cart.ts:223 | auth | clin(tech+) | n/a | n/a | PDN-8 | |

---

## /api/dispense — server/routes/dispense.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/draft` | dispense.ts:64 | **none** | Phase 1: `auth`. Phase 2B.4: clin(tech+) on active shift | yes (file imports `logAudit`) | yes (dispense.service.ts) | PDN-8 | **Phase 1 PR 1.4** — add `requireAuth` only. |
| POST | `/:id/confirm` | dispense.ts:88 | **none** | Phase 1: `auth`. Phase 2B.4: clin(tech+) on active shift | yes | yes | PDN-8 | **Phase 1 PR 1.4**. |
| POST | `/emergency` | dispense.ts:106 | **none** | Phase 1: `auth`. Phase 2B.4: clin(tech+) on active shift | yes | yes | PDN-8 | **Phase 1 PR 1.4**. PDN-6 medication stricter handling. |

---

## /api/display — server/routes/display.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/snapshot` | display.ts:38 | auth | auth-only | n/a | n/a | PDN-8 | Ward TV; redaction = PDN-9. |

---

## /api/equipment — server/routes/equipment.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/my` | equipment.ts:272 | auth | auth-only (self) | n/a | n/a | IN-target | |
| GET | `/` | equipment.ts:352 | auth | clin(tech+) for list across clinic | n/a | n/a | IN-target | |
| GET | `/deleted` | equipment.ts:486 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/critical` | equipment.ts:520 | auth | clin(tech+) | n/a | n/a | IN-target | |
| GET | `/:id` | equipment.ts:566 | auth | clin(tech+) | n/a | n/a | IN-target | |
| POST | `/` | equipment.ts:653 | auth+writeLimiter+role(technician) | clin(tech+) on active shift | yes | n/a | IN-target | |
| PATCH | `/:id` | equipment.ts:734 | auth+writeLimiter+role(technician) | clin(tech+) on active shift | yes | n/a | IN-target | |
| DELETE | `/:id` | equipment.ts:868 | admin+writeLimiter | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/:id/restore` | equipment.ts:920 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/scan` | equipment.ts:978 | auth+role(student)+checkoutLimiter | clin(student+) on active shift — **PDN-A7** (Students are not in EZShift; manual VetTrack assignment required) | yes | n/a | IN-target | Today allows Student via legacy hierarchy. Under new model, off-shift Students lose scan; on-shift Students need PDN-A7 resolution. |
| POST | `/:id/checkout` | equipment.ts:1146 | auth+role(student)+checkoutLimiter | clin(tech+) on active shift — Student scope **PDN-A7** | yes | n/a | IN-target | |
| POST | `/:id/return` | equipment.ts:1292 | auth+role(student)+checkoutLimiter | clin(tech+) on active shift AND `checkedOutById === actor.id` OR Senior Tech override | yes | n/a | IN-target | **Phase 2B.3** — add ownership check. |
| POST | `/:id/seen` | equipment.ts:1416 | auth+writeLimiter | auth-only (acknowledgement) | yes | n/a | IN-target | |
| POST | `/:id/scan` | equipment.ts:1475 | auth+role(student)+scanLimiter | clin(student+) on active shift — Student scope **PDN-A7** | yes | n/a | IN-target | |
| POST | `/:id/revert` | equipment.ts:1636 | auth+role(vet) | clin(vet+) on active shift | yes | n/a | IN-target | |
| GET | `/:id/logs` | equipment.ts:1728 | auth | clin(tech+) | n/a | n/a | IN-target | |
| GET | `/:id/transfers` | equipment.ts:1767 | auth | clin(tech+) | n/a | n/a | IN-target | |
| POST | `/import` | equipment.ts:1853 | admin+writeLimiter | sys-admin | yes | n/a | OUT-admin-carveout | CSV import. |
| POST | `/bulk-delete` | equipment.ts:2047 | admin+writeLimiter | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/bulk-move` | equipment.ts:2108 | auth+writeLimiter+role(technician) | clin(tech+) on active shift | yes | n/a | IN-target | |
| POST | `/bulk-verify-room` | equipment.ts:2191 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | IN-target | |

---

## /api/er — server/routes/er.ts (router.use(requireAuth) at line 34)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/mode` | er.ts:133 | auth | auth-only | n/a | n/a | IN | Public read of global mode. |
| GET | `/status` | er.ts:154 | auth | auth-only | n/a | n/a | IN | |
| GET | `/events` (SSE) | er.ts:228 | auth + mountErModeSse | auth-only | n/a | n/a | IN | |
| GET | `/stream` (SSE) | er.ts:229 | auth + mountErModeSse | auth-only | n/a | n/a | IN | |
| PATCH | `/mode` | er.ts:242 | auth | clin(vet+) on active shift | yes | n/a | IN | Phase 4 PR 4.1. |
| GET | `/board` | er.ts:288 | auth | clin(tech+ or vet+) — TBD | n/a | n/a | IN | |
| GET | `/assignees` | er.ts:307 | auth | clin(tech+) | n/a | n/a | IN | |
| POST | `/intake` | er.ts:326 | auth | `clin(vet)` on active shift in Phase 2B.5; tighten to `clin(receiving_vet ∨ er_icu_vet ∨ senior_vet)` after Phase 2.5 | yes | yes (er-audit-logger) | IN | **Phase 2B.5** — currently NO role gate. Operational-role specificity per `task-product-model.md §2.2` and `authority-model.md §4.3`. |
| PATCH | `/intake/:id/assign` | er.ts:360 | auth+requireAssignableRole | clin(per assign matrix) on active shift | yes | yes | IN | |
| PATCH | `/intake/:id/accept` | er.ts:399 | auth | clin(vet+) — verify | yes | yes | IN | |
| POST | `/admission-state` | er.ts:490 | auth+role(vet) | clin(vet+) on active shift | yes | yes | IN | |
| DELETE | `/admission-state` | er.ts:548 | auth+role(vet) | clin(vet+) on active shift | yes | yes | IN | |
| GET | `/admission-state` | er.ts:576 | auth | clin(vet+) — verify | n/a | n/a | IN | |
| POST | `/intake/:id/admission-complete` | er.ts:593 | auth | clin(vet+) on active shift | yes | yes | IN | |
| PATCH | `/intake/:id/enrich` | er.ts:674 | auth | clin(vet+) on active shift | yes | yes | IN | |
| GET | `/handoffs/eligible-hospitalizations` | er.ts:743 | auth+requireAssignableRole | clin(tech+ or vet+) | n/a | n/a | IN | |
| POST | `/handoffs` | er.ts:762 | auth+requireAssignableRole | clin(tech+) on active shift | yes | yes | IN | |
| POST | `/handoffs/:id/ack` | er.ts:797 | auth | auth-only (target user) | yes | yes | IN | |
| GET | `/queue` | er.ts:843 | auth | auth-only | n/a | n/a | IN | |
| GET | `/impact` | er.ts:848 | auth | auth-only — verify if admin-only intended | n/a | n/a | IN | |

---

## /api/er/admin — server/routes/er-admin.ts (router.use(requireAuth) at line ~12)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/toggle-global-mode` | er-admin.ts:31 | auth + `canManageErModeForUser` check inside | Phase 2B.6: `clin(vet)` on active shift. **Phase 4 PR 4.1 (after Phase 2.5): `clin(senior_vet)` only.** Audit on every toggle. | no | yes (`applyGlobalErModeToggle`) | IN | **Phase 2B.6** + **Phase 4 PR 4.1**. Dead-lock policy when no Senior Vet checked-in is **PDN-V10**. |
| GET | `/toggle-global-mode` | er-admin.ts:76 | auth | clin(vet+) — verify need | n/a | n/a | IN | Probe / read of toggle status. |

---

## /api/folders — server/routes/folders.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | folders.ts:35 | auth | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/` | folders.ts:82 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| PATCH | `/:id` | folders.ts:128 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| DELETE | `/:id` | folders.ts:192 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |

---

## /api/forecast — server/routes/forecast.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/parse` | forecast.ts:327 | parseRateLimit+auth+ensureUserClinicMembership+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | Long-lived parse session. |
| POST | `/approve` | forecast.ts:515 | auth+ensureUserClinicMembership+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| POST | `/parse/:id/keepalive` | forecast.ts:802 | auth+ensureUserClinicMembership+role(technician) | clin(tech+) | no | n/a | PDN-8 | |
| PATCH | `/clinic/pharmacy-email` | forecast.ts:854 | auth+ensureUserClinicMembership+admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| GET | `/clinic/pharmacy-email` | forecast.ts:913 | auth+ensureUserClinicMembership+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/clinic/pharmacy-forecast-exclusions` | forecast.ts:934 | auth+ensureUserClinicMembership+admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| POST | `/clinic/pharmacy-forecast-exclusions` | forecast.ts:954 | auth+ensureUserClinicMembership+admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| DELETE | `/clinic/pharmacy-forecast-exclusions/:id` | forecast.ts:1017 | auth+ensureUserClinicMembership+admin | sys-admin | no | n/a | OUT-admin-carveout | |

---

## /api/formulary — server/routes/formulary.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | formulary.ts:97 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/` | formulary.ts:137 | auth+role(vet) | clin(vet+) on active shift | yes | n/a | PDN-8 | |
| PATCH | `/:id` | formulary.ts:262 | auth+role(vet) | clin(vet+) on active shift | yes | n/a | PDN-8 | |
| DELETE | `/:id` | formulary.ts:390 | auth+role(vet) | clin(vet+) on active shift | yes | n/a | PDN-8 | |

---

## /api/health, /health — server/routes/health.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/live` | health.ts:35 | none | none | n/a | n/a | IN (always) | Load balancer probe. |
| GET | `/startup` | health.ts:39 | none | none | n/a | n/a | IN (always) | |
| GET | `/` | health.ts:139 | none | none | n/a | n/a | IN (always) | |
| GET | `/data-integrity` | health.ts:199 | none | sys-admin? — **current behaviour unclear** | n/a | n/a | OUT-admin-carveout | Currently `auth` is not declared at line 199 in extract; verify before Phase 5. |

---

## /api/integrations — server/routes/integrations.ts

All routes require `requireAdmin` (system-admin only).

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/dashboard` | integrations.ts:94 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/billing/mismatch-report` | integrations.ts:103 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/mappings/review` | integrations.ts:124 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| PATCH | `/mappings/:id` | integrations.ts:144 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| GET | `/runs` | integrations.ts:167 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/analytics/product` | integrations.ts:199 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/health` | integrations.ts:206 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/adapters` | integrations.ts:214 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/configs` | integrations.ts:228 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| POST | `/configs` | integrations.ts:255 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| GET | `/configs/:adapterId` | integrations.ts:329 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| PATCH | `/configs/:adapterId` | integrations.ts:360 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| DELETE | `/configs/:adapterId` | integrations.ts:404 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/configs/:adapterId/credentials` | integrations.ts:434 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/configs/:adapterId/validate` | integrations.ts:472 | admin | sys-admin | no | n/a | OUT-admin-carveout | |
| POST | `/configs/:adapterId/sync` | integrations.ts:520 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/configs/:adapterId/rollback` | integrations.ts:591 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| POST | `/configs/:adapterId/promote` | integrations.ts:647 | admin | sys-admin | no | n/a | OUT-admin-carveout | |
| GET | `/configs/:adapterId/logs` | integrations.ts:696 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |

---

## /api/inventory-items — server/routes/inventory-items.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | inventory-items.ts:94 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/` | inventory-items.ts:120 | admin | sys-admin (PDN-7 future Senior Tech) | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id` | inventory-items.ts:191 | admin | sys-admin (PDN-7) | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id/deactivate` | inventory-items.ts:267 | admin | sys-admin (PDN-7) | yes | n/a | OUT-admin-carveout | |
| POST | `/:id/prices` | inventory-items.ts:306 | admin | sys-admin (PDN-7) | yes | n/a | OUT-admin-carveout | |
| GET | `/:id/prices` | inventory-items.ts:363 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |

---

## /api/medication-tasks — server/routes/medication-tasks.ts (router.use(auth+role(technician)+ensureUserClinicMembership) at line 178)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/` | medication-tasks.ts:180 | auth+role(technician)+ensureUserClinicMembership + idempotency | Phase 3A: `clin(vet)` on active shift (any active Vet check-in). **After Phase 2.5:** `clin(any_vet_op_role except on_call_vet)` per `task-product-model.md §2.2`. On-call Vet without check-in is excluded (**PDN-V5**). | no | yes (medication-tasks.service.ts) | IN-target | Current gate is too permissive — Phase 3A locks down. Operational-role specificity depends on Phase 2.5. |
| POST | `/:id/take` | medication-tasks.ts:227 | (same router.use) + idempotency | clin(tech+) on active shift | no | yes | IN-target | |
| POST | `/:id/complete` | medication-tasks.ts:244 | (same router.use) + idempotency | clin(tech+ or vet+) on active shift; Student forbidden | no | yes | IN-target | |
| POST | `/:id/cancel` | medication-tasks.ts:276 | (same router.use) | clin(vet+) on active shift — verify | no | yes | IN-target | |
| GET | `/` | medication-tasks.ts:295 | (same router.use) | clin(tech+) | n/a | n/a | IN-target | |

---

## /api/metrics — server/routes/metrics.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | metrics.ts:40 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |

---

## /api/shift-handover/patient-handoffs — server/routes/patient-handoffs.ts

(mounted under `/api/shift-handover/patient-handoffs`)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/eligible-patients` | patient-handoffs.ts:59 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/eligible-staff` | patient-handoffs.ts:73 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/` | patient-handoffs.ts:87 | auth+role(technician) | clin(tech+) on active shift | no | yes (patient-handoff.service.ts) | PDN-8 | |
| GET | `/mine` | patient-handoffs.ts:103 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/:id` | patient-handoffs.ts:112 | auth+role(technician) | clin(tech+) — should verify ownership | n/a | n/a | PDN-8 | |
| PUT | `/:id/items/:hospitalizationId` | patient-handoffs.ts:132 | auth+role(technician) | clin(tech+) on active shift | no | yes | PDN-8 | |
| POST | `/:id/submit` | patient-handoffs.ts:154 | auth+role(technician) | clin(tech+) on active shift | no | yes | PDN-8 | |
| POST | `/:id/review` | patient-handoffs.ts:177 | auth+role(technician) | clin(tech+) on active shift (receiver) | no | yes | PDN-8 | |
| POST | `/:id/cancel` | patient-handoffs.ts:200 | auth+role(technician) | clin(tech+) on active shift (creator) | no | yes | PDN-8 | |

---

## /api/patients — server/routes/patients.ts (router.use(auth+role(technician)) at line 11)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | patients.ts:142 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/pending` | patients.ts:188 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/search` | patients.ts:254 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/:id` | patients.ts:290 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/` | patients.ts:323 | auth+role(technician) [via router.use] + per-route role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | Admit patient. |
| PATCH | `/:id` | patients.ts:425 | auth+role(technician) [via router.use] | clin(tech+) on active shift | yes | n/a | PDN-8 | Recent commits hardened resurrection bug. |
| PATCH | `/:id/status` | patients.ts:585 | auth+role(technician) [via router.use] | clin(tech+) on active shift | no | n/a | PDN-8 | **No audit log call from route.** |
| PATCH | `/:id/discharge` | patients.ts:635 | auth+role(technician) [via router.use] | clin(tech+) on active shift | no | n/a | PDN-8 | **No audit log call from route.** |
| PATCH | `/:id/assign` | patients.ts:765 | auth+role(technician) [via router.use] | clin(senior_tech+) on active shift (PDN-3 for Technician) | no | n/a | PDN-8 | Pending Patient assignment. |

---

## /api/procurement — server/routes/procurement.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | procurement.ts:59 | auth+role(technician) | clin(tech+) | n/a | n/a | OUT-admin-carveout (PDN-7) | |
| GET | `/:id` | procurement.ts:111 | auth+role(technician) | clin(tech+) | n/a | n/a | OUT-admin-carveout | |
| POST | `/` | procurement.ts:147 | admin | sys-admin (PDN-7 future Senior Tech) | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id/submit` | procurement.ts:212 | admin | sys-admin (PDN-7) | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id/receive` | procurement.ts:252 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id/cancel` | procurement.ts:396 | admin | sys-admin (PDN-7) | yes | n/a | OUT-admin-carveout | |

---

## /api/push — server/routes/push.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/vapid-public-key` | push.ts:76 | none | none (intentional, public key) | n/a | n/a | IN | |
| POST | `/subscribe` | push.ts:92 | auth+authSensitiveLimiter | auth-only (self) | no | n/a | IN | Settings — sensitive-reads audit per PDN-5. |
| PATCH | `/subscribe` | push.ts:224 | auth | auth-only (self) | no | n/a | IN | |
| DELETE | `/subscribe` | push.ts:270 | auth | auth-only (self) | no | n/a | IN | |
| POST | `/test` | push.ts:300 | auth+pushTestLimiter | auth-only | no | n/a | IN | |

---

## /api/queue — server/routes/queue.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/metrics` | queue.ts:38 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/dlq` | queue.ts:115 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| POST | `/dlq/:jobId/replay` | queue.ts:148 | admin | sys-admin | no | n/a | OUT-admin-carveout | |

---

## /api/realtime — server/routes/realtime.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/replay` | realtime.ts:149 | auth | auth-only | n/a | n/a | IN | |
| GET | `/outbox-head` | realtime.ts:232 | auth | auth-only | n/a | n/a | IN | |
| POST | `/telemetry` | realtime.ts:271 | auth | auth-only | n/a | n/a | IN | |
| GET | `/stream` | realtime.ts:296 | auth | auth-only | n/a | n/a | IN | SSE. |
| GET | `/` | realtime.ts:376 | auth | auth-only | n/a | n/a | IN | |

---

## /api/restock — server/routes/restock.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/start` | restock.ts:87 | auth+role(technician) | clin(tech+ or senior-tech+) on active shift | no | n/a | PDN-8 (inventory workflow) | **No audit log entry today.** |
| POST | `/scan` | restock.ts:110 | auth+role(technician) | clin(tech+ or senior-tech+) on active shift | no | n/a | PDN-8 | **Phase 1 PR 1.2:** FE must send `observedQuantity`, not `delta`. |
| POST | `/finish` | restock.ts:154 | auth+role(technician) | clin(tech+ or senior-tech+) on active shift | no | n/a | PDN-8 | |
| POST | `/cancel` | restock.ts:177 | auth+role(technician) | clin(tech+ or senior-tech+) on active shift | no | n/a | PDN-8 | |
| POST | `/container-items` | restock.ts:200 | auth+role(technician) | clin(tech+) | n/a (read) | n/a | PDN-8 | |

---

## /api/returns — server/routes/returns.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/` | returns.ts:75 | auth+checkoutLimiter+role(technician) + idempotency | clin(tech+) on active shift; ownership check (see equipment return) | yes | n/a | IN-target (equipment workflow) | |
| PATCH | `/:id` | returns.ts:157 | auth+checkoutLimiter+role(technician) + idempotency | clin(tech+) on active shift | yes | n/a | IN-target | |

---

## /api/rooms — server/routes/rooms.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/` | rooms.ts:68 | auth | clin(tech+) | n/a | n/a | PDN-8 (equipment workflow) | |
| GET | `/:id` | rooms.ts:129 | auth | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/:id/activity` | rooms.ts:204 | auth | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/` | rooms.ts:254 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| PATCH | `/:id` | rooms.ts:318 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| DELETE | `/:id` | rooms.ts:397 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |

---

## /api/shift-chat — server/routes/shift-chat.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/messages` | shift-chat.ts:54 | auth+role(technician) | clin(tech+) on active shift | n/a | n/a | PDN-8 | |
| POST | `/messages` | shift-chat.ts:174 | auth+role(technician)+writeLimiter | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| POST | `/messages/:id/ack` | shift-chat.ts:311 | auth+role(technician)+writeLimiter | clin(tech+) on active shift | no | n/a | PDN-8 | |
| POST | `/messages/:id/pin` | shift-chat.ts:405 | auth+role(senior_technician) | clin(senior-tech+) on active shift | yes | n/a | PDN-8 | |
| POST | `/reactions` | shift-chat.ts:472 | auth+role(technician)+writeLimiter | clin(tech+) | yes | n/a | PDN-8 | |
| GET | `/archive/:shiftId` | shift-chat.ts:557 | auth+role(senior_technician) | clin(senior-tech+) | n/a | n/a | PDN-8 | |
| POST | `/typing` | shift-chat.ts:593 | auth+role(technician)+writeLimiter | clin(tech+) | n/a | n/a | PDN-8 | |

---

## /api/shift-handover — server/routes/shift-handover.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/discharge/:animalId` | shift-handover.ts:88 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/summary` | shift-handover.ts:136 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| POST | `/session/start` | shift-handover.ts:269 | auth+role(technician) | clin(tech+) on active shift | yes | n/a | PDN-8 | |
| POST | `/session/end` | shift-handover.ts:331 | auth+role(technician) | clin(tech+) on active shift | no | n/a | PDN-8 | |
| GET | `/consumables-report` | shift-handover.ts:480 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/pending-emergencies` | shift-handover.ts:650 | auth+role(technician) | clin(tech+) | n/a | n/a | **IN-target** | Pending Emergencies page; allowlist add per Plan v2. |
| PATCH | `/emergency/:logId/reconcile` | shift-handover.ts:726 | auth+role(technician) | clin(tech+) on active shift | no | n/a | IN-target | |
| GET | `/patients` | shift-handover.ts:992 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |
| GET | `/snapshot/latest` | shift-handover.ts:1007 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | |

---

## /api/shifts — server/routes/shifts.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/imports` | shifts.ts:501 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | EZShift import history. |
| POST | `/import/preview` | shifts.ts:535 | admin | sys-admin | no | n/a | OUT-admin-carveout | EZShift import preview. Per-row audit policy = **PDN-A6**. |
| POST | `/import/confirm` | shifts.ts:574 | admin | sys-admin | yes | n/a | OUT-admin-carveout | EZShift import commit; grants/revokes active-shift authority in bulk. Per-row diff audit = **PDN-A6**. |
| POST | `/import` | shifts.ts:687 | admin | sys-admin | yes | n/a | OUT-admin-carveout | EZShift import (single-step). Per-row diff audit = **PDN-A6**. |
| GET | `/` | shifts.ts:814 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |

---

## /api/stability — server/routes/stability.ts (router.use(auth+role(admin)))

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/status` | stability.ts:59 | admin (via router.use) | sys-admin | n/a | n/a | OUT-admin-carveout | |
| POST | `/run` | stability.ts:71 | admin | sys-admin | no | n/a | OUT-admin-carveout | |
| GET | `/results` | stability.ts:89 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/logs` | stability.ts:93 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| DELETE | `/logs` | stability.ts:99 | admin | sys-admin | no | n/a | OUT-admin-carveout | |
| POST | `/test-mode` | stability.ts:105 | admin + requireNotProduction | sys-admin + dev-only | no | n/a | OUT-admin-carveout | Dev only. |
| POST | `/schedule` | stability.ts:122 | admin + requireNotProduction | sys-admin + dev-only | no | n/a | OUT-admin-carveout | Dev only. |

---

## /api/storage — server/routes/storage.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/upload-url` | storage.ts:53 | auth+role(technician) | clin(tech+) | n/a | n/a | PDN-8 | Signed URL for upload. |

---

## /api/support — server/routes/support.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/` | support.ts:66 | auth | auth-only | no | n/a | IN-target | Report Problem. |
| GET | `/` | support.ts:122 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/unresolved-count` | support.ts:146 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| PATCH | `/:id` | support.ts:169 | admin | sys-admin | no | n/a | OUT-admin-carveout | |

---

## /api/tasks — server/routes/tasks.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/:id/vet-approve` | tasks.ts:146 | auth+role(vet)+idempotency | clin(vet+) on active shift | no | yes (appointments.service.ts) | IN-target | |
| GET | `/dashboard` | tasks.ts:180 | auth+role(technician) | clin(tech+) | n/a | n/a | IN-target | |
| POST | `/:id/start` | tasks.ts:220 | auth+role(technician)+idempotency | clin(tech+) on active shift + ownership/override per task model | no | yes | IN-target | |
| POST | `/:id/complete` | tasks.ts:270 | auth+role(technician)+idempotency | clin(tech+) on active shift + ownership/override; **Student forbidden** | no | yes | IN-target | |
| GET | `/me` | tasks.ts:324 | auth+role(technician) | clin(tech+) | n/a | n/a | IN-target | |
| GET | `/active` | tasks.ts:354 | auth+role(technician) | clin(tech+) | n/a | n/a | IN-target | |
| GET | `/medication-active` | tasks.ts:374 | auth+role(technician) | clin(tech+) | n/a | n/a | IN-target | |
| GET | `/recommendations` | tasks.ts:464 | auth+role(technician) | clin(tech+) | n/a | n/a | IN-target | |

(Phase 3B will add `/escalate`, `/accept`, `/refuse`. Phase 4 will add `/report-issue` or similar for medication issue path.)

---

## /api/test — server/routes/test.ts (dev/test-mode only)

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/run-scheduler` | test.ts:80 | auth+requireTestMode | dev-only | n/a | n/a | OUT (dev only) | |
| POST | (other test routes line 87) | test.ts:87 | auth+requireTestMode | dev-only | n/a | n/a | OUT (dev only) | Path requires verification — multi-line declaration. **Current behaviour unclear without reading body.** |
| GET | `/notifications` | test.ts:158 | auth+requireTestMode | dev-only | n/a | n/a | OUT (dev only) | |
| POST | `/expiry-check/run` | test.ts:179 | auth+requireTestMode | dev-only | n/a | n/a | OUT (dev only) | |
| POST | `/charge-alert/run` | test.ts:202 | auth+requireTestMode | dev-only | n/a | n/a | OUT (dev only) | |
| GET | `/returns/:id` | test.ts:222 | auth+requireTestMode | dev-only | n/a | n/a | OUT (dev only) | |

---

## /api/uploads — server/routes/uploads.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/fault-image` | uploads.ts:53 | auth | auth-only | no | n/a | PDN-8 | Fault report image upload. |

---

## /api/users — server/routes/users.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| GET | `/me` | users.ts:121 | auth | auth-only | n/a | n/a | IN | Self-identity. |
| GET | `/deleted` | users.ts:161 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/` | users.ts:184 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| GET | `/pending` | users.ts:258 | admin | sys-admin | n/a | n/a | OUT-admin-carveout | |
| PATCH | `/:id/role` | users.ts:281 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id/secondary-role` | users.ts:356 | admin | sys-admin | yes | n/a | OUT-admin-carveout | Note: secondary-role is legacy; new model uses shiftRole. Behaviour to be reconciled. |
| PATCH | `/:id/status` | users.ts:409 | admin | sys-admin | yes | n/a | OUT-admin-carveout | |
| PATCH | `/:id/display_name` | users.ts:463 | requireAuthAny (variant) | auth-only (self) — **verify scope** | yes | n/a | IN | Uses `requireAuthAny`; behaviour unclear vs `requireAuth`. |
| PATCH | `/:id/delete` | users.ts:544 | auth | sys-admin OR self — **verify** | yes | n/a | IN | Soft-delete self; admin can delete others — verify in code. |
| PATCH | `/:id/restore` | users.ts:649 | auth | sys-admin — **verify** | yes | n/a | OUT-admin-carveout | |
| POST | `/sync` | users.ts:725 | auth+authSensitiveLimiter | auth-only | no | n/a | IN | Clerk sync. |
| GET | `/purge-candidates` | users.ts:871 | admin+authSensitiveLimiter | sys-admin | n/a | n/a | OUT-admin-carveout | |
| POST | `/purge-deleted` | users.ts:896 | admin+authSensitiveLimiter | sys-admin | yes | n/a | OUT-admin-carveout | |
| GET | `/managers` | users.ts:923 | auth | auth-only today. **Phase 4 PR 4.6 (after Phase 2.5):** filter to active-shift Vets (any operational role), annotate Senior Vets distinctly so FE can surface them first. Proposed new name `/active-shift-vets`; legacy path may remain for compatibility. | n/a | n/a | IN | **Endpoint EXISTS** — original audit's 404 finding was incorrect. Manager-picker behaviour without a checked-in Senior Vet is **PDN-V11**. On-call Vet inclusion depends on **PDN-V5**. |
| POST | `/backfill-clerk` | users.ts:953 | admin+authSensitiveLimiter | sys-admin | yes | n/a | OUT-admin-carveout | |

---

## /api/webhooks — server/routes/webhooks.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/` | webhooks.ts:60 | **none** + raw body + HMAC inside | HMAC signature verification (intentional, no `requireAuth`) | yes | n/a | OUT (webhook) | Clerk webhook. Signature verification is the auth mechanism. |

---

## /api/whatsapp — server/routes/whatsapp.ts

| Method | Path | File:line | Current gate | Target gate | Audit (route) | Audit (service) | ER allowlist | Notes |
|---|---|---|---|---|---|---|---|---|
| POST | `/alert` | whatsapp.ts:100 | auth+role(technician) | clin(tech+) on active shift | no | n/a | PDN-8 | |

---

## Mount aliases

The following alias is registered in `server/app/routes.ts:70`:

- `app.use("/api/shift-handover/patient-handoffs", patientHandoffsRoutes);` — patient-handoffs routes also appear under the `/api/shift-handover/patient-handoffs` prefix.

The following aliased mounts also exist:

- `app.use("/api/admin", adminOutboxHealthRoutes);` (mounted as `/outbox-health`)
- `app.use("/api/admin", adminOutboxDlqRoutes);` (mounted as `/outbox/dlq/...`)
- `app.use("/api/admin", adminMedicationIntegrityRoutes);` (mounted as `/medication-integrity`)
- `app.use("/api/health/ready", healthRoutes);` — same router mounted twice; not all paths are meaningful at both prefixes.
- `app.use("/health", healthRoutes);` — same router under `/health`.

---

## Endpoints where current behaviour is unclear

These rows in the matrix flag "verify before Phase 2C migrates them." Resolving them is part of Phase 0; if not resolved, they block their respective Phase 2C PRs.

1. `GET /api/er/admission-state` (er.ts:576) — no role gate currently; clinical-vet target should be confirmed.
2. `GET /api/er/queue` (er.ts:843) — no role gate; intended audience unclear.
3. `GET /api/er/impact` (er.ts:848) — no role gate; admin-only vs vet-only unclear.
4. `GET /api/er/admin/toggle-global-mode` (er-admin.ts:76) — read-side of toggle; intended audience unclear (probe vs status).
5. `GET /api/health/data-integrity` (health.ts:199) — extract showed no `requireAuth`; may rely on `router.use` elsewhere (none found). Verify before any Phase 2C work.
6. `PATCH /api/users/:id/display_name` (users.ts:463) — uses `requireAuthAny` (variant middleware not documented in `auth.ts` summary above). Behaviour vs `requireAuth` to be verified.
7. `PATCH /api/users/:id/delete` / `/restore` (users.ts:544, 649) — `requireAuth` only; need to confirm whether self-only or admin-required is enforced inside the handler.
8. `POST /api/test/...` second handler (test.ts:87) — multi-line route declaration; full path was not captured by the line-1 grep. Test-mode only, so low risk, but the matrix entry needs the actual path before Phase 5 dead-code review.
9. `POST /api/er/intake` (er.ts:326) — currently authenticated only; the audit reported it as "no role gate" which is correct, but the surrounding handler may inline-check role. Phase 0 doc records the matrix expectation (clin-vet on shift) and Phase 2B.5 enforces it.
10. `POST /api/code-blue/sessions` (code-blue.ts:185) — currently `requireAuth` only; Student trigger-only restriction is policy, not yet enforced in code. Phase 4 PR 4.6 may add an inline check.

---

## Summary counts (this matrix)

- Total handlers cataloged: **~165 across 47 route files** (per the per-file route grep).
- Currently **unauthenticated** (no `requireAuth`):
  - `/api/dispense/draft`, `/api/dispense/:id/confirm`, `/api/dispense/emergency` — Phase 1 PR 1.4 fixes.
  - `/api/health/*` (intentional, load balancer).
  - `/api/webhooks/` (intentional, signature-verified).
  - `/api/push/vapid-public-key` (intentional, public key).
- Currently **admin-only** (`requireAdmin`): roughly 60+ handlers, mostly in `analytics`, `integrations`, `audit-logs`, `metrics`, `queue`, `stability`, `shifts`, `users`, `admin-*`, parts of `billing`, `code-blue`, `procurement`, `inventory-items`, `equipment`, `folders/:id` delete, `rooms` patch/delete.
- Handlers gated `requireEffectiveRole("technician")`: the bulk of clinical mutations (equipment, restock, containers, patients, shift-handover, patient-handoffs, tasks, medication-tasks, returns, alert-acks, etc.). These are the targets of Phase 2C migration.
- Handlers gated `requireEffectiveRole("vet")`: billing reads, formulary, equipment revert, medication-tasks cancel target. Target: `clin(vet+)` on active shift.
- Handlers gated `requireEffectiveRole("senior_technician")`: shift-chat pin and archive. Target: `clin(senior-tech+)` on active shift.
- Handlers gated `requireEffectiveRole("student")`: equipment scan / checkout / return / per-equipment scan. Target depends on Student scope resolution (PDN).
- Handlers writing audit at route layer: roughly 80. Handlers without route-layer audit but with service-layer audit: at least the appointments/tasks/medication-tasks/patient-handoffs paths.
- Handlers in `IN` (ER allowlist) currently: `/er`, `/users`, `/realtime`, `/push`, `/containers` and their sub-paths.
- Handlers in `IN-target` (should be allowlisted per Plan v2 §1.4) but not today: `/code-blue`, `/billing`, `/equipment`, `/returns`, `/alert-acks`, `/rooms`, `/medication-tasks`, `/tasks`, `/appointments`, `/support`, `/shift-handover/pending-emergencies`. Final list depends on **PDN-8**.

---

## Notes on scope and accuracy

- This matrix is **read-only documentation**. It does not approve any code change.
- "Current gate" reflects middleware visible at the route declaration; `router.use(...)` upstream is applied to every handler downstream in that file.
- "Audit (route)" counts only direct `logAudit(...)` calls in the route file. "Audit (service)" is set when the route file is one of `appointments.ts`, `medication-tasks.ts`, `patient-handoffs.ts`, `dispense.ts` (whose services audit), or `er.ts` (whose `er-audit-logger.ts` is invoked). Other handlers that audit via deeper helpers may be under-counted; full audit-coverage verification is Phase 5 work.
- ER allowlist disposition is a **target** column. Today's actual allowlist is the 6-prefix set in `shared/er-mode-access.ts:15-23`. Backend enforcement does not currently use this list; Phase 4 PR 4.2 adds the middleware.
- Lines refer to the current branch (`claude/audit-app-codebase-irCU6`) as of this audit.
- The matrix is not a substitute for individual PR review — each Phase 2C migration PR re-verifies the exact handler before changing the gate.
