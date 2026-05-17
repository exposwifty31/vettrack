# VetTrack — Technical Debt Log

Items tracked here are known limitations, deferred work, or architectural compromises that don't block current functionality but should be addressed before scaling or handoff.

---

## Active Items

### HIGH — Inventory job failure visibility

**What:** `vt_inventory_jobs` has no operator UI. Medication deduction failures (terminal `status='failed'`) are only visible in the raw DB or server logs. There is no admin dashboard, no alert, and no one-click retry.

**Impact:** A technician completing a medication task may silently fail to deduct inventory. This requires periodic manual DB inspection to detect.

**Resolution path:** Add an admin `/inventory-jobs` page with failed job list, failure reason display, and manual retry button. Worker already supports re-enqueue.

---

### MEDIUM — Integration outbound sync is request-scoped only

**What:** Outbound patient/appointment/billing sync (VetTrack → external PMS) is not batched. The queue worker processes `direction: "outbound"` jobs as `skipped` with "not yet implemented". Outbound sync must be triggered per-record via direct API calls.

**Impact:** Large bulk exports require per-record API calls. No scheduled outbound delta sync.

**Resolution path:** Implement outbound batch handlers in `server/workers/integration.worker.ts` for `pushPatient`, `pushAppointment`, and `exportBillingEntry`, with delta tracking via `external_synced_at`.

---

### MEDIUM — pdf-parse dependency is unmaintained

**What:** `pdf-parse@1.1.4` (used in pharmacy forecast PDF import) has had no releases since 2021. No known active CVEs, but it receives no security updates.

**Impact:** Low — PDF import is an infrequent admin operation. Risk is theoretical.

**Resolution path:** Evaluate `pdfjs-dist` or `pdf2json` as replacements. Migration requires updating `server/routes/forecast.ts`.

---

### LOW — App tour video has UUID filename

**What:** `public/copy_7E88749A-28D9-4306-9CB2-807CF4452369 (1).mp4` is referenced in `src/pages/app-tour.tsx:9` as `APP_TOUR_VIDEO_FILENAME`. The filename was preserved from an original upload artifact.

**Impact:** Cosmetic. Works correctly but is confusing for anyone exploring the repo.

**Resolution path:** Rename the file to `vettrack-app-tour-v2.mp4`, update the constant in `app-tour.tsx`. Low priority.

---

### LOW — Appointments API uses `db.select()` for idempotency check

**What:** `server/routes/appointments.ts:365` uses `.select()` (all columns) for a medication task idempotency check that returns the full row. The full row is needed because it's returned in the `idempotent: true` response.

**Impact:** Minimal — this is a single-row lookup with `LIMIT 1`, not a list query. No payload bloat in the normal path.

**Resolution path:** If API response pruning is needed in future, create a separate GET endpoint for the idempotent response and narrow the select.

---

### LOW — Dev-mode Clerk bypass is all-or-nothing

**What:** In `NODE_ENV=development`, a fallback admin user (`DEV_ADMIN`) is loaded if Clerk returns no auth. This makes the entire app accessible without Clerk in dev. There is no per-feature dev toggle.

**Impact:** Dev-only. No production risk (gated on `NODE_ENV !== "production"` in multiple places).

**Resolution path:** No action required until the team grows and needs isolated dev environments.

---

### MEDIUM — SW activate wipes the entire previous cache generation

**What:** `public/sw.js` activate handler deletes every `vettrack-*` cache whose name differs from the new `CACHE_NAME`. With the Phase 9 per-build cache naming (`vettrack-${version}-${ts}`), every deploy invalidates 100% of the prior generation's cached chunks, including assets the previous SW just lazily cached during the same load. A stale-shell race against this wholesale wipe is the underlying condition the Phase 10 `index.html` recovery script papers over.

**Impact:** Mostly hidden by the new recovery script (one reload on the affected session). Increases first-load latency after every deploy because nothing carries over. Adds reload pressure on installed PWAs.

**Resolution path:** Investigate a generation-aware retention strategy — e.g. keep the most recent N cache buckets, or migrate compatible entries from the previous bucket into the new one on activate. **Out of scope for Phase 10** (no SW lifecycle / fetch / install semantics changes). Re-evaluate when the recovery script's reload-count telemetry signals a high enough recovery rate to justify the work.

---

## Resolved Items

| Item | Resolved In |
|------|-------------|
| Hard-delete scheduler removing users after 7 days | Phase 9 (cleanup-scheduler.ts rewrite) |
| Clerk webhook not mounted before express.json() | Phase 9 (server/index.ts mount order) |
| Push notification errors swallowed silently | Phase 5 Batch 3 (settings.tsx toast) |
| `jsqr` unused dependency in package.json | Phase 5 Batch 1 |
| Missing audit logs on billing POST, equipment restore, code-blue events, integration CRUD | Phase 5 Batch 4 |
| `DB_CONFIG_ENCRYPTION_KEY` and `CLERK_WEBHOOK_SECRET` not validated at startup | Phase 5 Batch 4 |
| No bundle chunk splitting (recharts, jspdf in main chunk) | Phase 5 Batch 2 |
| Missing DB index on animals (clinic_id, name) for patient search | Phase 5 Batch 2 |
