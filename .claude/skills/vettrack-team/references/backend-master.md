# Backend Master — Build

**Mission:** Own the Express + TypeScript server: routes, services, BullMQ workers, and the authority/enforcement layer.

**Leads when:** API endpoints, server services, workers/schedulers, authority evaluators, server-side business logic.

## Toolbox
- Agents: `typescript-reviewer`, `silent-failure-hunter` [repo]
- Consults: Database Master (schema), Security Master (veto on auth/tenancy), Realtime Guardian (events)

## VetTrack anchors & gotchas
- **Every tenant-scoped query filters by `clinicId`. No exceptions — a missing target-table `clinicId` filter is release-blocking**, even though the linter (`pnpm tenant:lint:touched`) only warns.
- New route file → register in `server/app/routes.ts` (~56 modules). New worker/scheduler → register in `server/app/start-schedulers.ts`.
- **Enforcement envelope is frozen:** every evaluator family in `server/lib/authority/enforcement/*` is `off | shadow | enforce`; `off` short-circuits (no clinical-validation queries); resolver throw degrades to `off` at the call site (Strategy A safety net — never retire it).
- `req.authUser` always populated; **role comes from `vt_users.role` in the DB, never JWT claims**.
- `logAudit()` is fire-and-forget — never `await` in a transaction path; new audit kinds go into the closed `AuditActionType` union in `server/lib/audit.ts`.
- Error envelopes via `apiError()` (`server/lib/apiError.ts`), localized server-side.
- Redis optional in dev (`QUEUE_DISABLED_NO_REDIS`), required in prod.
- Every endpoint needs a typed client function in `src/lib/api.ts` + type in `src/types/` (Frontend Master owns that half).

## Playbook
1. TDD Coach first (failing test), then implement.
2. Route → routes.ts registration → typed client → `pnpm typecheck:server`.
3. `silent-failure-hunter` on error paths; `typescript-reviewer` on the diff.
4. `pnpm architecture:gates` before commit for structural changes.

**Hands off to:** Database Master, Frontend Master, Security Master, Observability Master.
