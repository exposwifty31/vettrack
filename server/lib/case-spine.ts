/**
 * VetTrack 2.0 — Case Spine service core (task 0.2 spike).
 *
 * Pure, DB-free orchestration for the physical×clinical join. Mirrors the
 * reader/writer port precedent in readiness-forecast-engine.ts so the join
 * logic is unit-testable against an in-memory fake, with the Drizzle-backed
 * adapter living in server/services/case-spine.store.ts.
 *
 * Spike scope: prove that creating a case and attaching ONE dispense event
 * yields a queryable, clinic-scoped case-timeline row. Conflict resolution
 * (concurrent attaches to the same case) and the other five event paths
 * (custody scan, Code Blue session, task, damage report, RFID) are OUT of
 * scope — see docs/plans/2.0/case-spine-spike-findings.md.
 */

export type CaseStatus = "open" | "closed";

export interface CaseRecord {
  id: string;
  clinicId: string;
  /** Opaque PMS patient join key. May be absent. Never PHI. */
  patientExternalId: string | null;
  status: CaseStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCaseInput {
  clinicId: string;
  patientExternalId?: string | null;
}

/** A single physical event attached to a case, projected into the timeline. */
export interface CaseTimelineEntry {
  /** Discriminator — only "dispense" exists in the spike; 1.2 adds the rest. */
  kind: "dispense";
  clinicId: string;
  caseId: string;
  /** The attached event's own id (e.g. dispense event id). */
  refId: string;
  occurredAt: Date;
}

/** Read port — every method is clinic-scoped (multi-tenancy rule). */
export interface CaseSpineReader {
  getCase(clinicId: string, caseId: string): Promise<CaseRecord | null>;
  getCaseTimeline(clinicId: string, caseId: string): Promise<CaseTimelineEntry[]>;
}

/** Write port — additive attach only; never mutates the dispense event's meaning. */
export interface CaseSpineWriter {
  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  attachDispenseEvent(clinicId: string, caseId: string, dispenseEventId: string): Promise<void>;
}

export interface CaseSpineStore extends CaseSpineReader, CaseSpineWriter {}

export interface CreateCaseAndAttachDispenseInput {
  clinicId: string;
  dispenseEventId: string;
  patientExternalId?: string | null;
}

export interface CreateCaseAndAttachDispenseResult {
  case: CaseRecord;
  timeline: CaseTimelineEntry[];
}

/**
 * The spike's proof function: create a case, attach one dispense event to it,
 * and read back the clinic-scoped timeline. Pure orchestration — all storage
 * lives behind the CaseSpineStore port.
 */
export async function createCaseAndAttachDispense(
  store: CaseSpineStore,
  input: CreateCaseAndAttachDispenseInput,
): Promise<CreateCaseAndAttachDispenseResult> {
  const created = await store.createCase({
    clinicId: input.clinicId,
    patientExternalId: input.patientExternalId ?? null,
  });

  await store.attachDispenseEvent(input.clinicId, created.id, input.dispenseEventId);

  const timeline = await store.getCaseTimeline(input.clinicId, created.id);

  return { case: created, timeline };
}
