# VetTrack — Flow Verification Matrix (Section D)

**Status:** Planning only — no automated flow tests implemented from this matrix yet.  
**Branch:** `cursor/flow-matrix` → **base:** `staging`  
**Generated:** 2026-05-21  
**Scope:** Map UI routes, role gates, APIs, mutations, realtime/outbox, async side effects, and success/failure states for future Playwright + API verification. **No app or DB changes.**

---

## Legend

| Column | Meaning |
|--------|---------|
| **Flow ID** | Stable identifier for verification specs |
| **UI route** | `src/app/routes.tsx` path(s) |
| **Role floor** | Minimum effective role from `server/middleware/auth.ts` / route guards (`requireEffectiveRole`, `requireClinicalAuthority`, task RBAC) |
| **API** | Express mount under `server/app/routes.ts` |
| **Mutation** | Write that must not be silently dropped offline |
| **Realtime** | `vt_event_outbox` types via `insertRealtimeDomainEvent` or SSE `KEEPALIVE` payload |
| **Side effects** | Audit, BullMQ, billing ledger, `vt_inventory_jobs`, push, shift chat |
| **Success** | Expected HTTP + UI outcome |
| **Failure** | Documented denial / error codes |
| **Verify** | Planned verification — ❌ not started · ⚠️ partial (unit only) · ✅ spec exists |

Role hierarchy (numeric): `admin` 40 · `vet` 30 · `senior_technician` 25 · `technician` 20 · `student` 10.

---

## 1. Auth & account gates

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| AUTH-01 | `/signin` | public | Clerk FAPI (client) | — | — | — | Signed-in session | Clerk / bot protection | ❌ |
| AUTH-02 | `/signup` | public | Clerk + `POST /api/users/sync` | sync user row | — | `vt_users.status=pending` (non-admin email) | Account created | validation / trust | ❌ |
| AUTH-03 | pending state rendered by `AuthGuard` (`/pending` → redirect `/equipment`) | pending | `GET /api/users/me` | — | — | — | Pending screen (`AuthGuard.tsx`) | API 403 `ACCOUNT_PENDING_APPROVAL` on protected routes | ❌ |
| AUTH-04 | any `<AuthGuard>` | blocked | `GET /api/users/me` | — | — | — | Blocked screen | API 403 `ACCOUNT_BLOCKED` | ❌ |
| AUTH-05 | any protected | active | `GET /api/users/me` | — | — | role from DB | App shell | 401 → `/signin`; tenant errors in guard | ⚠️ `auth-gates.spec` API only |
| AUTH-06 | `/admin` (user mgmt) | admin | `PATCH /api/users/:id/status` | PATCH status | — | audit | User activated | 403 non-admin | ❌ |

**Gate contract (`requireAuth`):** `pending` → 403 `ACCOUNT_PENDING_APPROVAL`; `blocked` → 403 `ACCOUNT_BLOCKED`; `deletedAt` → 403 `ACCOUNT_DELETED`. Frontend mirrors via `useAuth` + `AuthGuard` before children render.

---

