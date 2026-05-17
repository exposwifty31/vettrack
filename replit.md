# VetTrack — Veterinary Equipment QR Tracking System

> **Historical snapshot.** This file documents the original Replit-era equipment-tracking surface and does not reflect the current post-Phase-9 architecture (SSE realtime, Code Blue runtime, Department Display, authority/enforcement, i18n governance). For the current architecture see `README.md` and `CLAUDE.md`; for the clinical glossary see `CONTEXT.md`. Sections below are preserved for context but may reference workflows, tables, and rules that have since evolved.

## Overview
VetTrack is a mobile-first progressive web app (PWA) for tracking veterinary equipment using QR codes and NFC tags. Built with React + Vite frontend and Express backend, backed by PostgreSQL, with full offline-first capability via Dexie.js and a hardened Service Worker.

## Architecture

### Frontend (port 5000)
- **React 18** + **Vite** + **TypeScript**
- **Wouter** for client-side routing
- **TanStack Query** for server state & caching
- **TailwindCSS v3** with brand blue (`#2563EB`) theme
- **shadcn/ui** components (Radix UI primitives)
- **Dexie.js** — offline-first IndexedDB layer: equipment cache, pending sync queue, and rooms cache
- **Service Worker v5** — SPA shell fallback for all offline navigations; stale-while-revalidate for static assets; network-first with Dexie fallback for API GET requests; `self.skipWaiting()` on install for immediate activation; ChunkLoadError recovery in `main.tsx`
- **recharts** for analytics charts
- **qrcode.react** for QR code generation
- **jsPDF** for monthly PDF report generation

### Backend (port 3001)
- **Express.js** + **TypeScript** (runs via `tsx`)
- **Drizzle ORM** + **PostgreSQL** (`pg` driver)
- Dev mode: No Clerk keys needed — uses hardcoded admin user
- Clerk mode: Add `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY` for real auth

### Database
PostgreSQL (available via `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`)

Tables (all prefixed `vt_`):
- `vt_users` — Clerk users with roles (admin / vet / technician / viewer), status, soft-delete
- `vt_folders` — manual + smart folders with soft-delete
- `vt_equipment` — equipment registry including:
  - `room_id` (FK → `vt_rooms`) — current room assignment
  - `nfc_tag_id` — optional NFC tag identifier for URL-NFC deep links
  - `last_verified_at` / `last_verified_by_id` — Asset Radar verification timestamps
  - `deleted_at` / `deleted_by` — soft-delete fields
  - Standard fields: name, serial number, model, manufacturer, purchase date, location, status, folder, images, maintenance interval, sterilization dates, checkout state
- `vt_rooms` — clinic room registry for Asset Radar:
  - `name`, `floor`, `sync_status` (`synced` | `stale` | `requires_audit`), `last_audit_at`
- `vt_scan_logs` — per-item scan/verification history (userId, userEmail, status, note, timestamp)
- `vt_transfer_logs` — folder transfer history
- `vt_undo_tokens` — short-lived tokens for scan revert (TTL: 8 seconds client display)
- `vt_whatsapp_alerts` — WhatsApp alert log
- `vt_push_subscriptions` — Web Push subscriptions (endpoint, keys, soundEnabled, alertsEnabled)
- `vt_server_config` — key/value store for VAPID keys and server-side configuration
- `vt_audit_logs` — immutable audit trail for all critical actions
- `vt_alert_acknowledgments` — per-equipment alert ack records
- `vt_support_tickets` — in-app support/issue ticket system
- `vt_inventory_jobs` — async medication inventory deduction reconciliation (`pending` / `processing` / `resolved` / `failed`)

## Architecture Rules
1. Every DB row is clinic-scoped (`clinicId`); every query must preserve tenant filtering.
2. `vt_appointments` is the unified appointment/task model.
3. `task_type = "medication"` identifies medication tasks.
4. `vet_id` is the assigned technician field (legacy naming).
5. Medication execution metadata lives in `vt_appointments.metadata` (`jsonb`).
6. Migrations are manual with `pnpm db:migrate`; they are not auto-run on boot.
7. Medication inventory deduction is async by design: `completeTask` commits billing + completion transactionally, then writes/enqueues `vt_inventory_jobs`; BullMQ worker processes deductions and a 10-minute recovery loop re-enqueues stale/retryable jobs.

