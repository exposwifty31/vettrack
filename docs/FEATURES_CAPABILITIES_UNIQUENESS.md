# VetTrack — Features, Capabilities & Uniqueness

**Purpose:** Standalone product reference for stakeholders, onboarding, and positioning. It describes what the application does today—not implementation details. For engineering rules and architecture, see [`README.md`](../README.md), [`CLAUDE.md`](../CLAUDE.md), and [`CONTEXT.md`](../CONTEXT.md).

**Last aligned with:** Equipment Operational State (V1–V3), pilot stabilization (`pilot-v1`), and post-pilot navigation fixes (through v1.1.2).

---

## What VetTrack is

VetTrack is a **mobile-first veterinary hospital operations platform** for multi-clinic deployments. It unifies **asset tracking**, **bedside medication safety**, **inventory and billing**, **emergency workflows**, and **PMS integration** behind one clinic-scoped, audit-heavy system.

It is positioned as an **orchestration and operational-intelligence layer** that can sit **above** incumbent practice management systems (PIMS), not only as a PIMS replacement narrative. See [`docs/investor-deck/COMPETITIVE_LANDSCAPE.md`](investor-deck/COMPETITIVE_LANDSCAPE.md).

---

## Capability map (by domain)

### 1. Identity, tenancy & security

| Capability | Summary |
|------------|---------|
| **Multi-clinic tenancy** | Every row is scoped by `clinicId`; cross-clinic access is treated as a defect. |
| **Clerk authentication** | Production sign-in (email, OTP, OAuth); dev-bypass for local work without keys. |
| **Role-based access** | Roles from DB (`admin`, `vet`, `senior_technician`, `technician`, `student`, …) with numeric floors for guards. |
| **Account lifecycle** | Pending approval, blocked, and soft-deleted users are enforced server-side. |
| **Audit trail** | Critical actions logged to `vt_audit_logs` with a closed action-type union. |
| **Encrypted integration secrets** | Optional AES-256-GCM at rest for vendor credentials. |

### 2. Equipment & assets (core wedge)

| Capability | Summary |
|------------|---------|
| **Equipment registry** | Full metadata, folders/categories, images, search, bulk operations. |
| **QR / NFC scan workflows** | Scan → detail, checkout/return, status updates, activity history. |
| **Status & maintenance** | OK, issue, maintenance, sterilized; problems dashboard and alerts. |
| **Room radar** | Location-oriented view of equipment in rooms; pilot mode adds staleness + “Confirm here”. |
| **Return custody & plug-in tracking** | Atomic return handling and offline-aware plug-in charge alerts. |
| **Operational state (V1–V3)** | Relationship-based deployability—not a single “available” flag. |
| **Custody** | `docked`, `checked_out`, `returned`, `untracked`. |
| **Readiness** | `ready`, `not_ready`, `unknown` with bundle/condition gates. |
| **Usage** | `available`, `staged`, `in_use`, `emergency_use`, `procedure_bound`. |
| **Dock return** | Return-to-dock with readiness condition verification. |
| **Staging queue (V3)** | Priority queue (`routine` / `urgent` / `emergency`), position, promotion notifications. |
| **Procedure binding (V2)** | Bind equipment to hospitalization; automated release on discharge (worker). |
| **Operational metrics** | Deployable success rate, checkout/dock-return times, overrides, stale conditions. |
| **Pilot tooling** | Coverage admin, configurable staleness (`pilot_stale_ms`), QR print for unconfirmed assets, floor notes, scan-log attribution (admin). |

Philosophy for this domain: **reduce uncertainty inside chaos**, not eliminate ER/ICU chaos—see [`docs/PH-01-operational-assistance-during-chaos.md`](PH-01-operational-assistance-during-chaos.md) and [`docs/decisions/AD-02-equipment-operational-state.md`](decisions/AD-02-equipment-operational-state.md).

### 3. Medication & pharmacy

