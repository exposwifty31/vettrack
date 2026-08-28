/**
 * S12 — binding an NFC tag to equipment is admin-only ON THE SERVER.
 *
 * Both clients already hide the bind action behind an admin check:
 *   - web console: `showWriteNfc = isAdmin && nfcWriteSupported && !!id`
 *     (`src/pages/equipment-detail.tsx`), binding via
 *     `api.equipment.update(equipmentId, { nfcTagId: tagId })`
 *   - RN: `NfcProvisionCard` returns null unless
 *     `hasRoleAtLeast(identity.data?.role, "admin")`
 *
 * That is a UI control, not an authorization control. The routes themselves only
 * require `requireEffectiveRole("technician")`, so any technician could bind or
 * rebind a physical sticker straight against the API. The guard belongs in the
 * handlers, mirroring the `EXPECTED_RETURN_MINUTES_ADMIN_ONLY` precedent that sits
 * immediately above in both files.
 *
 * There are TWO write paths, not one: PATCH /api/equipment/:id and
 * POST /api/equipment both accept `nfcTagId`. Guarding only PATCH leaves POST open.
 *
 * The trap this file also pins: the guard must key on `nfcTagId` ONLY. The console's
 * edit form (`src/pages/new-equipment.tsx` → `buildUpdatePayload`) sends
 * `rfidTagEpc` unconditionally on every save but never sends `nfcTagId`, so an
 * admin floor on `rfidTagEpc` would 403 every non-admin equipment edit. The
 * "technician can still edit" cases below fail if the guard is drawn too wide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";

const transactionMock = vi.fn(async (_cb: unknown) => undefined);
const insertMock = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    transaction: (cb: unknown) => transactionMock(cb),
    insert: (table: unknown) => insertMock(table),
  },
  equipment: {},
  folders: {},
  transferLogs: {},
}));

vi.mock("../server/lib/push.js", () => ({
  checkDedupe: vi.fn(() => false),
  sendPushToAll: vi.fn(),
  shouldSendPilotEnglishEquipmentPush: vi.fn(() => false),
}));

vi.mock("../server/lib/analytics-cache.js", () => ({
  invalidateAnalyticsCache: vi.fn(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: vi.fn(() => "technician"),
}));

import { patchEquipmentHandler } from "../server/routes/equipment/handlers/patch-equipment.js";
import { postEquipmentCreateHandler } from "../server/routes/equipment/handlers/post-equipment-create.js";

const NFC_TAG_UID = "041aff0b";

type Captured = { status: number | null; body: Record<string, unknown> | null };

function makeRes(): { res: Response; captured: Captured } {
  const headers = new Map<string, string>();
  const captured: Captured = { status: null, body: null };
  const res = {
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, captured };
}

function makeReq(
  role: string,
  body: Record<string, unknown>,
  secondaryRole: string | null = null,
): Request {
  return {
    body,
    params: { id: "eq-1" },
    headers: {},
    clinicId: "clinic-1",
    authUser: { id: "user-1", email: "user@clinic.test", role, secondaryRole },
  } as unknown as Request;
}

async function invoke(
  handler: RequestHandler,
  role: string,
  body: Record<string, unknown>,
  secondaryRole: string | null = null,
): Promise<Captured> {
  const { res, captured } = makeRes();
  await (handler as (req: Request, res: Response, next: () => void) => Promise<void>)(
    makeReq(role, body, secondaryRole),
    res,
    () => {},
  );
  return captured;
}

/** What the web console actually PATCHes on a plain equipment edit — no nfcTagId. */
const CONSOLE_EDIT_PAYLOAD = {
  name: "Ultrasound A",
  nameHe: null,
  serialNumber: null,
  model: null,
  manufacturer: null,
  purchaseDate: null,
  expiryDate: null,
  location: null,
  folderId: null,
  maintenanceIntervalDays: null,
  imageUrl: null,
  usuallyFoundHere: null,
  searchAlias: null,
  staffNote: null,
  rfidTagEpc: null,
};