## Medication Execution Flow
1. **Start** — Assigned technician (or elevated role override) starts the medication task and acknowledges ownership.
2. **Execute** — UI records dosage execution including calculated medication volume.
3. **Complete** — Single DB transaction commits task completion and billing idempotently; after commit, server inserts/enqueues an inventory deduction job.
4. **Deduct** — Inventory worker atomically claims pending jobs, resolves container from task state, applies idempotent inventory adjustment, and resolves/fails job.
5. **Recover** — Recovery scheduler runs every 10 minutes to re-enqueue stale pending jobs and retry-eligible failed jobs.

## Known Deferred Issues
- **M5 — `vt_inventory_jobs` operational UI**: terminal failures are visible only in logs/DB; add an operator-facing UI for failure visibility and retry workflow.

## Running
```bash
npm run dev          # Starts both backend (3001) + frontend (5000) concurrently
npm run build        # Build frontend for production
npm run start        # Start in production mode
npm run db:push      # Push Drizzle schema to DB
npm run validate:prod  # Run pre-deployment validation checks
tsx server/seed.ts   # Seed sample data
```

## Key Features

### Core Equipment Management
1. **Equipment Registry** — Add/edit/delete equipment with metadata, images, serial numbers, NFC tag IDs
2. **QR Codes** — Each item gets a unique QR code; batch print via QR Print page
3. **Scan Workflow** — Scan a QR → update status (OK / Issue / Maintenance / Sterilized / Overdue / Inactive)
4. **Smart Folders** — "Sterilization Due" auto-populates items not sterilized in 7+ days
5. **Alerts** — Automatic overdue / issue / inactive / sterilization-due detection
6. **WhatsApp Escalation** — Opens wa.me with pre-filled alert message

### Asset Radar
7. **Asset Radar (`/rooms`)** — Room-by-room equipment inventory view showing sync status (Synced / Stale / Requires Audit) computed from `lastVerifiedAt` timestamps relative to configurable thresholds
8. **Room Radar (`/rooms/:id`)** — Per-room detail page with equipment list, Activity Feed (last 5 scan entries with avatar + action + time-ago labels), and one-tap "Verify All" bulk verification
9. **NFC Room Reset** — URL-NFC deep link (`/rooms/:id?verify=true`) opens a confirmation overlay directly from an NFC tap; implemented via `useSearch()` → `useEffect` trigger; no native NFC API required
10. **Operational Transparency** — Dynamic stale-status logic (`computeEffectiveStatus`), "Verified X ago · D.S." verification labels, collapsible Activity Feed on room pages, NFC-deep-link overlay

### Offline-First
11. **Full Offline-First** — All core actions (checkout, return, scan, status update, room verify) work offline with optimistic UI updates. Pending actions are queued in IndexedDB and automatically synced when connectivity returns. Conflict resolution uses last-write-wins by timestamp. UI shows pending / synced / failed states via header indicators and the Sync Queue sheet.
12. **Service Worker v5 SPA Fallback** — Navigation fallback chain: `fetch()` → `cache.match("/index.html")` → `cache.match("/")` → inline branded offline page. `self.skipWaiting()` in install event ensures immediate activation. Cache purges all previous versions (v1–v4) on activate. `main.tsx` catches `ChunkLoadError` and module import failures via `window.onerror` + `window.onunhandledrejection`, clears all caches, and reloads once with a `sessionStorage` loop guard.

### Notifications & Communication
13. **Web Push Notifications** — Real-time push via Web Push + VAPID. Staff subscribe from Settings → Push Notifications. Triggers: equipment issue, overdue maintenance, sterilization due, checkout, return, transfer, alert acknowledgment. Per-user settings: silent mode and alerts-enabled. In-memory 60-second deduplication prevents spam. Test button in Settings.
14. **Sentry Integration (S4/S5)** — `sync-engine.ts` emits `Sentry.captureEvent({ tags: { "sync.failure": "true" } })` on every permanent sync failure. `server/lib/push.ts` adds Sentry breadcrumbs on every push dispatch and a `captureEvent` with `push.failure` tag on send errors. Both are guarded by DSN presence checks.

