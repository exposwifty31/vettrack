# Runbook G3C-1 — App Store / Play Reviewer Demo Account

**Purpose:** give an App Store / Play Console reviewer an account that clears
`BootstrapGate` (role ≥ student, valid `currentUserId`) **and** resolves an
open clinical shift, so shift-gated RN screens render populated data instead
of a wall of empty lists — the direct cause of an App Review 4.2 ("app
doesn't work") rejection.

**Status:** Code (seed script + test) is committed on
`feat/g3c1-reviewer-demo-seed`. Nothing has been run against production. The
steps below are the owner's to execute against the real Clerk instance and
production `DATABASE_URL`.

**What the code does vs. what you must do:**

| | Owned by |
|---|---|
| Create the Clerk identity (email + password, **not** OAuth) | **Owner** — Clerk dashboard or `clerk-cli` |
| Create/refresh the `vt_users` row, shift roster, and clinic data | `scripts/seed-reviewer-demo.ts` (this PR) |
| Point the reviewer at the right build / API origin | **Owner** — App Store Connect / Play Console listing notes |

---

## Step 1 — Create the Clerk identity (owner, once)

Do this in the **production** Clerk instance (`clerk.vettrack.uk`), not dev.

Reviewer accounts must be email + password — Apple/Google review devices
cannot complete a third-party OAuth consent screen unattended, so **do not**
create this as a Google/Apple-OAuth-only identity.

Using `clerk-cli` (see `.claude/skills/clerk-cli` for the full command surface):

```sh
clerk users create \
  --email reviewer-demo@vettrack.app \
  --password '<a strong, randomly generated password — store it in your password manager>' \
  --first-name App --last-name Review \
  --app <vettrack-production-app-id> --instance prod \
  --dry-run   # inspect the payload first
clerk users create --email reviewer-demo@vettrack.app --password '...' \
  --first-name App --last-name Review \
  --app <vettrack-production-app-id> --instance prod --yes
```

Or via the Clerk dashboard: **Users → Create user → Email + password**, using
the same `reviewer-demo@vettrack.app` address (or your own choice — just keep
it consistent with Step 2).

Record the returned Clerk **user ID** (`user_xxxxxxxx`) — Step 2 needs it.

## Step 2 — Run the seed against production (owner)

```sh
DATABASE_URL='<production DATABASE_URL>' \
REVIEWER_DEMO_CLERK_ID='user_xxxxxxxx' \
REVIEWER_DEMO_EMAIL='reviewer-demo@vettrack.app' \
pnpm seed:reviewer-demo
```

This is idempotent — safe to re-run. It will:

1. Create a dedicated demo clinic (`REVIEWER_DEMO_CLINIC_ID`, default
   `reviewer-demo-clinic`). The clinic ID must contain `"demo"` — this is a
   deliberate guard against a typo'd or stale `REVIEWER_DEMO_CLINIC_ID`
   silently seeding a fake technician + always-on-shift roster + equipment
   into a **real** clinic (the clinic insert is `onConflictDoNothing`, so an
   existing real clinic ID would not error, just get polluted). If you truly
   need a non-"demo"-named clinic ID, pass `{ allowAnyClinicId: true }` when
   calling `seedReviewerDemo()` programmatically — there is no CLI flag for
   this on purpose; think twice before doing it.
2. Upsert a `vt_users` row keyed by `clerkId`, with `role: "technician"`
   (least privilege that clears `BootstrapGate` and is useful — not `admin`),
   `status: "active"`, scoped to the demo clinic.
3. Lay down 14 consecutive full-day `vt_shifts` rows (today .. today+13),
   `employee_name` = the demo user's `displayName` ("App Review Demo"),
   `role: "technician"` — the roster row `resolveAuthority` /
   `resolveCurrentRole` (Strategy A, `server/lib/role-resolution.ts`) match
   against by normalized name to decide "on shift".
4. Seed 2 rooms, 2 docks, 4 equipment items, and 2 tasks scoped to the demo
   clinic, so equipment/docking/task screens are non-empty.

**Why this survives the reviewer's first real sign-in:** Clerk's own
JIT-provisioning path (`server/middleware/auth.ts`, the `insert(users)
.onConflictDoUpdate({ target: users.clerkId, ... })` block) upserts on first
login, but its `set` clause only ever touches `email` / `name` /
`displayName` — it deliberately **excludes** `role`, `status`, and
`clinicId`. Because Step 2 pre-creates the row keyed by the same `clerkId`,
the reviewer's first login lands on our row and cannot downgrade it back to
the JIT defaults (`role: technician` + `status: pending`, or the wrong
clinic).

## Step 3 — Re-run before/during the review window

`vt_shifts` has no recurring-shift concept — each row is a single calendar
day. The seed lays down 14 days from whenever it's run, comfortably covering
a typical review cycle, but if a review drags past that window, **re-run
Step 2** (same command) to extend coverage. Re-running is a no-op for
everything except the shift-window extension (`onConflictDoNothing` on all
other tables).

## Step 4 — Point the reviewer at the right build

In the App Store Connect / Play Console review notes, supply:

- Email: `reviewer-demo@vettrack.app` (or whatever you used in Step 1)
- Password: from your password manager
- Note: `EXPO_PUBLIC_API_ORIGIN` in the submitted build must point at the
  same environment as `DATABASE_URL` in Step 2 (production API origin, not a
  staging/dev origin) — otherwise the reviewer's client talks to a different
  backend than the one this seed populated.

## Verification (local, before touching production)

```sh
DATABASE_URL='postgres://vettrack:vettrack@localhost:5432/vettrack' \
  pnpm exec vitest run tests/seed-reviewer-demo.integration.test.ts
```

Or the full DB-integration suite: `pnpm test:db-integration` (also runs
`tests/equipment-operational-state.integration.test.ts`, unrelated to this
change).

This test seeds a throwaway clinic (`reviewer-demo-clinic-test`) against your
local dev DB, then calls the real `resolveAuthority()` and asserts:
`effectiveClinicalRole === "technician"`, `source === "shift"`, and that
equipment/rooms/docks/tasks rows exist for the clinic. It does **not** touch
Clerk or production.

**What this proves vs. what it doesn't.** The test — and this seed — verify
the *server-side* contract every shift-gated screen depends on: the account
authenticates, clears `role >= student`, resolves an open shift via
`resolveAuthority`, and every list endpoint it hits returns non-empty,
clinic-scoped rows. Confirmed server-side gates a `technician` clears:
`GET /api/equipment` (no extra role check beyond `requireAuth`) and
`GET /api/appointments` (`requireEffectiveRole("technician")` +
`canPerformTaskAction("technician", "task.read")` — verified `true` in
`server/lib/task-rbac.ts`). What this does **not** verify is how the RN
client (a separate repo) renders once it receives that data — this runbook
and its test stop at the server boundary the RN client's `BootstrapGate` and
shift-gated screens read from.

## Rollback

The demo clinic and its rows are namespaced (`reviewer-demo-clinic*`,
`reviewer-demo-*` IDs) and never referenced by real clinic data. To remove:
delete the `vt_users` row for the demo `clerkId`, then the demo clinic row
(FKs `ON DELETE RESTRICT`, so dependent rows — shifts/equipment/rooms/docks/
tasks — must be deleted first, or just leave the clinic in place; it costs
nothing and cannot be reached by any real user).
