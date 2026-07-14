/**
 * T18 (HIGH) — /import/preview and /import/confirm always ran the roster
 * parser (parseShiftsCsvContent), so doctor CSVs (userId column) were
 * rejected via missing-required-columns errors instead of being routed to
 * the doctor parser (parseDoctorShiftRows) — the doctor parser was only
 * reachable through the UI-less legacy POST /import. Both preview/confirm
 * now branch on isDoctorCsv() the same way the legacy endpoint always has.
 *
 * T19 (LOW+MEDIUM) regression coverage:
 *   - GET /import/shift-names surfaces the accepted-shift-name keyword lists.
 *   - Row numbering is consistently 1-based (line-number-matching) across
 *     multiple distinct error types, in BOTH the roster and doctor branches.
 *
 * DB is mocked (only the doctor branch's userId-existence check touches it —
 * the roster branch stays pure, matching shift-csv-role-labels.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";

const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock("../server/db.js", () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
  users: { id: "id", clinicId: "clinicId" },
  doctorShifts: {},
  shiftImports: {},
  shifts: {},
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: "admin-1", email: "admin@test.local", name: "Admin", role: "admin" };
    req.clinicId = "clinic-1";
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireEffectiveRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

const shiftsRoutes = (await import("../server/routes/shifts.js")).default;

type DoctorRow = { rowNumber: number; userId: string; shiftName: string; operationalRole: string };
type RosterRow = { rowNumber: number; employeeName: string; role: string };
type Issue = { rowNumber: number; reason: string; data: Record<string, unknown> };
type PreviewResponse = {
  kind: "roster" | "doctor";
  summary: { totalRows: number; validRows: number; skippedRows: number };
  rows: Array<DoctorRow | RosterRow>;
  issues: Issue[];
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/shifts", shiftsRoutes);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockResolvedValue([{ id: "user-1" }]);
});

async function preview(csv: string): Promise<PreviewResponse> {
  const res = await fetch(`${baseUrl}/api/shifts/import/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv, filename: "roster.csv" }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PreviewResponse;
}

describe("T18 — doctor CSV routing through /import/preview", () => {
  it("routes a doctor CSV (userId column) to the doctor parser instead of rejecting it", async () => {
    const csv = [
      "Date,Start,End,userId,Shift",
      "2026-07-05,08:00,16:00,user-1,Admission shift",
    ].join("\n");

    const parsed = await preview(csv);

    expect(parsed.kind).toBe("doctor");
    // Would fail against the pre-fix behavior: the roster parser rejects this
    // CSV outright with "Missing required columns: employee_name, shift_name".
    expect(parsed.issues.some((i) => i.reason.includes("Missing required columns"))).toBe(false);
    expect(parsed.summary.validRows).toBe(1);
    const row = parsed.rows[0] as DoctorRow;
    expect(row.userId).toBe("user-1");
    expect(row.operationalRole).toBe("admission");
  });

  it("still uses the roster parser, unchanged, for a roster CSV (no userId column)", async () => {
    const csv = [
      "Employee,Shift,Date,Start,End",
      "WC Dan Erez,טכנאי בוקר,2026-07-05,08:00,16:00",
    ].join("\n");

    const parsed = await preview(csv);

    expect(parsed.kind).toBe("roster");
    expect(parsed.summary.validRows).toBe(1);
    const row = parsed.rows[0] as RosterRow;
    expect(row.employeeName).toBe("WC Dan Erez");
    expect(row.role).toBe("technician");
    // The doctor-only DB lookup (userId existence check) must never run for a
    // roster CSV — this branch stays pure, exactly as before T18.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("rejects a doctor CSV whose userId is not a clinic user, with USER_NOT_FOUND", async () => {
    mockWhere.mockResolvedValue([{ id: "someone-else" }]);
    const csv = [
      "Date,Start,End,userId,Shift",
      "2026-07-05,08:00,16:00,user-1,Admission shift",
    ].join("\n");

    const parsed = await preview(csv);

    expect(parsed.kind).toBe("doctor");
    expect(parsed.summary.validRows).toBe(0);
    expect(parsed.issues[0]?.reason).toBe("USER_NOT_FOUND");
  });
});

describe("T19 — GET /import/shift-names surfaces the accepted-shift-name keywords", () => {
  it("returns the same keyword lists detectShiftRole matches against", async () => {
    const res = await fetch(`${baseUrl}/api/shifts/import/shift-names`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { technician: string[]; seniorTechnician: string[]; admin: string[] };

    expect(body.technician).toContain("טכנאי");
    expect(body.technician).toContain("technician");
    expect(body.seniorTechnician).toContain("בכיר");
    expect(body.seniorTechnician).toContain("lead technician");
    expect(body.admin).toContain("מנהל");
    expect(body.admin).toContain("manager");
  });
});

describe("T19 — row numbering is consistently 1-based across error types", () => {
  it("roster branch: invalid-date and duplicate-row issues both reference the true CSV line number", async () => {
    const csv = [
      "Employee,Shift,Date,Start,End",
      "WC A,טכנאי בוקר,not-a-date,08:00,16:00", // line 2 (row 2): invalid date
      "WC B,טכנאי בוקר,2026-07-05,08:00,16:00", // line 3 (row 3): valid
      "WC B,טכנאי בוקר,2026-07-05,08:00,16:00", // line 4 (row 4): duplicate of row 3
    ].join("\n");

    const parsed = await preview(csv);

    expect(parsed.kind).toBe("roster");
    const invalidDateIssue = parsed.issues.find((i) => i.data.employeeName === "WC A");
    const duplicateIssue = parsed.issues.find((i) => i.reason.toLowerCase().includes("duplicate"));
    expect(invalidDateIssue?.rowNumber).toBe(2);
    expect(duplicateIssue?.rowNumber).toBe(4);
  });

  it("doctor branch: missing-fields and user-not-found issues both reference the true CSV line number", async () => {
    mockWhere.mockResolvedValue([{ id: "user-1" }]);
    const csv = [
      "Date,Start,End,userId,Shift",
      "2026-07-05,08:00,16:00,,Admission shift", // line 2 (row 2): missing userId
      "2026-07-05,08:00,16:00,not-a-user,Admission shift", // line 3 (row 3): unknown user
    ].join("\n");

    const parsed = await preview(csv);

    expect(parsed.kind).toBe("doctor");
    const missingFieldsIssue = parsed.issues.find((i) => i.reason === "MISSING_OR_INVALID_FIELDS");
    const userNotFoundIssue = parsed.issues.find((i) => i.reason === "USER_NOT_FOUND");
    expect(missingFieldsIssue?.rowNumber).toBe(2);
    expect(userNotFoundIssue?.rowNumber).toBe(3);
  });
});

describe("T18 — /import/confirm source contract (doctor branch writes to vt_doctor_shifts)", () => {
  it("confirm handler inserts doctor rows via doctorShifts + shiftImports and logs doctor_shifts_csv_imported", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const shiftsSource = fs.readFileSync(path.resolve(__dirname, "../server/routes/shifts.ts"), "utf8");

    const confirmBlock = shiftsSource.slice(
      shiftsSource.indexOf('router.post("/import/confirm"'),
      shiftsSource.indexOf('router.post("/import",'),
    );
    expect(confirmBlock).toContain("isDoctorCsv(normalizedHeaders)");
    expect(confirmBlock).toContain("parseDoctorShiftRows(headers, rows, clinicId)");
    expect(confirmBlock).toContain(".insert(doctorShifts)");
    expect(confirmBlock).toContain('actionType: "doctor_shifts_csv_imported"');
  });
});
