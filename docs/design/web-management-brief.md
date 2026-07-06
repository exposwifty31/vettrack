# Web Management Console — Design Brief (Phase 1 / B1)

**For:** Claude Design (VetTrack Design System project), routed via Claude Cowork.
**From:** Claude Code (program plan Phase 1). **Date:** 2026-07-07.
**Deliverable of this phase:** this brief only. Zero code (plan fence).

> Read the Phase 1 playbook in `docs/design/platform-strategy-research.md` (§"Phase 1") and the III.2 calibration set (Topic 6) before designing. This brief is the single source of what to design and against what constraints.

---

## 1. Positioning — what the web app IS now

The web app **stops mirroring mobile** and becomes a **management console**: oversight, configuration, reporting. It is a distinct product from the iPhone/iPad operational app and the Command Center board (plan III.1 — four products, four build paths). Design for **desktop density**: tables, detail drawers, keyboard, multi-column layouts — **not** stacked mobile cards.

- **Viewport:** desktop-only, **≥1024px**. Below that the app shows a guard screen (`WebOnlyGuard`) — do not design a responsive-down-to-mobile console.
- **No native implications.** Nothing here ships to the Capacitor shell.

## 2. Personas & access (locked — plan I.4)

| Persona | Capability | What they see |
|---|---|---|
| **Admin** | `management.web` + `management.webWrite` | Full console: view **and** edit/configure every module |
| **Lead** (senior_technician) | `management.web` only | **Read-only** — every module viewable, all create/edit/delete affordances absent or disabled-with-reason |
| Everyone else | — | Excluded from the console in v1 (no nav entry) |

**Design both states for every module:** the admin (full) view and the lead (read-only) view. Read-only is not "grey everything out" — it is a deliberate view-mode: no primary action buttons, row actions hidden, forms shown as read-only summaries.

## 3. Design bar (III.2) & calibration references (Phase R Topic 6)

Every screen must clear the repo anti-template policy (`.claude/rules/ecc/web/design-quality.md`): real hierarchy via scale, spacing rhythm, depth/layering, designed hover/focus/active, semantic color, motion that clarifies. Calibrate against:

- **Restraint:** Linear / Vercel (precise, minimal, single accent) — VetTrack's accent is the existing **clinical indigo**; do not introduce a new palette.
- **Structure:** `shadcn-admin` (Vite+React+shadcn+RTL — near-identical stack) as the console skeleton reference (sidebar + content + drawer, RBAC-aware).
- **Glanceable panels:** bento-grid hierarchy for dashboard/summary surfaces.
- **Information architecture:** NN/g F/Z-pattern for tile placement; **≤7 competing top-level entries** (abandonment threshold).
- **Cmd+K command palette:** a strong 2026 console affordance — **calibration reference only, NOT a v1 deliverable** unless the owner explicitly scopes it (surfaced in Phase R, owner to route).

## 4. Global hard constraints (non-negotiable)

1. **Hebrew-default RTL is the primary rendering.** Design RTL first; LTR (English) is the secondary check. Use logical layout (start/end, not left/right).
2. **All copy is i18n-keyed.** No hardcoded strings anywhere in the designs' intent — every label maps to a `t.*` key (Claude Code adds keys to `he.json`+`en.json` in the same commit at build time). Provide he + en for every new string.
3. **Compose from the existing system.** Use the 111 synced components + Stage 1 tokens (`docs/design-system.md` §2 tokens, §4 component library). Do not invent new primitives where one exists.
4. **Frozen surfaces are read-only mirrors.** Ops Health, Analytics, Audit render **existing bounded-enum telemetry** and existing endpoints. **Do not** propose a new realtime transport, new polling, new telemetry fields, or renames of frozen surfaces (`appointmentsPage.*`, `vt_appointments`, `/api/appointments`). No new audit kinds in the design intent.
5. **Every module ships four states:** default (populated) · **empty** · **loading** (skeleton) · **error** — plus an **RTL spot-check** of the default state. Missing any of these fails the deliverable (Phase 1 playbook pitfall 3).

## 5. Inputs (attach to the Claude Design run)

- **Tokens:** `docs/design-system.md` §2.1–2.19 (color, surface ramp, status pills, typography scale, elevation, spacing, radius, motion). Already synced as Stage 1.
- **Components:** the 111 synced VetTrack components + `docs/design-system.md` §4 library. Sync config + gotchas: `.design-sync/NOTES.md`.
- **Restage sources:** `docs/design-handoff/stages-full/project/Stage 7 - Analytics & Management.dc.html` and `Stage 8 - Admin & Governance.dc.html` (existing screens to restage, not redraw from scratch).

---

## 6. IA spine — the console modules

Ten modules. The left nav groups them; **keep top-level groups ≤7** (collapse related modules under a group). Suggested grouping: **Overview** (Management Home) · **People** (People & Roles) · **Assets** (Equipment Governance, Inventory & Procurement) · **Connectivity** (Integrations & Webhooks, Notifications, RFID) · **Operations** (Ops Health, Analytics, Audit).

For each module below: **Exists today** (restage) vs **Net-new** (design fresh), the backend reality, and module-specific notes. "Exists" = there is a live page/route; "Net-new UI" = the server route exists but has weak/no console UI (verified in `server/routes/`).

