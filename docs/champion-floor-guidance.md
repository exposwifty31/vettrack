# Hospital Champion — Floor Guidance

**Use:** Live situations — keep on phone or print behind badge.  
**Scope:** **Pilot-validated** = equipment pilot only · **Platform capability — not pilot validated** = do not cite as pilot-proven.

---

## Quick triage

| Tag | Meaning |
|-----|---------|
| **P** | Pilot-validated (equipment) |
| **N** | Platform capability — not pilot validated |
| **?** | Needs confirmation |

**Escalation:** Yes = involve admin, implementation, or engineering same shift if unresolved in ~15 min (champion coach time).

---

## “I can’t find equipment”

| | |
|--|--|
| **Situation** | Staff expect item on list or in room; it does not appear or shows unavailable. |
| **Likely cause** | Checked out to someone else (**P**); wrong room filter; status inactive/issue; offline stale cache; soft-deleted (admin) (**P**); searching wrong name/alias. |
| **Recommended response** | 1) Go online and refresh list. 2) Check **My equipment** / who has checkout. 3) Open **Room radar** for that bay. 4) Search serial, alias, `usuallyFoundHere` (**P**). 5) Scan QR if label present. 6) If still missing — admin verifies not deleted/inactive. |
| **Escalation needed?** | **No** if found on refresh/checkout trace · **Yes** if missing from admin inventory (data issue) |

**Tag:** **P**

---

## “The system didn’t save”

| | |
|--|--|
| **Situation** | Action seemed to complete; later gone or not on server. |
| **Likely cause** | **Offline queue still pending** (**P**); sync **failed**; user left before sync; looked at wrong item; **N** med/Code Blue attempted offline (blocked, not queued). |
| **Recommended response** | 1) Cloud icon → pending vs failed. 2) Pending → connect Wi‑Fi → sync or wait auto-retry. 3) Failed → read message; retry; discard if duplicate. 4) Confirm on equipment detail after sync. 5) If **N** module — clarify that module requires online; not pilot-validated offline behavior. |
| **Escalation needed?** | **No** for single pending/fail coach · **Yes** if mass failed or 5xx with request id |

**Tag:** **P** (equipment) · **N** if referring to meds/Code Blue

---

## “I scanned twice”

| | |
|--|--|
| **Situation** | Worried about duplicate harm or punishment. |
| **Likely cause** | **Scans are append-only** — each scan is a log row (**P**); not the same as double checkout (checkout dedupes in offline queue). Pilot “Confirm here” may add OK scans without return (**P** — **?** exact label in build). |
| **Recommended response** | 1) Reassure: extra OK scans are logged, not double custody. 2) Teach: **checkout** when taking, **return** when done; scan for verify/status. 3) If two checkouts confusion — check My equipment once. 4) Admin scan log only for coaching, not punishment (**P** attribution). |
| **Escalation needed?** | **No** |

**Tag:** **P**

---

## “Internet stopped working”

| | |
|--|--|
| **Situation** | Ward Wi‑Fi drop; app “offline.” |
| **Likely cause** | Hospital network; device airplane mode; captive portal (**P** equipment still queues). |
| **Recommended response** | 1) **P:** Continue scans/checkout/return — they queue. 2) Show pending count; don’t tap frantically. 3) Paper **exception** only for custody if prolonged outage — reconcile when up. 4) **N:** Do **not** start Code Blue or complete meds — blocked offline. 5) When online, clear failed queue. |
| **Escalation needed?** | **No** for short blip · **Yes** if hospital outage &gt;2h and critical equipment tracking — inform ops lead |

**Tag:** **P** for equipment · **N** for clinical modules

---

## “Why can’t I do this action?”

| | |
|--|--|
| **Situation** | Button missing, 403, or redirect. |
| **Likely cause** | **Role** (student → equipment only, **N** redirect from meds/tasks); **pending/blocked** account (**N**); **ER Mode** concealment — menu hidden (**N**); **pilot mode** hides full platform routes; **vet-only** med create (**N**); **409** version lock on edit (**P**); rate limit on scan/checkout (**P**). |
| **Recommended response** | 1) Ask what they tried. 2) Check role/status with admin. 3) Student on meds → expected redirect (**N**). 4) Pilot week → only equipment actions promised (**P**). 5) 403 pending → admin activates. 6) 409 → refresh item. 7) Capture error **request id** if JSON shown. |
| **Escalation needed?** | **No** for role/pending coach · **Yes** for persistent 403 active user or wrong-clinic data |

**Tag:** Mixed — diagnose before tagging

---

## “It says conflict” / “Someone else updated it”

| | |
|--|--|
| **Situation** | Save or sync fails after edit. |
| **Likely cause** | **409** optimistic version mismatch — two edits or offline stale PATCH (**P**). |
| **Recommended response** | 1) Refresh equipment page. 2) Re-enter only still-needed changes. 3) Discard obsolete queue item if any. 4) Coach: one editor at a time on same asset. |
| **Escalation needed?** | **No** unless same item hits many users → **Yes** (pattern to implementation) |

**Tag:** **P**

---

## “I checked out but it still shows available”

