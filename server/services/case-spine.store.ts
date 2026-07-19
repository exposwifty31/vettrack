/**
 * VetTrack 2.0 — Case Spine Drizzle adapter (task 0.2 spike).
 *
 * Real, clinic-scoped implementation of the CaseSpineStore port from
 * server/lib/case-spine.ts. Deliberately NOT wired into any route in the spike
 * — it exists to prove the DB-backed shape typechecks and to give Task 1.2 a
 * starting adapter. Every query filters by `clinicId` (multi-tenancy rule).
 */
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { cases, dispenseEvents, db } from "../db.js";
import type {
  CaseRecord,
  CaseSpineStore,
  CaseStatus,
  CaseTimelineEntry,
  CreateCaseInput,
} from "../lib/case-spine.js";

function toCaseRecord(row: typeof cases.$inferSelect): CaseRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientExternalId: row.patientExternalId ?? null,
    status: row.status as CaseStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleCaseSpineStore implements CaseSpineStore {
  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const [row] = await db
      .insert(cases)
      .values({
        id: randomUUID(),
        clinicId: input.clinicId,
        patientExternalId: input.patientExternalId ?? null,
        status: "open",
      })
      .returning();
    return toCaseRecord(row);
  }

  async attachDispenseEvent(clinicId: string, caseId: string, dispenseEventId: string): Promise<void> {
    // Additive attach only: sets the nullable case_id, clinic-scoped so a
    // dispense event from another clinic can never be attached.
    await db
      .update(dispenseEvents)
      .set({ caseId })
      .where(
        and(
          eq(dispenseEvents.id, dispenseEventId),
          eq(dispenseEvents.clinicId, clinicId),
        ),
      );
  }

  async getCase(clinicId: string, caseId: string): Promise<CaseRecord | null> {
    const [row] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.clinicId, clinicId)))
      .limit(1);
    return row ? toCaseRecord(row) : null;
  }

  async getCaseTimeline(clinicId: string, caseId: string): Promise<CaseTimelineEntry[]> {
    const rows = await db
      .select({
        id: dispenseEvents.id,
        clinicId: dispenseEvents.clinicId,
        caseId: dispenseEvents.caseId,
        createdAt: dispenseEvents.createdAt,
      })
      .from(dispenseEvents)
      .where(
        and(
          eq(dispenseEvents.clinicId, clinicId),
          eq(dispenseEvents.caseId, caseId),
        ),
      );

    return rows.map((r) => ({
      kind: "dispense" as const,
      clinicId: r.clinicId,
      caseId: r.caseId ?? caseId,
      refId: r.id,
      occurredAt: r.createdAt,
    }));
  }
}
