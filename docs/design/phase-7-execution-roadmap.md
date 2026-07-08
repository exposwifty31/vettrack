<!-- Synthesized by the phase-7-drive workflow (wf_00695720-0d4), 2026-07-08. 6 code-verified slice blueprints + adversarial verify. Corrections in the text reflect the verify pass, not the blueprints' optimistic claims. -->

# Phase 7 — Web Management Console: Execution Roadmap

Synthesized from 6 code-verified slice blueprints + adversarial verdicts. Where the verify pass corrected a blueprint, the corrected reality is what appears below — not the blueprint's optimistic version.

---

## 1. Recommended build order

| Order | Slice | Risk | Ships now? | Rationale (verdict-corrected) |
|-------|-------|------|-----------|-------------------------------|
| 1 | **7f — People & Roles** | low | ✅ ready | Zero net-new server work; reuses complete `api.users.*`/`api.shifts.*` + `t.adminPage.*`. **Correction: drop the Topbar.tsx edit — Topbar renders nav as text labels, no ICON_MAP; only IconSidebar needs the `Users` icon.** Drawer = editable **Role only**, Status as read-only Pill, **no** secondaryRole select (mock shows none) pending owner Q. |
| 2 | **7a — Ops Health** (half) | medium | ✅ ready | All 7 reads registered, observe-only, zero server work. **Correction: lead does NOT see data** — every Ops read is `requireAdmin` and the scaffold gates on `management.webWrite`; lead gets the honest "pending server enablement" state. Fix the lead test expectation accordingly. Retry/drop/replay controls stay **unwired**. |
| 3 | **7e — Audit** (half) | medium | ✅ ready | Existing-surface restage over real data. Category chips = client display grouping over the closed `AuditActionType` union. **Correction: the Audit module has no top-bar "Export" — only the drawer's "Export entry" (owner-gated); "Export"/"Schedule" belong to Analytics.** Omit `Source/IP` + structured diff (no backing). |
| 4 | **7b — Integrations** (module) | medium | ✅ ready | Enriches the existing `IntegrationsConsolePage` against **already-registered** `GET /configs` + `GET /adapters` (blueprint's empty `serverBindings[]` understates this — enumerate them). Card `endpoint` field is a second unbacked source gap (only jsonb metadata) alongside the masked-credential gap. Bind card identity to `adapter.name/id`, never mock vendor strings. |
| 5 | **7d — Inventory & Procurement** | medium | ⚠️ partial | PO tab + cancel client ship immediately; **Restock tab and Low-stock tab are BLOCKED** on two net-new reads (`GET /api/restock/sessions`, low-stock aggregate) → render pending until owner-approved. Fix `RestockSession.status` type (`active`/`finished` → `active`/`completed`/`cancelled`). Cancel is **owner-only** (`assertSessionOwned`) — scope the affordance to the current user's sessions in v1. |
| — | **7a — Management Home** (half) | medium | 🚧 soft-blocked | Data-backed tiles (readiness, ops-summary, activity, exceptions-from-equipment) proceed in parallel; **staffing / inventory-low-stock / connectivity tiles + the `/dashboard` route+gate decision are owner-gated.** |
| 6 | **7c — RFID + Equipment Governance** | high | ⛔ split required | RFID readers (derived read) + governance asset-types/docks restage are buildable now. **Readiness Rules is owner-gated — but the blueprint's "no table exists — Verified" premise is WRONG.** |

**7c central correction (verdict: needs-revision):** a readiness-rules subsystem **already exists** — `vt_equipment_readiness_config` (schema/equipment.ts:399), a live `getReadinessRules()` service consumed by the command board, and shared `EquipmentReadinessRulesV1`. Do **not** author a greenfield `vt_readiness_rules` migration; it would silently duplicate live infrastructure. Reframe the owner question as **extend/supersede the existing per-clinic config blob vs. add a richer per-rule CRUD entity**. Also: the "online ≤ ~12s" reader-status threshold in the blueprint is invented (mock shows online heartbeats up to 45s) — thresholds are product-defined, don't cite a fake cutoff.

**Split 7c into two PRs:** (7c-1) RFID derived-read + governance existing-reads restage — ready after the reconciliation question; (7c-2) readiness-rules — owner-gated on the extend-vs-new-entity decision.

---

## 2. Shared-file coordination

Six load-bearing files are touched by nearly every slice. Serialize them through **one foundation PR first**, then every slice does only additive appends.

### FOUNDATION PR (`feat/phase7-console-foundation`) — land before any slice

1. **`src/lib/relative-time.ts`** (NEW) — generalize the *keyed* formatter from `use-alerts-controller.ts:16`. Note the reality the blueprints understate: that formatter pulls keys from **two** namespaces (`t.alerts.timeAgo.*` + `t.alertsPage.*`), so this is key-plumbing, not a trivial move.
2. **`src/features/alerts/hooks/use-alerts-controller.ts`** — delegate to the shared module, behavior byte-identical, keep back-compat export. **This is a cross-feature touch into `alerts` — every verdict flagged it as beyond-fence; get owner sign-off here, once, and gate it behind its own test so no slice re-does it.**
3. **`src/desktop/management/DataTable.tsx`** — C6 fix: `role="button"` + `tabIndex=0` + `Enter`/`Space` `onKeyDown` when `onRowClick` is set. Shared by 7b/7c/7d/7e/7f — land once.
4. **`src/desktop/management/DetailDrawer.tsx`** (NEW, optional) — the index.ts-deferred RTL drawer primitive. 7b/7c/7e/7f all need a detail drawer; extract it here rather than each building a local `sheet.tsx` variant. If skipped, each slice uses `components/ui/sheet.tsx` directly (7f/7e already plan this).

The `console.*` i18n namespace is a **whole-subtree passthrough** (`console: d.console`, i18n.ts:1048) and `nav: d.nav` (:1046) — so **new plain-string `console.*`/`nav.*` keys need NO `i18n.ts` edit**, only both-locale JSON parity. The only `i18n.ts` hand-wiring required is for **interpolated/parameterized** keys (relative-time functions) — and those already exist as `t.alertsPage.minutesAgo(n)`, so reuse them rather than authoring parameterized `console.*` functions.

### Per-slice append order (serialize merges)

Each slice PR then only appends to shared files — merge in build order (7f → 7a → 7e → 7b → 7d → 7c) so appends never collide:
- **`src/lib/routes/web-management-nav-model.ts`** — one node appended per slice (nav.people, managementHome?, analytics, auditLog, integrations already present, inventory, equipmentGovernance). Tests use `WEB_MANAGEMENT_NAV.length` dynamically → stay green; each slice adds one positive presence assertion.
- **`src/components/layout/IconSidebar.tsx`** — append icon import + `ICON_MAP` entry (unmapped icon ⇒ node silently dropped). **Only IconSidebar — not Topbar.**
- **`locales/{he,en}.json`** — append `console.<module>.*`; parity enforced (`pnpm i18n:check`), regenerate `i18n.generated.d.ts`.
- **`src/lib/api.ts`** — additive client fns only, and only where an owner-approved read lands (7d cancel client is safe now; 7d/7c list reads gated).
- **`src/app/routes.tsx`** — one additive `<Route>` per slice under `AuthGuard>WebOnlyGuard>ManagementGuard`.

---

## 3. Consolidated owner questions

### 🔴 BLOCKERS (must resolve before that slice's gated half is buildable)

| # | Question | Slice(s) |
|---|----------|----------|
| B1 | **Readiness Rules data model:** the existing `vt_equipment_readiness_config` + `getReadinessRules()` (per-clinic blob: `{version, staleEvidenceMs, minimumReadyByType}`) already ships. **Extend/supersede it, or add a richer per-rule CRUD entity** (name / appliesTo / windowHours / graceHours / severity / owner / status)? A new parallel table duplicates live infra. | 7c |
| B2 | **`/dashboard` route + gate:** restage `/dashboard` in place (add `ManagementGuard` + nav node — it's currently `AuthGuard+WebOnlyGuard` only, in NO nav) **or** mint a new console-home route and leave `/dashboard` as the equipment ops dashboard? | 7a |
| B3 | **`GET /api/restock/sessions`** does not exist — approve a read-only list (no schema change)? Without it the Restock tab renders pending. | 7d |
| B4 | **Low-stock aggregate** (`GET /api/inventory-items/low-stock` or add `onHand` to the list handler) — approve? Without it the Low-stock tab + count can't render (par exists, on-hand doesn't). | 7d |
| B5 | **Analytics ≠ available data:** ~6 of ~8 Analytics surfaces (avg-readiness/utilization/on-time KPIs + deltas, %-ready trend, per-room utilization, saved/scheduled reports, range presets, export) have **no server field.** Approve the v1 real-data subset (`totalEquipment` + compliance-rate KPIs, scans/day trend, `statusBreakdown` outcome-mix) or fund aggregates? | 7e |

### 🟡 Clarifying (pick a default; each has a recommended v1)

| Slice | Question | Recommended v1 |
|-------|----------|----------------|
| 7a/7b/7e | **Lead read-only reads** are all `requireAdmin` → lead sees "pending server enablement", not the design's read-only view. Relax reads to `management.web` **as a shadow-first evaluator** (security review for audit content), or keep pending? | Keep pending (server-edit-free) |
| 7a | Home "Team on shift" — no clinic-wide staffing read exists (deferred "Ops staffing coverage"). Build a read or render pending? | Pending placeholder |
| 7a | Home "Connectivity" tile reaching 7b-owned `api.integrations.adapters()` from 7a — acceptable cross-slice reach? | Defer to 7b |
| 7a/7e | Ops "Operational metrics" 12-bar sparkline + p95 latency — no time-series/p95 read. Drop for v1? | Drop sparkline; KPIs from outbox-health+queue |
| 7b | Integration masked-credential display (`•••• 3f9c`) — no server source. Show `configured/not-configured` boolean, `adapter.requiredCredentials` field-names, or a net-new masked-last-4 read? | boolean + field-names |
| 7b | Webhooks/Notifications — keep `PendingConsolePage`, or approve net-new inbound-event-log / whatsapp-log(masked) / push-roster reads? Templates tab = governed net-new entity → **defer regardless.** | Keep pending; approve reads case-by-case |
| 7c | RFID reader registry — derivation-only v1 (rooms.gatewayCode + rfid-reads aggregate; drop firmware/uptime/pairing + all mutations), or fund `vt_rfid_readers` + control endpoints? | Derivation-only, read-only |
| 7c | Governance Docks/Asset-types unbacked columns (dock Status/Last-sync/Readers-count; asset-type Category) — drop rather than add schema? | Drop |
| 7d | Restock "Deactivate/cancel" — expose only on **current-user-owned** sessions (honest to `assertSessionOwned`), or relax ownership for admin-cancel-any? | Owner-scoped, no server change |
| 7d | Should console restock-cancel be audited? Needs a new `restock_session_cancelled` kind appended to the closed union + a `logAudit` call (none today). | Optional; skip unless 7e needs it |
| 7d/7e/7f | Design status vocabularies are **fiction** — map to real enums (restock `active/completed/cancelled` — drop the 3-step stepper; PO `draft/ordered/partial/received/cancelled`). Confirm. | Map to real, drop stepper |
| 7f | "Status" column — mock conflates roster presence with account status; real `user.status` = `pending/active/blocked`. Show account status (map `invited`→`pending`)? | Account status |
| 7f | Surface `secondaryRole` in the drawer (real + mutable but **absent from the mock**)? | Follow mock: omit |
| 7f | Shifts tab — restage existing `admin-shifts.tsx` CSV import/history (backed) or build the mock's unbacked weekly roster grid? | CSV import/history |

---

## 4. Net-new server work needing owner sign-off (nothing written before approval)

All items below carry `needsOwnerReview: true`. **No new table, migration, route, or audit-kind is authored until signed off.**

| Slice | Kind | Item | Justification / caveat |
|-------|------|------|------------------------|
| 7c | **table/migration** | ⚠️ Readiness-rules store | **Do NOT greenfield `vt_readiness_rules`.** `vt_equipment_readiness_config` + `getReadinessRules()` + `EquipmentReadinessRulesV1` already exist. Reconcile first (B1). If a richer entity is justified: `id, clinicId (filter every query), name, appliesTo (asset-type join vs array), windowHours, graceHours, severityWhenOverdue {issue\|stale\|maint}, ownerId→vt_users, status {active\|paused}, timestamps`; overdue = computed-live vs stored-and-swept (owner call). |
| 7c | **audit-kind** | `readiness_rule_created/updated/status_changed/deleted` | Append-only to the closed `AuditActionType` union. `equipment_readiness_state_changed` is a per-unit STATE kind, not rule governance — verified. Only if B1 chooses a governed CRUD entity. |
| 7c | **route** | `GET/POST/PATCH/DELETE /api/readiness-rules` | Blocked on B1. `requireAuth` read (lead-readable), `requireAdmin` write. |
| 7c | **read** | `GET /api/rfid/readers` (derived) | rooms.gatewayCode LEFT JOIN `vt_equipment_rfid_reads` aggregate. **Register as a SEPARATE router — never fold into the frozen raw-body/HMAC ingest `rfid.ts` (index.ts:260).** |
| 7d | **read** | `GET /api/restock/sessions` | No list endpoint (`restock.ts` is POST-only). Read-only, no schema change (`vt_restock_sessions` exists). Guard `technician`. Blocks Restock tab. |
| 7d | **read** | `GET /api/inventory-items/low-stock` | par vs on-hand(Σ container_items) vs short. Read-only aggregate. Blocks Low-stock tab + count. |
| 7d | **audit-kind** | `restock_session_cancelled` (optional) | `cancelSession` emits no audit today; only needed if console cancel must be auditable / visible in 7e. |
| 7b | **reads** | webhooks inbound-event-log, whatsapp-log (server-masked phone), push-roster (masked endpoint) | Reuse existing tables (`vt_integration_webhook_events`, `vt_whatsapp_alerts`, `vt_push_subscriptions`) — no new tables. Server-side PII masking mandatory. |
| 7b | **auth-gate** | `GET /api/integrations/*` `requireAdmin` → `requireEffectiveRole` (read) | Ship as an `off\|shadow\|enforce` evaluator in **shadow first** — never a raw gate removal. |
| 7b | **entity (DEFER)** | Notification templates | Governed net-new entity, no `vt_` table — defer out of Phase 7 like 7c readiness rules. |
| 7e | **aggregates** | analytics avg-readiness/utilization/on-time + %-ready trend + per-room utilization; range param | Extend `/api/analytics` additively (clinicId-scoped, cache-aware) — do not invent silently. v1 recommendation: relabel trend to scans/day, KPIs from real compliance rates. |
| 7e | **subsystem (DEFER)** | Saved/scheduled reports + server export | New table + route + `report_*` audit kinds. v1: drop or client-side CSV of on-screen data. |
| 7a | **reads** | clinic-wide on-shift staffing count; inventory low-stock (shares 7d B4); ops metrics time-series/p95 | All three flagged; recommend omit/pending for v1 rather than server work. |
| 7f | **schema/reads** | `users.lastActiveAt` column; weekly-roster aggregation; user/shift read-relax for lead | All recommended-against; substitute `createdAt` "Member since", restage CSV, keep lead pending. |

**Frozen surfaces untouched across all slices:** SSE/outbox/`outbox-head` reads-only (never mutate, no parallel realtime path); SW emergency cache-denylist; `__VT_BUILD_TAG__`; observe-only Ops Health (retryAll/drop/queue-replay stay **unwired**); every new read filters `clinicId`; `AuditActionType` extended append-only only.

---

## 5. Cross-cutting concerns

### Round-2 audit blockers — shared checklist (every slice, every clickable surface)

- **C6 (WCAG 2.1.1) keyboard rows** — `DataTable` `onRowClick` `<tr>` has `onClick` only, no `role`/`tabIndex`/`onKeyDown`. **Fixed once in the foundation PR;** every slice's row/drawer-opener inherits it. Each slice adds an Enter/Space activation test.
- **M1r RTL numerals** — wrap Hebrew-or-numeric spans (DLQ age, counts, latency, cursor ids, dates, heartbeats, phone/device tokens) in `dir="auto"` (via `<Bdi>`), **never `dir="ltr"`.** Reserve `dir="ltr"` for pure-Latin tokens (endpoints, firmware, HTTP codes, secret hashes). Hebrew-default/RTL; zero Hebrew literals in `.ts/.tsx` (enforced by `tests/i18n-no-hebrew-in-source`).

### Purple `--status-stale` readiness palette

- Shipped token: `var(--status-stale)` / `-bg` / `-fg` / `-border` — light `279 68% 60%` (fg `#6b21a8`), dark `279 70% 70%` (decided 2026-07-08, index.css:94/182/277). **Bind to the token; never hardcode the mock's `#AF52DE`/`rgb(175 82 222)` or the stale `282 68% 60%`/`#7d3ec9` from `DESIGN_SYNC_FLAGS §A3` — that flag is outdated; do NOT re-open it.**
- **7d low-stock is NOT stale-custody (audit C7)** — bind low-stock dots to **`var(--status-maint-*)` (amber)**, not purple.
- **7f student role dot** is a role-identity color, not the stale status token — bind to the code `RoleBadge` scheme, not the mock literal.

### Scan-without-shift scope-add routing

"Admins can scan without an active shift" (program-plan §247) is **NOT a Phase-7 console slice.** It lives in `resolveAuthority()` / the scan handler as an `off\|shadow\|enforce` evaluator change shipped **shadow-first.** Explicitly out of 7f; route to a later authority phase.

---

## 6. Per-slice PR / gate plan

| Slice | Branch | Fence (in-scope files) | Gate (III.8) | Status |
|-------|--------|------------------------|--------------|--------|
| **Foundation** | `feat/phase7-console-foundation` | `src/lib/relative-time.ts` (new) + alerts-hook delegation + `DataTable` C6 + optional `DetailDrawer` | typecheck + `tests/relative-time.test.ts` + alerts-hook unchanged-behavior + `DataTable` keyboard test | **Ready now** — needs owner OK on the alerts-hook cross-feature touch |
| **7f People** | `feat/phase7-people-roles` | `src/pages/console/People*`, +route/nav/icon(sidebar only)/`console.people.*` | console-people guard/persona test + i18n parity + nav-model test + Playwright desktop smoke | **Ready now** — drop Topbar edit; drawer = Role-only |
| **7a Ops Health** | `feat/phase7-ops-health` | `OpsHealthConsolePage.tsx` (skin scaffold) + `console.opsHealth.*` | 4-render-states/observe-only (no retry/drop/replay in DOM) + ReadOnlyChip + **lead-sees-pending** test | **Ready now** — observe-only, zero server work |
| **7a Mgmt Home** | `feat/phase7-mgmt-home` | Home page (restage or new) + tiles + `console.home.*` | data-backed tiles tolerant-render + keyboard rows; guard/nav test if node added | **Soft-blocked** on B2; data-backed tiles parallel |
| **7e Audit** | `feat/phase7-audit` | `audit-log.tsx` reskin + `console.audit.*` | category-chips-map-real-kinds + append-only footer + generic metadata render + no-invented-kinds | **Ready now** (real-data) |
| **7e Analytics** | `feat/phase7-analytics` | `analytics.tsx` reskin + `console.analytics.*` + `stage-7` token test update | no-hardcoded-palette/binds `var(--status-stale)` + real-fields-only + leaderboard test | **Blocked** on B5 (v1 real-data subset) |
| **7b Integrations** | `feat/phase7-integrations` | `IntegrationsConsolePage.tsx` enrich + `IntegrationCard`/`CredentialDrawer` + `console.integrations.*` | cards from adapters+configs, masked/raw secret NEVER in DOM, admin-vs-lead, 4 states | **Ready now** — bind to `/configs`+`/adapters` |
| **7b Webhooks/Notif** | `feat/phase7-notifications` | `Webhooks/NotificationsConsolePage.tsx` | pending or clinicId-scope + PII-mask tests if reads approved | **Blocked** on owner reads decision |
| **7d Inventory** | `feat/phase7-inventory` | `src/pages/console/Inventory*` + `api.restock.cancel` + `inventory.ts` type fix + `console.inventory.*` | persona (lead lock-note), C6, cancel-only-on-owned, RestockSession.status type test | **Partial** — PO tab + cancel now; Restock/Low-stock pending B3/B4 |
| **7c-1 RFID + gov reads** | `feat/phase7-rfid-governance` | `RfidReadersConsolePage.tsx` skin + `EquipmentGovernanceConsolePage.tsx` (asset-types/docks) + separate `rfid-readers` router | reader-status thresholds + clinicId scope + tab persona gating + C6 | **Ready after** reader-derivation + drop-unbacked-columns confirm |
| **7c-2 Readiness rules** | `feat/phase7-readiness-rules` | `readiness-rules` route/service/schema/audit + governance rules tab | requireAdmin-write/requireAuth-read + clinicId isolation + audit emission | **Blocked** on B1 (reconcile with existing config store) |
