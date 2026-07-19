/**
 * Task 0.3 spike — reader PORT over the raw `vt_audit_logs` / `vt_event_outbox`
 * rows a shift-handover draft is grounded in.
 *
 * This exists so `tests/autopilot-spike.test.ts` can drive the delta ->
 * cited-fact pipeline with an in-memory fake (no live Postgres), following
 * the same reader-interface DI pattern as `ScheduleReader` /
 * `readiness-forecast-engine.ts`. Classification of a raw row into one of the
 * four delta dimensions is delegated to `classifyDeltaKind` — already
 * `export`ed from `shift-handover-generator.ts` — so the classification RULE
 * stays single-sourced between the shipped R-SH-F1 generator and this spike;
 * only the I/O (which rows exist) is injected here.
 *
 * `DrizzleShiftDeltaReader` is a real, typecheck-only demonstration of the
 * port against Postgres. It is NOT the wired production path — the actual
 * worker (server/workers/autopilotHandoverDraftWorker.ts) calls the shipped
 * `resolveShiftWindow` + `aggregateDeltas` directly for exact behavioral
 * fidelity with R-SH-F1. This reader exists to prove the port shape and to
 * give the spike's core test a way to run without a live DB.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { db, auditLogs, eventOutbox } from "../../db.js";
import { classifyDeltaKind, type ShiftWindow } from "../shift-handover-generator.js";
import { OUTBOX_TYPE_AUDIT_LOG } from "../event-publisher.js";
import type { ShiftHandoverDeltas, ShiftHandoverDeltaEntry } from "../shift-handover.js";
import type { ActionProposalCitedFact, ActionProposalCitationCategory } from "./action-proposal-types.js";

export interface RawAuditDeltaRow {
  id: string;
  actionType: string;
  targetId: string | null;
  targetType: string | null;
  timestamp: Date;
}

export interface RawOutboxDeltaRow {
  id: string;
  type: string;
  targetId: string | null;
  targetType: string | null;
  occurredAt: Date;
}

/** Port: fetch the raw audit/outbox rows for a clinic + shift window (clinicId-filtered). */
export interface ShiftDeltaReader {
  auditRows(clinicId: string, window: ShiftWindow): Promise<RawAuditDeltaRow[]>;
  outboxRows(clinicId: string, window: ShiftWindow): Promise<RawOutboxDeltaRow[]>;
}

function emptyDeltas(): ShiftHandoverDeltas {
  return { custody: [], taskState: [], alerts: [], dispenses: [] };
}

/**
 * Aggregate raw reader rows into `ShiftHandoverDeltas` (same shape R-SH-F1
 * persists) AND a flat, order-preserving `ActionProposalCitedFact[]` — the
 * ground-truth citation list this spike's proposals are checked against.
 * Every citedFact.sourceId traces back to a row the reader actually returned
 * — nothing here can fabricate a sourceId.
 */
export async function aggregateDeltasViaReader(
  clinicId: string,
  window: ShiftWindow,
  reader: ShiftDeltaReader,
): Promise<{ deltas: ShiftHandoverDeltas; citedFacts: ActionProposalCitedFact[] }> {
  const deltas = emptyDeltas();
  const citedFacts: ActionProposalCitedFact[] = [];

  const auditRows = await reader.auditRows(clinicId, window);
  for (const r of auditRows) {
    const category = classifyDeltaKind(r.actionType);
    if (!category) continue;
    const entry: ShiftHandoverDeltaEntry = {
      sourceId: r.id,
      kind: r.actionType,
      targetId: r.targetId,
      targetType: r.targetType,
      at: r.timestamp.toISOString(),
    };
    deltas[category].push(entry);
    citedFacts.push({
      sourceTable: "vt_audit_logs",
      sourceId: r.id,
      kind: r.actionType,
      category: category as ActionProposalCitationCategory,
      at: entry.at,
    });
  }

  const outboxRows = await reader.outboxRows(clinicId, window);
  for (const r of outboxRows) {
    const category = classifyDeltaKind(r.type);
    if (!category) continue;
    const entry: ShiftHandoverDeltaEntry = {
      sourceId: r.id,
      kind: r.type,
      targetId: r.targetId,
      targetType: r.targetType,
      at: r.occurredAt.toISOString(),
    };
    deltas[category].push(entry);
    citedFacts.push({
      sourceTable: "vt_event_outbox",
      sourceId: r.id,
      kind: r.type,
      category: category as ActionProposalCitationCategory,
      at: entry.at,
    });
  }

  for (const dim of Object.keys(deltas) as (keyof ShiftHandoverDeltas)[]) {
    deltas[dim].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
  citedFacts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return { deltas, citedFacts };
}

/** Real Drizzle implementation of the port — clinicId-scoped, mirrors the shipped generator's own reads. See module doc for why this is not the wired production path. */
export class DrizzleShiftDeltaReader implements ShiftDeltaReader {
  async auditRows(clinicId: string, window: ShiftWindow): Promise<RawAuditDeltaRow[]> {
    const rows = await db
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
    return rows.map((r) => ({
      id: r.id,
      actionType: r.actionType,
      targetId: r.targetId ?? null,
      targetType: r.targetType ?? null,
      timestamp: r.timestamp,
    }));
  }

  async outboxRows(clinicId: string, window: ShiftWindow): Promise<RawOutboxDeltaRow[]> {
    const rows = await db
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
    return rows
      .filter((r) => r.type !== OUTBOX_TYPE_AUDIT_LOG)
      .map((r) => {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id),
          type: r.type,
          targetId: typeof payload.targetId === "string" ? payload.targetId : null,
          targetType: typeof payload.targetType === "string" ? payload.targetType : null,
          occurredAt: r.occurredAt,
        };
      });
  }
}
