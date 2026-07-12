/**
 * T26 — inventory dispense/restock authorization is NON-clinical.
 *
 * Inventory dispense was reclassified as consumables work (drug formulary removed,
 * migrations 142-143). The inventory routes — POST /api/containers/:id/dispense,
 * the /api/dispense/* endpoints, the /api/restock/* read+act endpoints, and the
 * inventory-item read endpoints — moved OFF the clinical-authority gate
 * (`requireClinicalAuthority`) ONTO the student-floor role gate
 * (`requireEffectiveRole("student")`). A supervised student may now dispense,
 * restock, and view inventory.
 *
 * This suite proves three things:
 *   A. STRUCTURAL — the inventory routes gate on requireEffectiveRole("student"),
 *      and NONE of them use requireClinicalAuthority.
 *   B. FUNCTIONAL — requireEffectiveRole("student") ADMITS a student (200 path,
 *      not 403). Since every reclassified inventory route shares this one gate,
 *      admitting a student here admits them on dispense/restock/view alike.
 *   C. CONTROL — the clinical-authority middleware (unchanged; still used by
 *      Code Blue) STILL DENIES a student via STUDENT_NEVER_ELEVATED, even on the
 *      emergency break-glass path. The reclassification did NOT weaken clinical
 *      authority: a student never gets Code Blue clinical authority.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ActiveShiftRole,
  AuthorityReason,
  AuthoritySnapshot,
  ClinicalRole,
} from "../shared/authority.js";

// ── Mocks ───────────────────────────────────────────────────────────────────
// requireEffectiveRole (auth.ts) → resolveCurrentRole is the only DB touch; mock
// it so the gate decision runs in isolation.
const resolveCurrentRoleMock = vi.fn<
  (input: unknown) => Promise<{
    effectiveRole: string;
    source: string;
    activeShift: unknown;
  }>
>();
vi.mock("../server/lib/role-resolution.js", () => ({
  resolveCurrentRole: (input: unknown) => resolveCurrentRoleMock(input),
}));

// requireClinicalAuthority (authority.ts) consumes an already-resolved snapshot.
const resolveAuthorityMock = vi.fn<
  (input: unknown) => Promise<AuthoritySnapshot>
>();
vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));

// Keep server/db.ts out of the import chain (auth.ts + access-denied touch it).
vi.mock("../server/db.js", () => ({
  db: {},
  clinics: {},
  displayDevices: {},
  shifts: {},
  users: {},
}));

import { requireEffectiveRole } from "../server/middleware/auth.js";
import { requireClinicalAuthority } from "../server/middleware/authority.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
type FakeRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  getHeader: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  statusCode?: number;
  body?: unknown;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    status: vi.fn(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue(undefined),
    setHeader: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeReq(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    headers: { "x-request-id": "req-t26-1" },
    clinicId: "clinic-1",
    authUser: {
      id: "user-1",
      name: "Test User",
      role: "student",
      clerkId: "clerk-1",
      email: "u@example.com",
      status: "active",
      clinicId: "clinic-1",
    },
    ...overrides,
  };
}

function makeSnapshot(
  args: Partial<AuthoritySnapshot> & {
    effectiveClinicalRole: ActiveShiftRole | null;
    reason: AuthorityReason;
  },
): AuthoritySnapshot {
  return {
    systemRole: args.systemRole ?? "User",
    clinicalRole: (args.clinicalRole ?? null) as ClinicalRole | null,
    activeShiftRole: args.activeShiftRole ?? null,
    operationalRole: null,
    effectiveClinicalRole: args.effectiveClinicalRole,
    source: args.source ?? "no_active_shift",
    reason: args.reason,
    resolvedAt: args.resolvedAt ?? "2026-07-11T12:00:00.000Z",
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const containersSource = readSource("server/routes/containers.ts");
const dispenseSource = readSource("server/routes/dispense.ts");
const restockSource = readSource("server/routes/restock.ts");
const inventoryItemsSource = readSource("server/routes/inventory-items.ts");

beforeEach(() => {
  resolveCurrentRoleMock.mockReset();
  resolveAuthorityMock.mockReset();
});

// ── A. Structural — inventory routes gate on the student floor, not clinical ──
describe("A. inventory routes are gated on the student floor (T26)", () => {
  it("POST /containers/:id/dispense uses requireEffectiveRole(\"student\"), not requireClinicalAuthority", () => {
    const block = containersSource.slice(
      containersSource.indexOf('"/:id/dispense"'),
      containersSource.indexOf('"/:id/dispense"') + 300,
    );
    expect(block).toContain('requireEffectiveRole("student")');
    expect(block).not.toContain("requireClinicalAuthority");
  });

  it("containers.ts container list + emergency-complete use the student floor", () => {
    expect(containersSource).toMatch(
      /router\.get\("\/",\s*requireAuth,\s*requireEffectiveRole\("student"\)/,
    );
    const completeBlock = containersSource.slice(
      containersSource.indexOf('"/emergency/:eventId/complete"'),
      containersSource.indexOf('"/emergency/:eventId/complete"') + 200,
    );
    expect(completeBlock).toContain('requireEffectiveRole("student")');
  });

  it("containers.ts contains no requireClinicalAuthority call at all", () => {
    expect(containersSource).not.toMatch(/requireClinicalAuthority\(/);
  });

  it("dispense.ts gates the router on requireEffectiveRole(\"student\") and drops clinical authority", () => {
    expect(dispenseSource).toMatch(
      /router\.use\([^)]*requireEffectiveRole\("student"\)[^)]*\)/,
    );
    expect(dispenseSource).not.toMatch(/requireClinicalAuthority\(/);
  });

  it("restock.ts read+act routes use the student floor (no technician gate remains)", () => {
    // start / scan / finish / cancel / container-items — 5 student-floor gates.
    const studentGates = restockSource.match(
      /requireEffectiveRole\("student"\)/g,
    );
    expect(studentGates?.length ?? 0).toBe(5);
    expect(restockSource).not.toContain('requireEffectiveRole("technician")');
  });

  it("inventory-items.ts read routes use the student floor", () => {
    const studentGates = inventoryItemsSource.match(
      /requireEffectiveRole\("student"\)/g,
    );
    // GET / , GET /:id/detail , GET /:id/prices
    expect(studentGates?.length ?? 0).toBe(3);
    expect(inventoryItemsSource).not.toContain(
      'requireEffectiveRole("technician")',
    );
  });
});

// ── B. Functional — requireEffectiveRole("student") ADMITS a student ──────────
describe("B. requireEffectiveRole(\"student\") admits a student (inventory dispense/restock/view)", () => {
  it("a plain student passes the student-floor gate (next called, no 403)", async () => {
    resolveCurrentRoleMock.mockResolvedValue({
      effectiveRole: "student",
      source: "permanent",
      activeShift: null,
    });
    const mw = requireEffectiveRole("student");
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("a technician also passes the same gate (staff-wide access)", async () => {
    resolveCurrentRoleMock.mockResolvedValue({
      effectiveRole: "technician",
      source: "permanent",
      activeShift: null,
    });
    const mw = requireEffectiveRole("student");
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "technician" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});

// ── C. Control — clinical authority STILL denies a student (Code Blue intact) ──
describe("C. clinical authority still denies a student via STUDENT_NEVER_ELEVATED (Code Blue invariant)", () => {
  it("requireClinicalAuthority (with emergency break-glass) DENIES a student (403)", async () => {
    // A STUDENT_NEVER_ELEVATED snapshot is what resolveAuthority returns for any
    // student, regardless of shift. Even the emergency break-glass opt-in must
    // not elevate them (clinicalRole "student" is excluded from the fallback).
    const snap = makeSnapshot({
      effectiveClinicalRole: null,
      clinicalRole: "student",
      reason: "STUDENT_NEVER_ELEVATED",
    });
    resolveAuthorityMock.mockResolvedValue(snap);

    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleForEmergency: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "student" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ reason: "INSUFFICIENT_CLINICAL_AUTHORITY" });

    const reqWithSnap = req as { authoritySnapshot?: AuthoritySnapshot };
    expect(reqWithSnap.authoritySnapshot!.effectiveClinicalRole).toBeNull();
    expect(reqWithSnap.authoritySnapshot!.reason).toBe("STUDENT_NEVER_ELEVATED");
  });

  it("requireClinicalAuthority still ADMITS a vet with active clinical authority (gate not broken)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "vet",
        activeShiftRole: "vet",
        clinicalRole: "vet",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});
