# VetTrack Champion Training Scenarios

**Purpose:** Realistic drills for champions to run on the floor or in sim.  
**Companion:** `docs/champion-onboarding-guide.md`, `docs/champion-playbook.md`  
**Rules:** Repository-confirmed behavior only; no invented features.

**Scope tags**

| Tag | Meaning |
|-----|---------|
| **Pilot-validated** | Appropriate for the equipment-only pilot curriculum. |
| **Platform capability — not pilot validated** | May be demonstrated only after a separate go-live phase — not part of pilot proof. |
| **Needs confirmation** | Verify with product/ops before running. |

---

## How to run a drill

1. State the tag aloud before the scenario.
2. Let staff attempt without coaching for 60–90 seconds.
3. Coach **correct response** only.
4. Debrief using the bullet list — capture clinic-specific gaps in **Needs confirmation** notes.

---

## Scenario 1 — Internet lost during equipment checkout

**Tag:** **Pilot-validated**

### Scenario

A technician checks out a infusion pump. Mid-action, Wi‑Fi drops. They tap Check out again, then panic.

### Expected behavior

- Checkout request is **queued** in the offline sync queue (pending).
- Header **cloud icon** shows pending actions.
- When online, sync engine **retries** FIFO; checkout dedupes to one row per endpoint for checkout type.
- Item may show optimistic “my equipment” locally until sync completes or fails.

### Common mistakes

- Assuming the action is lost.
- Making a paper checkout that never gets reconciled.
- Creating duplicate checkouts for the same item repeatedly while offline (dedup helps, but confusion remains).

### Correct response

1. Stop duplicate taps.
2. Open sync queue from cloud icon; read status **pending** vs **failed**.
3. Restore connectivity; wait for auto-sync or tap sync.
4. Verify **My equipment** matches server after sync.
5. If **failed**, read error; retry or escalate with request id.

### Debrief points

- Equipment offline queue is intentional (**Pilot-validated**).
- Medication and Code Blue do **not** queue the same way (**Platform capability — not pilot validated**).
- Conflict (409) possible if another user edited item version while offline — refresh equipment detail.

---

## Scenario 2 — Device returned without charge (unplugged)

**Tag:** **Pilot-validated** (return path) · charge alert outcome **Platform capability — not pilot validated**

### Scenario

Staff returns a device that must stay plugged in. On the return dialog they select **not plugged in** to finish quickly.

### Expected behavior

- Return completes (or queues if offline).
- When `isPluggedIn=false` on return, system may **enqueue a charge alert job** (BullMQ) per equipment routes — delayed notification pattern exists in codebase.
- Billing ledger charge behavior is separate from pilot validation scope.

### Common mistakes

- Lying on plug status to avoid conversation.
- Assuming return automatically bills correctly without understanding plug workflow.
- Ignoring follow-up alert as “bug.”

### Correct response

1. Train honest plug/charge answers on every return.
2. If alert fires, treat as operational signal — verify physical plug-in.
3. Admin reviews whether item needs `expectedReturnMinutes` configured (**Needs confirmation** per clinic).

### Debrief points

- Pilot validated **tracking** and return honesty, not hospital revenue outcomes.
- Do not claim pilot proved billing accuracy.

---

## Scenario 3 — Concurrent patient admission

**Tag:** **Platform capability — not pilot validated**

### Scenario

Two clinicians admit the same animal within minutes — one from patient list, one from ER intake enrich path.

### Expected behavior

- Patient routes require **technician** floor minimum.
- Admit schema requires `animalId` or `animalName`; hospitalization row is clinic-scoped.
- Duplicate admissions may be blocked by business rules or create conflicting rows — **Needs confirmation** for exact duplicate UI message.

### Common mistakes

- Running this drill during equipment pilot week (scope creep).
- Assuming ER intake and ward admission always dedupe automatically.

### Correct response

1. **Not taught in pilot phase** — escalate to clinical admin.
2. Search active hospitalizations before second admit.
3. Merge/enrich intake per ER SOP (**Needs confirmation** clinic ER adoption).

### Debrief points

- Pilot did not validate admissions.
- Champion defers to product/clinical owner for duplicate-admit policy.

---

## Scenario 4 — Medication administered incorrectly (volume)

**Tag:** **Platform capability — not pilot validated**

### Scenario

Technician completes a medication task with **actual volume** at or above **100 ml** liquid limit (or zero/negative).

### Expected behavior

