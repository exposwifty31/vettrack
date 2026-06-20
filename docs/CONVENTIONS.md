# CONVENTIONS.md

> Agents: follow these conventions in every file you touch.
> Do not introduce new patterns — extend them only via `docs/decisions/`.
> Keep this descriptive, not aspirational. Document what IS, not what you wish were true.

---

## Guiding Principle

Consistency beats cleverness. When in doubt, match what already exists in the file you are editing.

---

## Language and Runtime

**Language:** TypeScript 5 (server) + TypeScript 5 / React 18 (frontend)
**Node version:** 22.14.0 (see `.nvmrc`)
**Package manager:** pnpm 9.15.9
**Strictness:** `strict: true` in all tsconfig files

---

## Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables / params | `camelCase` | `clinicId`, `isLoading` |
| Functions / methods | `camelCase`, verb-first | `getEquipment`, `validateClinicId` |
| Types / interfaces | `PascalCase` | `EquipmentRow`, `AuthUser` |
| Constants (module-level) | `SCREAMING_SNAKE` | `MAX_RETRY_COUNT` |
| Server route files | `kebab-case` | `equipment.ts`, `code-blue.ts` |
| React components | `PascalCase` file + export | `EquipmentCard.tsx` |
| React pages | `PascalCase` | `EquipmentPage.tsx` |
| Test files | same name + `.test.ts` | `equipment.test.ts` |
| Boolean variables | `is` / `has` / `can` prefix | `isPluggedIn`, `hasPermission` |
| i18n keys | `namespace.subKey` dot-notation | `appointmentsPage.title` |
| DB tables | `vt_` prefix, `snake_case` | `vt_equipment`, `vt_clinical_check_ins` |
| Drizzle schema exports | `camelCase` | `equipment`, `clinicalCheckIns` |

**Rules:**
- Hebrew text never appears in identifiers, variable names, or file names
- Do not abbreviate unless the abbreviation is universal in this domain

---

## Directory Conventions

```
server/
  routes/       One file per API resource — register in server/app/routes.ts
  services/     Domain services — called by routes, never call routes
  schema/       pgTable definitions — re-exported via server/db.ts
  lib/          Business logic, utilities, shared helpers
  middleware/   Express middleware only
  jobs/         BullMQ job definitions
  workers/      BullMQ worker implementations
  integrations/ External PMS adapter layer
src/
  pages/        Route-level page components — lazy-loaded via src/app/routes.tsx
  components/   Shared UI — primitives in components/ui/ (shadcn)
  features/     Feature-scoped modules
  hooks/        Custom React hooks
  lib/          api.ts, offline-db.ts, sync-engine.ts, i18n.ts
  types/        Shared TypeScript types for API responses
```

**Adding a new feature:**
1. Schema → `server/schema/*.ts` → `npx drizzle-kit generate` → commit SQL
2. Route → `server/routes/` → register in `server/app/routes.ts`
3. Worker (if needed) → register in `server/app/start-schedulers.ts`
4. API function → `src/lib/api.ts` + type in `src/types/`
5. Page → `src/pages/` → lazy import + `<Route>` in `src/app/routes.tsx`
6. Copy → `locales/he.json` + `locales/en.json` (parity enforced)
7. Audit kind (if needed) → add to `AuditActionType` union in `server/lib/audit.ts`

---

## Multi-Tenancy (Critical)

Every DB table has a `clinicId` column. **Every query must filter by `clinicId`.** No exceptions. Dev-bypass hardcodes `clinicId = "dev-clinic-default"`.

---

## API Routes

- Route files in `server/routes/` — one file per resource
- Must be registered in `server/app/routes.ts`
- All responses go through `apiError()` from `server/lib/apiError.ts` for errors
- New endpoints are authenticated via `req.authUser` (set by `server/middleware/auth.ts`)
- Role is always read from `vt_users.role` in the DB — never from JWT claims
- Rate limiting: global 100 req/min, scan 10/min, checkout/return 20/min

