# VetTrack Equipment Readiness Wedge — Full Master Execution Plan with Code References, PR Breakdown, and Modular Architecture

**Document type:** Controlling execution plan (review-first; not yet incorporated until human sign-off)  
**Repository inspected:** `cursor/equipment-focus-cleanup-0bf6` (clean working tree)  
**Inspection date:** 2026-06-01 (read-only)

---

## Canonical status

**Approved with blockers — cleanup patch pending incorporation.**

Until incorporated into the master execution plan, this governance patch is **advisory governance text** and is **not** the controlling execution plan.

- **Incorporation requires explicit human sign-off.**
- **This document does not self-authorize incorporation.**
- After explicit approval and incorporation, it becomes the **governing blocker appendix** for the Equipment Readiness Wedge execution plan.
- **No application code work may begin from the pre-incorporation plan.**

---

## Part E — Canonical API policy

| Concept | Value |
|---------|--------|
| Mount (canonical board) | `/api/equipment-board` |
| Endpoint | `GET /api/equipment-board/snapshot` |
| Compatibility | `GET /api/display/snapshot` |

**Today:** only `app.use("/api/display", displayRoutes)` in `server/app/routes.ts`; `server/routes/display.ts` exports **singleton** `router` with `GET /snapshot`.

**Required PR2 pattern:**

```ts
export function createDisplayRouter(deps: DisplayRouterDeps) {
  const router = Router();
  router.get("/snapshot", createDisplaySnapshotHandler(deps));
  return router;
}
app.use("/api/display", createDisplayRouter(deps));
app.use("/api/equipment-board", createDisplayRouter(deps));
```

**Forbidden:** mounting same `displayRoutes` instance twice.

---

## Part O — PR11 scan-truth + DB mutation contract

**Design-blocked** until mapping table concrete and owners approved.

| Required field | Status |
|----------------|--------|
| target table | concrete required |
| allowed columns | concrete required |
| allowed status/type values | concrete required |
| outbox behavior | concrete required |
| truth-ranking behavior | concrete required |
| clinicId filter | concrete required |
| forbidden side effects | concrete required |

**May:** resolve tag; insert approved evidence; return truth + suggested action.

**Must not:** checkout, return, custody, emergency, task complete, ready/unavailable, custody/emergency outbox.

**Do not** invent freeform `vt_scan_logs.status` without approved evidence-event contract.

---

## Part P — PR12 Command façade (checkout/return only)

```ts
export async function performCheckout(input: CheckoutCommandInput): Promise<CheckoutDomainResult> {
  // authorization, validation, transaction, custody, evidence, audit, outbox
}
```

**Routes (planned):**

- `POST /api/equipment/:id/commands/checkout`
- `POST /api/equipment/:id/commands/return`

**Forbidden:** `fetch("/api/equipment/:id/checkout")`, internal HTTP, Express handlers as pseudo-services, duplicate state machine.

**Idempotency:** shared service boundary or approved adapter above it.

**Future commands (not PR12):** confirm-location, mark-issue, complete-inspection, mark-repaired, post-emergency-reset.

---

