/**
 * R-SH-F1.2 — Shift-handover delta generator (all 4 delta types) at shift end.
 *
 * `generateShiftHandover(clinicId, shiftSessionId, opts?)` aggregates the
 * shift-window deltas from the EXISTING `vt_audit_logs` + `vt_event_outbox`
 * tables (no new realtime path/transport) over the shift window `[start, end)`
 * into the four locked delta dimensions — custody / task-state / alerts /
 * dispenses — plus an open-items list, and persists a `vt_shift_handover`
 * artifact.
 *
 * Idempotent per `shiftSessionId`: the scheduler (no-`opts`) path is retry-safe
 * — if a current revision already exists for `(clinicId, shiftSessionId)` it
 * returns that row unchanged (same `generatedAt`, no duplicate deltas), else it
 * inserts `revision = 1`. An intentional `{ regenerate: true }` inserts
 * `max(revision) + 1`, preserving all prior revisions. There is NO public HTTP
 * generate route in v1 — the only caller is the shift-end scheduler, so
 * `clinicId` is always system-derived.
 *
 * System-derived observed signals (R-SH-F1.3) are collected on their OWN
 * clinic-scoped read path over `vt_scan_logs` (app-observed custody/scan/
 * readiness events, distinct from the manually-logged audit/outbox deltas).
 *
 * Every read carries an explicit target-table `clinicId` predicate (audit,
 * outbox, scan-logs, shift-sessions, handover) — a cross-clinic event is never
 * aggregated. `patientWorklist` is left `{ state: 'not_configured' }` here;
 * R-SH-F1.4 populates it through the PMS-agnostic port.
 */
import { randomUUID } from "crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db, auditLogs, eventOutbox, scanLogs, shiftSessions, shifts, shiftHandover, users } from "../db.js";
import { logAudit } from "./audit.js";
import type { ShiftHandoverRow } from "../schema/ops.js";
import { OUTBOX_TYPE_AUDIT_LOG } from "./event-publisher.js";
import { resolveNextShiftRoster } from "./shift-handover-roster.js";
import { enqueueNotificationJob } from "./queue.js";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate } from "../../lib/i18n/index.js";
import {
  serializePatientWorklist,
  type ShiftHandoverDeltas,
  type ShiftHandoverDeltaEntry,
  type ShiftHandoverObservedSignal,
  type ShiftHandoverOpenItem,
} from "./shift-handover.js";
import {
  resolvePatientWorklist,
  type PatientWorklistDeps,
} from "../integrations/patient-worklist-port.js";
import {
  isWindowSessionId,
  parseWindowSessionId,
  windowBounds,
} from "./shift-window.js";

type DeltaCategory = keyof ShiftHandoverDeltas;

/**
 * Audit action-types mapped to their delta dimension. Explicit so the artifact
 * stays a compact, deterministic snapshot — an action not listed here (and not
 * matched by the keyword fallback below) is intentionally excluded.
 */
const CUSTODY_ACTIONS = new Set<string>([
  "equipment_checked_out",
  "equipment_returned",
  "equipment_reverted",
  "equipment_dock_return",
  "equipment_custody_state_changed",
  "equipment_custody_chain_broken",
  "equipment_emergency_checkout",
]);
const TASK_ACTIONS = new Set<string>([
  "task_created",
  "task_updated",
  "task_started",
  "task_completed",
  "task_cancelled",
  "task_approved",
]);
const ALERT_ACTIONS = new Set<string>([
  "alert_acknowledged",
  "alert_acknowledgment_removed",
  "alert_seen",
  "alert_resolved",
  "alert_reopened",
  "whatsapp_alert_created",
]);
const DISPENSE_ACTIONS = new Set<string>([
  "inventory_dispensed",
  "dispense_confirmed",
  "dispense_emergency_created",
  "emergency_dispense_reconciled",
]);

/** Task/alert kinds that CLOSE an open item — a terminal kind is never "open". */
const TASK_TERMINAL = new Set<string>(["task_completed", "task_cancelled"]);
const ALERT_TERMINAL = new Set<string>(["alert_resolved"]);

