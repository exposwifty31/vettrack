# Program Brain — delivery state

**Last updated:** 2026-05-27 (post-merge PR #492)

## Equipment waitlist (Phase B)

| Item | Status | Notes |
|------|--------|--------|
| **Phase B — Equipment Waitlist** | **Complete** | Merged via PR #492 (`707b77b7` on `main`). Foundation: `vt_equipment_waitlist`, promotion on return/dock-return/TTL, SSE events, integration + Playwright evidence. |
| **WTL-UX-01 — Reservation banner** | **Complete** | Post-promotion `ReservationBanner`; `reservationExpiresAt` / TTL only. Shipped in #492. |
| **WTL-UX-02a — Waiter ETA context** | **Deferred** | Plan: `docs/follow-ups/WTL-UX-02-estimated-return-waitlist-integration.md` |
| **WTL-UX-02b — Holder reminder + queue** | **Deferred** | Stronger copy when `queueSize > 0`; no waiter notify, no promotion side effects. |

### Boundaries (frozen)

- `expectedReturnMinutes` — advisory holder reminder / future waiter ETA (02a); **not** tied to waitlist promotion.
- `reservationExpiresAt` — promoted-user claim window only.
- Waitlist progression — **return**, **dock-return**, **TTL worker** only.

### References

- Plan: `docs/program-brain/phase-b-equipment-waitlist-plan.md`
- P0 evidence: `docs/evidence/phase-b-equipment-waitlist-p0.md`
- WTL-UX-01 (done): `docs/follow-ups/WTL-UX-01-reservation-banner-after-promote.md`
- WTL-UX-02 (deferred): `docs/follow-ups/WTL-UX-02-estimated-return-waitlist-integration.md`
