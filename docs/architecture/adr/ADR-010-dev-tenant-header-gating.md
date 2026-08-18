# ADR-010: Gate the dev clinic-override header behind dev-bypass in `tenantContext`

| Field | Value |
|-------|--------|
| **Date** | 2026-08-18 |
| **Status** | proposed |
| **Tags** | `#tenancy` |

## Context

`server/middleware/tenant-context.ts` resolves a best-effort `req.clinicId` hint
for every `/api` request. Its precedence chain is:

```
authUser → Clerk org → DB lookup → x-dev-clinic-id-override → DEV_DEFAULT_CLINIC_ID → implicit dev default
```

Before this ADR, the fourth source — the **client-supplied**
`x-dev-clinic-id-override` request header — was read at `tenant-context.ts:26`
with **no environment condition of any kind**. Four lines below it, at
`tenant-context.ts:30`, the *implicit* dev default was gated on
`process.env.NODE_ENV !== "production"`. (Both line numbers are as of commit
`bbea16ec8`, the parent of this change; the gate added here shifts them down.)

The sibling middleware gates the identical header **twice** before reading it:

| Location | Gate |
|----------|------|
| `server/middleware/auth.ts:159` | `isDevelopment = NODE_ENV !== "production"` |
| `server/middleware/auth.ts:312` | `isDevBypass = isDevelopment && resolveAuthModeFromEnv().mode === "dev-bypass"` |
| `server/middleware/auth.ts:317` | header read, inside `if (isDevBypass)` |

`.cursorrules:26` states the intended contract in words:

> **Dev-only headers** (`x-dev-role-override`, `x-dev-user-id-override`,
> `x-dev-clinic-id-override`): honored only in **dev bypass** path inside
> `resolveAuthUser` (`server/middleware/auth.ts`).

An ungated read inside one file, four lines above a gated read, contradicting the
repo's own written contract and its sibling's double gate, is an **omission**
rather than a deliberate design choice. This ADR records the reasoning for
closing it, because `TRIGGERS.md` requires an ADR for any change to "tenancy
(`clinicId` resolution, membership, dev-bypass, tenant middleware order)".

### Severity — stated precisely, deliberately not inflated

`tenantContext` is mounted at `server/index.ts:312`, **before** any per-route
`requireAuth`, so `req.authUser` is usually unset when it runs and precedence can
fall through to the header. That is the whole of the upside for an attacker.
Against it:

- Whenever credentials resolve, `req.clinicId` is **overwritten from the
  session** — globally by `sessionContextMiddleware` one line later
  (`server/index.ts:313` → `auth.ts:633`), and again per-route by `requireAuth`
  (`auth.ts:675/774/907`).
- The header value therefore survives only on requests whose credentials do
  **not** resolve, and only into handlers that read `req.clinicId` without
  `requireAuth`.
- The file's own comment (`tenant-context.ts:51-56`) documents the
  value as a best-effort hint precisely because it runs ahead of authentication.

**End-to-end exploitability was not demonstrated, and this ADR does not claim
it.** No route was shown to return another clinic's data on the strength of the
header alone.

### Why fix it anyway

The forward-looking reason, not a present-tense breach claim: this branch is
scheduled to become row-level-security work, in which `req.clinicId` would be
pushed into a Postgres GUC that RLS policies read. On that day a
client-supplied header would set **database-enforced** tenant scope rather than
merely hinting at it, and the same line would move from "best-effort hint that
gets overwritten" to "authoritative tenant identity". Closing the gate now is the
precondition that makes the RLS work safe to start, and it is the only part of
that programme that is safe to land without touching the database.

## Decision

Gate the `x-dev-clinic-id-override` read in `tenantContext` behind the **same
double gate** `auth.ts` applies:

```ts
function devClinicHeaderAllowed(): boolean {
  return process.env.NODE_ENV !== "production"
    && resolveAuthModeFromEnv().mode === "dev-bypass";
}
```

Nothing else in the precedence chain changes. `DEV_DEFAULT_CLINIC_ID`
(`tenant-context.ts:63`) is deliberately left as-is — see "Options considered",
Option E.

**No database change. No migration. No DDL.** This ADR covers a source edit only.

## Options considered

### Option A — Leave it ungated

| Dimension | Assessment |
|-----------|------------|
| Complexity | None |
| Risk | Carries a client-controlled tenant input into the RLS work |
| Reversibility | n/a |

**Pros:** zero churn; no chance of disturbing a dev workflow.
**Cons:** leaves the repo contradicting `.cursorrules:26`; guarantees that the
first RLS PR must either fix this first or ship a client-settable GUC.
**Rejected** — the cost of fixing is one boolean, and the fix is a precondition
for work already scheduled on this branch.

### Option B — Single gate: `NODE_ENV !== "production"` only

| Dimension | Assessment |
|-----------|------------|
| Complexity | Lowest of the fixes (no new import) |
| Risk | Low |
| Consistency | Matches the implicit dev default's own gate (now `tenant-context.ts:64`), not `auth.ts` |

**Pros:** internally consistent with the very next line of the same file;
sufficient to keep the header out of production entirely.
**Cons:** still diverges from the sibling and from `.cursorrules`. A developer
running Clerk mode locally (the RN Clerk end-to-end harness does exactly this,
injecting a live secret into a local server) would have the header honored by
`tenantContext` while `auth.ts` refuses it — so the hint could disagree with the
identity the session actually proves. That disagreement is the same class of
defect being fixed, one environment narrower.
**Rejected in favour of C**, but noted as the acceptable minimum if C ever proves
disruptive.

