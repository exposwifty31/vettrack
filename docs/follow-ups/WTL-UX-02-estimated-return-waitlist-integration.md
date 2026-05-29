# WTL-UX-02 — Estimated Return Time + Equipment Waitlist Integration

**Source:** Program Brain review (directionally approved). **Follow-up** to Phase B waitlist + WTL-UX-01.

**Status:** **Complete** — merged via PR #494 (`dce98fac` on `main`, 2026-05-27).

**Merge order:** WTL-UX-01 merged (#492); WTL-UX-02a + 02b shipped together in #494.

---

## Authority boundaries (frozen)

| Concept | Field / mechanism | Role |
|--------|-------------------|------|
| **Estimated return (advisory)** | `vt_equipment.expected_return_minutes` + `checked_out_at` | Holder reminder; waiter ETA display |
| **Reservation TTL (authoritative for promoted user)** | `vt_equipment_waitlist.reservation_expires_at` | Claim window after promotion only |
| **Waitlist progression** | Return, dock-return, reservation TTL worker | Only triggers that set `notified` / promote next |

**Must NOT:**

- Auto-return, auto-checkout, or change custody from expected return
- Promote waitlist when expected return time elapses
- Notify waiters when holder reminder fires
- Start reservation TTL before promotion
- Add a duplicate “estimated return” field

**Existing implementation (do not redesign):**

- Reminder: `scheduleSmartReturnReminder` → `vt_scheduled_notifications` (`return_reminder`) → `runScheduledNotifications` poll (`server/lib/role-notification-scheduler.ts`)
- Config UI: admin-only `expectedReturnMinutes` on `src/pages/new-equipment.tsx` (`/equipment/new`, `/equipment/:id/edit`)

---

## WTL-UX-02a — Waiter-facing expected return context

### Problem

While another user holds a checked-out device, waiters on the waitlist have no in-app estimate of when it may become available. The data already exists on the equipment record; it is not projected in waitlist UX.

### Scope

**Read-only presentation** on equipment detail (and optionally WaitlistPanel) while:

- `equipment.custodyState === "checked_out"`
- Another user is holder (`checkedOutById !== currentUserId`)
- Viewer is waiting or eligible to join (`WaitlistPanel` visible or same gating)

**Before promotion** only. After promotion, WTL-UX-01 `ReservationBanner` owns post-promote UX (reservation TTL, not expected return).

### Data source (no new backend)

Derive client-side (shared pure helpers):

```text
expectedReturnAt = checkedOutAt + expectedReturnMinutes × 60_000   // when both set
isHolderOverdue  = now >= expectedReturnAt && still checked_out
```

Inputs from existing `GET /api/equipment/:id` (already on detail): `checkedOutAt`, `expectedReturnMinutes`, `checkedOutByEmail`, `custodyState`.

Optional: `GET /api/equipment/:id/waitlist` for `myPosition`, `queueSize` (already fetched on detail).

### UX copy (i18n — new keys under `equipmentWaitlist.holderContext.*` or similar)

| State | Show |
|-------|------|
| In use | “Currently in use” + holder display name/email |
| ETA configured | “Expected return around {time}” (locale-formatted `expectedReturnAt`) |
| Past ETA, still checked out | “Overdue — waiting for return” (advisory badge) |
| No ETA configured | Omit estimate line or neutral “Return time not set for this device” |
| Join / queue | Existing WaitlistPanel (position, join/leave) |

**Do not show** expected-return ETA inside `ReservationBanner` (TTL countdown only).

### Implementation sketch

1. Extend `src/lib/equipment-waitlist-ui.ts` with `computeHolderReturnEstimate(equipment, now?)` returning `{ expectedReturnAt, isOverdue, hasEstimate }`.
2. New presentational component e.g. `HolderReturnContext.tsx` (or section inside `WaitlistPanel`).
3. `equipment-detail.tsx`: render above `WaitlistPanel` when `showWaitlistJoinPanel` OR user on waitlist (`myStatus === "waiting"`).
4. Parity: `locales/en.json`, `locales/he.json`, `src/lib/i18n.ts`, `pnpm i18n:check`.

### Acceptance criteria

- [ ] Waiter sees “Expected return around {time}” when device checked out to someone else and `expectedReturnMinutes` is set
- [ ] Overdue advisory when `now > expectedReturnAt` and still `checked_out`
- [ ] No estimate line when `expectedReturnMinutes` is null/0
- [ ] After promotion (`notified`), holder context hidden; WTL-UX-01 banner visible instead
- [ ] No API/schema changes
- [ ] Unit tests on pure helpers (fixtures: notified + returned vs waiting + checked_out)

### Out of scope (02a)

- Equipment list row badges / `queueSize` on paginated API
- Exposing `return_reminder.sent_at` (“reminder sent at …”)
- RFID, new SSE types, polling

### Tests

- `tests/equipment-waitlist-reservation-banner.test.ts` (extend) or new `equipment-holder-return-estimate.test.ts`
- Playwright: extend `equipment-waitlist-two-browser.spec.ts` — after B joins, before A returns, assert ETA line visible; after promote, assert ETA gone and reservation banner present

### Files (likely)

- `src/lib/equipment-waitlist-ui.ts`
- `src/components/equipment/HolderReturnContext.tsx` (new)
- `src/components/equipment/WaitlistPanel.tsx` and/or `src/pages/equipment-detail.tsx`
- `locales/en.json`, `locales/he.json`, `src/lib/i18n.ts`

---

## WTL-UX-02b — Holder reminder copy when queue exists

### Problem

Holder receives the same generic return push whether or not anyone is waiting. When `queueSize > 0`, copy should reflect team pressure without notifying waiters or changing waitlist state.

### Scope

**Server-only copy branch** in existing reminder processor. No new schedulers, no BullMQ migration.

### Behavior

| Condition | Action |
|-----------|--------|
| `return_reminder` due, holder still checked out | Existing flow |
| `countWaiting(clinicId, equipmentId) === 0` | Existing `push.role.reminderForEquipment` |
| `countWaiting > 0` | New key e.g. `push.role.reminderForEquipmentWithWaitlist`: “Please return {equipmentName}; another team member is waiting.” |

Use existing `countWaiting` from `server/services/equipment-waitlist.service.ts` (or equivalent query inside `processReturnReminderNotification`).

**Unchanged:**

- Who receives push: holder only
- When it fires: `checkedOutAt + expectedReturnMinutes` (via `vt_scheduled_notifications.scheduled_at`)
- Cancel on return: `cancelSmartReturnReminder`

### Acceptance criteria

- [ ] With active waiters, holder push uses stronger copy (both locales)
- [ ] With no waiters, copy unchanged
- [ ] Waiters receive no push from this path
- [ ] No call to `promoteEquipmentWaitlistIfEligible` from reminder processor
- [ ] Integration test: scheduled due reminder + seeded waitlist row → message variant (mock push or payload assert)

### Optional follow-up (same PR or tiny 02b.1)

- Gate holder reminder on `technician_return_reminders_enabled` if product requires settings parity (today `processReturnReminderNotification` may not check this flag — verify before shipping).

### Out of scope (02b)

- Notifying waiters on reminder
- Promoting on overdue
- Changing `scheduleSmartReturnReminder` timing formula

### Tests

- New case in `tests/equipment-waitlist.integration.test.ts` or dedicated `equipment-return-reminder-waitlist.test.ts`
- Assert promotion still only on return/dock-return/TTL sweep (existing tests remain green)

### Files (likely)

- `server/lib/role-notification-scheduler.ts` (`processReturnReminderNotification`, `buildReminderMessage`)
- `locales/en.json`, `locales/he.json` (`push.role.reminderForEquipmentWithWaitlist`)
- `lib/i18n` parity (backend `translate()` uses locale dictionaries)

---

## Relationship to WTL-UX-01

| Slice | When | Primary UI |
|-------|------|------------|
| **WTL-UX-01** | `myStatus === notified` | `ReservationBanner` — reservation TTL + checkout CTA |
| **WTL-UX-02a** | `waiting` / join eligible, device checked out to other | Holder return context — expected return / overdue |
| **WTL-UX-02b** | At expected return time | Holder push copy only |

```text
[Checked out to A] ──waiter joins──► [02a: ETA visible]
        │
        │ expectedReturnMinutes elapses
        ▼
[02b: stronger holder push if queue > 0]   (no promotion)
        │
        │ A returns
        ▼
[01: ReservationBanner for promoted B]     (TTL, not expected return)
```

---

## PR checklist (engineering)

1. WTL-UX-01 merged or rebased first (Phase B + reservation banner).
2. **02a** — frontend-only; `npx tsc --noEmit`, unit + Playwright ETA assertions.
3. **02b** — backend copy; `pnpm test` integration slice, `pnpm i18n:check`.
4. No changes to `EQUIPMENT_WAITLIST_*` event types, promotion service signatures, or TTL constants.

---

## References

- Integration review (planning): conversation / agent doc “Existing Estimated Return Time Integration Review”
- WTL-UX-01: `docs/follow-ups/WTL-UX-01-reservation-banner-after-promote.md`
- Waitlist service: `server/services/equipment-waitlist.service.ts`
- Reminder scheduler: `server/lib/role-notification-scheduler.ts`
- UI helpers: `src/lib/equipment-waitlist-ui.ts`, `src/components/equipment/ReservationBanner.tsx`