### Analytics & Reporting
15. **Analytics** — Status distribution pie chart, 30-day scan activity, top problem equipment. In-memory 60-second cache (`analytics-cache.ts`) invalidated on every mutation.
16. **Monthly PDF Reports** — Generated client-side with `jsPDF`; includes dashboard counts, critical items, cost estimate, operational percentage

### Settings & UX
17. **Settings System** — Centralized settings persisted to localStorage. Quick Settings panel (gear icon in top bar) for dark mode, density, sound, language. Full Settings page at `/settings`.
18. **Clinical Ergonomics** — All operationally critical touch targets ≥ 44 × 44 px (Apple HIG / Android a11y standard). Secondary action row buttons (Issue / Status / Move) are `h-11` (44 px); primary actions (Return / In-Use) are `h-12` (48 px); NFC overlay Confirm button is `h-12` (48 px).

## Auth & Security
- **Dev mode** (no Clerk keys): Admin user hardcoded, all routes accessible
- **Clerk mode**: Add `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` secrets for real auth
  - **Israeli phone numbers (+972)**: Clerk must have Israel enabled under Configure → User & Authentication → Phone numbers → SMS sending → Allowed countries
  - `ADMIN_EMAILS` (optional): Comma-separated emails auto-promoted to admin on every login (self-healing). Example: `danerez5@gmail.com`
  - Admin (40): create/delete equipment, manage folders/users, bulk ops, audit log, backup
  - Vet (30): scan equipment, revert scans
  - Technician (20): checkout/return, create equipment, room verify, WhatsApp alerts, alert-acks
  - Viewer (10): read-only access
- **RBAC**: Role always resolved from the DB record — never from JWT claims, request headers, or body fields. `onConflictDoUpdate` excludes the `role` column intentionally.
- **CORS**: Locked to `REPLIT_DEV_DOMAIN` in dev and `ALLOWED_ORIGIN` in prod
- **Rate Limiting** (`express-rate-limit`):
  - Global: 100 req/min/IP on all `/api/*` routes
  - Scan actions: 10/min/IP on `POST /api/equipment/:id/scan`
  - Checkout/return: 20/min/IP on checkout/return endpoints
  - Auth-sensitive: 5/min/IP on push subscribe and users sync
- **XSS**: Global body sanitization via `xss` library
- **Helmet**: Security headers including CSP, X-Frame-Options, HSTS
- **Undo token TTL**: 8 seconds (client countdown); server cleans up expired tokens