## 2. Code Blue & emergency

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| CB-01 | `/code-blue` | clinical: vet · senior_technician · technician + `requireClinicalUser` | `POST /api/code-blue/sessions` | **yes** | `CODE_BLUE_STATUS_CHANGED`, `NOTIFICATION_REQUESTED` | tx insert session; push `code_blue_broadcast`; shift chat; audit `code_blue_started`; keepalive cache invalidate | 201 `{ id }` | 409 `ACTIVE_SESSION_EXISTS`; 403 `MANAGER_NOT_CODE_BLUE_ELIGIBLE`; 400 `INVALID_MANAGER`; **offline blocked** | ⚠️ vitest offline block |
| CB-02 | `/code-blue` | same | `POST /api/code-blue/sessions/:id/logs` | **yes** | log outbox event (per insert path) | idempotent log row; drug/shock authority evaluator | 201 / 200 duplicate | 404 `SESSION_NOT_FOUND`; 403 `DRUG_SHOCK_AUTHORITY_REQUIRED`; offline blocked | ❌ |
| CB-03 | `/code-blue` | auth (session end) | `PATCH /api/code-blue/sessions/:id/end` | **yes** | `CODE_BLUE_STATUS_CHANGED` | billing hooks; audit; server-confirmed end (no optimistic UI) | 200 ended | 404; offline blocked | ❌ |
| CB-04 | `/code-blue` | auth | `PATCH /api/code-blue/sessions/:id/presence` | **yes** | — | presence row upsert | 200 | offline blocked | ❌ |
| CB-05 | `/code-blue`, `/display`, ward | auth | `GET /api/code-blue/sessions/active` | no (read) | SSE replay + keepalive `activeCodeBlueSessionId` | — | snapshot JSON | 401 | ⚠️ phase-9 drills SSE |
| CB-06 | `/pending-emergencies` | admin | `GET /api/code-blue/reconciliation` | no | — | — | queue list | 403 | ❌ |
| CB-07 | `/billing/code-blue-reconciliation` | admin | `PATCH /api/code-blue/sessions/:id/reconcile` | **yes** | `SHADOW_ORPHAN_ALERT_RESOLVED` (when applicable) | billing reconcile | 200 | 403; validation | ❌ |
| CB-08 | `/admin/code-blue-history` | admin | `GET /api/code-blue/history` | no | — | — | history | 403 | ❌ |
| CB-09 | `/crash-cart` | auth | `POST /api/crash-cart/*` (checks) | **yes** | — | audit | checklist saved | 403 clinical | ❌ |
| CB-10 | legacy | admin | `POST/PATCH /api/code-blue/events` | **yes** | — | archive table | near-dead path | clinical gate | ❌ |

**Offline doctrine:** `classifyEmergencyEndpoint()` blocks POST sessions, POST logs, PATCH end, PATCH presence — toast + `sessionStorage` buffer (never replayed). Reads (`/sessions/active`, snapshot) allowed.

---

## 3. Equipment scanner & Asset Radar

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| EQ-01 | `/equipment` | student+ | `GET /api/equipment` | no | optional cache | — | list | 401 | ⚠️ `equipment-read.spec` |
| EQ-02 | `/equipment/:id` | student+ | `GET /api/equipment/:id` | no | — | — | detail | 404 | ⚠️ |
| EQ-03 | `/equipment/new`, `/:id/edit` | technician+ | `POST /api/equipment`, `PATCH /api/equipment/:id` | **yes** | outbox (where wired) | audit | 201 / 200 | 403; validation | ❌ |
| EQ-04 | scanner / detail | student+ | `POST /api/equipment/:id/scan` | **yes** | outbox | `vt_scan_logs`; analytics cache | 200 + undo token | rate limit scan | ❌ |
| EQ-05 | scanner | student+ | `POST /api/equipment/scan` (quick) | **yes** | — | redirect resolve | 200 | 404 equipment | ❌ |
| EQ-06 | checkout flow | student+ | `POST /api/equipment/:id/checkout` | **yes** | outbox | scan log; checkout state | checked out | 409 conflict | ❌ |
| EQ-07 | return flow | student+ | `POST /api/equipment/:id/return` | **yes** | outbox | return log; may enqueue billing | returned | validation | ❌ |
| EQ-08 | billing link | student+ | `POST /api/equipment/:id/seen` | **yes** | — | `recordEquipmentSeen` → billing ledger idempotent | 200 | — | ❌ |
| EQ-09 | `/my-equipment` | student+ | `GET /api/equipment/my` | no | — | — | my checkouts | 401 | ❌ |
| EQ-10 | `/rooms`, `/rooms/:id` | auth | `GET /api/rooms`, room verify | **yes** bulk verify | — | scan/transfer logs | radar UI | — | ❌ |
| EQ-11 | revert | vet+ | `POST /api/equipment/:id/revert` | **yes** | — | undo window | reverted | 403 / expired | ❌ |
| EQ-12 | plug check | technician+ | `POST /api/returns` | **yes** | — | BullMQ `charge-alert` if unplugged | return row | 404 equipment | ❌ |
| EQ-13 | admin import | admin | `POST /api/equipment/import` | **yes** | — | bulk insert | CSV result | 403 | ❌ |

