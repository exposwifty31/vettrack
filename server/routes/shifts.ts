import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomUUID } from "crypto";
import multer from "multer";
import { and, desc, eq } from "drizzle-orm";
import { db, doctorShifts, shiftImports, shifts, users } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { detectDoctorOperationalShiftRole } from "../../shared/doctor-operational-shift.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate, type TranslationParams } from "../../lib/i18n/index.js";
import type { Locale } from "../../lib/i18n/types.js";

/**
 * File-local translation helper for shift-CSV-import row issues (mirrors
 * `tWhatsApp` in whatsapp.ts). `parseShiftsCsvContent` has no `req` access,
 * so route handlers thread `req.locale` down as a plain parameter; this
 * keeps the parser's callers in control of localization while producing
 * already-localized `reason` strings the client can render as-is (HIGH
 * audit finding: roster CSV import errors were raw English regardless of
 * `req.locale`).
 */
function tShiftImport(locale: Locale, key: string, params?: TranslationParams): string {
  const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
  return translate(primary, `shiftImport.${key}`, params, { fallbackDict: fallback, locale: lc });
}

type ShiftRole = "technician" | "senior_technician" | "admin";

interface ParsedShiftRow {
  rowNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  shiftName: string;
  role: ShiftRole;
}

interface ShiftRowIssue {
  rowNumber: number;
  reason: string;
  data: Record<string, unknown>;
}

interface ShiftParseResult {
  filename: string;
  totalRows: number;
  validRows: ParsedShiftRow[];
  issues: ShiftRowIssue[];
}

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.mimetype === "text/plain" || file.originalname.endsWith(".csv")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only CSV files are accepted"));
  },
});

function uploadCsvFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err?: unknown) => {
    if (!err) {
      next();
      return;
    }
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const message = err instanceof Error ? err.message : "Invalid CSV upload";
    res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "INVALID_CSV_UPLOAD",
        message,
        requestId,
      }),
    );
  });
}

const CSV_HEADER_VARIANTS = {
  date: ["date", "shiftdate", "workdate", "תאריך", "תאריךמשמרת", "יום"],
  startTime: ["start", "starttime", "from", "fromtime", "שעתהתחלה", "התחלה", "משעה"],
  endTime: ["end", "endtime", "to", "totime", "שעתסיום", "סיום", "עדשעה"],
  employeeName: ["employee", "employeename", "name", "fullname", "שם", "שםעובד", "עובד", "שםמלא"],
  shiftName: ["shift", "shiftname", "rolename", "תפקיד", "משמרת", "שםמשמרת", "תורה"],
  userId: ["user_id", "userid", "מזהה משתמש", "מזהה_משתמש"],
} as const;

interface ParsedDoctorShiftRow {
  rowNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  userId: string;
  shiftName: string;
  operationalRole: import("../../shared/doctor-operational-shift.js").DoctorOperationalShiftRole;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "") // strip UTF-8 BOM from first CSV header cell
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/[\s_-]+/g, "")
    .replace(/[()[\]./\\]/g, "");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(field.trim());
      field = "";
      continue;
    }
    field += ch;
  }
  fields.push(field.trim());
  return fields;
}

function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [] };
  }
  const [headerLine, ...dataLines] = nonEmpty;
  return {
    headers: parseCsvLine(headerLine),
    rows: dataLines.map((line) => parseCsvLine(line)),
  };
}