### Option C — Double gate, matching `auth.ts` **(chosen)**

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one pure helper, one leaf import |
| Risk | Low; blast radius enumerated below |
| Consistency | Matches `auth.ts:312` and `.cursorrules:26` exactly |

**Pros:** one rule for one header across both middlewares; the invariant becomes
statable in a sentence ("dev-only headers are honored only in dev bypass") and is
now enforced in both places that read it. `resolveAuthModeFromEnv` is a pure
function over `process.env` with no caching and no side effects
(`server/lib/auth-mode.ts:57`), so it is safe to call per-request, and
`auth-mode.ts` is a leaf module, so no import cycle is introduced.

**Cons:** in a local server running Clerk mode, the header stops being honored by
`tenantContext`. This is intended: `auth.ts` already refuses it in that mode, so
the change removes a divergence rather than a working workflow.

**Blast radius (enumerated, all callers of the header):**

| Caller | Mode it runs in | Effect |
|--------|-----------------|--------|
| `tests/{equipment-scan-e2e,expiry-api,expiry-check-worker,returns-api,charge-alert-worker,code-blue-mode-equipment}` | live server via `pnpm dev` (no `CLERK_SECRET_KEY` per `CLAUDE.md`) → dev-bypass | unaffected |
| `tests/equipment-waitlist-{sse,two-browser}.spec.ts` | Playwright against the dev server → dev-bypass | unaffected |
| `scripts/wetcheck/simulate.mjs:557-569` | dev server → dev-bypass | unaffected |
| `server/lib/realtime-collab/{server.ts:185,identity.ts:41}` | Socket.io handshake on `/collab-ws` | unaffected — `tenantContext` is mounted on `/api` only (`server/index.ts:312`); the collab path builds a pseudo-request and calls `resolveAuthUser` directly |

`pnpm dev:bypass` sets `CLERK_ENABLED=false`, which `resolveAuthMode` resolves to
`dev-bypass` even with a secret present (`auth-mode.ts:44-46`) — so that workflow
keeps the header too. A regression test covers this case explicitly.

### Option D — Remove the header branch from `tenantContext` entirely

| Dimension | Assessment |
|-----------|------------|
| Complexity | Lowest diff |
| Risk | **Higher than C** |

**Pros:** the strongest possible statement — only `resolveAuthUser` ever reads
dev headers, which is literally what `.cursorrules` says.
**Cons:** `tenantContext` runs *before* `sessionContextMiddleware`, and its
fail-open contract exists precisely for requests where `resolveAuthUser` does not
resolve. Deleting the branch changes dev behavior in exactly those cases, and
proving that no dev flow depends on the hint arriving at `:312` rather than
`:313` needs runtime evidence this change does not have.
**Rejected** — C achieves the security property with strictly less behavioral
risk. D remains available as a later simplification once RLS lands and the
precedence chain is re-derived.

### Option E — Also gate `DEV_DEFAULT_CLINIC_ID` (`tenant-context.ts:63`)

**Rejected (out of scope).** `DEV_DEFAULT_CLINIC_ID` is a **server environment
variable**, set by whoever runs the process — not remote input, and not
attacker-controllable through a request. It sits in a different threat class from
a request header, and `auth.ts:320` reads it too. Tightening it is defensible
hardening but is not the omission this ADR is about, and bundling it would put an
operator-facing config change into a security fix. Flagged here so the next
reader does not mistake the omission for oversight.

## Consequences

**Easier**

- The RLS work can begin from a state where no request header can reach a tenant
  GUC. This ADR is the L2 prerequisite for that programme.
- One statable invariant across both middlewares, testable in isolation without a
  database.

**Harder**

- Anyone debugging tenant scope against a **local Clerk-mode** server can no
  longer force a clinic with the header at the `tenantContext` layer. The
  supported path is dev-bypass (`pnpm dev:bypass`), which is unchanged.

**Revisit later**

- Option D (delete the branch) once RLS lands and the precedence chain is
  re-derived against the GUC.
- Option E (`DEV_DEFAULT_CLINIC_ID`) as separate operator-config hardening.
- If `req.clinicId` is ever wired to an RLS GUC, that PR must re-audit **every**
  source in this precedence chain, not just the header — the DB-inferred branch
  (`tenant-context.ts:76-91`) especially, since it resolves a clinic before
  `requireAuth` has validated anything.

## Compliance

- [x] `pnpm typecheck` (frontend + server tsconfigs) exits 0
      — note: `tests/` is included by **neither** tsconfig (`tsconfig.json`
      includes `src`/`lib`; `tsconfig.server.json` includes `server`/`shared`/`lib`),
      so the new test file is type-checked only by vitest's transform at run time,
      not by `tsc`. Stated rather than implied.
- [x] Regression test: `tests/tenant-context-dev-header-gating.test.ts`
      (5 cases; written first, 2 observed failing against the unfixed code)
- [x] No schema migration — **this ADR changes no database object**
- [ ] i18n parity — n/a, no user-facing copy
- [ ] `pnpm architecture:gates` — no structural/boundary change (one leaf import
      added: `server/lib/auth-mode.ts`, which imports nothing)