## File Structure
```
server/
  index.ts              # Express entry point, Sentry init
  db.ts                 # Drizzle schema + pool + initDb()
  migrate.ts            # Migration runner (migrations 001–016+)
  middleware/
    auth.ts             # Clerk auth + dev bypass + RBAC (requireAuth, requireRole, requireAdmin)
    rate-limiters.ts    # express-rate-limit instances
    validate.ts         # Zod body/param validation helpers
  routes/
    equipment.ts        # CRUD + scan + bulk ops + bulk-verify-room
    rooms.ts            # Room CRUD + activity feed API
    folders.ts          # Folder management
    analytics.ts        # Stats & charts data (with in-memory cache)
    activity.ts         # Global activity feed
    users.ts            # User management + login audit events
    audit-logs.ts       # Audit log read API (admin-only)
    admin-audit-logs.ts # Admin audit log extended routes
    push.ts             # Push subscription + Sentry-instrumented dispatch
    alert-acks.ts       # Alert acknowledgment
    whatsapp.ts         # WhatsApp alert URL generator
    support.ts          # Support ticket system
    storage.ts          # Object storage stub
    metrics.ts          # GET /api/metrics — admin-only server stats
    stability.ts        # Stability test runner API
    health.ts           # GET /api/health
  lib/
    audit.ts            # logAudit() — central audit log writer (fire-and-forget)
    push.ts             # VAPID init, sendPushToAll/Others/User, Sentry-instrumented dispatchToSub
    analytics-cache.ts  # TTL in-memory cache for analytics (60s, invalidated on mutations)
    stability-log.ts    # In-memory ring buffer (1,000 entries)
    stability-token.ts  # Ephemeral random token for stability test auth
    test-runner.ts      # Functional / stress / edge test suite engine
    envValidation.ts    # Startup environment variable validation

src/
  main.tsx              # App entry: QueryClient + providers + SW registration + ChunkLoadError recovery + user-friendly ClerkErrorBoundary
  App.tsx               # Wouter routing + Sentry.ErrorBoundary
  index.css             # Tailwind + CSS variables (blue brand theme #2563EB)
  types/index.ts        # Shared TypeScript types (Equipment, Room, RoomActivityEntry, etc.)
  lib/
    api.ts              # Typed fetch API client (offline interception + optimistic updates)
    utils.ts            # Alert computation, date formatting, QR URL, cn()
    offline-db.ts       # Dexie offline DB: equipment cache + rooms cache + pending sync queue
    sync-engine.ts      # Background sync: FIFO queue, retries, circuit-breaker, Sentry sync.failure events
    generate-report.ts  # jsPDF monthly PDF report generator
    auth-store.ts       # Auth header store for sync engine
    offline-session.ts  # Offline session helpers
    sounds.ts           # Clinical alert tone player
    dashboard-utils.ts  # Dashboard stat computation helpers
    design-tokens.ts    # statusToBadgeVariant and shared design tokens
  hooks/
    use-auth.tsx        # Auth context (Clerk or dev mode)
    use-sync.tsx        # Sync state context (pending count, failed count, trigger sync, circuit state)
    use-settings.tsx    # Settings context (dark mode, density, sound, language, date/time)
    use-push-notifications.tsx  # Push subscription management
  components/
    layout.tsx              # Top header + bottom nav + mobile menu + Quick Settings panel
    move-room-sheet.tsx     # Bottom sheet for moving equipment to a room (with Dexie sync)
    settings-controls.tsx   # Reusable SettingsToggle, SettingsSelect, SettingsSectionHeader
    shift-summary-sheet.tsx # Bottom sheet: checked-out items, today's issues, unack'd alerts, copy to clipboard
    sw-update-banner.tsx    # Update available banner (triggers SKIP_WAITING message to SW)
    update-banner.tsx       # Generic update banner
    onboarding-walkthrough.tsx  # First-run 3-step onboarding (scan / checkout / report issue)
    csv-import-dialog.tsx   # Bulk CSV import dialog (admin)
    report-issue-dialog.tsx # Report issue dialog
    sync-queue-sheet.tsx    # Sync queue inspection sheet
    ui/
      error-card.tsx        # Inline error card with optional retry button
      empty-state.tsx       # Reusable empty state with icon, message, subMessage, optional action
      server-error-banner.tsx  # Dismissible global error banner (emitServerError / clearServerError)
      skeleton-cards.tsx    # Pre-built skeleton card sets for loading states
      button.tsx / badge.tsx / card.tsx / dialog.tsx / sheet.tsx / ...  # shadcn primitives
  pages/
    home.tsx             # Dashboard with stats + alerts preview + Shift Summary button
    equipment-list.tsx   # Filterable list with bulk ops + location chip row filter + EmptyState
    equipment-detail.tsx # Detail + scan dialog + QR + checkout/return + Move to Room + history (secondary buttons h-11)
    new-equipment.tsx    # Add/Edit equipment form (edit mode via /equipment/:id/edit)
    rooms-list.tsx       # Asset Radar: room list with sync status badges + dynamic stale logic
    room-radar.tsx       # Per-room inventory: equipment list + Verify All + NFC overlay + Activity Feed + EmptyState
    analytics.tsx        # Charts & compliance rates + EmptyState
    alerts.tsx           # Grouped alerts + WhatsApp + ErrorCard with retry + EmptyState
    my-equipment.tsx     # Checked-out items + Shift Summary button + ErrorCard + EmptyState
    qr-print.tsx         # Batch QR printing
    settings.tsx         # Full Settings page — all sections + reset + logout
    admin.tsx            # Folders + users management (EmptyState for zero-users state)
    audit-log.tsx        # Immutable audit log with filters (EmptyState with "Clear filters" CTA)
    management-dashboard.tsx  # Management-level dashboard with system health card
    stability-dashboard.tsx   # Stability test runner dashboard (/stability, admin-only)
    signin.tsx / signup.tsx / landing.tsx  # Auth and landing pages
    not-found.tsx        # 404
```