/**
 * Classify an audit action-type OR an outbox event-type into one of the four
 * delta dimensions (or `null` to exclude). Explicit sets cover the audit
 * action-types; a normalized keyword fallback covers heterogeneous outbox
 * event-types (e.g. `EQUIPMENT_CUSTODY_STATE_CHANGED`, `custody_returned`).
 */
export function classifyDeltaKind(kind: string): DeltaCategory | null {
  if (CUSTODY_ACTIONS.has(kind)) return "custody";
  if (TASK_ACTIONS.has(kind)) return "taskState";
  if (ALERT_ACTIONS.has(kind)) return "alerts";
  if (DISPENSE_ACTIONS.has(kind)) return "dispenses";
  const norm = kind.toUpperCase();
  if (norm.includes("CUSTODY")) return "custody";
  if (norm.includes("DISPENSE")) return "dispenses";
  if (norm.includes("ALERT")) return "alerts";
  if (norm.includes("TASK")) return "taskState";
  return null;
}

/**
 * Domain-outbox event types that are a realtime-TRANSPORT MIRROR of a
 * vt_audit_logs row (the same logical transition, emitted for SSE delivery) —
 * NOT an independent handover record. They are excluded from delta aggregation
 * so a custody move is counted ONCE, from its authoritative audit row, never
 * doubled. A type absent from this set is treated as a distinct record and kept,
 * so a genuinely independent domain event is never silently dropped.
 */
const AUDIT_MIRROR_OUTBOX_TYPES = new Set<string>(["EQUIPMENT_CUSTODY_STATE_CHANGED"]);

export interface ShiftWindow {
  start: Date;
  end: Date;
}

/**
 * Resolve the `[start, end)` window for a shift session, with an explicit
 * `clinicId` predicate. Supports both a legacy `vt_shift_sessions` id and a
 * roster window id (`win:<clinic>:<date>:<start>` — the shift-chat frame).
 */
export async function resolveShiftWindow(
  clinicId: string,
  shiftSessionId: string,
): Promise<ShiftWindow> {
  if (isWindowSessionId(shiftSessionId)) {
    const parsed = parseWindowSessionId(shiftSessionId);
    if (!parsed || parsed.clinicId !== clinicId) {
      throw new Error(
        `shift-handover: window id does not belong to clinic ${clinicId}: ${shiftSessionId}`,
      );
    }
    const [shift] = await db
      .select({ date: shifts.date, startTime: shifts.startTime, endTime: shifts.endTime })
      .from(shifts)
      .where(
        and(
          eq(shifts.clinicId, clinicId),
          eq(shifts.date, parsed.date),
          eq(shifts.startTime, parsed.startTime),
        ),
      )
      .limit(1);
    if (!shift) {
      throw new Error(`shift-handover: no roster shift for window ${shiftSessionId}`);
    }
    const { startedAt, endsAt } = windowBounds(shift);
    return { start: startedAt, end: endsAt };
  }

  const [session] = await db
    .select({ startedAt: shiftSessions.startedAt, endedAt: shiftSessions.endedAt })
    .from(shiftSessions)
    .where(and(eq(shiftSessions.id, shiftSessionId), eq(shiftSessions.clinicId, clinicId)))
    .limit(1);
  if (!session) {
    throw new Error(
      `shift-handover: no shift session ${shiftSessionId} for clinic ${clinicId}`,
    );
  }
  return { start: session.startedAt, end: session.endedAt ?? new Date() };
}

function emptyDeltas(): ShiftHandoverDeltas {
  return { custody: [], taskState: [], alerts: [], dispenses: [] };
}

/**
 * Aggregate the four delta dimensions from `vt_audit_logs` + `vt_event_outbox`
 * over `[start, end)`. Both reads carry an explicit `clinicId` predicate; the
 * outbox `audit_log` wrapper rows are skipped (they mirror audit rows already
 * counted). Ordered oldest→newest for stable open-item resolution.
 */
