# ADR-007: Clinic join codes — invite-free sign-up membership

| Field | Value |
|-------|--------|
| **Date** | 2026-07-22 |
| **Status** | accepted |
| **Tags** | `#tenancy` |

## Context

A brand-new Clerk user whose session carries no organization claim hits 403
`MISSING_CLINIC_ID` in `resolveAuthUser` (`server/middleware/auth.ts`) before
their `vt_users` row is provisioned. They never appear in Pending Users (the
list is clinic-scoped), so the admin has nothing to approve. The operational
workaround — pre-inviting every email to the Clerk organization — does not
scale to a hospital's worth of doctors.

Root cause: clinic **membership has no first-class representation**. It exists
only as `vt_users.clinicId`, written once at JIT provisioning from the Clerk
session org claim. Membership *intent* ("I work at this hospital") is captured
nowhere, so a never-invited user is structurally unprovisionable. An env-var
default clinic (`DEFAULT_SIGNUP_CLINIC_ID`) was considered and rejected:
single-tenant-only, not rotatable, invisible to the product, ops-owned instead
of admin-owned.

## Decision

Membership intent becomes explicit, admin-controlled data — a **per-clinic
join code**:

- `vt_clinics.signup_join_code` (globally unique, nullable; NULL = joining
  disabled, the default). Migration 178, additive.
- **`POST /api/auth/join-clinic`** (`server/routes/clinic-join.ts`):
  identity-only auth (`readClerkUserSession` — deliberately NOT
  `requireAuth`, which denies before provisioning). Resolves the clinic FROM
  the code (clinic is the result of a globally-unique key, same pattern as
  the display-token lookup), then provisions a `status: "pending"` /
  `role: "technician"` row reusing `resolveAuthUser`'s JIT pieces
  (`isAdminEmail`, `sanitizeRequestedRole`, `sanitizeVetLicense`).
  Idempotent for existing users (never re-homes); enumeration-safe (malformed
  and unknown codes return the same 404); rate-limited.
- **`GET/POST /api/admin/clinic-join-code[/rotate]`**: admin-only view and
  rotate; surfaced as an "Invite staff" card in Pending Users with a copyable
  `/signup?clinic=CODE` link. Rotation invalidates the old link immediately.
- **Client**: `AuthGuard` renders a join screen for `MISSING_CLINIC_ID`
  (code carried from the invite link via sessionStorage with one-shot
  auto-submit; manual entry covers native social OAuth, which cannot carry
  Clerk `unsafeMetadata`). After joining, `refreshAuth` lands on the existing
  pending-approval screen.

**`resolveAuthUser` is byte-identical.** Once the join endpoint has created
the row, the middleware's existing existing-row-by-clerkId branch resolves
every subsequent request. The admin-approval gate (`pending → active`)
remains the single authorization step; a join code confers pending-list
visibility only.

## Consequences

- Doctors sign up without Clerk-org invites; the admin approves them in the
  existing Pending Users flow. No env configuration; per-clinic, rotatable,
  auditable (`user_joined_via_clinic_code`, `clinic_join_code_rotated`).
- Multi-tenant-correct: each clinic owns its code; deployments that never
  generate a code keep today's behavior exactly.
- The join flow (like today's returning-user path) relies on
  `DB_CLINIC_FALLBACK` staying enabled (default). Operators who set it
  `false` still demand org-in-session — unchanged explicit opt-out.
- Spam surface: a leaked code lets someone add themselves to the pending
  list (no data access). Mitigations: Clerk bot protection at sign-up,
  5/min rate limit, rotation.
- Two `vt_users` lookups keyed by `clerkId` (not `clinicId`) carry
  `tenant-lint:scoped` waivers — auth-resolution queries where the clinic is
  unknown/derived, mirroring `resolveAuthUser` itself.

## Compliance

- [x] `pnpm architecture:gates` — All G1 passed
- [x] `npx tsc --noEmit` (both tsconfigs)
- [x] Schema migration 178 + `pnpm db:migrate` (applied clean locally)
- [x] i18n parity (`auth.joinClinic.*`, `adminPage.inviteStaff.*`, `errors.clinicJoin.*` in en + he)
- [x] `pnpm test` full suite green (655 files / 5894 tests)