## Stability Testing System

A full stability testing system accessible at `/stability` (admin-only):

- **Functional tests** — Health check, equipment list, analytics, activity, folders, users, and (with testing mode) full equipment CRUD + scan workflow
- **Stress tests** — 5× concurrent requests, 10× rapid sequential requests, 3× concurrent analytics; detects latency spikes and performance degradation
- **Edge case tests** — Missing fields → 400, nonexistent resources → 404, invalid status → 4xx, 5000-char XSS/overflow check, duplicate scan idempotency (test mode)
- **Testing mode** — Toggle to run CRUD tests safely; test data tagged `__TEST__` and cleaned up after each run
- **Auto-schedule** — Set tests to run every 2/4/8/12/24 hours via the UI
- **Internal action log** — Ring buffer of last 1,000 server-side actions, searchable, auto-refreshes every 5 seconds
- **Live dashboard** — Real-time system status (Stable / Warnings / Issues Detected / Testing), per-test pass/fail details, latency stats

## Error Tracking & Monitoring
- **Sentry frontend** — `@sentry/react` initialized in `src/instrument.ts` (imported as the very first line of `src/main.tsx`). Configured with `browserTracingIntegration()`, `replayIntegration()`, `enableLogs: true`, `sendDefaultPii: true`, `tracePropagationTargets: [/^\/api/, "localhost"]`, production sample rate `0.2`. Guard: `if (import.meta.env.VITE_SENTRY_DSN)` — safe no-op in dev. Uses `Sentry.ErrorBoundary` in `App.tsx` with friendly fallback + "Report Issue" button. `sync-engine.ts` emits `captureEvent` with `sync.failure` tag on permanent failures. Source maps: `vite.config.ts` uses `sentryVitePlugin` conditionally when `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` are set; build outputs `sourcemap: "hidden"`.
- **Sentry backend** — `@sentry/node` initialized in `server/index.ts` if `SENTRY_DSN` is set. Uses `setupExpressErrorHandler(app)` and sets user context in `requireAuth` middleware. `server/lib/push.ts` emits breadcrumbs and `captureEvent` with `push.failure` tag on send errors, guarded by `process.env.SENTRY_DSN`.
- **Global error banner** — `GlobalServerErrorBanner` in `src/components/ui/server-error-banner.tsx` — fires on 5xx responses or network failure via `emitServerError()` in `src/lib/api.ts`
- **ChunkLoadError recovery** — `main.tsx` catches `"Failed to fetch dynamically imported module"`, `"ChunkLoadError"`, and related patterns via `window.onerror` and `window.onunhandledrejection`. On first detection: clears all SW caches, then reloads. `sessionStorage` flag prevents infinite reload loops.
- **User-friendly auth error screen** — `ClerkErrorBoundary` in `main.tsx` shows a plain-language "Having trouble connecting" message with a Refresh button instead of raw stack traces.
- **Admin metrics endpoint** — `GET /api/metrics` (admin only) — uptime, memory, active sessions, pending sync count

## Production Readiness & QA Protocol

VetTrack ships with a formal production readiness gate documented in `PRODUCTION_READINESS.md`. **All 26 criteria across 4 Pillars must be marked PASS or formally waived before any deployment to a live clinic.**

### Pillars
| Pillar | Focus | Criteria |
|---|---|---|
| 1 — Stability | Sentry error/crash rates, offline sync, push delivery, SW shell integrity | S1–S6 |
| 2 — Performance | API p50/p95 latency, Lighthouse scores, TTI, IndexedDB flush, PDF speed, NFC-to-overlay latency | P1–P10 |
| 3 — Data Reliability | Offline sync correctness, audit log completeness, soft-delete, RBAC, DB backup, multi-user conflict | D1–D6 |
| 4 — UX Clarity | Empty states, loading states, error messages, QR low-light scan, staff onboarding, clinical glove usability | U1–U6 |

