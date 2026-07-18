/**
 * R-SH-F1.4 — PatientWorklistProvider port (PMS-agnostic).
 *
 * The shift-handover generator populates `patientWorklist` through THIS port,
 * never a named PMS. The port is a capability on the integration adapter
 * contract (`IntegrationAdapter.getPatientWorklist`) — any supported PMS plugs
 * in by implementing it; Priza is only ONE reference adapter.
 *
 * Resolution is PER-CLINIC from `vt_integration_configs` (`enabled` +
 * `syncPatients`, with an explicit `clinicId` predicate). The port maps the
 * adapter's outcome onto the discriminated `PatientWorklist` union (SH-1.1 — the
 * single contract, not re-forked):
 *   - no enabled `syncPatients` adapter for the clinic → `{ state: 'not_configured' }`
 *     (graceful — NEVER an empty `ready` list);
 *   - the adapter throws → `{ state: 'error', code }` with a CLOSED safe code
 *     (never a raw PMS message/url/credential);
 *   - the adapter returns entries → `{ state: 'ready', entries }` (external PMS
 *     id + display + the INTERNAL `byTechId`, validated in-clinic downstream by
 *     `serializePatientWorklist`).
 *
 * A PMS failure only carries into `patientWorklist` — the rest of the handover
 * (deltas / open-items / observed-signals) still generates.
 */

import { and, eq } from "drizzle-orm";
import { db, integrationConfigs } from "../db.js";
import { getAdapter } from "./index.js";
import { getCredentials } from "./credential-manager.js";
import type {
  IntegrationCredentials,
  PatientWorklistWindow,
  PatientWorklistProviderEntry,
} from "./types.js";
import type {
  PatientWorklist,
  PatientWorklistErrorCode,
} from "../lib/shift-handover.js";

/**
 * Worklist data shapes moved to ./types.js to keep the leaf type graph acyclic
 * (adapters/base.ts imports them without depending on this port). Re-exported
 * here so existing `patient-worklist-port` importers keep their public surface.
 */
export type { PatientWorklistWindow, PatientWorklistProviderEntry };

/**
 * The port capability an adapter implements to expose an end-of-shift patient
 * worklist. Adapters that don't support it simply omit the method.
 */
export interface PatientWorklistProvider {
  getPatientWorklist(
    credentials: IntegrationCredentials,
    window: PatientWorklistWindow,
  ): Promise<PatientWorklistProviderEntry[]>;
}

/** Minimal adapter view the port needs: an id + the optional worklist capability. */
export interface PatientWorklistCapableAdapter {
  readonly id: string;
  getPatientWorklist?: PatientWorklistProvider["getPatientWorklist"];
}

/**
 * Thrown by an adapter's `getPatientWorklist` to signal a SAFE, closed error
 * code. The port never serializes the underlying message — only the `code`
 * reaches the artifact, so a raw PMS message/url/credential can never leak.
 */
export class PatientWorklistProviderError extends Error {
  readonly code: PatientWorklistErrorCode;
  constructor(code: PatientWorklistErrorCode, message?: string) {
    super(message ?? `patient worklist provider error: ${code}`);
    this.name = "PatientWorklistProviderError";
    this.code = code;
  }
}

/**
 * Injectable seams (default to the real registry + credential store). Tests
 * override `resolveAdapter` / `loadCredentials` to drive a mock adapter through
 * the SAME port without polluting the global adapter registry.
 */
export interface PatientWorklistDeps {
  resolveAdapter?: (adapterId: string) => PatientWorklistCapableAdapter | null | undefined;
  loadCredentials?: (clinicId: string, adapterId: string) => Promise<IntegrationCredentials | null>;
}

/**
 * Resolve the clinic's enabled `syncPatients` adapter and pull an end-of-shift
 * worklist through the port, mapping the outcome onto the `PatientWorklist`
 * union. Every read carries an explicit `clinicId` predicate. Returns a RAW
 * `ready` union (entries un-validated) — the caller runs
 * `serializePatientWorklist` to validate/strip before persistence.
 */
export async function resolvePatientWorklist(
  clinicId: string,
  window: PatientWorklistWindow,
  deps: PatientWorklistDeps = {},
): Promise<PatientWorklist> {
  const resolveAdapter = deps.resolveAdapter ?? getAdapter;
  const loadCredentials = deps.loadCredentials ?? getCredentials;

  const [config] = await db
    .select({ adapterId: integrationConfigs.adapterId })
    .from(integrationConfigs)
    .where(
      and(
        eq(integrationConfigs.clinicId, clinicId),
        eq(integrationConfigs.enabled, true),
        eq(integrationConfigs.syncPatients, true),
      ),
    )
    .limit(1);

  if (!config) return { state: "not_configured" };

  const adapter = resolveAdapter(config.adapterId);
  if (!adapter || typeof adapter.getPatientWorklist !== "function") {
    // Enabled+syncPatients config points at an adapter that can't provide a
    // worklist — treat as not wired for worklist rather than an error.
    return { state: "not_configured" };
  }

  try {
    const credentials = (await loadCredentials(clinicId, config.adapterId)) ?? {};
    const entries = await adapter.getPatientWorklist(credentials, window);
    return {
      state: "ready",
      entries: entries.map((e) => ({
        externalId: e.externalId,
        display: e.display,
        byTechId: e.byTechId,
      })),
    };
  } catch (err) {
    const code: PatientWorklistErrorCode =
      err instanceof PatientWorklistProviderError ? err.code : "unknown";
    return { state: "error", code };
  }
}