**Offline queue (`PendingSyncType`):** `scan`, `checkout`, `return`, `return_with_charge`, `seen`, `create`, `update`, `delete` — via `src/lib/api.ts` + `sync-engine.ts`.

---

## 4. Inventory & dispense

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| INV-01 | `/inventory` | technician+ | `GET /api/containers` | no | — | — | container list | 403 | ❌ |
| INV-02 | `/inventory` | clinical authority | `POST /api/containers/:id/dispense` | **yes** | outbox | billing ledger; orphan evaluator (422 possible) | dispense OK | `ORPHAN_DISPENSE_BLOCKED` enforce; 409 legacy disabled paths | ⚠️ vitest dispense |
| INV-03 | `/inventory` | technician+ | `POST /api/restock/sessions/*` | **yes** | — | restock session qty | session complete | `RestockServiceError` | ❌ |
| INV-04 | `/inventory` | — | `POST /api/containers/:id/restock` | — | — | **disabled** 409 `LEGACY_RESTOCK_DISABLED` | — | 409 | ❌ |
| INV-05 | `/inventory-items` | technician read / admin write | `GET/POST/PATCH /api/inventory-items` | **yes** CRUD | — | audit | item saved | 403 admin-only writes | ❌ |
| INV-06 | dispense API | clinical | `POST /api/dispense/*` | **yes** | — | authority enforcement families | 200 | shadow vs enforce | ⚠️ vitest |
| INV-07 | `/procurement` | auth | `POST /api/procurement/*` | **yes** | — | PO lines audit | PO created | 403 | ❌ |
| INV-08 | `/billing/inventory-jobs` | admin | `GET/POST /api/billing/inventory-jobs` | retry | — | BullMQ inventory-deduction worker | job completed | stale re-enqueue | ❌ |

**Async path:** medication `completeTask` → `vt_inventory_jobs` → worker (brief billing/inventory skew).

---

## 5. Medications

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| MED-01 | `/meds` | vet (task RBAC) | `POST /api/medication-tasks` | **yes** | outbox | calc snapshot v1; duplicate partial unique | 201 task | 400 `DOSE_BLOCKED`, `REASON_REQUIRED`, `INVALID_ROUTE`; 403 create not permitted | ⚠️ vitest calc |
| MED-02 | `/meds` | technician+ | `POST /api/medication-tasks/:id/take` | **yes** | — | ownership | in_progress | 409 `TASK_ALREADY_TAKEN` | ❌ |
| MED-03 | `/meds` | assignee | `POST /api/medication-tasks/:id/complete` | **yes** | — | billing tx + `vt_inventory_jobs` insert | completed | `VOLUME_OUT_OF_RANGE` (&lt;100ml); `NOT_ASSIGNED_USER`; 409 state errors | ⚠️ vitest |
| MED-04 | `/meds` | technician+ | `POST /api/medication-tasks/:id/cancel` | **yes** | — | audit | cancelled | 409 completed | ❌ |
| MED-05 | `/meds` | technician+ | `GET /api/medication-tasks` | no | SSE task invalidation (client) | — | list | 401 | ❌ |
| MED-06 | `/admin/medication-integrity` | admin | `GET /api/admin/medication-integrity` | no | — | — | dashboard | 403 | ❌ |

**Routes:** `IV`, `IM`, `PO`, `SC` only. Liquid volume must be &gt; 0 and &lt; 100 ml (2 dp).

---