- `completeMedicationTask` enforces volume rules: liquid completed volume must be **> 0 and < 100 ml** (strict upper bound in services).
- Server returns **4xx** with structured error — not silent save.
- Task completion requires **online** path (not offline queue).

### Common mistakes

- Pilot staff believe med module was validated.
- Retrying blindly without vet review.
- Using student account (med pages redirect/block).

### Correct response

1. Stop; do not override without vet.
2. Vet reviews dose calculation snapshot on task.
3. Create correction flow per hospital policy — **Needs confirmation** if correction task type trained.

### Debrief points

- Only **vet** creates medication tasks (`task-rbac.ts`).
- Pilot champions must not imply med safety was field-proven in equipment pilot.

---

## Scenario 5 — Inventory discrepancy discovered

**Tag:** **Platform capability — not pilot validated**

### Scenario

Cabinet count does not match system after a busy shift. Tech blames VetTrack.

### Expected behavior

- Inventory/dispense/restock routes are **online-required** in offline registry.
- Smart COP may flag **orphan dispense** when enforcement enabled — **Needs confirmation** per clinic mode (`off` / `shadow` / `enforce`).
- Medication complete triggers **async inventory job** — brief lag normal.

### Common mistakes

- Expecting equipment scan to fix cabinet quantity.
- Dispensing without patient/order context when enforce mode on.

### Correct response

1. Separate **equipment location** from **inventory quantity** mentally.
2. Reconcile with restock/dispense audit, not QR scan alone.
3. Escalate orphan/COP banners to vet (**Platform**).

### Debrief points

- Inventory reconciliation was **not** pilot-validated.
- Equipment pilot success ≠ pharmacy accuracy.

---

## Scenario 6 — Emergency Code Blue event

**Tag:** **Platform capability — not pilot validated**

### Scenario

Cardiac arrest; staff opens VetTrack Code Blue while Wi‑Fi is unstable.

### Expected behavior

- Code Blue mutations (`POST` session, `POST` logs, `PATCH` end, `PATCH` presence) are classified as **emergency** — **blocked offline** with loud failure.
- Session end is **server-confirmed** — UI must not show ended until server agrees.
- Ward display and realtime SSE feed active session when online.

### Common mistakes

- Training this during equipment pilot as if validated.
- Staff believing logs will “sync later.”
- Closing browser thinking session ended.

### Correct response

1. **Hospital verbal/alarm protocol** primary.
2. When stable connectivity: start session, log entries, end via app.
3. Watch ward display for team alignment.
4. Never use offline queue for Code Blue.

### Debrief points

- Code Blue availability in pilot **build** ≠ pilot **validation** — curriculum excludes unless separate sign-off.
- Reference onboarding guide §6 for doctrine.

---

## Scenario 7 — Sync conflict scenario (equipment version)

**Tag:** **Pilot-validated**

### Scenario

Two techs edit the same equipment record. Offline tech syncs PATCH after online tech already saved.

### Expected behavior

- Equipment PATCH uses **optimistic locking** (`version` field).
- Stale update returns **409**; sync engine classifies as **conflict**.
- Conflict may surface in conflict store — **Needs confirmation** if persists after browser reload.

### Common mistakes

- Force-saving without refresh.
- Deleting equipment to “fix” conflict.

### Correct response

1. Refresh equipment detail — load latest version.
2. Re-apply only still-needed changes.
3. Discard failed queue item if duplicate of resolved server state.
4. Champion logs pattern if same item repeats.

### Debrief points

- **Pilot-validated** lesson: one source of truth on server.
- Teach refresh, not workaround hacks.

---

## Scenario 8 — User permission issue

**Tag:** Mixed — pending status **Platform capability — not pilot validated**; student equipment **Pilot-validated**

### Scenario A — Pending signup

New hire can open app but every action returns forbidden.

### Expected behavior

- `status === "pending"` → **403** `ACCOUNT_PENDING_APPROVAL`.
- Admin sets status **active** on Users admin page.

### Scenario B — Student on medication page

Student opens `/meds` or `/appointments`.

### Expected behavior

- Frontend redirects student to **equipment** when auth loaded.
- `task-rbac` denies task/med actions for student.

### Common mistakes

- Champion shares admin login.
- Promising med access “next week” without implementation plan.

### Correct response

- A: Admin approval before shift.
- B: Use student only for scan/checkout training (**Pilot-validated**).

### Debrief points