### 6.1 Management Home  — restage
- **Exists:** `/dashboard` → `src/pages/management-dashboard.tsx` (`WebOnlyGuard`-fenced).
- **Design:** a **bento-grid** overview — coverage/readiness/exceptions at a glance, drill-down tiles into the other modules. This is the console's F-pattern landing; lead the top-left with the highest-signal summary.
- **States:** empty (new clinic, no data) is important — design a real first-run state, not a blank grid.

### 6.2 People & Roles  — restage + extend
- **Exists:** `/admin` (`src/pages/admin.tsx`, tabbed) + `/admin/shifts` (`AdminShiftsPage`).
- **Design:** users table (role, status, last-seen) with a detail drawer; shift roster view. Role editing is **admin-write**; lead sees the roster read-only.
- **Note:** roles shown are the DB roles (`admin · vet · senior_technician · technician · student`). Do not surface the client-only alias roles.

### 6.3 Equipment Governance  — restage + net-new
- **Exists:** `/admin/asset-types` (`AdminAssetTypesPage`), `/admin/docks` (`AdminDocksPage`).
- **Net-new UI:** readiness rules, folders/organization. Backend: existing equipment/asset-type/dock services.
- **Design:** config tables + rule editor drawer. Treat asset-types & docks as the two anchor tables; readiness rules as a governed list.

### 6.4 Inventory & Procurement  — restage + net-new
- **Exists:** `/procurement` → `src/pages/procurement.tsx`.
- **Net-new UI:** the **restock** flow console (`server/routes/restock.ts` exists; weak/no desktop UI).
- **Design:** purchase-orders + restock-session tables with a stepper drawer for a restock session. Density-first.

### 6.5 Integrations & Webhooks  — net-new
- **Backend:** `server/routes/integrations.ts`, `webhooks.ts` (present, minimal UI).
- **Design:** integration-config list (per-PMS), connection status, sync log, conflict view; webhook endpoints + delivery log.
- **Security note for the designer:** **secrets never display** — show masked/last-4 only, never round-trip a secret to the screen. Design an "edit credential" affordance that writes but never reveals.

### 6.6 Notifications  — net-new
- **Backend:** `server/routes/whatsapp.ts`, `push.ts`.
- **Design:** channel config (WhatsApp / push), template/subscription management, send-test affordance, delivery status. Same secret-masking rule as 6.5.

### 6.7 RFID Readers  — net-new
- **Backend:** `server/routes/rfid.ts`.
- **Design:** reader registry (name, location, last-seen/heartbeat), pairing/health. A device-fleet table with per-device drawer.

### 6.8 Ops Health  — net-new (read-only over frozen telemetry)
- **Backend:** `server/routes/admin-outbox-dlq.ts`, `admin-outbox-health.ts`; plus existing display heartbeats and the `/admin/metrics` (`OperationalMetricsDashboardPage`) surface to restage.
- **Design:** outbox DLQ + health, queue health, **display heartbeats** (the future Displays console — Phase 9 — will extend this), operational metrics. **Read-only dashboards over bounded-enum telemetry** — no new transport, no free-form filters that imply new telemetry. Bento/table hybrid; status-pill tokens from §2.6.
- **This is where the frozen-surface discipline matters most:** design views that consume what the endpoints already emit.

### 6.9 Analytics & Reports  — restage (Stage 7)
- **Exists:** `/analytics` (`src/pages/analytics.tsx`), `/analytics/shift-leaderboard`, `/analytics/outcome-kpi`.
- **Design:** restage `Stage 7 - Analytics & Management.dc.html` to console density — data-viz as part of the design system (tokens, not default chart colors), export/report affordances. Charts read existing aggregates only.

### 6.10 Audit  — restage (Stage 8)
- **Exists:** `/audit-log` (`src/pages/audit-log.tsx`, `WebOnlyGuard`-fenced).
- **Design:** restage `Stage 8 - Admin & Governance.dc.html` — append-only audit table with filter/detail drawer. The `AuditActionType` union is closed; design filters over the **existing** kinds only.

---

## 7. Deliverables requested (per module)

For **each** of the 10 modules:
1. **Default screen** — admin (full) view, RTL/Hebrew primary.
2. **Read-only screen** — lead view (same data, no write affordances).
3. **Empty state**, **loading state** (skeleton), **error state**.
4. **RTL spot-check** note on the default screen (logical layout, mirrored icons where directional, non-mirrored functional controls).

Return as `.dc.html` into `docs/design-handoff/` (same convention as the existing Stage files). Phase 6 pre-builds the headless structure while these are out; Phase 7 skins each returned design as an independently shippable slice — so **module independence matters**: each module should stand alone, not depend on another's design landing first.

## 8. What NOT to do (Phase 1 playbook "Do NOT")

- Do **not** brief mobile-card layouts for a desktop console (density/tables/drawers instead).
- Do **not** exceed ~7 competing top-level nav entries.
- Do **not** propose renames of frozen surfaces, new realtime transport, new telemetry fields, or new audit kinds.
- Do **not** write or imply code — this is a design brief.
- Do **not** introduce a new palette or type system — extend the existing clinical/indigo tokens.
