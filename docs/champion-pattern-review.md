# Champion Pattern Review

**Purpose:** Turn friction logs into **actionable patterns** for training, UX, workflow, engineering, and product — without false conclusions.

**Audience:** Champion lead + clinic admin + implementation/product (weekly, 30–45 min).

**Input:** Rows from `docs/champion-friction-log.md` (one hospital, one week).

**Do not modify:** Other `docs/champion-*.md` files.

---

## Scope reminder

| Label | Use in review |
|-------|----------------|
| **Pilot-validated** | Patterns may drive **equipment pilot** improvements and training. |
| **Platform capability — not pilot validated** | Log separately; **do not** attribute to pilot success/failure. |
| **Needs confirmation** | Investigation bucket before priority score. |

**Never conclude:** “The pilot validated hospital operations.”  
**May conclude:** “Seven technicians in ICU could not find checkout confirmation within 30 seconds.”

---

## Weekly review checklist

Complete each section with **counts** and **one example quote** (not vibes).

### 1. Most common questions (verbatim themes)

- [ ] List top 5 questions staff asked champions (exact wording clusters).
- [ ] Tag each **Pilot-validated** or **Platform capability**.
- [ ] Separate “scope education” (pilot ≠ meds) from product questions.

### 2. Repeated workflow failures

- [ ] Which workflow labels repeat? (checkout, return, offline sync, 409, discovery…)
- [ ] Fail **after** sync vs **during** pending?
- [ ] Only **Pilot-validated** rows count toward pilot health score.

### 3. Repeated user confusion (belief vs fact)

- [ ] Confusion: scan = custody, offline = lost, confirm = checkout, etc.
- [ ] Count staff who needed the same explanation twice+.

### 4. Most escalated issues

- [ ] L0 champion vs L1 admin vs L2 implementation vs L3 engineering.
- [ ] Any **Critical** severity rows?
- [ ] Request ids collected for engineering rows?

### 5. Time-consuming tasks

- [ ] What took &gt;5 min per incident (champion time)?
- [ ] Admin time on never-confirmed / QR reprint?
- [ ] **Needs confirmation:** Target champion minutes per shift.

### 6. Unexpected workarounds

- [ ] Paper shadow sheet, shared login, scan-without-checkout, wrong plug answer.
- [ ] Workaround = signal (workflow mismatch or UX), not laziness by default.

### 7. Training gaps

- [ ] Rows where **Suspected category** = Training and action fixed once.
- [ ] Same training fix repeated → upgrade to UX or workflow candidate.

### 8. Potential product bugs

- [ ] **Product issue? = Yes** rows.
- [ ] Repo-confirmed expected behavior written in log?
- [ ] Repro steps: role, online/offline, workflow.

### 9. Potential UI problems

- [ ] Discovery, confirmation, pending state, conflict message, pilot “Confirm here” vs checkout (**Needs confirmation** label in build).

### 10. Potential feature requests

- [ ] **Missing feature** category — explicit ask, not “make it like paper.”
- [ ] Tag **Platform** if outside equipment pilot — backlog separately.

---

## Pattern identification

Group rows that share:

- Same **workflow** + same **observed behavior** + similar **quote**, or
- Same **Suspected category** across departments.

Name the pattern neutrally:

- **Good:** `pending_sync_visible_delay_after_checkout`
- **Bad:** `app_is_broken`

---

## Pattern scoring

Score each pattern (not each row):

| Dimension | 1 | 2 | 3 | 4 | 5 |
|-----------|---|---|---|---|---|
| **Frequency** | 1 incident | 2–3 | 4–6 | 7–10 | 11+ / multi-dept |
| **Impact** | Low severity only | Mostly low | Mix medium | High | Critical or custody wrong |
| **Urgency** | Can wait month | Next sprint | This week | This shift | Safety / data integrity now |

### Priority score formula

**Priority = Frequency × Impact × Urgency**

| Score range | Guidance |
|-------------|----------|
| 1–20 | Monitor |
| 21–50 | Plan action |
| 51–80 | Prioritize |
| 81–125 | Immediate cross-functional |

**Pilot gate:** Patterns tagged **Platform capability — not pilot validated** do not inflate **pilot exit** criteria — track on a separate backlog sheet.

---

## Review outputs (pick primary)

| Output | Definition | Owner typical |
|--------|------------|---------------|
| **Training action needed** | SOP or drill fixes repeat confusion | Champion + clinic lead |
| **UI improvement candidate** | SOP clear; UI obscures state/confirmation | Product / design |
| **Workflow redesign candidate** | Hospital SOP and product flow conflict | Ops + product |
| **Engineering bug** | Behavior ≠ repo-confirmed expectation | Engineering |
| **Feature request** | Net-new capability; not bug | Product |
| **Needs investigation** | Repro unclear, scope tag wrong, or **Needs confirmation** | Champion + implementation |