function parseDate(value: string): string | null {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slashMatch = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);

  let year = 0;
  let month = 0;
  let day = 0;

  if (isoMatch) {
    year = Number.parseInt(isoMatch[1], 10);
    month = Number.parseInt(isoMatch[2], 10);
    day = Number.parseInt(isoMatch[3], 10);
  } else if (slashMatch) {
    day = Number.parseInt(slashMatch[1], 10);
    month = Number.parseInt(slashMatch[2], 10);
    const parsedYear = Number.parseInt(slashMatch[3], 10);
    year = slashMatch[3].length === 2 ? 2000 + parsedYear : parsedYear;
  } else {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTime(value: string): string | null {
  const raw = normalizeWhitespace(value).toUpperCase();
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;

  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  const ampm = match[4];

  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;

  if (ampm) {
    if (hours < 1 || hours > 12) return null;
    if (ampm === "AM" && hours === 12) hours = 0;
    if (ampm === "PM" && hours < 12) hours += 12;
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isDoctorCsv(normalizedHeaders: string[]): boolean {
  return CSV_HEADER_VARIANTS.userId.some((v) =>
    normalizedHeaders.includes(normalizeHeader(v)),
  );
}

async function parseDoctorShiftRows(
  headers: string[],
  rows: string[][],
  clinicId: string,
): Promise<{ validRows: ParsedDoctorShiftRow[]; issues: ShiftRowIssue[] }> {
  const normalizedHeaders = headers.map(normalizeHeader);

  function colIdx(variants: readonly string[]): number {
    for (const v of variants) {
      const i = normalizedHeaders.indexOf(normalizeHeader(v));
      if (i !== -1) return i;
    }
    return -1;
  }

  const dateIdx = colIdx(CSV_HEADER_VARIANTS.date);
  const startIdx = colIdx(CSV_HEADER_VARIANTS.startTime);
  const endIdx = colIdx(CSV_HEADER_VARIANTS.endTime);
  const userIdIdx = colIdx(CSV_HEADER_VARIANTS.userId);
  const shiftNameIdx = colIdx(CSV_HEADER_VARIANTS.shiftName);

  const clinicUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clinicId, clinicId));
  const validUserIds = new Set(clinicUsers.map((u) => u.id));

  const validRows: ParsedDoctorShiftRow[] = [];
  const issues: ShiftRowIssue[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const rawDate = row[dateIdx] ?? "";
    const rawStart = row[startIdx] ?? "";
    const rawEnd = row[endIdx] ?? "";
    const rawUserId = normalizeWhitespace(row[userIdIdx] ?? "");
    const rawShiftName = normalizeWhitespace(row[shiftNameIdx] ?? "");

    const date = parseDate(rawDate);
    const startTime = parseTime(rawStart);
    const endTime = parseTime(rawEnd);

    if (!date || !startTime || !endTime || !rawUserId || !rawShiftName) {
      issues.push({
        rowNumber,
        reason: "MISSING_OR_INVALID_FIELDS",
        data: { date: rawDate, start: rawStart, end: rawEnd, userId: rawUserId, shiftName: rawShiftName },
      });
      return;
    }

    if (!validUserIds.has(rawUserId)) {
      issues.push({
        rowNumber,
        reason: "USER_NOT_FOUND",
        data: { userId: rawUserId },
      });
      return;
    }

    const operationalRole = detectDoctorOperationalShiftRole(rawShiftName);
    if (operationalRole === "unknown") {
      issues.push({
        rowNumber,
        reason: "UNKNOWN_OPERATIONAL_ROLE",
        data: { shiftName: rawShiftName, note: "imported but will not route" },
      });
    }

    validRows.push({ rowNumber, date, startTime, endTime, userId: rawUserId, shiftName: rawShiftName, operationalRole });
  });

  return { validRows, issues };
}

/**
 * Substring keywords `detectShiftRole` matches against a normalized (lowercased,
 * whitespace-collapsed) shift-name cell. Named + exported so the import UI can
 * show admins the accepted-shift-names list (T19) without a parallel/duplicated
 * copy of these tokens drifting out of sync with the parser.
 */
const SENIOR_TECHNICIAN_SHIFT_KEYWORDS = [
  "בכיר",
  "senior technician",
  "senior_technician",
  "senior-tech",
  "senior tech",
  "sr tech",
  "lead technician",
] as const;

const ADMIN_SHIFT_KEYWORDS = ["מנהל", "אדמין", "admin", "manager"] as const;

const TECHNICIAN_SHIFT_KEYWORDS = ["טכנאי", "קבלה", "technician", "tech", "reception"] as const;

function detectShiftRole(shiftName: string): ShiftRole | null {
  const normalized = normalizeWhitespace(shiftName).toLowerCase();

  if (SENIOR_TECHNICIAN_SHIFT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "senior_technician";
  }
  if (ADMIN_SHIFT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "admin";
  }
  if (TECHNICIAN_SHIFT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "technician";
  }

  return null;
}

function detectRole(shiftName: string): ShiftRole | null {
  return detectShiftRole(shiftName);
}

/**
 * Labels that name real staff roles the roster CSV cannot carry: vet shifts
 * import via the doctor CSV (userId column), and students never hold roster
 * authority. Distinguishing them from truly irrelevant labels keeps real
 * staff rows from being skipped as "not relevant" without explanation.
 */
