# Equipment pilot mode — fix plan docs

Companion documentation for the [Equipment-Pilot Fix Plan](https://github.com/dboy3156/VetTrack) (per-browser override, Ward Display UX, rate limits, billing/push gates, Phase 3 correctness).

Each numbered doc matches one PR. Merge order follows the sequence below.

## Status

| Step | Doc | PR # | Status | Deployed SHA | Rollback |
|------|-----|------|--------|--------------|----------|
| 01 | [01-pilot-mode-override.md](./01-pilot-mode-override.md) | — | Shipped (code on `claude/app-demo-prep-yXiUj` @ `3e9d520`) | `3e9d520` | `git revert` or clear `localStorage.vt_pilot_mode_override` |
| 02 | [02-display-empty-panes.md](./02-display-empty-panes.md) | — | Pending | — | `git revert` |
| 03 | [03-rate-limiter-per-user.md](./03-rate-limiter-per-user.md) | — | Pending | — | `git revert` |
| 04 | [04-suppress-english-pushes.md](./04-suppress-english-pushes.md) | — | Pending | — | Unset `PILOT_DISABLE_EN_PUSH` |
| 05 | [05-suppress-default-billing.md](./05-suppress-default-billing.md) | — | Pending | — | Unset `PILOT_SUPPRESS_DEFAULT_BILLING` |
| 06 | [06-bulk-delete-cleanup.md](./06-bulk-delete-cleanup.md) | — | Pending | — | `git revert` |
| 07 | [07-revert-version-pin.md](./07-revert-version-pin.md) | — | Pending | — | `git revert` |
| 08 | [08-bulk-verify-room-version.md](./08-bulk-verify-room-version.md) | — | Pending | — | `git revert` |
| 09 | [09-emergency-staging-ttl.md](./09-emergency-staging-ttl.md) | — | Pending | — | `git revert` (+ SQL in doc if needed) |
| 10 | [10-patch-equipment-strict.md](./10-patch-equipment-strict.md) | — | Pending | — | `git revert` |
| 11 | [11-unit-condition-states-clinic.md](./11-unit-condition-states-clinic.md) | — | Pending | — | `git revert` |

## Critical files (update after refactor slices)

| Phase | Primary file(s) |
|-------|-----------------|
| P2.1 | `src/pages/display.tsx` |
| P2.2 | `server/middleware/rate-limiters.ts` |
| P2.3 | `server/routes/equipment/handlers/patch-equipment.ts`, `server/routes/equipment.ts`, `server/routes/equipment/handlers/post-equipment-bulk-move.ts` |
| P2.4 | `server/lib/equipment-seen.ts` |
| P3.1 | `server/routes/equipment/handlers/post-equipment-bulk-delete.ts` |
| P3.2 | `server/routes/equipment/handlers/post-equipment-revert.ts` |
| P3.3 | `server/routes/equipment/handlers/post-equipment-bulk-verify-room.ts` |
| P3.4 | `server/workers/stagingExpiryWorker.ts`, `server/lib/audit.ts` |
| P3.5 | `server/routes/equipment.ts` (`patchEquipmentSchema`) |
| P3.6 | `server/routes/equipment-operational-state.ts` |

## Coordination with modular refactor

Before each pilot PR: rebase on `main`, run `git log origin/main --since="3 days" --oneline | grep -E "Slice|refactor"`, and locate handlers by name under `server/routes/equipment/handlers/` if `equipment.ts` line numbers drift.