| | |
|--|--|
| **Situation** | List/radar shows available while user believes they have it. |
| **Likely cause** | Pending sync not completed (**P**); wrong item scanned; another user returned; viewing cached list offline. |
| **Recommended response** | 1) Sync queue. 2) Open **My equipment**. 3) Rescan QR to open correct detail. 4) If server agrees checkout — radar updates after refresh. |
| **Escalation needed?** | **No** · **Yes** if server disagrees after successful sync (data bug) |

**Tag:** **P**

---

## “Return won’t go through”

| | |
|--|--|
| **Situation** | Return button errors or spins. |
| **Likely cause** | Offline fail; not checked out to them; validation on plug/charge dialog; **409** (**P**). |
| **Recommended response** | 1) Confirm holder on detail. 2) Complete plug/charge questions honestly (**P** return-with-charge path). 3) Check sync queue. 4) Refresh and retry once. |
| **Escalation needed?** | **No** first pass · **Yes** if repeated with request id |

**Tag:** **P**

---

## “Alerts won’t clear”

| | |
|--|--|
| **Situation** | Bell badge stays high. |
| **Likely cause** | New issues faster than acks; underlying equipment still issue/overdue; cache not refreshed (**P**). |
| **Recommended response** | 1) Open alerts — acknowledge resolved items. 2) Fix root equipment status. 3) Refresh equipment list. |
| **Escalation needed?** | **No** |

**Tag:** **P**

---

## “Push didn’t notify me”

| | |
|--|--|
| **Situation** | Expected phone alert for equipment event. |
| **Likely cause** | Subscription expired; VAPID/Redis not configured; OS notification off; dedupe suppressed duplicate (**N** infrastructure). |
| **Recommended response** | 1) Settings → re-enable push → send test (**N**). 2) In-app alerts bell still works (**P**). 3) Do not claim pilot proved push reliability — **?** per clinic. |
| **Escalation needed?** | **Yes** if clinic depends on push for safety — admin + implementation |

**Tag:** **N** (notification stack) · **P** (in-app alerts)

---

## “Where did the menu go?” / “Page not found”

| | |
|--|--|
| **Situation** | Bookmark or habit URL 404 / empty nav. |
| **Likely cause** | **ER Mode** concealment (**N**); **pilot mode** trimmed nav (**P**); student redirect (**N**). |
| **Recommended response** | 1) Ask if ER Mode on — use `/er` only (**N**). 2) Pilot — use equipment, rooms, alerts, admin (**P**). 3) Don’t promise hidden modules during pilot. |
| **Escalation needed?** | **No** · **Yes** if ER Mode stuck on inappropriately — ops lead |

**Tag:** Mixed

---

## “I need to start Code Blue”

| | |
|--|--|
| **Situation** | Emergency; staff open VetTrack for arrest. |
| **Likely cause** | **N** — Code Blue not pilot-validated; may exist in build but not trained/validated. |
| **Recommended response** | 1) **Hospital emergency protocol first.** 2) If online and clinic has **separate** Code Blue go-live — use trained path (**N**). 3) If offline — app will **block**; do not wait for sync. 4) Champion does not improvise training mid-arrest. |
| **Escalation needed?** | **Yes** — clinical lead; post-event review with implementation if app failed online |

**Tag:** **N**

---

## “I gave the medication in VetTrack” (med task)

| | |
|--|--|
| **Situation** | Dose or completion dispute. |
| **Likely cause** | **N** — medication workflow not pilot-validated; volume limits; vet create only; blocked dose. |
| **Recommended response** | 1) **Do not** coach dose under pilot scope unless med phase live. 2) Escort to vet. 3) If med live: verify online completion, task snapshot, error code. |
| **Escalation needed?** | **Yes** — vet + **N** support path |

**Tag:** **N**

---

## “Patient isn’t on the list”

| | |
|--|--|
| **Situation** | Admit/pending/ER board lookup fails. |
| **Likely cause** | **N** — patients/admissions not in equipment pilot; wrong list; pending assign; integration lag (**N**). |
| **Recommended response** | 1) State pilot is equipment-only. 2) Direct to hospital ADT/PMS. 3) If hospital enabled patients module — admin/admit workflow (**N**), not champion improv. |
| **Escalation needed?** | **Yes** if module contracted live — admin/clinical |

**Tag:** **N**

---

## “Never-confirmed” shame / admin list

| | |
|--|--|
| **Situation** | Staff upset about pilot coverage naming them. |
| **Likely cause** | Admin operational list for QR follow-up (**P**); culture misread as discipline. |
| **Recommended response** | 1) Private coaching. 2) Print QR / verify location. 3) Admin avoids public call-out. |
| **Escalation needed?** | **No** · **Yes** if harassment — HR/clinic lead |

**Tag:** **P**

---

## Champion one-liners (scope-safe)

| Say | Don’t say |
|-----|-----------|
| “Equipment actions queue offline; watch the cloud.” (**P**) | “Everything saves offline.” |
| “Pilot proved tracking; meds are a later phase.” | “We tested the whole hospital in pilot.” |
| “Refresh after a conflict.” (**P**) | “Delete the item.” |
| “Code Blue needs Wi‑Fi and separate training.” (**N**) | “Use Code Blue like checkout.” |

---

## Document control

| Field | Value |
|-------|--------|
| Created | 2026-05-25 |
| Pair with | `docs/champion-daily-operations.md` |