function classifyUnsupportedRosterRole(shiftName: string): "vet" | "student" | null {
  const normalized = normalizeWhitespace(shiftName).toLowerCase();
  if (normalized.includes("סטודנט") || normalized.includes("student")) return "student";
  if (
    normalized.includes("וטרינר") ||
    normalized.includes("רופא") ||
    normalized.includes("vet") ||
    normalized.includes("doctor")
  ) {
    return "vet";
  }
  return null;
}

function skippedRoleReason(shiftName: string, locale: Locale): string {
  const unsupported = classifyUnsupportedRosterRole(shiftName);
  if (unsupported === "vet") {
    return tShiftImport(locale, "shiftNotRelevantVet", { shiftName });
  }
  if (unsupported === "student") {
    return tShiftImport(locale, "shiftNotRelevantStudent", { shiftName });
  }
  return tShiftImport(locale, "shiftNotRelevant", { shiftName });
}

function resolveHeaderIndex(headers: string[], variants: readonly string[]): number {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  for (const variant of variants) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(variant));
    if (idx !== -1) return idx;
  }
  return -1;
}

function createShiftDeterministicId(row: Omit<ParsedShiftRow, "rowNumber">): string {
  const key = `${row.date}|${row.startTime}|${row.endTime}|${row.employeeName.toLowerCase()}|${row.role}`;
  return createHash("sha1").update(key).digest("hex");
}

function parseShiftsCsvContent(csvContent: string, filename: string, locale: Locale): ShiftParseResult {
  const { headers, rows } = parseCsv(csvContent);

  if (headers.length === 0) {
    return {
      filename,
      totalRows: 0,
      validRows: [],
      issues: [{ rowNumber: 1, reason: tShiftImport(locale, "csvEmpty"), data: {} }],
    };
  }

  const dateIdx = resolveHeaderIndex(headers, CSV_HEADER_VARIANTS.date);
  const startIdx = resolveHeaderIndex(headers, CSV_HEADER_VARIANTS.startTime);
  const endIdx = resolveHeaderIndex(headers, CSV_HEADER_VARIANTS.endTime);
  const employeeIdx = resolveHeaderIndex(headers, CSV_HEADER_VARIANTS.employeeName);
  const shiftNameIdx = resolveHeaderIndex(headers, CSV_HEADER_VARIANTS.shiftName);

  const missingColumns = [
    dateIdx === -1 ? "date" : null,
    startIdx === -1 ? "start_time" : null,
    endIdx === -1 ? "end_time" : null,
    employeeIdx === -1 ? "employee_name" : null,
    shiftNameIdx === -1 ? "shift_name" : null,
  ].filter((value): value is string => Boolean(value));

  if (missingColumns.length > 0) {
    return {
      filename,
      totalRows: rows.length,
      validRows: [],
      issues: [
        {
          rowNumber: 1,
          reason: tShiftImport(locale, "missingRequiredColumns", { columns: missingColumns.join(", ") }),
          data: { headers: headers.join(",") },
        },
      ],
    };
  }

  const validRows: ParsedShiftRow[] = [];
  const issues: ShiftRowIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const row = rows[i];
    const get = (idx: number) => normalizeWhitespace(row[idx] ?? "");

    const dateRaw = get(dateIdx);
    const startRaw = get(startIdx);
    const endRaw = get(endIdx);
    const employeeRaw = get(employeeIdx);
    const shiftNameRaw = get(shiftNameIdx);

    const rowData = {
      date: dateRaw,
      startTime: startRaw,
      endTime: endRaw,
      employeeName: employeeRaw,
      shiftName: shiftNameRaw,
    };

    if (!dateRaw && !startRaw && !endRaw && !employeeRaw && !shiftNameRaw) {
      continue;
    }

    if (!dateRaw || !startRaw || !endRaw || !employeeRaw || !shiftNameRaw) {
      issues.push({ rowNumber, reason: tShiftImport(locale, "missingRequiredValues"), data: rowData });
      continue;
    }

    const parsedDate = parseDate(dateRaw);
    if (!parsedDate) {
      issues.push({ rowNumber, reason: tShiftImport(locale, "invalidDate", { value: dateRaw }), data: rowData });
      continue;
    }

    const parsedStart = parseTime(startRaw);
    if (!parsedStart) {
      issues.push({ rowNumber, reason: tShiftImport(locale, "invalidStartTime", { value: startRaw }), data: rowData });
      continue;
    }

    const parsedEnd = parseTime(endRaw);
    if (!parsedEnd) {
      issues.push({ rowNumber, reason: tShiftImport(locale, "invalidEndTime", { value: endRaw }), data: rowData });
      continue;
    }

    const role = detectShiftRole(shiftNameRaw);
    if (!role) {
      issues.push({ rowNumber, reason: skippedRoleReason(shiftNameRaw, locale), data: rowData });
      continue;
    }

    const parsed: ParsedShiftRow = {
      rowNumber,
      date: parsedDate,
      startTime: parsedStart,
      endTime: parsedEnd,
      employeeName: employeeRaw,
      shiftName: shiftNameRaw,
      role,
    };

    const dedupeKey = `${parsed.date}|${parsed.startTime}|${parsed.endTime}|${parsed.employeeName.toLowerCase()}|${parsed.role}`;
    if (seen.has(dedupeKey)) {
      issues.push({ rowNumber, reason: tShiftImport(locale, "duplicateRow"), data: rowData });
      continue;
    }
    seen.add(dedupeKey);
    validRows.push(parsed);
  }

  return {
    filename,
    totalRows: rows.length,
    validRows,
    issues,
  };
}