## 6. Billing

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| BIL-01 | `/billing` | vet+ effective | `GET /api/billing` | no | — | — | ledger rows | 403 technician | ❌ |
| BIL-02 | `/billing` | vet+ | `GET /api/billing/summary` | no | — | — | aggregates | 403 | ❌ |
| BIL-03 | `/billing/leakage` | vet+ | `GET /api/billing/leakage-report` | no | — | — | report JSON | 403 | ⚠️ vitest leakage |
| BIL-04 | `/billing/leakage` | vet+ | `GET /api/billing/leakage-report.csv` | no | — | — | CSV download | 500 export | ❌ |
| BIL-05 | `/billing` | vet+ | `POST /api/billing/:id/void` (see routes) | **yes** | — | ledger `voided`; idempotent key | voided | 404; 409 | ❌ |
| BIL-06 | `/billing` | vet+ | `PATCH /api/billing/:id/sync` | **yes** | — | status → `synced` | synced | validation | ❌ |
| BIL-07 | shift widget | auth | `GET /api/billing/shift-total` | no | — | shift session scope | total | — | ❌ |

---

## 7. Scheduling (Tasks / appointments)

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| SCH-01 | `/appointments` | technician+ | `GET /api/appointments` | no | SSE | — | task list (UI copy: Tasks) | 403 | ⚠️ scheduling vitest |
| SCH-02 | `/appointments` | technician+ | `POST /api/appointments` | **yes** | outbox | audit | 201 | validation | ❌ |
| SCH-03 | `/appointments` | technician+ | `PATCH /api/appointments/:id` | **yes** | outbox | audit | updated | 404 | ❌ |
| SCH-04 | `/appointments` | technician+ | `DELETE /api/appointments/:id` | **yes** | — | soft/hard per service | deleted | 403 | ❌ |
| SCH-05 | `/shift-handover` | auth | `POST /api/shift-handover` | **yes** | — | audit | handoff saved | — | ❌ |
| SCH-06 | `/shift-chat/:shiftId` | auth | `GET /api/shift-chat/*` | no | — | archive read | transcript | 404 | ❌ |

---

## 8. Ward display

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| DISP-01 | `/board` (`/display`, `/equipment-board` → redirect `/board`) | auth | `GET /api/display/snapshot` | no | SSE + snapshot resync | ward + ER + code blue summary | board render | 401; stale cursor → full resync | ❌ |
| DISP-02 | `/board` (was `/display`) | auth | `POST /api/display/heartbeat` | **yes** | — | kiosk liveness | 200 | — | ❌ |
| DISP-03 | `/code-blue/display` | auth | same snapshot + SSE | no | `KEEPALIVE` stormHint | emergency takeover UI | live session | offline read OK; writes blocked | ❌ |

**Cache denylist (SW):** `/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/*` — never Cache Storage.

---

## 9. SSE realtime transport

| Flow ID | Consumer | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|-----|----------|----------|--------------|---------|---------|--------|
| RT-01 | all clinical tabs | `GET /api/realtime/stream` | no | SSE `id:` cursor, domain events, `KEEPALIVE` ~10s | outbox publisher 750ms poll | connected | 401; prune → `reset_state:last_event_pruned` | ✅ phase-9 drills |
| RT-02 | reconnect | `GET /api/realtime/replay?after=` | no | replay rows | — | gap filled | pruned → resync | ✅ drills |
| RT-03 | tabs | `GET /api/realtime/outbox-head` | no | head cursor | BroadcastChannel gossip | aligned cursor | split-version banner | ⚠️ |
| RT-04 | client | `POST /api/realtime/telemetry` | **yes** (metrics only) | bounded enums | `incrementMetric` | 204 | invalid enum rejected | ✅ vitest + drills |
| RT-05 | cross-tab | BroadcastChannel `vt_realtime_outbox_cursor` | no | cursor / build_tag / `code_blue_seen` | — | gossip | mismatch → `splitVersionClientDetected` | ⚠️ |

**ER parallel transport:** `GET /api/er/stream` (ER mode SSE) — separate from clinic outbox; map in ER verification pass.

---

## 10. Offline / PWA

