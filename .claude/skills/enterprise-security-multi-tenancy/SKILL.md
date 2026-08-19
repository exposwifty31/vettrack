---
name: enterprise-security-multi-tenancy
description: Enforces clinic-scoped data isolation and RBAC consistency across Drizzle queries, Express routes, and Clerk-backed sessions so no tenant crosses another's clinical or financial data. Use when adding reports or APIs that need clinicId filtering, auditing admin routes, verifying role checks from vt_users, sensitive billing or inventory reads, or reviewing middleware and audit logging.
---

# Enterprise security & multi-tenancy

## Quick start

1. **Every database read/write** for tenant data must constrain **`clinicId`** to the active clinic (see `AGENTS.md` multi-tenancy rule).
2. **Role** is resolved from **`vt_users.role`** after auth (`server/middleware/auth.ts`)—not from JWT claims alone.
3. Sensitive mutations: **`logAudit()`** from `server/lib/audit.ts` (fire-and-forget outside transactions per project norms).
4. Run the repo's own tenant gate: `pnpm tenant:lint:touched` (or `pnpm tenant:lint:all`) — `scripts/architecture/tenant-query-lint.mjs` flags Drizzle queries with no `clinicId` filter. It is warn-only; review each reported line for a real tenant leak (e.g. ID-only `where` clauses).

## Workflows

### A — New API or report

- Resolve `clinicId` from session / `req.authUser` context once; thread explicitly—do not trust client body for tenant id.
- Test with **two clinics** in mind: a query without `clinicId` should be impossible or rejected.

### B — RBAC review

- Map route to minimum role using existing patterns (numeric role hierarchy in project docs).
- Admin-only surfaces (financial settings, org-wide config) must fail closed for ICU/technician roles.

### C — Clerk & sessions

- Clerk verifies identity; **authorization** remains application-side via DB role and clinic membership.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm tenant:lint:touched` | Flags queries missing a `clinicId` filter (warn-only heuristic) |

## References

- `server/middleware/auth.ts`
- `server/lib/audit.ts`
- Clerk: follow official security docs for secret handling—never embed keys in client bundles.