function resolveCsvFromRequest(req: { file?: Express.Multer.File; body: Record<string, unknown> }): { csv: string; filename: string } {
  if (req.file) {
    return {
      csv: req.file.buffer.toString("utf-8"),
      filename: req.file.originalname || "shifts.csv",
    };
  }

  const csv = typeof req.body.csv === "string" ? req.body.csv : "";
  const filename = typeof req.body.filename === "string" && req.body.filename.trim() ? req.body.filename.trim() : "shifts.csv";
  return { csv, filename };
}

router.get("/imports", requireAuth, requireAdmin, async (_req, res) => {
  const requestId = resolveRequestId(res, _req.headers["x-request-id"]);
  try {
    const clinicId = _req.clinicId!;
    const rows = await db
      .select({
        id: shiftImports.id,
        importedAt: shiftImports.importedAt,
        importedBy: shiftImports.importedBy,
        importedByName: users.name,
        importedByEmail: users.email,
        filename: shiftImports.filename,
        rowCount: shiftImports.rowCount,
      })
      .from(shiftImports)
      .leftJoin(users, and(eq(shiftImports.importedBy, users.id), eq(users.clinicId, clinicId)))
      .where(eq(shiftImports.clinicId, clinicId))
      .orderBy(desc(shiftImports.importedAt))
      .limit(100);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SHIFT_IMPORTS_FETCH_FAILED",
        message: "Failed to fetch shift imports",
        requestId,
      }),
    );
  }
});

/**
 * T19 (LOW): surfaces the roster-CSV shift-name keyword lists so the import UI
 * can show admins what the parser recognizes instead of failing opaquely.
 * Returns the exact same arrays `detectShiftRole` matches against — single
 * source of truth, no parallel/duplicated keyword list to drift.
 */
router.get("/import/shift-names", requireAuth, requireAdmin, async (_req, res) => {
  res.json({
    technician: [...TECHNICIAN_SHIFT_KEYWORDS],
    seniorTechnician: [...SENIOR_TECHNICIAN_SHIFT_KEYWORDS],
    admin: [...ADMIN_SHIFT_KEYWORDS],
  });
});