### Current Code Status (post audit remediation)
- **Code-complete, verification required**: S6, P1–P10, D1–D4, D6, U2–U5
- **Prerequisite pending (secrets)**: S1, S2, S3, S4 (VITE_SENTRY_DSN + SENTRY_DSN)
- **Instrumentation added (S4, S5)**: sync permanent failure events + push send breadcrumbs/errors now emit to Sentry
- **UI gaps closed (U1, U3, U6)**: EmptyState added to admin users list + audit-log; ClerkErrorBoundary text softened; secondary action buttons upgraded from h-10 (40 px) to h-11 (44 px)
- **Manual-only gates**: D5 (pg_dump restore), U4 (physical QR low-light field test), U5 (usability test)

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (set by Replit)
- `SESSION_SECRET` — Express session secret
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key (`pk_test_...` dev / `pk_live_...` prod)
- `CLERK_SECRET_KEY` — Clerk secret key (`sk_test_...` dev / `sk_live_...` prod)
- `ALLOWED_ORIGIN` — Production deployed URL for CORS enforcement
- `ADMIN_EMAILS` — Comma-separated emails auto-promoted to admin on every login (e.g. `danerez5@gmail.com`)
- `VITE_SENTRY_DSN` — Optional: Sentry DSN for frontend error tracking (enables S1, S3, S4 metrics)
- `SENTRY_DSN` — Optional: Sentry DSN for backend error tracking (enables S2, S5 metrics)
- `SENTRY_AUTH_TOKEN` — Optional: Sentry auth token for source map upload at build time (`sntrys_...`)
- `SENTRY_ORG` — Optional: Sentry organization slug (required alongside `SENTRY_AUTH_TOKEN`)
- `SENTRY_PROJECT` — Optional: Sentry project slug (required alongside `SENTRY_AUTH_TOKEN`)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Optional: override auto-generated VAPID keys
- `UNDO_TTL_MS` — Optional: override undo token TTL in milliseconds (default: 90,000)

## Production Deployment Checklist

### Step 1 — Switch Clerk to Production Mode
1. Go to **https://dashboard.clerk.com/apps** and open your VetTrack app
2. In the left sidebar click **Settings**
3. Scroll to **"Switch to production"** and follow the wizard
4. Copy the two production keys: `pk_live_...` (Publishable) and `sk_live_...` (Secret)

### Step 2 — Set Production Secrets in Replit
| Secret | Value |
|--------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (from Clerk) |
| `CLERK_SECRET_KEY` | `sk_live_...` (from Clerk) |
| `ALLOWED_ORIGIN` | `https://<your-app>.replit.app` |
| `VITE_SENTRY_DSN` | DSN from your Sentry project (frontend) |
| `SENTRY_DSN` | DSN from your Sentry project (backend) |

### Step 3 — Add Allowed Origin in Clerk Dashboard
1. Clerk Dashboard → **Configure** → **Paths**
2. **Allowed redirect URLs**: `https://<your-app>.replit.app/*`
3. **Allowed origins**: `https://<your-app>.replit.app`

### Step 4 — Deploy
Click **Deploy / Publish** in Replit. After success, verify:
- Clerk sign-in form loads at the production URL
- Sign in with an `ADMIN_EMAILS` address and confirm the dashboard loads
- Browser console shows no CORS or Clerk errors

### Step 5 — Run Production Readiness Gate
Run through every criterion in `PRODUCTION_READINESS.md` and complete the Sign-Off Checklist (§5) before treating the deployment as clinic-ready.

### Notes
- Israeli phone numbers (+972): enable Israel in Clerk Dashboard → Configure → User & Authentication → Phone numbers → SMS sending → Allowed countries
- `ADMIN_EMAILS` auto-promotes email addresses to admin on every login (self-healing)
- The pre-deployment validation script (`npm run validate:prod`) checks environment variables, runs a secret scan, builds the frontend, and hits `/api/health`
