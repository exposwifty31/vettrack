# Dependencies Codemap
<!-- Generated: 2026-07-08 | Source: package.json + knip 2026-07-08 | Token estimate: ~550 -->

## Runtime stack
| Concern | Library |
|---------|---------|
| Frontend | React 18, Vite, wouter (routing), TanStack Query |
| UI | shadcn/ui over Radix primitives, Tailwind |
| Offline/PWA | Dexie (IndexedDB), custom `sync-engine`, service worker |
| Backend | Express, TypeScript, Drizzle ORM |
| Jobs | BullMQ + Redis (optional in dev) |
| Auth | Clerk (prod) / dev-bypass (local) |
| Native | Capacitor 8 (iOS + Android shells) |
| Errors | Sentry (permanent-sync-failure events) |

## External services
- **PostgreSQL** — primary store (64 `vt_*` tables)
- **Redis** — BullMQ queues, rate limiting (prod-required, dev-optional)
- **Clerk** — auth (JWT); bypassed locally
- **PMS integrations** — `server/integrations/` adapter registry (`generic-pms` + `chameleon/priza/smartflow` stubs); webhooks **inbound-only**
- **Railway** — deploy target (`railway up --ci`); domain `vettrack.uk`

## Native downstream (per `docs/MAINTENANCE_MODE.md`)
Portable contracts (experience model, capability union, typed API surface, board shell) target the sibling repo `exposwifty31/literate-dollop` (Expo/React-Native + `@vettrack/contracts`) — the real consumer of the I.2 framework-free contracts.

## ⚠️ Unused dependencies (knip, 2026-07-08 — TECH_DEBT TD-3)
**0 imports confirmed** across `src/`+`server/`. Candidates for a clean-sub-phase cull:

**Prod (25):** `framer-motion`, `zustand`, `fuse.js`, `react-virtuoso`, `pdf-parse`, `@clerk/clerk-sdk-node`, `@ionic/core`, `@ionic/react`, `@capacitor/camera`, `@types/helmet`, `@types/react-window`, and 14 `@radix-ui/*` (accordion, avatar, checkbox, collapsible, dropdown-menu, popover, progress, radio-group, scroll-area, separator, slider, switch, toast, tooltip).

**Dev (5):** `@capacitor/ios`, `@types/connect-pg-simple`, `@types/pdf-parse`, `code-inspector-plugin`, `madge`.

> Caution: some `@radix-ui/*` back **unused** `components/ui/*` files — delete the UI file and its dep together (don't orphan one). `madge` is invoked by `pnpm architecture:cycles` via CLI, so verify before removing. Re-run `knip` + `pnpm build` after any cull.

## Config debt
`knip.json` still ignores `src/lib/tokens.ts` + `server/seed.ts` which are now used ("Remove from ignore") — TECH_DEBT TD-13.
