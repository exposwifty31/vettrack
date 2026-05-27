# WTL-UX-01 — Show reservation banner after promotion even when equipment is returned

**Source:** Program Brain approval of PR #491 (`60dbd212`). Not a merge blocker.

**Status:** **Complete** — merged in PR #492 (`main`, 2026-05-27).

**Merge:** Independent of estimated-return integration. See follow-up **WTL-UX-02** in `docs/follow-ups/WTL-UX-02-estimated-return-waitlist-integration.md`.

## Problem

After waitlist promotion, equipment `custodyState` is no longer `checked_out`, so `WaitlistPanel` hides (join eligibility requires another user’s checkout). The reservation remains valid (`myStatus: notified`, TTL, checkout entitlement) but the user loses a persistent on-page cue.

## What to build

### Equipment detail (required)

- Banner: **“Reserved for you”**
- Countdown to `reservationExpiresAt`
- Primary CTA: checkout / take device
- Desktop + mobile layouts

### Equipment list row (optional)

- Compact reservation indicator on paginated list when viewer is `notified`

## Acceptance criteria

- [x] `myStatus === notified` shows banner on `/equipment/:id` even when custody is not `checked_out`
- [x] Countdown matches server expiry
- [x] CTA triggers checkout; fulfill path unchanged
- [x] Banner clears on fulfill, leave, expiry, or lost reservation
- [x] Single promote toast (no `EQUIPMENT_WAITLIST_AVAILABLE` duplicate)
- [x] `locales/en.json` + `locales/he.json` parity
- [x] Automated test for post-promote banner visibility

## Out of scope

- RFID
- Promotion / TTL rule changes

## References

- `src/components/equipment/WaitlistPanel.tsx`
- `src/pages/equipment-detail.tsx`
- `tests/equipment-waitlist-two-browser.spec.ts`
