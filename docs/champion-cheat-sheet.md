# VetTrack Champion Cheat Sheet

*~1 printed page. Scope tags: **P** = Pilot-validated (equipment pilot) · **N** = Platform capability — not pilot validated*

---

## Scope reminder

**Pilot-validated:** equipment discovery, scans, checkout, return, return-with-charge, tracking, lifecycle visibility, related alerts/notifications.  
**Not pilot-validated:** admissions, meds, billing, ER, Code Blue, inventory reconciliation, tasks, integrations, reporting.

---

## Roles (account — all builds)

| Role | Floor | Never |
|------|-------|-------|
| **admin** | Users, config, pilot coverage, equipment delete | Share integration secrets |
| **vet** | **N** meds create, patients, Code Blue UI | **P** primary trainer for scan/checkout |
| **senior_technician** | **N** task assign | Create med tasks |
| **technician** | **P** scan/checkout/return; **N** patients/inventory | Create med tasks |
| **student** | **P** equipment only | **N** Tasks/Meds (redirect) |

Status: **pending** / **blocked** → cannot work until admin activates.

---

## Top workflows

| Workflow | Tag |
|----------|-----|
| Scan QR → detail → OK / issue / maintenance | **P** |
| Checkout → My equipment → Return | **P** |
| Return + plug/charge honesty | **P** |
| Room radar → verify room | **P** |
| Alerts → acknowledge | **P** |
| Offline queue → cloud icon → retry | **P** |
| Admit → med → discharge | **N** |
| Code Blue session | **N** |
| ER Command Center | **N** |

---

## Emergency rules (**N** — not pilot-validated)

- Code Blue mutations **require internet** — not queued offline.
- Session **end** only when **server** confirms — no optimistic “all clear.”
- Ward display = shared truth when deployed.
- If offline: **hospital protocol**, not VetTrack arrest log.

---

## Offline rules (**P** for equipment)

| Works offline (queued) | Does not |
|------------------------|----------|
| Scan, seen, checkout, return, return+charge, equipment CRUD | **N** Code Blue, med complete, dispense, billing |

Pending = saved locally · Failed = fix or discard · **409** = someone else edited — refresh item.

---

## Most common mistakes

1. Treating pilot as full platform (**scope**)  
2. Shared logins (**audit**)  
3. Ignoring cloud icon (**P** sync)  
4. **N** “Code Blue works offline”  
5. **N** tech creating med tasks  
6. Skip checkout “once” (**P**)  
7. Wrong plug answer on return (**P** charge path)  
8. **N** discharge via status instead of discharge action  
9. **N** ER bookmark while ER Mode hides menus  
10. Duplicate open med task same drug/route (**N**)

---

## Top 15 FAQs (short answers)

| # | Q | A | Tag |
|---|---|---|-----|
| 1 | Device missing? | Checked out, inactive, filter, or wrong room — refresh online | **P** |
| 2 | Scan didn’t show? | Offline pending — check cloud | **P** |
| 3 | Sync failed? | Open queue; read error; retry/discard | **P** |
| 4 | Can’t edit item? | Role or 409 version — reload | **P** |
| 5 | Can’t sign in? | Pending/blocked — admin | **N** |
| 6 | Internet down? | **P** equipment queues; **N** no Code Blue/med complete | Mixed |
| 7 | Why no Tasks menu? | Pilot build or student role or ER Mode | Mixed |
| 8 | Who approves users? | Admin | **N** |
| 9 | Student on meds page? | Redirect to equipment — expected | **N** |
| 10 | Push not working? | Re-subscribe; VAPID/Redis — **Needs confirmation** on pilot | **N** |
| 11 | “Confirm here” vs checkout? | Pilot location verify — see `docs/pilot.md` | **P** |
| 12 | Never-confirmed asset? | Admin coverage; print QR; floor campaign | **P** |
| 13 | Two people edited item? | 409 — refresh | **P** |
| 14 | Did pilot prove billing? | **No** — equipment only | Scope |
| 15 | Charge alert after return? | Unplugged return may schedule job | **P** path · **N** validated billing outcome |

---

## Escalation triggers

| Trigger | Escalate |
|---------|----------|
| Sync failed >24h on clinical item | **N** — L2 |
| Any patient harm risk | Clinical lead first |
| 409 mass conflicts | L2 implementation |
| Cross-clinic data seen | L3 engineering immediately |
| Code Blue display/UI mismatch | **N** — L3 |
| Pending users blocking shift | L1 admin |
| Pilot scope dispute | Implementation lead + contract |

**Log:** user, time, action, error **request id** if shown.

---

*Full detail: `docs/champion-onboarding-guide.md` · Drills: `docs/champion-training-scenarios.md` · Execution: `docs/champion-playbook.md`*
