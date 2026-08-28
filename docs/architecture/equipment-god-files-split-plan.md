# Equipment god-files — split inventory and handoff

**Status:** Documentation only (item 9, backlog 3–7 / 9–10). **No implementation in this doc.**  
**Refreshed:** 2026-06-13 — after item 4 service extraction (`equipment-custody-toggle.service.ts`) merged.  
**Companion:** `docs/architecture/equipment-inline-mutations-inventory.md` (inline mutation replay/offline matrix).

**Handoff:** `tweaking-neighbor-cleaner` (or equivalent refactor agent) — split routes and page component per proposed slices below. Do **not** start extraction without product sign-off on paused inline mutations (see inline inventory).

---

## Why this exists

Two files exceed comfortable review size and mix concerns:

| File | Lines (main `442dd2a`) | Problem |
|------|-------------------|---------|
| `server/routes/equipment.ts` | ~1054 | Router + inline checkout/return/scan mutations + middleware stacks |
| `src/pages/equipment-detail.tsx` | ~2037 | Single page: custody, scans, dialogs, tabs, waitlist, operational state |

> **Snapshot scope:** every line count and line-range in this document is as of main
> `442dd2a` — the split-planning baseline. Both files have moved since; re-measure before
> cutting, and treat the numbers here as the plan's coordinates, not the current truth.

Item 4 extracted **toggle business logic** to `server/services/equipment-custody-toggle.service.ts` but left route wrappers inline. Checkout/return/scan remain inline and **paused** per inline-mutations inventory.

---

## `server/routes/equipment.ts` — handler groups

### Inline mutations (paused — see inline inventory)

| Lines (approx) | Method / path | Notes |
|----------------|---------------|--------|
| 287–455 | POST `/scan` | Legacy quick-scan; NFC uses `/:id/toggle` instead |
| 457–561 | POST `/:id/toggle` | Thin wrapper → `toggleEquipmentCustody` service |
| 563–796 | POST `/:id/checkout` | V1 gates, emergency header, waitlist, staging |
| 797–884 | POST `/:id/return` | Waitlist promote, charge alert, returns row |
| 885–931 | POST `/:id/seen` | Delegates to `recordEquipmentSeen` |
| 932–1104 | POST `/:id/scan` | Scan logs + undo tokens |

### Shared router concerns (stay on router until slice approved)

- Middleware registration order (`requireAuth`, limiters, `requireEffectiveRole`, validation, **replay last** on custody routes).
- `equipmentReplayIdempotency` endpoint map alignment with `server/lib/equipment-replay-idempotency.ts`.
- `mountEquipmentWaitlistRoutes(router)` at file bottom.

### Proposed split order (cleaner)

1. **Toggle route only** — move POST `/:id/toggle` handler to `handlers/post-equipment-toggle.ts` (service already exists).
2. **Checkout + return** — paired extraction; shared V1 pre-check patterns; highest risk — needs replay/offline test matrix sign-off.
3. **Scan pair** — POST `/scan` (legacy) vs POST `/:id/scan`; consider deprecating legacy path in product review.
4. **Seen** — thinnest; wrapper around existing service.

---

## `src/pages/equipment-detail.tsx` — sections

Single default export `EquipmentDetailPage` (starts ~L132). Major regions:

| Lines (approx) | Section | Split candidate |
|----------------|---------|-----------------|
| 132–223 | Auth/role gates, state, deep-link query params | `useEquipmentDetailPageState` hook |
| 224–820 | Mutations (checkout, return, scan, delete, bind, floor note, undo) | `useEquipmentDetailMutations` or feature module |
| 821–909 | Loading / error / derived flags (waitlist, recovery, custody) | selectors / small hooks |
| 910–1277 | Header, quick actions, banners, floor note, staff note | `EquipmentDetailHeader`, `EquipmentQuickActions` |
| 1278–1565 | Tabs: details, activity, readiness, scan log | tab components under `src/features/equipment-detail/` |
| 1583–1995 | Dialogs / sheets (status, report issue, scan sheet, move room, return) | one file per dialog cluster |

### Extraction principles

- Keep route page as composition shell (<300 lines target).
- Do **not** duplicate API calls — colocate React Query keys with extracted hooks.
- Preserve `data-testid` hooks used by Playwright / unit source tests.
- NFC deep-link toggle ref (`nfcDeepLinkToggleRef`) stays wired to custody mutations in one hook.

---

## `TODO(arch)` marker

See file header in `src/pages/equipment-detail.tsx` — points here for split sequencing.

---

## Verification (doc-only item)

| Check | Pass |
|-------|------|
| File exists at `docs/architecture/equipment-god-files-split-plan.md` | ✓ |
| Line-range inventory for `equipment.ts` inline groups | ✓ |
| Section inventory for `equipment-detail.tsx` | ✓ |
| Handoff note to cleaner; no code split in item 9 | ✓ |
