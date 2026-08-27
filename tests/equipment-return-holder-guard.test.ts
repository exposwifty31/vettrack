/**
 * S16.1 — POST /api/equipment/:id/return must refuse to return equipment the
 * actor does not hold.
 *
 * Before this guard, `performEquipmentReturn` SELECTed the row and never
 * compared `existing.checkedOutById` to `actor.id`, so any authenticated user
 * (down to `student`, the minimum the route mounts) could force-return anyone
 * else's equipment. The two sibling entry points (`toggleEquipmentCustody`,
 * `quickScanEquipmentCustody`) gate on holder identity in the CALLER, outside
 * the transaction — the service itself was unguarded for every caller.
 *
 * The guard is three-way, not `holder !== actor`:
 *   - self     → allowed
 *   - foreign  → refused unless an admin passes `force: true`
 *   - orphaned → `checkedOutById IS NULL` while `custody_state = 'checked_out'`
 *                (the W3B-TEST-3 repair shape) → refused unless forced
 *
 * These tests drive `performEquipmentReturn` directly with a stub transaction:
 * the guard runs before any write, so the stub only has to answer the initial
 * SELECT. When the guard is PASSED the function proceeds to the conditional
 * UPDATE, whose empty result raises `CustodyReturnVersionConflictError` — that
 * distinct error is the proof the holder guard let the call through.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as custodyService from "../server/services/equipment-custody-toggle.service.js";
import { equipmentReturnBodySchema } from "../server/routes/equipment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(path.join(__dirname, "..", "server", "routes", "equipment.ts"), "utf8");

const returnRouteSource = (() => {
  const start = routeSource.indexOf("// POST /api/equipment/:id/return");
  const end = routeSource.indexOf("// POST /api/equipment/:id/seen");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return routeSource.slice(start, end);
})();

/**
 * The same slice with comments stripped. The negative assertion below is about
 * what the handler EXECUTES; a prose mention of `req.effectiveRole` explaining
 * why it is not used must not be read as a use of it.
 */
const returnRouteCode = returnRouteSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const ACTOR = { id: "user-actor", email: "actor@clinic.test" };
const OTHER_HOLDER = "user-other";

type EquipmentSnapshot = {
  checkedOutById: string | null;
  custodyState: string;
  lastSeen?: Date | null;
};

function buildRow(snapshot: EquipmentSnapshot) {
  return {
    id: "equip-1",
    clinicId: "clinic-1",
    name: "Ultrasound",
    version: 7,
    assetTypeId: null,
    deletedAt: null,
    lastSeen: snapshot.lastSeen ?? null,
    checkedOutById: snapshot.checkedOutById,
    checkedOutByEmail: snapshot.checkedOutById ? "holder@clinic.test" : null,
    checkedOutAt: snapshot.checkedOutById ? new Date(1_000) : null,
    custodyState: snapshot.custodyState,
  };
}

/**
 * Minimal drizzle-shaped stub. `where()` is both awaitable (the staging-queue
 * count reads it directly) and carries `.limit()` (the equipment read chains
 * one), so a single implementation serves both call shapes in order.
 */
function makeTx(selectResults: unknown[][], updateResult: unknown[] = []) {
  let selectCall = 0;
  const chain = () => {
    const rows = selectResults[selectCall++] ?? [];
    const pending = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
    pending.limit = async () => rows;
    return pending;
  };
  return {
    select: () => ({ from: () => ({ where: chain }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => updateResult }) }),
    }),
    insert: () => ({ values: async () => undefined }),
  } as unknown as Parameters<typeof custodyService.performEquipmentReturn>[0];
}

function callReturn(
  snapshot: EquipmentSnapshot,
  extra: { clientTimestamp?: number; allowForeignHolder?: boolean } = {},
) {
  const tx = makeTx([[buildRow(snapshot)], [{ count: 0 }]]);
  return custodyService.performEquipmentReturn(tx, {
    clinicId: "clinic-1",
    equipmentId: "equip-1",
    actor: ACTOR,
    ...extra,
  });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected performEquipmentReturn to throw, but it resolved");
}