async function aggregateDeltas(
  clinicId: string,
  window: ShiftWindow,
): Promise<ShiftHandoverDeltas> {
  const deltas = emptyDeltas();

  const auditRows = await db
    .select({
      id: auditLogs.id,
      actionType: auditLogs.actionType,
      targetId: auditLogs.targetId,
      targetType: auditLogs.targetType,
      timestamp: auditLogs.timestamp,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.clinicId, clinicId),
        gte(auditLogs.timestamp, window.start),
        lt(auditLogs.timestamp, window.end),
      ),
    )
    .orderBy(auditLogs.timestamp, auditLogs.id);

  for (const r of auditRows) {
    const category = classifyDeltaKind(r.actionType);
    if (!category) continue;
    const entry: ShiftHandoverDeltaEntry = {
      sourceId: r.id,
      kind: r.actionType,
      targetId: r.targetId ?? null,
      targetType: r.targetType ?? null,
      at: r.timestamp.toISOString(),
    };
    deltas[category].push(entry);
  }

  const outboxRows = await db
    .select({
      id: eventOutbox.id,
      type: eventOutbox.type,
      payload: eventOutbox.payload,
      occurredAt: eventOutbox.occurredAt,
    })
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.clinicId, clinicId),
        gte(eventOutbox.occurredAt, window.start),
        lt(eventOutbox.occurredAt, window.end),
      ),
    )
    .orderBy(eventOutbox.occurredAt, eventOutbox.id);

  for (const r of outboxRows) {
    if (r.type === OUTBOX_TYPE_AUDIT_LOG) continue;
    // A realtime-transport mirror of a custody audit already counted from the
    // audit log (the authoritative record) — excluded so the move is not doubled.
    // A type NOT in the set is a distinct record and is kept. See AUDIT_MIRROR_OUTBOX_TYPES.
    if (AUDIT_MIRROR_OUTBOX_TYPES.has(r.type)) continue;
    const category = classifyDeltaKind(r.type);
    if (!category) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    const targetType = typeof payload.targetType === "string" ? payload.targetType : null;
    const entry: ShiftHandoverDeltaEntry = {
      sourceId: String(r.id),
      kind: r.type,
      targetId,
      targetType,
      at: r.occurredAt.toISOString(),
    };
    deltas[category].push(entry);
  }

  // Audit rows are appended before outbox rows, so each dimension is not globally
  // chronological. Sort oldest->newest by `at` so deriveOpenItems' "latest wins"
  // reflects true chronology and a stale older event cannot reopen a terminal one.
  for (const dim of Object.keys(deltas) as DeltaCategory[]) {
    deltas[dim].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  return deltas;
}

/**
 * Collect SYSTEM-DERIVED observed signals over `[start, end)` on their OWN
 * clinic-scoped read path — `vt_scan_logs` (app-observed custody/scan/readiness
 * events the system recorded, distinct from the manually-logged audit/outbox
 * deltas). Carries an explicit `clinicId` predicate; a cross-clinic scan is
 * never observed. Ordered oldest→newest for a stable snapshot. The `kind` is a
 * bounded `scan:<status>` label derived from the scan's own status column — no
 * PII, no free-form text.
 */
async function collectObservedSignals(
  clinicId: string,
  window: ShiftWindow,
): Promise<ShiftHandoverObservedSignal[]> {
  const scanRows = await db
    .select({
      id: scanLogs.id,
      status: scanLogs.status,
      timestamp: scanLogs.timestamp,
    })
    .from(scanLogs)
    .where(
      and(
        eq(scanLogs.clinicId, clinicId),
        gte(scanLogs.timestamp, window.start),
        lt(scanLogs.timestamp, window.end),
      ),
    )
    .orderBy(scanLogs.timestamp, scanLogs.id);

  return scanRows.map((r) => ({
    sourceId: r.id,
    kind: `scan:${r.status}`,
    at: r.timestamp.toISOString(),
  }));
}

/**
 * Derive open items from the task/alert deltas: for each distinct `targetId`,
 * the item is open when its LATEST delta in the window is non-terminal (a task
 * still in progress, an alert still unresolved). Deltas ordered oldest→newest.
 */