beforeEach(() => {
  transactionMock.mockClear();
  transactionMock.mockImplementation(async () => undefined);
  insertMock.mockClear();
  insertMock.mockImplementation(() => ({
    values: () => ({
      returning: async () => [{ id: "eq-1", name: "Ultrasound A", serialNumber: null }],
    }),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/equipment/:id — nfcTagId is admin-only", () => {
  it("403s a technician binding a tag, before any DB work", async () => {
    const captured = await invoke(patchEquipmentHandler, "technician", {
      nfcTagId: NFC_TAG_UID,
    });

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      code: "FORBIDDEN",
      reason: "NFC_TAG_ID_ADMIN_ONLY",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("403s a technician CLEARING a tag — unbinding is a write too", async () => {
    const captured = await invoke(patchEquipmentHandler, "technician", { nfcTagId: null });

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ reason: "NFC_TAG_ID_ADMIN_ONLY" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("403s a senior_technician too — the floor is identity admin, not seniority", async () => {
    const captured = await invoke(patchEquipmentHandler, "senior_technician", {
      nfcTagId: NFC_TAG_UID,
    });

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ reason: "NFC_TAG_ID_ADMIN_ONLY" });
  });

  it("lets an admin bind — the guard does not block the only legitimate caller", async () => {
    const captured = await invoke(patchEquipmentHandler, "admin", { nfcTagId: NFC_TAG_UID });

    expect(captured.status).not.toBe(403);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  // The web console's `isAdmin` is `role === "admin" || secondaryRole === "admin"`
  // (`src/hooks/use-auth.tsx`), and `secondaryRole` is account RBAC — the exact
  // dimension this gate is on (`server/schema/core.ts`), honored as an admin bypass
  // by the `requireEffectiveRole` middleware already on this route. A role-only
  // check would show a secondary-admin the write button, let them PROGRAM the
  // physical sticker, then 403 the bind: a tag written to hardware and bound
  // nowhere. The sticker write is not undoable, so this is not a cosmetic mismatch.
  it("lets a secondary-role admin bind — the web console shows them the button", async () => {
    const captured = await invoke(
      patchEquipmentHandler,
      "technician",
      { nfcTagId: NFC_TAG_UID },
      "admin",
    );

    expect(captured.status).not.toBe(403);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it("a non-admin secondaryRole grants nothing", async () => {
    const captured = await invoke(
      patchEquipmentHandler,
      "technician",
      { nfcTagId: NFC_TAG_UID },
      "senior_technician",
    );

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ reason: "NFC_TAG_ID_ADMIN_ONLY" });
  });

  it("does NOT 403 a technician's ordinary console edit (rfidTagEpc must stay unguarded)", async () => {
    const captured = await invoke(patchEquipmentHandler, "technician", CONSOLE_EDIT_PAYLOAD);

    expect(captured.status).not.toBe(403);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/equipment — nfcTagId is admin-only on the create path too", () => {
  it("403s a technician creating equipment with a tag pre-bound, before the insert", async () => {
    const captured = await invoke(postEquipmentCreateHandler, "technician", {
      name: "Ultrasound A",
      nfcTagId: NFC_TAG_UID,
    });

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      code: "FORBIDDEN",
      reason: "NFC_TAG_ID_ADMIN_ONLY",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("403s a technician passing an explicit null tag", async () => {
    const captured = await invoke(postEquipmentCreateHandler, "technician", {
      name: "Ultrasound A",
      nfcTagId: null,
    });

    expect(captured.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("lets an admin create with a tag", async () => {
    const captured = await invoke(postEquipmentCreateHandler, "admin", {
      name: "Ultrasound A",
      nfcTagId: NFC_TAG_UID,
    });

    expect(captured.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("lets a secondary-role admin create with a tag — same floor as PATCH", async () => {
    const captured = await invoke(
      postEquipmentCreateHandler,
      "technician",
      { name: "Ultrasound A", nfcTagId: NFC_TAG_UID },
      "admin",
    );

    expect(captured.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("lets a technician create equipment without a tag", async () => {
    const captured = await invoke(postEquipmentCreateHandler, "technician", {
      name: "Ultrasound A",
      rfidTagEpc: null,
    });

    expect(captured.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
