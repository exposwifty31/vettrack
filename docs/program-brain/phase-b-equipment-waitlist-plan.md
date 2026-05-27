# Program Brain — Phase B: Equipment Waitlist / Reservation System

**Status:** **Complete** (merged PR #492 to `main`, 2026-05-27)  
**Prerequisite:** Phase A verification passed (operational state, staging, deployability)  
**Last updated:** 2026-05-27 — Program Brain merge acknowledgment; WTL-UX-01 shipped in same PR  

**Follow-ups (deferred):** WTL-UX-02a / 02b — see `docs/follow-ups/WTL-UX-02-estimated-return-waitlist-integration.md` and `docs/program-brain/STATE.md`.

---

## Executive summary

Phase B adds a **separate per-device waitlist** for shared-device orchestration (Lime-style: join queue while another technician holds the device). It does **not** extend `vt_staging_queue` or `usageState=staged`.

Phase B also closes the equipment realtime gap: server already emits `EQUIPMENT_*` outbox events, but clients ignore them and lists poll or rely on mutation invalidation. **The equipment list itself must become SSE-driven** — not only detail/waitlist panels.

---

## Staging vs waitlist (hard boundary)

| Dimension | Dock staging (`vt_staging_queue`) | Equipment waitlist (`vt_equipment_waitlist`) |
|-----------|-----------------------------------|-----------------------------------------------|
| **When** | Device **docked** + ready, not checked out | Device **in use** (`checked_out` / `in_use`) |
| **User intent** | “I’m next for checkout at the dock” | “Notify me when the current holder is done” |
| **Equipment mutation** | May set `usageState = staged` | **Does not** change custody/usage |
| **UI** | `StagingQueuePanel` | `WaitlistPanel` |

---

## Equipment list must become SSE-driven (mandatory end state)

### Problem today

| Surface | Query keys | Live updates |
|---------|------------|--------------|
| Equipment list | `["/api/equipment", "paginated", page, pageSize, filters…]` via `usePaginatedEquipment` | `staleTime: 30_000`, no `refetchInterval`; refresh only on mount/focus/mutation invalidation |
| Layout badge | `["/api/equipment"]`, `["/api/equipment/my"]` | `staleTime` 30–60s |
| Room radar / home | `["/api/equipment"]` | Partial polling elsewhere (e.g. management dashboard 30s) |
| Equipment detail | deployability, staging-queue | **30s polling** on some queries |

Waitlist promotion and custody changes are invisible on the list until the user navigates away, mutates, or waits for stale data to expire. That violates Lime-style expectations for **list-level** availability (badges, “in use”, checkout holder).

### Requirement

When any subscribed client receives equipment-related SSE events (`EQUIPMENT_CUSTODY_STATE_CHANGED`, `EQUIPMENT_USAGE_STATE_CHANGED`, `EQUIPMENT_WAITLIST_*`, dock/readiness events as needed):

1. **Equipment list** (`/equipment`) updates without manual refresh — **target &lt;2s** (outbox publisher ~750ms + invalidation).
2. **Paginated list** invalidates or patches so filtered pages stay consistent (no “ghost available” row).
3. **My equipment**, **room radar**, and **layout** equipment counts stay in sync via the same invalidation helper.
4. **Polling is not the primary mechanism** for list freshness; any remaining `refetchInterval` is a slow safety net only (e.g. 5–10 min), not 30s UX.

### Implementation strategy (phased within Phase B)

**B3 — Realtime foundation (required before B4 UI sign-off)**

- `invalidateEquipmentCaches()` in `src/lib/equipment-realtime.ts` must include:
  - `["/api/equipment"]`
  - `["/api/equipment/my"]`
  - Predicate: `queryKey[0] === "/api/equipment" && queryKey[1] === "paginated"` (all pages/filters)
  - `["/api/rooms"]` when list shows location/room columns (room-radar parity)
- Extend `applyEvent` for all `EQUIPMENT_*` + `EQUIPMENT_WAITLIST_*`.
- Mount `EquipmentRealtimeBridge` in **app layout** (authenticated) so list pages benefit without duplicating SSE connections.

**B3.1 — List-first acceptance (same PR as B3 or fast-follow before pilot flag)**

- Remove or demote list reliance on `staleTime`-only freshness for operational fields.
- Document acceptance test: User A returns device on detail page → User B’s **equipment list** row updates checkout state without refresh.
- Optional v1.1: **targeted `setQueryData`** for paginated cache when payload includes full equipment row (avoid full-list refetch flicker on large pages). Invalidation remains the safe default.

**Eventually (explicit Phase B / early Phase C completion criterion)**

- Equipment list is **SSE-driven by default** for all clinics with waitlist or operational-state enabled.
- CI/Playwright: two-browser drill — list row custody badge changes on peer return (extends manual QA checklist).
- No product requirement to “open detail to see device freed”.

### Events that must refresh the list

| Event | List impact |
|-------|-------------|
| `EQUIPMENT_CUSTODY_STATE_CHANGED` | Checkout holder, returned/docked badges |
| `EQUIPMENT_USAGE_STATE_CHANGED` | In use / staged / available columns |
| `EQUIPMENT_READINESS_STATE_CHANGED` | Deployability indicators on list cards |
| `EQUIPMENT_DOCK_RETURN` | Ready/not ready on list |
| `EQUIPMENT_WAITLIST_JOINED` / `LEFT` | Optional queue-size chip on row (B4+) |
| `EQUIPMENT_WAITLIST_PROMOTED` | Highlight row for notified user |

### Out of scope for “list SSE”

- Replacing paginated API with a full in-memory mirror (keep server pagination).
- WebSockets or second transport.
- Offline list consistency (list may show stale cache offline; waitlist mutations fail loud).

---

## Schema, API, promotion, notifications

(See prior Program Brain review — unchanged core.)

**Table:** `vt_equipment_waitlist` — `waiting | notified | fulfilled | cancelled | expired`, reservation TTL 10 min.

**APIs:**

- `POST /api/equipment/:id/waitlist`
- `DELETE /api/equipment/:id/waitlist`
- `GET /api/equipment/:id/waitlist`
- `POST /api/equipment/:id/waitlist/claim` (v2)

**Promotion hooks:**

- After `POST /api/equipment/:id/return` (custody released)
- After `POST /api/equipment/:equipmentId/dock-return` when deployable
- Reservation TTL worker (60s tick)
- Checkout marks notified row `fulfilled`

**Realtime events:** `EQUIPMENT_WAITLIST_JOINED`, `LEFT`, `PROMOTED`, `AVAILABLE`, `EXPIRED`

**Notifications:** `enqueueNotificationJob` on promote (mirror `staging-promotion.ts`).

---

## PR breakdown (updated)

| PR | Scope | List SSE |
|----|--------|----------|
| **B1** | Schema, service, routes, types | — |
| **B2** | Promotion, hooks, TTL worker, push | — |
| **B3** | Outbox events, `applyEvent`, layout SSE bridge, **`invalidateEquipmentCaches` includes paginated list**, demote polling | **Required:** list invalidates on equipment SSE |
| **B3.1** | List acceptance tests + optional `setQueryData` row patch; remove 30s list-adjacent polling on dashboard where redundant | **Required for “SSE-driven list” sign-off** |
| **B4** | `WaitlistPanel`, i18n, offline loud fail, toasts | UI assumes B3 list sync works |
| **B5** | v2 claim, priority, optimizations | — |

**Merge order:** B1 → B2 → B3 (+ B3.1) → B4. **Do not ship B4 without B3 list invalidation.**

---

## Test requirements (additions)

### Realtime / list

- Unit: `applyEvent` + `EQUIPMENT_CUSTODY_STATE_CHANGED` invalidates paginated query key predicate.
- Integration: emit outbox row → client reducer invalidates `["/api/equipment","paginated",…]`.
- Playwright (or phase-9-style harness): Tab B on `/equipment`; Tab A returns device; Tab B list row updates within 2s without reload.

### Existing waitlist tests

- Join ordering, duplicate prevention, promotion, TTL, return→promote, dock-return→promote, multi-user ordering.

---

## Manual QA checklist (additions)

- [ ] **List:** Two users; B on `/equipment` list; A returns device; B’s list row updates custody/checkout state without refresh.
- [ ] **List + filters:** Same test with status/folder filter active (paginated key still invalidates).
- [ ] **My equipment:** A’s return removes/updates row on B’s `/my-equipment` if applicable.
- [ ] **Reconnect:** After sleep, list matches server without manual refresh.

---

## Pilot vs Phase C

Unchanged recommendation: **full B1–B4 (including SSE-driven list) = Phase C default**; pilot not blocked on waitlist. If a flag-gated slice ships early, **do not enable without B3** — a waitlist UI with a polling-only list fails the product requirement.

---

## Approval checklist (additions)

- [ ] Confirm **equipment list SSE-driven** is Phase B completion criterion (B3 + B3.1).
- [ ] Confirm layout-level `EquipmentRealtimeBridge` (one SSE per clinic, extended reducer only).
- [ ] Confirm paginated invalidation uses predicate, not single-page key only.
