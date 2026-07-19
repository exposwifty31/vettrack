/**
 * VetTrack 2.0 — Case Spine spike (task 0.2), server side.
 *
 * Proves the physical×clinical join: creating a case and attaching ONE dispense
 * event yields a queryable, clinic-scoped case-timeline row containing that
 * dispense event. Exercised against an in-memory fake CaseSpineStore (the
 * reader/writer port precedent from readiness-forecast-engine.ts) so the join
 * logic needs no live database.
 */
import { describe, expect, it } from "vitest";
import {
  createCaseAndAttachDispense,
  type CaseRecord,
  type CaseSpineStore,
  type CaseTimelineEntry,
  type CreateCaseInput,
} from "../server/lib/case-spine.js";

/** In-memory CaseSpineStore fake — clinic-scoped, mirrors the Drizzle adapter. */
class InMemoryCaseSpineStore implements CaseSpineStore {
  private cases = new Map<string, CaseRecord>();
  private attachments: Array<{ clinicId: string; caseId: string; dispenseEventId: string; at: Date }> = [];
  private seq = 0;

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const now = new Date(2026, 6, 19, 12, 0, this.seq++);
    const record: CaseRecord = {
      id: `case-${this.seq}`,
      clinicId: input.clinicId,
      patientExternalId: input.patientExternalId ?? null,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    this.cases.set(record.id, record);
    return record;
  }

  async attachDispenseEvent(clinicId: string, caseId: string, dispenseEventId: string): Promise<void> {
    this.attachments.push({ clinicId, caseId, dispenseEventId, at: new Date(2026, 6, 19, 12, 5, this.seq++) });
  }

  async getCase(clinicId: string, caseId: string): Promise<CaseRecord | null> {
    const found = this.cases.get(caseId);
    if (!found || found.clinicId !== clinicId) return null;
    return found;
  }

  async getCaseTimeline(clinicId: string, caseId: string): Promise<CaseTimelineEntry[]> {
    return this.attachments
      .filter((a) => a.clinicId === clinicId && a.caseId === caseId)
      .map((a) => ({
        kind: "dispense" as const,
        clinicId: a.clinicId,
        caseId: a.caseId,
        refId: a.dispenseEventId,
        occurredAt: a.at,
      }));
  }
}

describe("case-spine spike — create case + attach dispense yields a timeline row", () => {
  it("attaching a dispense event produces a queryable case timeline row", async () => {
    const store = new InMemoryCaseSpineStore();

    const result = await createCaseAndAttachDispense(store, {
      clinicId: "clinic-a",
      dispenseEventId: "disp-1",
      patientExternalId: "pms-patient-42",
    });

    expect(result.case.clinicId).toBe("clinic-a");
    expect(result.case.status).toBe("open");
    expect(result.case.patientExternalId).toBe("pms-patient-42");

    expect(result.timeline).toHaveLength(1);
    const [entry] = result.timeline;
    expect(entry.kind).toBe("dispense");
    expect(entry.refId).toBe("disp-1");
    expect(entry.caseId).toBe(result.case.id);
    expect(entry.clinicId).toBe("clinic-a");
  });

  it("case may exist before it is linked to a PMS patient (null patientExternalId)", async () => {
    const store = new InMemoryCaseSpineStore();
    const result = await createCaseAndAttachDispense(store, {
      clinicId: "clinic-a",
      dispenseEventId: "disp-2",
    });
    expect(result.case.patientExternalId).toBeNull();
    expect(result.timeline).toHaveLength(1);
  });

  it("timeline is clinic-scoped — a different clinic never sees the attachment", async () => {
    const store = new InMemoryCaseSpineStore();
    const { case: created } = await createCaseAndAttachDispense(store, {
      clinicId: "clinic-a",
      dispenseEventId: "disp-3",
    });

    const otherClinicTimeline = await store.getCaseTimeline("clinic-b", created.id);
    expect(otherClinicTimeline).toHaveLength(0);

    const otherClinicCase = await store.getCase("clinic-b", created.id);
    expect(otherClinicCase).toBeNull();
  });
});