function deriveOpenItems(deltas: ShiftHandoverDeltas): ShiftHandoverOpenItem[] {
  const items: ShiftHandoverOpenItem[] = [];

  const latestByTarget = (
    entries: ShiftHandoverDeltaEntry[],
  ): Map<string, ShiftHandoverDeltaEntry> => {
    const map = new Map<string, ShiftHandoverDeltaEntry>();
    for (const e of entries) {
      if (!e.targetId) continue;
      map.set(e.targetId, e); // entries are oldest→newest, so last wins
    }
    return map;
  };

  for (const [targetId, entry] of latestByTarget(deltas.taskState)) {
    if (TASK_TERMINAL.has(entry.kind)) continue;
    items.push({ id: targetId, kind: "task", summary: `${entry.kind}:${targetId}` });
  }
  for (const [targetId, entry] of latestByTarget(deltas.alerts)) {
    if (ALERT_TERMINAL.has(entry.kind)) continue;
    items.push({ id: targetId, kind: "alert", summary: `${entry.kind}:${targetId}` });
  }

  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return items;
}

/** The current (max-revision) handover row for a session, or undefined. */
async function currentHandover(
  clinicId: string,
  shiftSessionId: string,
): Promise<ShiftHandoverRow | undefined> {
  const [row] = await db
    .select()
    .from(shiftHandover)
    .where(
      and(
        eq(shiftHandover.clinicId, clinicId),
        eq(shiftHandover.shiftSessionId, shiftSessionId),
      ),
    )
    .orderBy(desc(shiftHandover.revision))
    .limit(1);
  return row;
}

/**
 * R-SH-F1.5 — injectable seams for the "push once to the next-shift roster" step
 * fired when a NEW handover revision is inserted. Production passes none (real
 * `resolveNextShiftRoster` + `enqueueNotificationJob`); tests override `enqueue`
 * (and optionally `resolveRoster`) to assert the once-only fan-out without a
 * live queue. The push-target roster is the SAME `resolveNextShiftRoster` output
 * that authorizes acknowledge (server/services/shift-handover.service.ts), so
 * push-targets ≡ ack-authorized set by construction.
 */
export interface ShiftHandoverNotifyDeps {
  resolveRoster?: (clinicId: string, afterEnd: Date) => Promise<string[]>;
  enqueue?: (userId: string, ctx: { clinicId: string; handoverId: string }) => Promise<void>;
}

export interface GenerateShiftHandoverOptions {
  /** Force a NEW revision (max+1) preserving priors — the manual "handover now" path. */
  regenerate?: boolean;
  /**
   * Injectable seams for the PMS-agnostic patient-worklist port (R-SH-F1.4).
   * The scheduler path passes none (real registry + credential store); tests
   * override to drive a mock adapter through the SAME port.
   */
  worklistDeps?: PatientWorklistDeps;
  /** R-SH-F1.5 — override the next-shift push fan-out (tests inject a spy). */
  notifyDeps?: ShiftHandoverNotifyDeps;
}

/**
 * Build + enqueue the default per-user handover push (`push_to_user`). Copy is
 * pulled from `push.handover.*` at the recipient's own locale — no hardcoded
 * strings — and the `idempotencyKey` makes the fan-out once-only even under a
 * scheduler retry. `enqueueNotificationJob` never throws.
 */
async function defaultEnqueueHandoverPush(
  clinicId: string,
  userId: string,
  handoverId: string,
): Promise<void> {
  const [row] = await db
    .select({ preferredLocale: users.preferredLocale })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
    .limit(1);
  const locale = row?.preferredLocale ?? "he";
  const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
  const title = translate(primary, "push.handover.title", undefined, { fallbackDict: fallback, locale: lc });
  const body = translate(primary, "push.handover.body", undefined, { fallbackDict: fallback, locale: lc });
  await enqueueNotificationJob({
    type: "push_to_user",
    clinicId,
    userId,
    title,
    body,
    tag: `handover-ready-${handoverId}`,
    url: "/handoff",
    priority: "NORMAL",
    idempotencyKey: `handover-ready:${handoverId}:${userId}`,
  });
}

