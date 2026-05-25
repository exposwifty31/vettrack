# Champion Friction Log

**Purpose:** Capture repeated workflow friction **before** assumptions are made. Champions act as structured field sensors inside **one hospital** — not a support ticket system.

**Output consumer:** Weekly `docs/champion-pattern-review.md` sessions → product, implementation, and training owners.

**Companion:** `docs/champion-daily-operations.md`, `docs/champion-floor-guidance.md`

**Do not modify:** Other `docs/champion-*.md` files.

---

## Scope legend

| Label | Meaning |
|-------|---------|
| **Pilot-validated** | Equipment pilot scope: discovery, scans, checkout, return, return-with-charge, tracking, lifecycle visibility, equipment-related notifications, offline equipment queue. |
| **Platform capability — not pilot validated** | Exists in product; **not** proven in equipment pilot. Log if observed, but do not score as pilot success/failure. |
| **Needs confirmation** | Unclear from repo or clinic contract — flag for review. |

**Do not imply** the pilot validated admissions, medication, ER, Code Blue, billing, inventory reconciliation, integrations, or reporting.

---

## Rules of logging

1. **Record exact user language** whenever possible (quote in their words).
2. **Record facts before interpretation** — what you saw on screen, count, time, role; then your hypothesis.
3. **Avoid diagnosing immediately** — use **Suspected category** tentatively; change after review.
4. **One row per incident** — if the same root cause repeats, add new rows with dates (frequency matters).
5. **Tag scope correctly** — wrong tag pollutes product prioritization.
6. **Product issue?** = Yes only when behavior diverges from repository-confirmed expected behavior or agreed SOP; No for pure training/SOP gaps unless UX forces the workaround.
7. **No patient identifiers** in log — use department, role, equipment type, or bay (**Needs confirmation** if clinic policy allows more).

### Suspected category (pick one primary)

| Category | When to use |
|----------|-------------|
| **Training issue** | Staff lack SOP or one-time coach fixes it |
| **UX issue** | SOP is clear but UI hides, confuses, or extra steps block success |
| **Bug** | Broken behavior vs documented/repo-confirmed expectation |
| **Workflow mismatch** | Hospital SOP fights product flow (not necessarily wrong product) |
| **Missing feature** | Legitimate need not in product today — do not invent capability |
| **Unknown** | Not enough data — default until weekly review |

---

## Severity definitions

| Level | Definition | Example (equipment pilot) |
|-------|------------|---------------------------|
| **Low** | Annoyance; workaround exists; no custody/safety impact | Wording confusion on staleness badge |
| **Medium** | Repeated extra time; risk of wrong record if not caught | Pending sync fear → duplicate scans |
| **High** | Wrong custody state, unresolved same shift, multiple staff blocked | Mass failed sync on checkout |
| **Critical** | Patient safety narrative, cross-clinic data, or total loss of trust in tracking | **Needs confirmation** — escalate immediately; often **Platform** if clinical modules cited |

**Pilot note:** Critical should be rare in **equipment-only** phase; if clinical modules involved, tag **Platform capability — not pilot validated** and escalate per hospital protocol.

---

## Friction log table (copy per row)

| Field | What to write |
|-------|----------------|
| **Date** | YYYY-MM-DD (shift if helpful) |
| **Department** | ICU, ER, surgery, etc. |
| **Workflow** | Short name: checkout, return, scan, radar, alerts, offline sync, pilot coverage |
| **Pilot-validated or Platform capability** | Exact label from legend |
| **Situation** | Neutral 1–2 sentences — context only |
| **Exact user quote** | Verbatim or “paraphrase — not verbatim” |
| **Observed behavior** | What happened in app (pending, 409, missing item, redirect…) |
| **Expected behavior** | Per training/SOP or repo-confirmed behavior |
| **Suspected category** | Training / UX / Bug / Workflow mismatch / Missing feature / Unknown |
| **Champion action taken** | Coach, refresh, admin, escalate, none yet |
| **Product issue?** | Yes / No / Needs confirmation |
| **Severity** | Low / Medium / High / Critical |
| **Follow-up** | Owner, date, status (open/closed) |

### Blank row template

| Date | Department | Workflow | Pilot-validated or Platform capability | Situation | Exact user quote | Observed behavior | Expected behavior | Suspected category | Champion action taken | Product issue? | Severity | Follow-up |
|------|------------|----------|----------------------------------------|-------------|------------------|-------------------|-------------------|--------------------|-----------------------|----------------|----------|-----------|
| | | | | | | | | | | | | |

---

## Example entries (equipment pilot only)

Repository-confirmed behaviors referenced; no invented features.

---

### Example 1 — Duplicate scan confusion

| Field | Entry |
|-------|-------|
| Date | 2026-05-20 |
| Department | ICU |
| Workflow | Scan (append-only log) |
| Scope | **Pilot-validated** |
| Situation | Tech scanned same pump twice during shift worried about discipline. |
| Exact user quote | “I scanned twice — am I in trouble?” |
| Observed behavior | Two OK scan rows in history; single checkout on My equipment. |
| Expected behavior | Scans append; custody = checkout/return, not scan count. |
| Suspected category | Training issue |
| Champion action taken | 5-min huddle: scan vs checkout/return |
| Product issue? | No |
| Severity | Low |
| Follow-up | Closed — watch repeat |