---

## API Client (Frontend)

- All server calls go through `src/lib/api.ts`
- Every new endpoint needs a typed function exported from `src/lib/api.ts`
- A corresponding TypeScript type goes in `src/types/`
- Never call `fetch` directly from pages or components — always use `src/lib/api.ts`

---

## Error Handling

**Philosophy:** Expected failures return typed error responses. Invariant violations throw. Errors are never silently swallowed.

**Server errors:** Use `apiError()` from `server/lib/apiError.ts` — it renders locale-aware JSON error envelopes.

**Audit logging:** Use `logAudit()` from `server/lib/audit.ts` for critical actions. It is fire-and-forget — never `await` it inside a transaction.

**What is prohibited:**
- Empty catch blocks
- Catching errors and only logging without rethrowing or returning a failure result
- Generic error messages: `"Something went wrong"`

---

## i18n

- Two locales: `locales/he.json` (Hebrew default) and `locales/en.json`
- Frontend: import typed `t` from `@/lib/i18n` (generated types in `src/lib/i18n.generated.d.ts`)
- Backend: use `req.locale` via `i18nMiddleware`; errors via `apiError()` with locale
- **No hardcoded copy in source** — `tests/i18n-no-hebrew-in-source.test.ts` enforces this
- `_meta.*` keys are non-rendering metadata — include in parity, filter at runtime
- The `appointmentsPage.*` namespace is frozen (only copy renamed to "Tasks", not the keys)

---

## Database

- All tables prefixed `vt_`, defined in `server/schema/*.ts`, re-exported from `server/db.ts`
- After schema edits: `npx drizzle-kit generate` → commit generated SQL → `pnpm db:migrate`
- Do not use raw SQL unless Drizzle ORM cannot express the query
- Migrations also run at server startup — `pnpm db:migrate` runs the same path on demand

---

## Realtime (Frozen)

- SSE via `GET /api/realtime/stream` — do not add WebSockets or polling
- BroadcastChannel `vt_realtime_outbox_cursor` envelope shape is frozen
- Emergency endpoints are never cached in Service Worker
- New telemetry surfaces must be bounded enums on both client and `server/routes/realtime.ts`

---

## Background Workers

- All BullMQ workers and schedulers registered in `server/app/start-schedulers.ts`
- Redis is optional in dev (queues log `QUEUE_DISABLED_NO_REDIS`)
- Production requires Redis

---

## Exports

- Named exports preferred throughout — avoid default exports except for React page components loaded by the router (lazy import pattern requires a default export)
- Never `export *` — explicit exports only

---

## Comments

- Write **why**, not **what**. Comments that restate what the code does are noise.
- No docstrings on functions where the signature is self-explanatory
- Inline comments only when the code is genuinely non-obvious (hidden constraint, workaround, subtle invariant)

---

## Testing

- **Test runner:** Vitest (`pnpm test`)
- **Framework:** Vitest + vitest mocking utilities; Playwright for E2E
- **File location:** `tests/` directory (not co-located)
- **Naming:** descriptive sentence form — `"returns 401 when clinicId does not match"`
- **Structure:** AAA (Arrange, Act, Assert)
- **Excluded from default suite:** DB integration tests, live-server tests, Phase 9 Playwright drills — see `vite.config.ts` excludes

---

## Git

**Commit message format:**
```
type(scope): short description in imperative mood

- What changed and why
- Refs TASK-NNN if applicable

Types: feat | fix | refactor | test | docs | chore | perf
```

**Never commit:**
- `.env`, `.env.local`, or any file containing secrets
- `console.log` / debug statements
- Commented-out code
- Build artefacts (`dist/`, `node_modules/`)

---

## What Is Deliberately Not Listed Here

- No Husky git hooks (too much friction; pre-commit checks are manual)
- No barrel (`index.ts`) files in `server/routes/` or `server/schema/` — they cause confusion
- No `any` type escape hatches without an inline comment explaining why the type system cannot handle the case