| Flow ID | Surface | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|---------|-----|----------|----------|--------------|---------|---------|--------|
| PWA-01 | `public/sw.js` | shell assets | no | — | cache `vettrack-<buildTag>` | install/activate | update conflict counter | ⚠️ `pwa.system` |
| PWA-02 | `sync-engine.ts` | queued via `api.ts` | **yes** (non-emergency) | — | Dexie `pendingSync`; retries 5; circuit breaker | drained queue | permanent fail → Sentry | ✅ `offline.test` |
| PWA-03 | equipment offline | equipment endpoints | **yes** | — | optimistic UI optional | sync later | conflict 409 | ❌ UI e2e |
| PWA-04 | Code Blue offline | emergency endpoints | **blocked** | — | local buffer only | loud toast | never queued | ✅ vitest |
| PWA-05 | chunk load | — | no | — | SW purge + reload once | recovery | loop guard | ⚠️ |

---

## 11. Admin surfaces

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| ADM-01 | `/admin` | admin | `GET /api/users` | no | — | — | user list | 403 | ❌ |
| ADM-02 | `/admin` | admin | `PATCH /api/users/:id/role` | **yes** | — | audit; authority cache invalidate | role updated | validation | ❌ |
| ADM-03 | `/admin/shifts` | admin | `/api/shifts` CRUD | **yes** | — | audit | shift saved | 403 | ❌ |
| ADM-04 | `/admin/ops-dashboard` | admin | `/api/metrics`, stability | no | — | — | dashboards | 403 | ❌ |
| ADM-05 | `/admin/ops-dashboard` | admin | `GET /api/admin/outbox-health` | no | — | — | lag stats | 403 | ❌ |
| ADM-06 | `/admin/ops-dashboard` | admin | `GET /api/admin/outbox-dlq` | no | — | — | DLQ rows | 403 | ❌ |
| ADM-07 | `/admin/medication-integrity` | admin | `GET /api/admin/medication-integrity` | no | — | — | integrity view | 403 | ❌ |
| ADM-08 | `/stability` | admin | `/api/stability` | **yes** toggles | — | test mode | flag set | 403 | ❌ |
| ADM-09 | `/audit-log` | auth (read) | `GET /api/audit-logs` | no | — | — | log page | 403 sensitive | ❌ |

---

## 12. ER mode (adjacent clinical transport)

| Flow ID | UI route | Role floor | API | Mutation | Realtime | Side effects | Success | Failure | Verify |
|---------|----------|------------|-----|----------|----------|--------------|---------|---------|--------|
| ER-01 | `/er` | assignable: admin · vet · senior_technician · technician | `GET /api/er/board` | no | ER SSE | — | board | 403 | ⚠️ er vitest |
| ER-02 | `/er` | assignable | `POST /api/er/intake` | **yes** | SSE | escalation timers | intake row | validation | ❌ |
| ER-03 | `/er` | assignable | `PATCH /api/er/intake/:id/assign` | **yes** | `QUEUE_SEVERITY_ESCALATED` (scheduler) | audit | assigned | 403 | ❌ |
| ER-04 | `/er` | assignable | `POST /api/er/handoffs` | **yes** | SLA breach events | `slaBreachedAt` | handoff | 403 | ❌ |
| ER-05 | `/er/impact`, `/er/kpis` | auth | `GET /api/er/impact` | no | — | — | KPIs | — | ❌ |

---

## Route index (`src/app/routes.tsx`)

Public: `/` (RootRoute: signed-out → `/signin`, signed-in → `/home`), `/signin`, `/signup`. Board kiosk: `/board`, `/board/pair` (device-token paired, not Clerk). `/landing` has no route (falls through to the 404 page).  
Gated (`AuthGuard`): all paths in sections above plus `/analytics/*`, `/dashboard`, `/print`, `/help`, `/settings`, `/whats-new`, `/app-tour`, `/alerts`, etc.  
Legacy redirects (no screen): `/pending`, `/pending-emergencies`, `/patients`, `/patients/:id` → `/equipment`; `/display`, `/equipment-board` → `/board`.

---

## Verification backlog (Section D → implementation)

Priority order for **new** Playwright/API flow specs (none required in this PR):