- Role is always from **database**, not JWT claims.
- Map receptionist job to technician/admin — **Needs confirmation** clinic standard.

---

## Scenario 9 — Duplicate scan scenario

**Tag:** **Pilot-validated**

### Scenario

Tech scans the same QR every hour “to be safe,” flooding scan history.

### Expected behavior

- Scan-type offline ops are **append-only** (each scan replays individually).
- Multiple OK scans create multiple scan log rows.
- Pilot staleness badges use last scan time vs `pilot_stale_ms` threshold.

### Common mistakes

- Thinking duplicate scans replace checkout state.
- Using scan instead of return when done with item.

### Correct response

1. Scan when verifying location or status change — not as heartbeat.
2. **Checkout** when taking; **return** when done.
3. Admin reviews scan log tab (admin-only attribution) for abuse coaching.

### Debrief points

- Scans ≠ checkout (**Pilot-validated**).
- Pilot “Confirm here” in pilot UI may differ from full checkout — read `docs/pilot.md` (**Needs confirmation** wording in live build).

---

## Scenario 10 — ER Mode hides the menu

**Tag:** **Platform capability — not pilot validated**

### Scenario

Clinic enables ER Mode during surge. Staff cannot find inventory or tasks.

### Expected behavior

- Non-allowlisted SPA paths return **Concealment 404** behavior.
- Allowlisted includes `/er`, auth, `/realtime`, `/push`, and selected APIs (`shared/er-mode-access.ts`).
- Navigation collapses to ER Command Center set.

### Common mistakes

- Bookmarking full-platform URLs during ER Mode.
- Thinking app is broken.

### Correct response

1. Use `/er` workflows only while flag on.
2. Ops lead disables ER Mode when surge ends (admin allowlist — **Needs confirmation** who can toggle).
3. Do not run in equipment pilot curriculum unless ER purchased.

### Debrief points

- ER was **not** pilot-validated.
- Equipment scans may still exist in allowlist via containers API — **Needs confirmation** if taught during ER surge.

---

## Scenario 11 — Pilot coverage shame campaign

**Tag:** **Pilot-validated**

### Scenario

Admin publishes “never confirmed” list publicly; morale drops.

### Expected behavior

- `/admin/pilot-coverage` sorts never-confirmed first for **operational** follow-up.
- Scan log staff names visible to **admin only** on equipment logs endpoint.

### Common mistakes

- Public shaming in group chat.
- Confusing never-confirmed with “stolen.”

### Correct response

1. Private coaching: print QR, assign owner, verify room.
2. Celebrate improvement week-over-week.
3. Tune staleness hours if 24h default too harsh.

### Debrief points

- Pilot-validated metric is adoption, not clinical quality.
- Never imply never-confirmed = misconduct.

---

## Scenario 12 — Return with charge while offline

**Tag:** **Pilot-validated**

### Scenario

Tech returns device with plug=false offline; expects immediate charge alert.

### Expected behavior

- Return may sit in **pending** queue.
- Charge alert worker runs when server processes return — requires Redis in production.
- Alert timing not instant if offline delay.

### Common mistakes

- Expecting immediate push while offline.
- Second return attempt creating confusion.

### Correct response

1. Sync first; then verify alert behavior.
2. If no alert after sync, check plug answer and Redis/VAPID config (**Needs confirmation**).

### Debrief points

- Queue-first semantics (**Pilot-validated**).
- Billing/charge outcomes **not** pilot-validated as business KPI.

---

## Scenario index

| # | Title | Tag |
|---|-------|-----|
| 1 | Internet lost during checkout | **Pilot-validated** |
| 2 | Return without charge | **Pilot-validated** / charge **N** |
| 3 | Concurrent admission | **N** |
| 4 | Med volume error | **N** |
| 5 | Inventory discrepancy | **N** |
| 6 | Code Blue | **N** |
| 7 | Sync conflict 409 | **Pilot-validated** |
| 8 | Permission / student | Mixed |
| 9 | Duplicate scan | **Pilot-validated** |
| 10 | ER Mode concealment | **N** |
| 11 | Pilot coverage morale | **Pilot-validated** |
| 12 | Offline return + charge | **Pilot-validated** |

---

## Document control

| Field | Value |
|-------|--------|
| Created | 2026-05-25 |
| Pilot scope | Equipment workflows only — see `docs/pilot.md` |

When adding scenarios, tag every scenario header and never imply pilot validated non-equipment modules.