| Capability | Summary |
|------------|---------|
| **Drug formulary** | Per-clinic formulary with composite uniqueness (generic + concentration). |
| **Dose calculation** | Weight-based liquid/tablet paths with hard safety caps (&lt; 100 ml liquids). |
| **Medication tasks** | Create, assign, complete with calculation snapshot and billing in one transaction. |
| **Duplicate-open guard** | DB + service prevention of multiple open tasks per animal/drug/route. |
| **Inventory deduction** | Async BullMQ job after completion; recovery scheduler for stale/failed jobs. |
| **Smart COP** | Cross-cutting clinical integrity (orphan dispense, order alignment, shadow/enforce evaluators). |
| **Pharmacy forecast & ICU tooling** | Forecasting, exclusions, flowsheet-oriented filters (see specs under `docs/superpowers/`). |
| **Crash cart** | Daily readiness checks tied to emergency preparedness. |

### 4. Inventory, containers & procurement

| Capability | Summary |
|------------|---------|
| **Items & containers** | Lot-aware inventory, restock, dispense paths. |
| **Billing ledger** | Idempotent billing events; session-based usage billing where applicable. |
| **Purchase orders** | PO headers and lines for procurement workflows. |

### 5. Tasks & scheduling

| Capability | Summary |
|------------|---------|
| **Unified task model** | `vt_appointments` with `taskType` (user-facing copy: **Tasks / משימות**). |
| **Shifts & shift sessions** | Shift-scoped operations and handover support. |
| **Shift chat** | Shift-scoped channel with broadcasts, reactions, and system auto-posts. |

### 6. Emergency & ER

| Capability | Summary |
|------------|---------|
| **ER Mode** | Clinic-scoped allowlist; non-allowed routes return concealment 404. |
| **ER board & intake** | Triage intake, queue severity, time-based escalation, primary-lane discipline. |
| **Code Blue** | Live resuscitation sessions, structured logs, presence, server-confirmed end state. |
| **Handoff SLA** | Breach detection and realtime signals for structured clinical handoffs. |
| **Ward / display surfaces** | Large-format views for unit awareness (with frozen realtime/PWA rules). |

### 7. Patients & hospitalization

| Capability | Summary |
|------------|---------|
| **Animals & owners** | Patient records linked to clinical workflows. |
| **Hospitalizations** | Inpatient context; ties to equipment procedure binding and dispense validation. |
| **Pending patients & ER routing** | Admission fan-out, “in admission” pool semantics, handoff debt (see `CONTEXT.md`). |

### 8. Realtime, offline & PWA

| Capability | Summary |
|------------|---------|
| **SSE realtime** | Per-clinic outbox-backed stream with monotonic cursor and HTTP replay. |
| **Cross-tab reconciliation** | BroadcastChannel gossip, build-tag split detection, visibility/online recovery. |
| **Offline-first (Dexie)** | Equipment/rooms cache, pending sync queue, circuit breaker sync engine. |
| **Service worker** | Versioned cache; emergency endpoints never cached. |
| **Emergency block** | Code Blue mutations never queued offline—fail loud with bounded telemetry. |

### 9. Integrations & ops

| Capability | Summary |
|------------|---------|
| **PMS adapters** | IDEXX, Covetrus, and extensible vendor layer with sync jobs and webhooks. |
| **WhatsApp / push** | Issue escalation and scheduled notifications (config-dependent). |
| **Background workers** | Expiry checks, charge alerts, inventory deduction, integration sync, ownership sweeps, outbox publisher. |
| **Admin observability** | Outbox health, DLQ, medication integrity, task ownership tooling. |

### 10. Internationalization & UX

| Capability | Summary |
|------------|---------|
| **Hebrew + English** | Parity-checked locales; Hebrew default; RTL-capable UI. |
| **Bedside-oriented UI** | Large targets, minimal navigation on critical paths, skeleton loading, sync indicators. |

---

## What makes VetTrack unique

These are **product differentiators**, not a claim to replace every PIMS feature.

### 1. Clinical deployability, not just asset location

Most asset systems answer *“where is it?”* VetTrack’s operational state answers ***“is it actually deployable right now?”*** by combining custody, readiness (bundle conditions), usage (including staging and procedure binding), and timestamps. That matches how ER/ICU staff think—distinct from maintenance’s “powers on” definition (see AD-02).

### 2. Offline-first without compromising emergency safety