router.post("/import/preview", requireAuth, requireAdmin, uploadCsvFile, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const { csv, filename } = resolveCsvFromRequest(req as { file?: Express.Multer.File; body: Record<string, unknown> });
    if (!csv.trim()) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "MISSING_CSV_INPUT",
          message: "Provide a CSV file upload or `csv` string in request body",
          requestId,
        }),
      );
    }

    // T18 (HIGH): doctor CSVs (userId column) were always run through the
    // roster parser here and rejected — the doctor parser was only reachable
    // via the UI-less legacy POST /import. Branch on the same isDoctorCsv()
    // shape-detection the legacy endpoint already uses; the roster branch
    // below is untouched (same call, same parser, same response shape plus
    // an additive `kind` tag).
    const { headers, rows } = parseCsv(csv);
    const normalizedHeaders = headers.map((header) => normalizeHeader(header));

    if (isDoctorCsv(normalizedHeaders)) {
      const clinicId = req.clinicId!;
      const { validRows: doctorRows, issues } = await parseDoctorShiftRows(headers, rows, clinicId);
      return res.json({
        kind: "doctor",
        filename,
        summary: {
          totalRows: rows.length,
          validRows: doctorRows.length,
          skippedRows: issues.length,
        },
        rows: doctorRows,
        issues,
      });
    }

    const parsed = parseShiftsCsvContent(csv, filename, req.locale);
    return res.json({
      kind: "roster",
      filename: parsed.filename,
      summary: {
        totalRows: parsed.totalRows,
        validRows: parsed.validRows.length,
        skippedRows: parsed.issues.length,
      },
      rows: parsed.validRows,
      issues: parsed.issues,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SHIFT_CSV_PREVIEW_FAILED",
        message: "Failed to preview shifts CSV",
        requestId,
      }),
    );
  }
});

router.post("/import/confirm", requireAuth, requireAdmin, uploadCsvFile, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!req.authUser) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    const clinicId = req.clinicId!;

    const { csv, filename } = resolveCsvFromRequest(req as { file?: Express.Multer.File; body: Record<string, unknown> });
    if (!csv.trim()) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "MISSING_CSV_INPUT",
          message: "Provide a CSV file upload or `csv` string in request body",
          requestId,
        }),
      );
    }

    // T18 (HIGH): same doctor/roster branch as /import/preview above — a
    // confirmed doctor CSV must actually write to vt_doctor_shifts (via the
    // existing doctor parser + insert sequence the legacy POST /import
    // endpoint already uses) instead of being force-fit through the roster
    // parser. Roster branch below is unchanged.
    const { headers, rows } = parseCsv(csv);
    const normalizedHeaders = headers.map((header) => normalizeHeader(header));

    if (isDoctorCsv(normalizedHeaders)) {
      const { validRows: doctorRows, issues } = await parseDoctorShiftRows(headers, rows, clinicId);
      if (doctorRows.length === 0) {
        return res.status(400).json({
          ...apiError({
            code: "VALIDATION_FAILED",
            reason: "NO_VALID_SHIFT_ROWS",
            message: "No valid shift rows found for import",
            requestId,
          }),
          issues,
        });
      }

      const importId = randomUUID();
      await db.insert(shiftImports).values({
        id: importId,
        clinicId,
        importedBy: req.authUser!.id,
        filename,
        rowCount: doctorRows.length,
      });
      await db.insert(doctorShifts).values(
        doctorRows.map((row) => ({
          id: randomUUID(),
          clinicId,
          userId: row.userId,
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          shiftName: row.shiftName,
          operationalRole: row.operationalRole,
        })),
      );

      logAudit({
        clinicId,
        actionType: "doctor_shifts_csv_imported",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        metadata: { rowCount: doctorRows.length, issueCount: issues.length },
      });

      return res.json({
        kind: "doctor",
        importId,
        filename,
        insertedRows: doctorRows.length,
        skippedRows: issues.length,
        issues,
      });
    }

    const parsed = parseShiftsCsvContent(csv, filename, req.locale);
    if (parsed.validRows.length === 0) {
      return res.status(400).json({
        ...apiError({
          code: "VALIDATION_FAILED",
          reason: "NO_VALID_SHIFT_ROWS",
          message: "No valid shift rows found for import",
          requestId,
        }),
        issues: parsed.issues,
      });
    }

    const importId = randomUUID();
    await db.transaction(async (tx) => {
      const values = parsed.validRows.map((row) => ({
        id: createShiftDeterministicId({
          date: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          employeeName: row.employeeName,
          shiftName: row.shiftName,
          role: row.role,
        }),
        date: row.date,
        clinicId,
        startTime: row.startTime,
        endTime: row.endTime,
        employeeName: row.employeeName,
        role: row.role,
      }));

      if (values.length > 0) {
        await tx
          .insert(shifts)
          .values(values)
          .onConflictDoNothing();
      }

      const importingUser = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, req.authUser!.id), eq(users.clinicId, clinicId)))
        .limit(1);

      if (importingUser.length > 0) {
        await tx.insert(shiftImports).values({
          id: importId,
          clinicId,
          importedBy: req.authUser!.id,
          filename: parsed.filename,
          rowCount: parsed.validRows.length,
        });
      }
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "task_created",
      performedBy: req.authUser!.name || req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: importId,
      targetType: "shift_import",
      metadata: { filename: parsed.filename, rowCount: parsed.validRows.length, skippedRows: parsed.issues.length },
    });
    return res.json({
      kind: "roster",
      importId,
      filename: parsed.filename,
      insertedRows: parsed.validRows.length,
      skippedRows: parsed.issues.length,
      issues: parsed.issues,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SHIFT_CSV_IMPORT_CONFIRM_FAILED",
        message: "Failed to import shifts CSV",
        requestId,
      }),
    );
  }
});

