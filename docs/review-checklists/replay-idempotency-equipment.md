# Replay Idempotency Review Checklist (equipment · support · shift-chat)

## Scope
- [ ] Headers are added on replay paths only, not initial writes.
- [ ] ~~Server middleware is scoped to equipment routes only.~~ *Superseded 2026-08-28: the same middleware also guards `POST /api/support` and `POST /api/shift-chat/messages` (RN #147/#148 client keys).*
- [ ] No FIFO replay ordering change.
- [ ] No conflict-resolution behavior change.
- [ ] No emergency-path behavior change.
- [ ] No public/sw.js change.
- [ ] Idempotency collision logging/shadow signal is present or explicitly tracked as follow-up.
- [ ] Rollback strategy is explicit in the PR description.

## Required verification
- [ ] Existing emergency/offline tests pass.
- [ ] Existing equipment replay/idempotency tests pass.
- [ ] sync-engine replay header tests pass.
- [ ] ~~No non-equipment domain receives idempotency middleware.~~ *Superseded 2026-08-28: support tickets and shift-chat broadcasts are keyed domains now; the check is that any NEW mount sits after its route's `validateBody` (see `tests/replay-idempotency-mounts.routes.test.ts`).*