/**
 * Fire the handover push ONCE to the next-shift roster (the users rostered on
 * the earliest shift starting after the current shift's end). Guarded so a push
 * failure never breaks generation. Called only on a genuine NEW insert.
 */
async function notifyNextShiftRoster(
  clinicId: string,
  afterEnd: Date,
  handoverId: string,
  deps?: ShiftHandoverNotifyDeps,
): Promise<void> {
  try {
    const resolveRoster = deps?.resolveRoster ?? resolveNextShiftRoster;
    const roster = await resolveRoster(clinicId, afterEnd);
    const enqueue =
      deps?.enqueue ??
      ((userId: string, ctx: { clinicId: string; handoverId: string }) =>
        defaultEnqueueHandoverPush(ctx.clinicId, userId, ctx.handoverId));
    for (const userId of roster) {
      await enqueue(userId, { clinicId, handoverId });
    }
  } catch (err) {
    console.error("[shift-handover] next-shift push failed", { clinicId, handoverId, err });
  }
}

/**
 * The internal `vt_users.id` set for a clinic — every `ready` worklist
 * `byTechId` must be a member (a cross-clinic id is rejected on serialize).
 * Explicit `clinicId` predicate.
 */
async function loadClinicTechIds(clinicId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clinicId, clinicId));
  return new Set(rows.map((r) => r.id));
}

/**
 * Generate (or, on the retry path, return the current) shift-handover artifact
 * for `(clinicId, shiftSessionId)`. See module doc for the idempotency contract.
 */
export async function generateShiftHandover(
  clinicId: string,
  shiftSessionId: string,
  opts?: GenerateShiftHandoverOptions,
): Promise<ShiftHandoverRow> {
  const existing = await currentHandover(clinicId, shiftSessionId);
  if (existing && !opts?.regenerate) {
    // Retry-safe: return the persisted current revision verbatim — same
    // generatedAt, no duplicate deltas.
    return existing;
  }

  const window = await resolveShiftWindow(clinicId, shiftSessionId);
  const deltas = await aggregateDeltas(clinicId, window);
  const openItems = deriveOpenItems(deltas);
  const observedSignals = await collectObservedSignals(clinicId, window);
  const validTechIds = await loadClinicTechIds(clinicId);
  const resolvedWorklist = await resolvePatientWorklist(clinicId, window, opts?.worklistDeps);
  const patientWorklist = serializePatientWorklist(resolvedWorklist, { validTechIds });
  const revision = existing ? existing.revision + 1 : 1;

  try {
    const [insertedRow] = await db
      .insert(shiftHandover)
      .values({
        id: randomUUID(),
        clinicId,
        shiftSessionId,
        revision,
        deltas,
        openItems,
        observedSignals,
        patientWorklist,
      })
      .returning();
    if (!insertedRow) {
      // INSERT ... RETURNING yields the row on success; a missing row means the
      // insert did not take, so fail loudly rather than assert non-null blindly.
      throw new Error("shift-handover: INSERT ... RETURNING produced no row");
    }
    // R-SH-F1.5 — a NEW revision was persisted: push ONCE to the next-shift
    // roster. The retry path (returned `existing` above) never reaches here, so
    // the fan-out is once-only per artifact.
    await notifyNextShiftRoster(clinicId, window.end, insertedRow.id, opts?.notifyDeps);
    // Record the generation ONCE — only on this fresh/regenerated-revision path.
    // The retry short-circuit returned `existing` above, so no duplicate audit
    // is ever written for an idempotent re-generate (fire-and-forget).
    logAudit({
      clinicId,
      actionType: "shift_handover_generated",
      performedBy: "system:shift_handover",
      performedByEmail: "shift-handover@vettrack.system",
      targetId: insertedRow.id,
      targetType: "shift_handover",
    });
    return insertedRow;
  } catch (err) {
    // Concurrent no-opts generate lost the race on the unique
    // (clinicId, shiftSessionId, revision) key — return the row the winner
    // persisted so the retry contract still holds.
    if (!opts?.regenerate) {
      const raced = await currentHandover(clinicId, shiftSessionId);
      if (raced) return raced;
    }
    throw err;
  }
}