router.post("/import", requireAuth, requireAdmin, uploadCsvFile, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    if (!req.file) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "MISSING_CSV_FILE",
          message: "CSV file is required (multipart field: file)",
          requestId,
        }),
      );
    }

    const csvText = req.file.buffer.toString("utf-8");
    const { headers, rows } = parseCsv(csvText);
    const normalizedHeaders = headers.map((h: string) => normalizeHeader(h));

    if (isDoctorCsv(normalizedHeaders)) {
      const { validRows: doctorRows, issues } = await parseDoctorShiftRows(headers, rows, clinicId);
      const importId = randomUUID();

      if (doctorRows.length > 0) {
        await db.insert(shiftImports).values({
          id: importId,
          clinicId,
          importedBy: req.authUser!.id,
          filename: req.file!.originalname,
          rowCount: doctorRows.length,
        });

        await db.insert(doctorShifts).values(
          doctorRows.map((r) => ({
            id: randomUUID(),
            clinicId,
            userId: r.userId,
            date: r.date,
            startTime: r.startTime,
            endTime: r.endTime,
            shiftName: r.shiftName,
            operationalRole: r.operationalRole,
          })),
        );
      }

      logAudit({
        clinicId,
        actionType: "doctor_shifts_csv_imported",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        metadata: { rowCount: doctorRows.length, issueCount: issues.length },
      });

      return res.json({
        filename: req.file!.originalname,
        totalRows: rows.length,
        validRows: doctorRows,
        issues,
      });
    }

    const parsed = parseShiftsCsvContent(csvText, req.file.originalname || "shifts.csv", req.locale);
    if (parsed.totalRows === 0) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "EMPTY_CSV_FILE",
          message: "CSV file is empty",
          requestId,
        }),
      );
    }
    if (parsed.validRows.length === 0) {
      return res.status(400).json({
        ...apiError({
          code: "VALIDATION_FAILED",
          reason: "NO_VALID_SHIFT_ROWS",
          message: "No valid shift rows found for import",
          requestId,
        }),
        issues: parsed.issues,
      });
    }

    const values = parsed.validRows.map((row) => ({
      id: createShiftDeterministicId({
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        employeeName: row.employeeName,
        shiftName: row.shiftName,
        role: row.role,
      }),
      clinicId,
      employeeName: row.employeeName,
      role: row.role,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
    }));

    await db.insert(shifts).values(values).onConflictDoNothing();

    console.info(
      `[shifts import] filename=${parsed.filename} totalRows=${parsed.totalRows} insertedRows=${values.length} skippedRows=${parsed.issues.length}`
    );

    return res.json({
      success: true,
      inserted: values.length,
      skippedRows: parsed.issues.length,
      issues: parsed.issues,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SHIFT_CSV_IMPORT_FAILED",
        message: "Failed to import shifts CSV",
        requestId,
      }),
    );
  }
});

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const dateFilter = typeof req.query.date === "string" ? req.query.date : "";
    const rows = await db
      .select({
        id: shifts.id,
        date: shifts.date,
        startTime: shifts.startTime,
        endTime: shifts.endTime,
        employeeName: shifts.employeeName,
        role: shifts.role,
      })
      .from(shifts)
      .where(dateFilter ? and(eq(shifts.clinicId, clinicId), eq(shifts.date, dateFilter)) : eq(shifts.clinicId, clinicId))
      .orderBy(desc(shifts.date), shifts.startTime, shifts.employeeName)
      .limit(500);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SHIFTS_FETCH_FAILED",
        message: "Failed to fetch shifts",
        requestId,
      }),
    );
  }
});

export default router;
