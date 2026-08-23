import { z } from "zod";

// Request-body schemas for the Code Blue routes. Kept in a module separate
// from both the router (server/routes/code-blue.ts) and its handlers
// (server/routes/code-blue/handlers/*.ts) so handlers can import a schema's
// inferred type without creating a router → handler → router import cycle.
// code-blue.ts re-exports every name below unchanged, so the existing
// `from "../server/routes/code-blue.js"` import contract (see
// tests/strict-body-validation.test.ts) keeps resolving exactly as before.

export const startSchema = z.object({
  localStartedAt: z.string().datetime().optional(),
}).strict();

export const endSchema = z.object({
  outcome: z.enum(["rosc", "died", "transferred", "ongoing"]).optional(),
  notes: z.string().max(2000).optional(),
  timeline: z
    .array(z.object({ elapsed: z.number(), label: z.string().max(200) }))
    .max(500)
    .optional(),
}).strict();

export const startSessionSchema = z.object({
  managerUserId: z.string().min(1),
  managerUserName: z.string().min(1),
  preCheckPassed: z.boolean().optional(),
  localStartedAt: z.string().datetime().optional(),
  /** Primary unit for this event (logged at elapsed 0). */
  equipmentId: z.string().min(1).optional(),
  /** Accepted for client idempotency hygiene; not persisted on session start. */
  idempotencyKey: z.string().min(1).max(128).optional(),
}).strict();

export const logEntrySchema = z.object({
  idempotencyKey: z.string().uuid(),
  elapsedMs: z.number().int().min(0),
  label: z.string().min(1).max(200),
  category: z.enum(["equipment", "note"]),
  equipmentId: z.string().optional(),
}).strict();

export const endSessionSchema = z.object({
  outcome: z.enum(["rosc", "died", "transferred", "ongoing"]),
  earlyStopReason: z.string().min(1).max(500).optional(),
}).strict();

// R-CBF-1.1 — one-tap Code Blue orchestration body.
export const oneTapStartSchema = z.object({
  /** Per-hold-gesture idempotency token (R-CBF-1.3), persisted across retries. */
  idempotencyToken: z.string().min(1).max(128),
  managerUserId: z.string().min(1),
  managerUserName: z.string().min(1),
  preCheckPassed: z.boolean().optional(),
  /** Optimistic location hint — re-validated server-side, never trusted to steer cart selection. */
  locationHint: z.object({ roomId: z.string().nullable() }).strict().optional(),
}).strict();

// PATCH /api/code-blue/sessions/:id/reconcile
// Fix D: Validates billing completeness + no failed inventory jobs before marking reconciled.
// Pass ?force=true + body.forceReason to override gaps. Admin only.
export const reconcileSchema = z.object({
  forceReason: z.string().min(1).max(500).optional(),
}).strict();

// POST /api/code-blue/sessions/:id/manual-billing
// Creates a manual billing entry for an unbilled dispense. Admin only.
export const manualBillingSchema = z.object({
  inventoryLogId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  /** When set, clears matching `PROBABLE_ORPHAN_USAGE` Smart Cop alert after billing linkage. */
  resolveTaskId: z.string().uuid().optional(),
}).strict();
