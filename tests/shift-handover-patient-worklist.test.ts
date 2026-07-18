/**
 * R-SH-F1.4 — Patient/animal worklist via the PMS integration port (adapter-agnostic).
 *
 * `patientWorklist` is populated through a PMS-AGNOSTIC port
 * (`server/integrations/patient-worklist-port.ts`) — a `PatientWorklistProvider`
 * capability on the adapter contract, resolved PER-CLINIC from
 * `vt_integration_configs` (`enabled` + `syncPatients`). The generator calls the
 * PORT, never a named PMS. Priza is only ONE possible adapter.
 *
 * This DB-integration suite asserts (all through `generateShiftHandover`, the
 * real path — no forked contract):
 *   - a MOCKED adapter resolved through the port populates the worklist per tech
 *     (`{ state: 'ready', entries: [{ externalId, display, byTechId }] }`);
 *   - NO enabled `syncPatients` adapter for the clinic → `patientWorklist` is
 *     EXACTLY `{ state: 'not_configured' }` (the discriminator, NOT an empty
 *     `ready` list) while deltas / open-items / observed-signals still generate;
 *   - a configured-but-FAILING adapter → `{ state: 'error', code }` (closed
 *     enum, NOT `not_configured`, NOT empty) while the rest still generates;
 *   - a SECOND, different stub adapter resolved through the SAME port yields the
 *     same worklist shape — proving the seam is adapter-agnostic, not
 *     Priza-coupled.
 *
 * Requires DATABASE_URL (e.g. from .env) with migration 177 applied
 * (`vt_shift_handover`). Self-skips when DATABASE_URL is absent so the default
 * `pnpm test` stays green in a DB-less environment.
 * Run: pnpm test -- tests/shift-handover-patient-worklist.test.ts
 */
import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The generator writes a fire-and-forget shift_handover_generated audit; this
// suite doesn't assert audit, and a real audit row would make the append-only
// vt_audit_logs block the clinic teardown (RESTRICT FK). Mock it to a no-op so
// teardown stays a plain clinic delete with no global rule-toggle race.
vi.mock("../server/lib/audit.js", async (importActual) => {
  const actual = await importActual<typeof import("../server/lib/audit.js")>();
  return { ...actual, logAudit: vi.fn() };
});
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  db,
  clinics,
  users,
  shiftSessions,
  scanLogs,
  eventOutbox,
  integrationConfigs,
  shiftHandover,
} from "../server/db.js";
import { generateShiftHandover } from "../server/lib/shift-handover-generator.js";
import {
  PatientWorklistProviderError,
  type PatientWorklistCapableAdapter,
  type PatientWorklistDeps,
} from "../server/integrations/patient-worklist-port.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

const SHIFT_START = new Date("2026-05-14T08:00:00.000Z");
const SHIFT_END = new Date("2026-05-14T16:00:00.000Z");
const IN_WINDOW = new Date("2026-05-14T10:00:00.000Z");

let clinicA = "";
let userA1 = "";
let userA2 = "";
let sessionA = "";

async function makeClinic(): Promise<{ clinicId: string; userIds: string[] }> {
  const clinicId = `test-shf-wl-${randomUUID()}`;
  const u1 = randomUUID();
  const u2 = randomUUID();
  await db.insert(clinics).values({ id: clinicId });
  for (const id of [u1, u2]) {
    await db.insert(users).values({
      id,
      clinicId,
      clerkId: `clerk_${randomUUID()}`,
      email: `shfwl_${randomUUID()}@example.com`,
      name: "Worklist Tester",
      displayName: "Worklist Tester",
    });
  }
  return { clinicId, userIds: [u1, u2] };
}

async function makeSession(clinicId: string, userId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(shiftSessions).values({
    id,
    clinicId,
    startedAt: SHIFT_START,
    endedAt: SHIFT_END,
    startedByUserId: userId,
  });
  return id;
}

/**
 * Seed one in-window scan (observed signal) + one in-window NON-mirror domain
 * event (a task-state delta) so "the rest of the handover still generates" is
 * provable. It comes from `vt_event_outbox` (cascade FK, purgeable) rather than
 * the append-only `vt_audit_logs`, and is deliberately NOT an audit-mirror type —
 * EQUIPMENT_CUSTODY_STATE_CHANGED is excluded from aggregation as a transport mirror.
 */
async function seedNonPmsSignals(clinicId: string, userId: string): Promise<void> {
  await db.insert(scanLogs).values({
    id: randomUUID(),
    clinicId,
    equipmentId: "eqWL",
    userId,
    userEmail: "shfwl@example.com",
    status: "ok",
    timestamp: IN_WINDOW,
  });
  await db.insert(eventOutbox).values({
    clinicId,
    type: "TASK_UPDATED",
    payload: { targetId: "taskWL", targetType: "task" },
    occurredAt: IN_WINDOW,
  });
}

async function enableWorklistAdapter(clinicId: string, adapterId: string): Promise<void> {
  await db.insert(integrationConfigs).values({
    id: randomUUID(),
    clinicId,
    adapterId,
    enabled: true,
    syncPatients: true,
  });
}