Staff can scan, update status, and queue mutations offline—but **Code Blue and other emergency mutations are explicitly blocked offline**, with loud failure and metrics instead of silent replay. Billing and inventory may be briefly eventual after task completion by design.

### 3. Hospital-grade realtime without WebSockets

A single SSE stream per clinic, transactional outbox ordering, replay on reconnect, and cross-tab cursor gossip give ward boards and emergency UI a consistent source of truth without ad-hoc polling—while keeping emergency endpoints out of the service worker cache.

### 4. Medication safety wired to money and stock

Task completion commits clinical completion and billing atomically; inventory deduction is async but recoverable. Dose hard-stops, orphan dispense detection (Smart COP), and authority evaluators (`off` / `shadow` / `enforce`) connect **clinical**, **financial**, and **inventory** data in one platform.

### 5. ER wedge + orchestration layer

ER Mode, intake escalation, admission fan-out, and handoff SLAs target **high-pressure shift operations**. Integrations let hospitals keep their system of record while VetTrack owns **bedside ops, assets, and safety nets**.

### 6. Multi-tenant audit and enforcement by default

Clinic isolation, DB-sourced roles, closed audit action types, and bounded telemetry enums are architectural constraints—not optional add-ons—supporting enterprise and diligence narratives.

### 7. Pilot-ready asset discipline (optional)

With `PILOT_MODE` / `VITE_PILOT_MODE`, hospitals get measurable adoption tooling: never-confirmed assets, configurable staleness, coverage dashboards, and admin-only attribution on scan logs—without changing core tenancy or auth models. See [`docs/pilot.md`](pilot.md).

---

## Comparison at a glance

| Dimension | Typical PIMS / asset tool | VetTrack |
|-----------|---------------------------|----------|
| Primary question | Billing, records, or location | Deployability + bedside workflow + safety |
| Offline | Often limited or none | PWA queue with emergency carve-outs |
| Live updates | Polling or none | Outbox SSE + replay |
| Meds + assets + billing | Siloed modules | Shared clinic scope and audit |
| ER / Code Blue | Varies | First-class, frozen runtime guarantees |
| Integrations | Vendor lock-in | Adapter layer above incumbent PIMS |

---

## Feature flags & rollout surfaces

| Surface | Control |
|---------|---------|
| Pilot UX | `PILOT_MODE` / `VITE_PILOT_MODE` — see [`docs/pilot.md`](pilot.md) |
| Operational metrics | `ENABLE_OPERATIONAL_METRICS` |
| Authority evaluators | Per-clinic `off` / `shadow` / `enforce` |
| Auth | Clerk vs dev-bypass — see [`docs/dev-signin-runbook.md`](dev-signin-runbook.md) |

Equipment operational state V1 kill switch has been removed; the UI and API fields are the default path when the feature is enabled in deployment config.

---

## Related documents

| Document | Use when |
|----------|----------|
| [`CONTEXT.md`](../CONTEXT.md) | Canonical ER / Smart COP glossary |
| [`docs/pilot.md`](pilot.md) | Pilot-only features and activation |
| [`docs/decisions/AD-01-complete-task-fix.md`](decisions/AD-01-complete-task-fix.md) | Medication completion / billing integrity |
| [`docs/decisions/AD-02-equipment-operational-state.md`](decisions/AD-02-equipment-operational-state.md) | Operational state model |
| [`docs/PH-01-operational-assistance-during-chaos.md`](PH-01-operational-assistance-during-chaos.md) | Product philosophy for equipment ops |
| [`docs/integrations-guide.md`](integrations-guide.md) | PMS adapter onboarding |
| [`docs/investor-deck/COMPETITIVE_LANDSCAPE.md`](investor-deck/COMPETITIVE_LANDSCAPE.md) | Market category context |

---

## Out of scope for this file

- API route lists and table schemas (see `server/app/routes.ts`, `server/db.ts`)
- Step-by-step dev setup (see [`README.md`](../README.md))
- Frozen Phase 9 implementation rules (see [`CLAUDE.md`](../CLAUDE.md) — Realtime, Code Blue, PWA)

*This document should be updated when major product slices ship (e.g. new operational-state phases, ER routing, or integration certifications).*