| Priority | Flow IDs | Rationale |
|----------|----------|-----------|
| P0 | CB-01–CB-04 | Emergency mutations + offline block + SSE end confirmation |
| P0 | EQ-04–EQ-08 | Core scanner/checkout/return/seen + offline queue |
| P1 | MED-01–MED-03 | Dose safety + complete → billing/inventory job |
| P1 | INV-02, INV-03 | Dispense authority + restock session |
| P1 | DISP-01, RT-01–RT-02 | Ward snapshot + SSE reconnect |
| P2 | BIL-01, BIL-03 | Ledger read + leakage |
| P2 | SCH-01–SCH-03 | Task CRUD |
| P2 | AUTH-03–AUTH-04 | Pending/blocked gates (UI + API 403) |
| P3 | ADM-01–ADM-02, ER-02–ER-04 | Admin and ER assign/handoff |

**Existing partial coverage:** `tests/e2e/flows/api-health.spec.ts`, `auth-gates.spec.ts`, `equipment-read.spec.ts`; vitest for offline emergency, med calc, billing leakage, phase-9 SSE drills.

---

## Flow coverage summary

| Domain | Flows mapped | API routes traced | Mutation paths | Realtime linked | Automated flow verify |
|--------|--------------|-------------------|----------------|-----------------|------------------------|
| Auth & gates | 6 | ✅ | 1 | — | ⚠️ API only |
| Code Blue | 10 | ✅ | 6 | ✅ | ⚠️ partial |
| Equipment | 13 | ✅ | 9 | ⚠️ | ❌ |
| Inventory | 8 | ✅ | 5 | ⚠️ | ⚠️ unit |
| Medications | 6 | ✅ | 4 | ⚠️ | ⚠️ unit |
| Billing | 7 | ✅ | 2 | — | ⚠️ unit |
| Scheduling | 6 | ✅ | 4 | ⚠️ | ⚠️ unit |
| Ward display | 3 | ✅ | 1 | ✅ | ❌ |
| SSE realtime | 5 | ✅ | 1 | ✅ | ✅ drills |
| Offline/PWA | 5 | ✅ | 3 | — | ⚠️ partial |
| Admin | 9 | ✅ | 3 | — | ❌ |
| ER | 5 | ✅ | 3 | ✅ | ⚠️ unit |

**Totals:** 83 flow rows · ~49 API routers registered · 37+ write mutations identified · 12+ outbox/SSE coupling points documented.

---

## Top missing flows (for verification implementation)

1. **Equipment scan lifecycle E2E** (EQ-04 → EQ-08): NFC/QR scan → checkout → return → optional `seen` billing — no Playwright path; highest daily-use gap.  
2. **Code Blue session E2E** (CB-01 → CB-04): start → log → end with SSE confirmation; offline attempt must show block toast (CB doctrine).  
3. **Medication complete path** (MED-02 → MED-03): take → complete with volume validation and post-hoc inventory job visibility.  
4. **Ward display + SSE resync** (DISP-01 + RT-01): snapshot render after simulated `Last-Event-ID` gap / prune.  
5. **Pending/blocked account UI** (AUTH-03, AUTH-04): full-screen gates vs API 403 on `GET /api/equipment` (denial matrix).  
6. **Container dispense authority** (INV-02): enforce-mode `ORPHAN_DISPENSE_BLOCKED` vs shadow (clinical invariant).  
7. **Inventory restock session** (INV-03): start → scan → finish (replaces legacy 409 endpoints).  
8. **Scheduling task mutation** (SCH-02 → SCH-04): create/patch/delete with SSE cache invalidation.  
9. **Admin user activation** (AUTH-06): pending → active unlocks app shell.  
10. **ER assign + handoff** (ER-02 → ER-04): technician-floor assignable roles (not vet-only).

---

## References

- API registration: `server/app/routes.ts`  
- UI routes: `src/app/routes.tsx`  
- Auth: `server/middleware/auth.ts`, `src/features/auth/components/AuthGuard.tsx`  
- Offline emergency: `src/lib/offline-emergency-block.ts`, `src/lib/offline-db.ts`, `src/lib/sync-engine.ts`  
- Realtime: `server/routes/realtime.ts`, `CLAUDE.md` (Frozen architecture surfaces)  
- Existing e2e stubs: `tests/e2e/flows/`
