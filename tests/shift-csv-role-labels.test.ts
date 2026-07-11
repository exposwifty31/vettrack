/**
 * F3 regression — shift CSV import must not silently misclassify real staff
 * roles as "not relevant":
 *   - vet labels (וטרינר / רופא) → explicit reason pointing at the doctor CSV path
 *   - student labels (סטודנט) → explicit reason (students carry no roster authority)
 *   - genuinely irrelevant labels keep the generic reason
 *   - recognized roles (טכנאי / בכיר) import unchanged
 *
 * Exercises the real POST /api/shifts/import/preview route (pure parse, no DB).
 * Confirm-path visibility (audit metadata + client toast) is pinned by source
 * contract below.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.authUser = { id: "admin-1", email: "admin@test.local", name: "Admin", role: "admin" };
    req.clinicId = "clinic-1";
    // Real auth.ts resolves req.locale via resolveRequestLocale(); this mock
    // skips that entirely (req.locale stays undefined → apiError-style
    // helpers fall back to English), except when a test explicitly opts in
    // via `x-locale` — needed to exercise the T7 Hebrew-locale CSV-import
    // localization without pulling in the full auth middleware.
    const headers = req.headers as Record<string, string | string[] | undefined> | undefined;
    const localeHeader = headers?.["x-locale"];
    if (localeHeader === "en" || localeHeader === "he") {
      req.locale = localeHeader;
    }
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

const CSV = [
  "Employee,Shift,Date,Start,End",
  "WC Dan Erez,טכנאי בוקר,2026-07-05,08:00,16:00",
  "WC Guy Segev,בכיר בוקר,2026-07-05,08:00,16:00",
  "WC Maya Rosen,וטרינר בוקר,2026-07-05,08:00,16:00",
  "WC Avi Katz,סטודנט בוקר,2026-07-05,08:00,14:00",
  "WC Dan Erez,טכנאי לילה,2026-07-06,00:00,08:00",
  "WC Outside Corp,ניקיון בוקר,2026-07-05,08:00,16:00",
].join("\n");

type PreviewResponse = {
  summary: { totalRows: number; validRows: number; skippedRows: number };
  rows: Array<{ shiftName: string; role: string }>;
  issues: Array<{ rowNumber: number; reason: string; data: Record<string, unknown> }>;
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

async function preview(csv: string, locale?: "en" | "he"): Promise<PreviewResponse> {
  const res = await fetch(`${baseUrl}/api/shifts/import/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(locale ? { "x-locale": locale } : {}),
    },
    body: JSON.stringify({ csv, filename: "roster.csv" }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PreviewResponse;
}

describe("shift CSV role-label classification (F3 regression)", () => {
  it("imports recognized roles and skips vet/student/irrelevant with per-kind reasons", async () => {
    const parsed = await preview(CSV);

    expect(parsed.summary.totalRows).toBe(6);
    expect(parsed.summary.validRows).toBe(3);
    expect(parsed.summary.skippedRows).toBe(3);
    expect(parsed.rows.map((r) => r.role).sort()).toEqual([
      "senior_technician",
      "technician",
      "technician",
    ]);

    const reasonFor = (marker: string) =>
      parsed.issues.find((i) => String(i.data.shiftName ?? "").includes(marker))?.reason ?? "";

    const vetReason = reasonFor("וטרינר");
    expect(vetReason).toContain("vet shift");
    expect(vetReason).toContain("doctor");

    const studentReason = reasonFor("סטודנט");
    expect(studentReason).toContain("student shift");

    const irrelevantReason = reasonFor("ניקיון");
    expect(irrelevantReason).toContain("not relevant to VetTrack");
    expect(irrelevantReason).not.toContain("vet shift");
  });

  it("classifies English vet/doctor and student labels the same way", async () => {
    const csv = [
      "Employee,Shift,Date,Start,End",
      "WC A,Vet Morning,2026-07-05,08:00,16:00",
      "WC B,Doctor Night,2026-07-05,20:00,08:00",
      "WC C,Student Shift,2026-07-05,08:00,14:00",
    ].join("\n");
    const parsed = await preview(csv);

    expect(parsed.summary.validRows).toBe(0);
    expect(parsed.summary.skippedRows).toBe(3);
    expect(parsed.issues.filter((i) => i.reason.includes("vet shift"))).toHaveLength(2);
    expect(parsed.issues.filter((i) => i.reason.includes("student shift"))).toHaveLength(1);
  });

  it("does not reclassify labels that already map to roster roles", async () => {
    // "בכיר" wins over a stray vet-ish word only if detectShiftRole matched first;
    // a senior-technician label must never be diverted into a skip reason.
    const csv = ["Employee,Shift,Date,Start,End", "WC D,בכיר לילה,2026-07-06,00:00,08:00"].join("\n");
    const parsed = await preview(csv);
    expect(parsed.summary.validRows).toBe(1);
    expect(parsed.rows[0]?.role).toBe("senior_technician");
  });
});

describe("confirm-path visibility contract", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const shiftsSource = fs.readFileSync(path.resolve(__dirname, "../server/routes/shifts.ts"), "utf8");
  const adminPageSource = fs.readFileSync(
    path.resolve(__dirname, "../src/pages/admin-shifts.tsx"),
    "utf8",
  );

  it("confirm audit-log metadata records the skipped-row count", () => {
    const confirmBlock = shiftsSource.slice(
      shiftsSource.indexOf('router.post("/import/confirm"'),
      shiftsSource.indexOf('router.post("/import",'),
    );
    expect(confirmBlock).toContain("skippedRows: parsed.issues.length");
    const auditCall = confirmBlock.slice(confirmBlock.indexOf("logAudit("));
    expect(auditCall.slice(0, auditCall.indexOf("})"))).toContain("skippedRows");
  });

  it("admin page surfaces skipped rows on confirm instead of a plain success toast", () => {
    expect(adminPageSource).toContain("importSuccessWithSkipped");
    expect(adminPageSource).toContain("skippedRows > 0");
  });
});

// T7 (HIGH audit fix): roster CSV import errors ("Missing required columns:
// employee_name", 'Shift "Ward" is not relevant to VetTrack') were returned
// as raw English regardless of locale. They now route through the same
// translate()/getLocaleDictionaries() primitives apiError() uses, keyed on
// req.locale, via a file-local `tShiftImport` helper (server/routes/shifts.ts).
describe("shift CSV import errors are localized per req.locale (T7)", () => {
  it("defaults to English when the request carries no locale (unchanged from before T7)", async () => {
    const csv = "Employee,Shift,Date,Start"; // missing end_time column
    const parsed = await preview(csv);
    expect(parsed.issues[0]?.reason).toBe("Missing required columns: end_time");
  });

  it("returns Hebrew copy for 'Missing required columns' when req.locale is he", async () => {
    const csv = "Employee,Shift,Date,Start"; // missing end_time column
    const parsed = await preview(csv, "he");
    expect(parsed.issues[0]?.reason).toBe("חסרות עמודות חובה: end_time");
  });

  it("returns Hebrew copy for the 'not relevant to VetTrack' family when req.locale is he", async () => {
    const csv = [
      "Employee,Shift,Date,Start,End",
      "WC Outside Corp,ניקיון בוקר,2026-07-05,08:00,16:00",
      "WC Maya Rosen,וטרינר בוקר,2026-07-05,08:00,16:00",
    ].join("\n");
    const parsed = await preview(csv, "he");

    const reasonFor = (marker: string) =>
      parsed.issues.find((i) => String(i.data.shiftName ?? "").includes(marker))?.reason ?? "";

    expect(reasonFor("ניקיון")).toBe('המשמרת "ניקיון בוקר" אינה רלוונטית ל-VetTrack');
    expect(reasonFor("וטרינר")).toContain("משמרת וטרינר/ית");
  });
});