One pattern may spawn two outputs (e.g. training now + UI candidate).

---

## Weekly review template (fill-in)

**Hospital:** __________  
**Week ending:** __________  
**Champion:** __________  
**Rows reviewed:** __________ (**Pilot-validated:** __ / **Platform:** __)

### Top patterns (max 5)

| Pattern name | Scope | F × I × U = Priority | Primary output | Owner | Due |
|--------------|-------|----------------------|----------------|-------|-----|
| | | | | | |
| | | | | | |

### Pilot-validated health (equipment only)

| Signal | This week | Trend |
|--------|-----------|-------|
| Failed sync rows (unresolved &gt;24h) | | ↑ ↓ → |
| Unique staff with checkout+return | | |
| Never-confirmed delta (admin) | | |
| Training-only closures % | | |

### Platform backlog (do not mix into pilot sign-off)

| Pattern | Notes |
|---------|-------|
| | |

### Decisions

- [ ] No product change this week
- [ ] Training pack update: __________
- [ ] Escalate to implementation: __________
- [ ] Escalate to engineering (attach request ids): __________

---

## How to avoid false conclusions

### Correlation ≠ cause

| Bad | Good |
|-----|------|
| “Wi‑Fi bad → pilots failed” | “4 of 6 failed returns occurred during documented outage window” |
| “Older staff won’t adopt” | “3 of 4 avoiders had pending accounts first 2 days” |

### Survivorship bias

- Interview quiet adopters **and** resistors.
- Empty friction log may mean champion not observing, not perfect UX.

### Single dramatic incident

- One Critical row does not define pilot — unless reproducible bug.
- Code Blue / med incidents during equipment phase → **Platform** scope education, not pilot defect.

### Confusing build with validation

| Bad | Good |
|-----|------|
| “Code Blue failed in pilot” | “Staff opened Code Blue during equipment week — not in pilot curriculum; offline block per design” |
| “VetTrack doesn’t do billing” | “Billing not in pilot scope; equipment returns may trigger charge **path** — billing outcomes not validated” |

### Label leakage

- Do not let **Platform** rows dominate pilot retrospective slides.
- Re-tag rows miscoded as **Pilot-validated** before scoring.

### Solutioneering in the log

| Bad | Good |
|-----|------|
| “Need AI search” | “5 techs could not find item when checked out — holder not visible on list view” |

### Quotes matter

| Bad | Good |
|-----|------|
| Users hate equipment checkout | 7 technicians asked where checkout confirmation appears after tap |
| Offline doesn’t work | 4 quotes: “didn’t save” — all pending cloud, synced within 3 min |

---

## Example pattern write-ups (equipment pilot)

### Pattern A — Pending sync looks like data loss

| Field | Content |
|-------|---------|
| Rows | 6 (**Pilot-validated**) |
| Quote cluster | “Didn’t save” / “lost my return” |
| Observed | Pending → success within 5 min |
| Expected | Offline queue behavior per sync-engine |
| Scoring | F=4, I=3, U=3 → Priority = 36 |
| Output | Training action + UI improvement candidate (clearer post-tap state) |
| Not | Engineering bug unless failed after online |

### Pattern B — Duplicate scan anxiety

| Field | Content |
|-------|---------|
| Rows | 4 (**Pilot-validated**) |
| Output | Training — reinforce scan vs checkout |
| Product issue? | No |

### Pattern C — Med task offline (out of pilot scope)

| Field | Content |
|-------|---------|
| Rows | 3 (**Platform capability — not pilot validated**) |
| Output | Scope communication to leadership — **not** pilot UI bug |
| Priority | Separate backlog |

---

## Feeding product improvements

### What product needs from you

1. **Neutral pattern title**
2. **Count** + departments
3. **Best verbatim quote**
4. **Observed vs expected** (repo-aligned)
5. **Scope tag**
6. **Repro** (role, online, steps) for bugs
7. **Priority score**
8. **Suggested output type** — not mandated solution

### What product does not need

- Venting paragraphs without counts
- “Everyone knows” claims
- Mixed pilot + platform success metrics
- Feature designs disguised as bugs

### Cadence

| Rhythm | Action |
|--------|--------|
| Daily | Champion logs rows |
| Weekly | This review → top 3 patterns |
| Monthly | Implementation rolls hospital patterns cross-clinic (**Needs confirmation** process) |

---

## Anti-patterns (this is not a ticket system)

| Do not | Do instead |
|--------|------------|
| Open Jira for every row | Batch patterns weekly |
| Assign severity by mood | Use definitions in friction log |
| Close row without follow-up field | Track open/closed |
| Let admin shame lists replace logging | Log culture impact separately |

---

## Document control

| Field | Value |
|-------|--------|
| Created | 2026-05-25 |
| Pair with | `docs/champion-friction-log.md` |