describe("performEquipmentReturn — current-holder guard", () => {
  it("exports a dedicated not-holder error alongside the version-conflict error", () => {
    expect(typeof custodyService.CustodyReturnNotHolderError).toBe("function");
    expect(typeof custodyService.CustodyReturnVersionConflictError).toBe("function");
  });

  it("refuses a return when the equipment is held by another user", async () => {
    const err = await captureError(
      callReturn({ checkedOutById: OTHER_HOLDER, custodyState: "checked_out" }),
    );
    // Message first: before the guard existed this call reached the UPDATE and
    // raised CUSTODY_RETURN_VERSION_CONFLICT, which is the vulnerability stated
    // in the failure output rather than hidden behind a missing constructor.
    expect(err.message).toBe("CUSTODY_RETURN_NOT_HOLDER");
    expect(err).toBeInstanceOf(custodyService.CustodyReturnNotHolderError);
  });

  it("refuses an orphaned checked_out row (W3B-TEST-3 shape: holder NULL, custody checked_out)", async () => {
    const err = await captureError(
      callReturn({ checkedOutById: null, custodyState: "checked_out" }),
    );
    expect(err.message).toBe("CUSTODY_RETURN_NOT_HOLDER");
    expect(err).toBeInstanceOf(custodyService.CustodyReturnNotHolderError);
  });

  it("allows the actual holder through the guard", async () => {
    const err = await captureError(
      callReturn({ checkedOutById: ACTOR.id, custodyState: "checked_out" }),
    );
    expect(err).toBeInstanceOf(custodyService.CustodyReturnVersionConflictError);
    expect(err).not.toBeInstanceOf(custodyService.CustodyReturnNotHolderError);
  });

  it("allows a foreign holder through when allowForeignHolder is set (admin override)", async () => {
    const err = await captureError(
      callReturn(
        { checkedOutById: OTHER_HOLDER, custodyState: "checked_out" },
        { allowForeignHolder: true },
      ),
    );
    expect(err).toBeInstanceOf(custodyService.CustodyReturnVersionConflictError);
    expect(err).not.toBeInstanceOf(custodyService.CustodyReturnNotHolderError);
  });

  it("allows the orphaned repair through when allowForeignHolder is set", async () => {
    const err = await captureError(
      callReturn({ checkedOutById: null, custodyState: "checked_out" }, { allowForeignHolder: true }),
    );
    expect(err).toBeInstanceOf(custodyService.CustodyReturnVersionConflictError);
    expect(err).not.toBeInstanceOf(custodyService.CustodyReturnNotHolderError);
  });
});

describe("performEquipmentReturn — offline replay must not regress", () => {
  it("does not treat an already-returned row (holder NULL, custody returned) as a foreign holder", async () => {
    const err = await captureError(
      callReturn({ checkedOutById: null, custodyState: "returned" }),
    );
    expect(err).toBeInstanceOf(custodyService.CustodyReturnVersionConflictError);
    expect(err).not.toBeInstanceOf(custodyService.CustodyReturnNotHolderError);
  });

  it("keeps the stale-clientTimestamp idempotent short-circuit ahead of the guard", async () => {
    const result = await callReturn(
      { checkedOutById: null, custodyState: "checked_out", lastSeen: new Date(5_000) },
      { clientTimestamp: 3_000 },
    );
    expect(result).not.toBeNull();
    expect(result!.alreadyReturned).toBe(true);
    expect(result!.didTransitionCustody).toBe(false);
  });

  it("still reports a missing row as not-found rather than a holder violation", async () => {
    const tx = makeTx([[]]);
    const result = await custodyService.performEquipmentReturn(tx, {
      clinicId: "clinic-1",
      equipmentId: "missing",
      actor: ACTOR,
    });
    expect(result).toBeNull();
  });
});

describe("POST /api/equipment/:id/return — admin force override", () => {
  it("accepts force on the return body schema", () => {
    expect(equipmentReturnBodySchema.safeParse({ force: true }).success).toBe(true);
    expect(equipmentReturnBodySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a non-boolean force", () => {
    expect(equipmentReturnBodySchema.safeParse({ force: "yes" }).success).toBe(false);
    expect(equipmentReturnBodySchema.safeParse({ force: 1 }).success).toBe(false);
  });

  it("gates the override on authUser.role/secondaryRole, never on req.effectiveRole", () => {
    expect(returnRouteCode).toContain('req.authUser!.role === "admin"');
    expect(returnRouteCode).toContain('req.authUser!.secondaryRole === "admin"');
    // requireEffectiveRole overwrites req.effectiveRole from the roster shift, so an
    // admin rostered as a technician carries effectiveRole "technician" and would be
    // refused the repair exactly when they are on shift.
    expect(returnRouteCode).not.toContain("effectiveRole");
  });

  it("passes the resolved override into the transaction, not a route-level pre-check", () => {
    expect(returnRouteSource).toContain("allowForeignHolder");
    const guardInService = fs.readFileSync(
      path.join(__dirname, "..", "server", "services", "equipment-custody-toggle.service.ts"),
      "utf8",
    );
    const fnStart = guardInService.indexOf("export async function performEquipmentReturn");
    const fnBody = guardInService.slice(fnStart);
    expect(fnBody).toContain("CustodyReturnNotHolderError");
    expect(fnBody).toContain("allowForeignHolder");
  });

  it("maps the holder violation to 403 NOT_CURRENT_HOLDER", () => {
    expect(returnRouteSource).toContain("CustodyReturnNotHolderError");
    expect(returnRouteSource).toContain("res.status(403)");
    expect(returnRouteSource).toContain('reason: "NOT_CURRENT_HOLDER"');
  });

  it("audits a forced return so the override is not invisible", () => {
    expect(returnRouteSource).toContain("forcedByAdmin");
  });
});