/** A mock adapter that returns a fixed worklist through the port. */
function readyAdapter(
  adapterId: string,
  entries: Array<{ externalId: string; display: string; byTechId: string }>,
): PatientWorklistCapableAdapter {
  return {
    id: adapterId,
    async getPatientWorklist() {
      return entries;
    },
  };
}

/** A mock adapter that fails through the port with a closed error code. */
function failingAdapter(adapterId: string, code: PatientWorklistProviderError["code"]): PatientWorklistCapableAdapter {
  return {
    id: adapterId,
    async getPatientWorklist() {
      throw new PatientWorklistProviderError(code, "raw PMS detail must never surface");
    },
  };
}

function depsFor(adapter: PatientWorklistCapableAdapter): PatientWorklistDeps {
  return {
    resolveAdapter: () => adapter,
    loadCredentials: async () => ({}),
  };
}

async function purge(clinicId: string): Promise<void> {
  await db.delete(shiftHandover).where(eq(shiftHandover.clinicId, clinicId));
  await db.delete(integrationConfigs).where(eq(integrationConfigs.clinicId, clinicId));
  await db.delete(scanLogs).where(eq(scanLogs.clinicId, clinicId));
  await db.delete(eventOutbox).where(eq(eventOutbox.clinicId, clinicId));
  await db.delete(shiftSessions).where(eq(shiftSessions.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

describe.skipIf(!DATABASE_URL)("R-SH-F1.4 — shift-handover patient worklist via PMS port", () => {
  beforeEach(async () => {
    const a = await makeClinic();
    clinicA = a.clinicId;
    userA1 = a.userIds[0]!;
    userA2 = a.userIds[1]!;
    sessionA = await makeSession(clinicA, userA1);
    await seedNonPmsSignals(clinicA, userA1);
  });

  afterEach(async () => {
    await purge(clinicA);
  });

  it("populates the worklist per tech through a mocked adapter (ready state)", async () => {
    await enableWorklistAdapter(clinicA, "mock-worklist-a");
    const adapter = readyAdapter("mock-worklist-a", [
      { externalId: "PMS-1", display: "Rex", byTechId: userA1 },
      { externalId: "PMS-2", display: "Milo", byTechId: userA2 },
    ]);

    const row = await generateShiftHandover(clinicA, sessionA, { worklistDeps: depsFor(adapter) });

    expect(row.patientWorklist.state).toBe("ready");
    if (row.patientWorklist.state !== "ready") throw new Error("unreachable");
    const byTech = new Map(row.patientWorklist.entries.map((e) => [e.byTechId, e]));
    expect(byTech.get(userA1)).toEqual({ externalId: "PMS-1", display: "Rex", byTechId: userA1 });
    expect(byTech.get(userA2)).toEqual({ externalId: "PMS-2", display: "Milo", byTechId: userA2 });
  });

  it("no configured PMS → exactly { state: 'not_configured' } while the rest still generates", async () => {
    // No integrationConfigs row seeded for the clinic.
    const row = await generateShiftHandover(clinicA, sessionA, {
      worklistDeps: depsFor(readyAdapter("never-called", [])),
    });

    expect(row.patientWorklist).toEqual({ state: "not_configured" });
    // The rest of the handover still generates.
    expect(row.observedSignals.length).toBeGreaterThan(0);
    expect(row.deltas.taskState.length).toBeGreaterThan(0);
  });

  it("configured-but-failing adapter → { state: 'error', code } (not not_configured/empty) while the rest still generates", async () => {
    await enableWorklistAdapter(clinicA, "mock-worklist-fail");
    const adapter = failingAdapter("mock-worklist-fail", "timeout");

    const row = await generateShiftHandover(clinicA, sessionA, { worklistDeps: depsFor(adapter) });

    expect(row.patientWorklist).toEqual({ state: "error", code: "timeout" });
    expect(row.patientWorklist.state).not.toBe("not_configured");
    // No raw PMS detail leaked into the persisted artifact.
    expect(JSON.stringify(row.patientWorklist)).not.toContain("raw PMS detail");
    // The rest of the handover still generates on a PMS failure.
    expect(row.observedSignals.length).toBeGreaterThan(0);
    expect(row.deltas.taskState.length).toBeGreaterThan(0);
  });

  it("a SECOND, different stub adapter through the SAME port yields the same shape (adapter-agnostic)", async () => {
    await enableWorklistAdapter(clinicA, "mock-worklist-b");
    const adapter = readyAdapter("mock-worklist-b", [
      { externalId: "OTHER-9", display: "Bella", byTechId: userA1 },
    ]);

    const row = await generateShiftHandover(clinicA, sessionA, { worklistDeps: depsFor(adapter) });

    expect(row.patientWorklist.state).toBe("ready");
    if (row.patientWorklist.state !== "ready") throw new Error("unreachable");
    expect(row.patientWorklist.entries).toEqual([
      { externalId: "OTHER-9", display: "Bella", byTechId: userA1 },
    ]);
  });
});
