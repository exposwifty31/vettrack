# Task 2.3 — "Who's on the floor" glance card

> Breakdown-first plan (Phase 2 convention). Source design: claude.ai/design project
> `9ef590ff-f089-48bf-a247-cd678bdd7ca4` → `VetTrack Design Pass.dc.html`, turn 23. Roadmap entry:
> `docs/vettrack-2.0-roadmap.md` Task 2.3 (P2 · S · Sonnet 5).

## What this is

A home-screen card answering "is the floor covered?" at a glance: rooms with staff avatars parked in
them, an explicit staleness state, and a "כל המחלקה" (whole floor) expansion to a per-person list. This
is the deliberately small, de-risking slice of Task 2.2 (Live Floor + The Baton) — display only, no
baton, no handoff, no acknowledgement.

## Data-source decision (resolved 2026-07-21 — see conversation, not re-derivable from the design file)

The design implies "who is physically in this room," but the only real presence mechanism in the repo
(`server/lib/realtime-collab/`) tracks **co-presence on a record's screen** — "has this room's detail
page open" — not physical location. Two options were on the table: repurpose record-room presence as-is
(fast, weaker signal) or derive from recent scan/custody activity (slower, closer to physical truth).
**Decision: repurpose record-room presence as-is.** Ship copy must be honest about what the signal means
(a staff member with the room open, not a confirmed physical-presence system) — this is a "Honesty" spec
requirement from the design's own findings block, so it isn't a new constraint, just applied to the
right thing.

**No new server code is needed.** Verified against real code:
- `server/lib/realtime-collab/rooms.ts` already defines `RECORD_TYPES = ["equipment", "task", "room"]`
  — `"room"` is a first-class co-presence record type, keyed to `vt_rooms` row ids
  (`server/lib/realtime-collab/record-access.ts`'s `existsInClinic` against `roomsTable`).
- `src/features/collab/useRecordPresence.ts` already joins one such room and exposes
  `presentMembers: { userId, displayName }[]`.
- `useCollabRoom` (`src/features/collab/useCollabRoom.ts`) acquires a single **shared, ref-counted**
  socket (`getCollabSocket`/`releaseCollabSocket`) and filters incoming `"presence"` events to its own
  `joinedRoomRef.current` (`handlePresence`, line ~176-185) — so **N simultaneous instances of
  `useRecordPresence`, one per physical room, correctly coexist on the one shared socket**, each joining
  its own room and only ever updating its own roster. This is exactly the aggregation this card needs:
  mount one subscriber per room in the clinic, never a new bulk/aggregate server endpoint.

## Files

- **New:** `src/features/floor-presence/useFloorPresence.ts` — thin wrapper: takes a list of room ids,
  mounts one `useRecordPresence({ recordType: "room", recordId })` per room (via a small per-room
  subscriber component, not a hook-in-a-loop — React rules), aggregates into
  `{ roomId, roomName, members, isStale }[]`. Staleness = no presence event refreshed within a fixed TTL
  (mirrors the design's "נוכחות מלפני 8 דק׳" / stale-after-N-minutes framing) — exact TTL to confirm
  against `PRESENCE_TTL_MS` in `server/lib/realtime-collab/config.ts` so the client's staleness read
  matches the server's actual lease TTL, not an invented number.
- **New:** `src/features/floor-presence/FloorPresenceCard.tsx` — the home-screen card (fresh/stale
  states per the design mock).
- **New:** `src/features/floor-presence/RoomAvatarRow.tsx` — per-room avatar stack + count.
- **New:** `src/features/floor-presence/StalenessBadge.tsx` — text-based (not colour-only, WCAG per the
  design's own a11y note) freshness indicator; reused by the card and the sheet.
- **New:** `src/features/floor-presence/FloorSheet.tsx` — "כל המחלקה" expansion: per-person list (name,
  room, you-marker only — **join time and role are explicitly out of scope**: the collab presence-store's
  `presentMembers` only ever carries `{userId, displayName}`, and adding either field would require a
  server-side change, which this task's own zero-new-backend architecture decision rules out).
- **Edit:** `src/pages/home.tsx` — mount `FloorPresenceCard` in the existing home card grid.
- **Edit:** `locales/he.json` + `locales/en.json` — new keys under a `floorPresence.*` namespace (Hebrew
  first; parity enforced by `pnpm i18n:check`).
- **New tests:** `tests/floor-presence/useFloorPresence.test.ts` (aggregation + staleness logic, mocked
  `useRecordPresence`), `tests/floor-presence/FloorPresenceCard.test.tsx` (fresh/stale/empty-room render
  states, RTL).

## Execute (RED → GREEN, per methodology)

1. Failing test: `useFloorPresence` returns one entry per room id with `members: []` when no presence
   has arrived yet, and marks an entry stale once its last-update timestamp exceeds the confirmed TTL.
2. Implement `useFloorPresence` + the per-room subscriber component (minimal, passes the test).
3. Failing test: `FloorPresenceCard` renders desaturated/dimmed avatars + the amber stale copy when
   `isStale`, and the live-dot + "עכשיו" when fresh — assert on text content, not colour alone (mirrors
   the design's own a11y requirement).
4. Implement `FloorPresenceCard` / `RoomAvatarRow` / `StalenessBadge`, wire into `home.tsx`.
5. Failing test: empty room (no members) renders as an explicit empty row, not hidden (design: "a real
   signal").
6. Implement, then `FloorSheet` expansion + i18n keys both locales. `FloorSheet` is a real modal — its own
   test coverage must include: opens/closes via `onOpenChange`; renders an explicit empty state with zero
   members across all rooms; Escape key dismisses it; focus moves onto the dialog on open and returns to
   the triggering element on close; a click on content *inside* the dialog does not dismiss it (only the
   close button / Escape / outside-click do).
7. Visual evidence: 320/768/1024, Hebrew + English, fresh + stale states — screenshots.

## Verify

- `npx tsc --noEmit` (both tsconfigs) → 0.
- New tests green; `pnpm i18n:check` parity.
- Coworker-presence-only confirmed (no patient/clinical data ever rendered here — this card only ever
  shows staff).
- PROOF_ALIGNMENT_LOG entry with real command output, not a summary.

## Done when

Card renders on home (mobile first; console variant + board kiosk scale are explicitly OUT per the
design's own note — "later, per 2.2"), fresh/stale states verified, independent review passes, tracker
box flips.