---

### Example 2 — Unable to find equipment

| Field | Entry |
|-------|-------|
| Date | 2026-05-21 |
| Department | Surgery |
| Workflow | Discovery / checkout state |
| Scope | **Pilot-validated** |
| Situation | Item not in room list during case. |
| Exact user quote | “I can’t find the infusion pump in the app.” |
| Observed behavior | List showed available; My equipment showed another user checked out since 08:00. |
| Expected behavior | Available = not held; checkout holder visible after refresh online. |
| Suspected category | Training issue |
| Champion action taken | Showed My equipment + holder message to request return |
| Product issue? | No |
| Severity | Medium |
| Follow-up | Peer return completed — closed |

---

### Example 3 — Checkout uncertainty

| Field | Entry |
|-------|-------|
| Date | 2026-05-22 |
| Department | Ward |
| Workflow | Checkout |
| Scope | **Pilot-validated** |
| Situation | After tap Check out, staff unsure it worked. |
| Exact user quote | “Did it save? I don’t see anything.” |
| Observed behavior | Brief pending cloud; then synced; name on detail and My equipment. |
| Expected behavior | Pending when offline; holder appears after sync. |
| Suspected category | UX issue |
| Champion action taken | Pointed to cloud icon + holder name on detail |
| Product issue? | Needs confirmation — if confirmation toast absent in build |
| Severity | Low |
| Follow-up | Pattern review — if &gt;5 similar, UI candidate |

---

### Example 4 — Offline confusion

| Field | Entry |
|-------|-------|
| Date | 2026-05-23 |
| Department | ER |
| Workflow | Offline equipment queue |
| Scope | **Pilot-validated** |
| Situation | Wi‑Fi drop during return; staff re-tapped Return three times. |
| Exact user quote | “The system didn’t save my return.” |
| Observed behavior | Three pending rows; sync engine dedupes return type to one endpoint per item — **Needs confirmation** if staff saw three pending lines vs one. |
| Expected behavior | Queue pending; auto-retry when online; failed shows in sync queue sheet. |
| Suspected category | Training issue |
| Champion action taken | Airplane-mode drill; open sync queue |
| Product issue? | No unless failed after online |
| Severity | Medium |
| Follow-up | Add to week-1 FAQ |

---

### Example 5 — Return-with-charge misunderstanding

| Field | Entry |
|-------|-------|
| Date | 2026-05-24 |
| Department | ICU |
| Workflow | Return + plug status |
| Scope | **Pilot-validated** (return path); charge alert outcome **Platform capability — not pilot validated** |
| Situation | Staff selected “not plugged in” to finish dialog quickly. |
| Exact user quote | “It keeps nagging me about the charger — I just returned it.” |
| Observed behavior | Return succeeded; later alert or flag — **Needs confirmation** if push fired. |
| Expected behavior | Honest plug answer; unplugged return may schedule charge alert job (server). |
| Suspected category | Workflow mismatch |
| Champion action taken | Explained honesty; not billing lecture during pilot |
| Product issue? | No — unless alert misfires when plugged=true (**Bug**) |
| Severity | Medium |
| Follow-up | Coach charge nurse on dialog purpose |

---

### Example 6 — Wrong scope (do not score as pilot defect)

| Field | Entry |
|-------|-------|
| Date | 2026-05-25 |
| Department | ER |
| Workflow | Medication task |
| Scope | **Platform capability — not pilot validated** |
| Situation | Tech could not complete med task offline. |
| Exact user quote | “Your app won’t save the dose.” |
| Observed behavior | Complete blocked offline — medication not in offline allow registry. |
| Expected behavior | Med complete requires online (repo-confirmed). |
| Suspected category | Training issue (scope) |
| Champion action taken | Clarified pilot = equipment only; med is later phase |
| Product issue? | No |
| Severity | Low (scope education) |
| Follow-up | Implementation — contract alignment |

---

## Quick reference: workflow → scope tag

| Workflow | Tag |
|----------|-----|
| Scan, seen, QR/NFC | **Pilot-validated** |
| Checkout, return, return-with-charge | **Pilot-validated** |
| My equipment, alerts (equipment) | **Pilot-validated** |
| Room radar, verify all, staleness | **Pilot-validated** |
| Sync queue pending/failed/409 | **Pilot-validated** |
| Pilot coverage / never-confirmed | **Pilot-validated** |
| Push notification delivery | **Platform capability — not pilot validated** / **Needs confirmation** on pilot sites |
| Patients, meds, ER, Code Blue, billing, inventory, integrations, reports | **Platform capability — not pilot validated** |

---

## Handoff to weekly review

- Export or copy rows for the review week.
- Do not aggregate “users hate the app” — aggregate **counts of identical quotes or behaviors** (see `docs/champion-pattern-review.md`).
- Critical rows: notify implementation same day before weekly review.

---

## Document control

| Field | Value |
|-------|--------|
| Created | 2026-05-25 |
| System | Not a ticket system — field sensor log |
