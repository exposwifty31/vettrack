# Replay Idempotency Equipment Review Checklist

## Scope
- [ ] Headers are added on replay paths only, not initial writes.
- [ ] Server middleware is scoped to equipment routes only.
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
- [ ] No non-equipment domain receives idempotency middleware.
