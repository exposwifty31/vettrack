import { createHash, randomUUID } from "crypto";
import { Router, type Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import multer from "multer";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import pdfParse from "pdf-parse";

import { db, clinics, pharmacyForecastParses, pharmacyOrders, pharmacyForecastExclusions } from "../db.js";
import { requireAuth, requireEffectiveRole, requireAdmin } from "../middleware/auth.js";
import { ensureUserClinicMembership } from "../middleware/ensure-user-clinic-membership.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { buildPharmacyOrderEmail } from "../lib/forecast/emailBuilder.js";
import { validateMergedForecastForApproval } from "../lib/forecast/approveGuard.js";
import {
  approvePayloadSchema,
  forecastParseRequestSchema,
  forecastResultSchema,
} from "../lib/forecast/forecastZod.js";
import { applyManualQuantities } from "../lib/forecast/mergeApproval.js";
import { buildForecastMailtoUrl } from "../lib/forecast/mailtoSafe.js";
import {
  fingerprintForecastExclusions,
  loadForecastExclusionSubstrings,
  runForecastPipeline,
} from "../lib/forecast/pipeline.js";
import { resolveForecastDeliveryPolicy } from "../lib/forecast/deliveryPolicy.js";
import type {
  ForecastDrugEntry,
  ForecastParseFailure,
  ForecastPatientEntry,
  ForecastResult,
} from "../lib/forecast/types.js";

/** Parse row was already consumed or concurrent approve won the race. */
class ForecastParseSessionGoneError extends Error {
  constructor() {
    super("PARSE_SESSION_INVALID");
    this.name = "ForecastParseSessionGoneError";
  }
}

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

function resolveRequestId(res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void }, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function parseTimeoutEnv(raw: string | undefined, fallbackMs: number): number {
  if (!raw || !raw.trim()) return fallbackMs;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

/**
 * Coerce SMTP_IP_FAMILY env to a value Node `net.connect` understands (0 | 4 | 6).
 * 0 = let the OS choose (default Node behavior — tries AAAA first on Linux).
 * 4 = IPv4 only (safe default for Railway/Fly containers without v6 egress).
 * 6 = IPv6 only.
 */
function parseIpFamilyEnv(raw: string | undefined, fallback: 0 | 4 | 6): 0 | 4 | 6 {
  if (!raw || !raw.trim()) return fallback;
  const parsed = parseInt(raw, 10);
  if (parsed === 0 || parsed === 4 || parsed === 6) return parsed;
  return fallback;
}

/**
 * Produce a short, safe description of an SMTP failure for the client UI.
 * Never includes credentials; only the library error code / summary line.
 */
function sanitizeSmtpError(err: unknown): string {
  if (!err || typeof err !== "object") return "SMTP error";
  const anyErr = err as { code?: unknown; command?: unknown; message?: unknown };
  const code = typeof anyErr.code === "string" ? anyErr.code : "";
  const command = typeof anyErr.command === "string" ? anyErr.command : "";
  const raw = typeof anyErr.message === "string" ? anyErr.message : "";
  // Keep to the first line, trim, and cap so we don't leak long server traces.
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const summary = firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
  const parts = [code, command, summary].filter((s) => s && s.length > 0);
  return parts.length > 0 ? parts.join(" · ") : "SMTP error";
}

function apiError(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
  errors?: unknown[];
}) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
    ...(params.errors != null ? { errors: params.errors } : {}),
  };
}

/**
 * Thursday (Israel) → 72 h weekend pharmacy window; else 24 h.
 * Uses Asia/Jerusalem so server UTC does not shift the weekday at night.
 */
function defaultWindowHoursFromCalendar(): 24 | 72 {
  const formatter = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
  });
  const hebrewDay = formatter.format(new Date());
  return hebrewDay.includes("חמישי") ? 72 : 24;
}

const parseRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const xf = req.headers["x-forwarded-for"];
    const fromHeader = typeof xf === "string" ? xf.split(",")[0]?.trim() : "";
    return fromHeader || ipKeyGenerator(req.ip ?? "");
  },
});

function multipartOrJsonBody(req: Request): Record<string, unknown> {
  const b = req.body;
  if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  return {};
}

// ORIGINAL
// function collectUploadedPdfFiles(req: Request): Express.Multer.File[] {
//   const collected: Express.Multer.File[] = [];
//   const reqAny = req as Request & {
//     file?: Express.Multer.File;
//     files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
//   };
//   if (reqAny.file) collected.push(reqAny.file);
//   if (Array.isArray(reqAny.files)) {
//     collected.push(...reqAny.files);
//   } else if (reqAny.files && typeof reqAny.files === "object") {
//     for (const value of Object.values(reqAny.files)) {
//       if (Array.isArray(value)) collected.push(...value);
//     }
//   }
//   const deduped = new Map<string, Express.Multer.File>();
//   for (const file of collected) {
//     if (!file?.buffer?.length) continue;
//     const key = `${file.originalname}:${file.size}:${file.mimetype}`;
//     if (!deduped.has(key)) deduped.set(key, file);
//   }
//   return [...deduped.values()];
// }
function collectUploadedPdfFiles(req: Request): Express.Multer.File[] {
  const collected: Express.Multer.File[] = [];
  const reqAny = req as Request & {
    file?: Express.Multer.File;
    files?: Express.Multer.File[] | Record<string, Express.Multer.File[]>;
  };
  if (reqAny.file) collected.push(reqAny.file);
  if (Array.isArray(reqAny.files)) {
    collected.push(...reqAny.files);
  } else if (reqAny.files && typeof reqAny.files === "object") {
    for (const value of Object.values(reqAny.files)) {
      if (Array.isArray(value)) collected.push(...value);
    }
  }
  return collected.filter((file) => !!file?.buffer?.length);
}

function mergeDrugEntries(base: ForecastDrugEntry, incoming: ForecastDrugEntry): ForecastDrugEntry {
  const quantityUnits =
    base.quantityUnits == null && incoming.quantityUnits == null
      ? null
      : (base.quantityUnits ?? 0) + (incoming.quantityUnits ?? 0);
  const administrationsPer24h = base.administrationsPer24h ?? incoming.administrationsPer24h;
  const administrationsInWindow =
    base.administrationsInWindow == null && incoming.administrationsInWindow == null
      ? null
      : (base.administrationsInWindow ?? 0) + (incoming.administrationsInWindow ?? 0);
  return {
    ...base,
    concentration: base.concentration || incoming.concentration,
    packDescription: base.packDescription || incoming.packDescription,
    route: base.route || incoming.route,
    quantityUnits,
    administrationsPer24h,
    administrationsInWindow,
    flags: Array.from(new Set([...base.flags, ...incoming.flags])),
  };
}

function mergePatientEntries(base: ForecastPatientEntry, incoming: ForecastPatientEntry): ForecastPatientEntry {
  const mergedDrugMap = new Map<string, ForecastDrugEntry>();
  for (const drug of [...base.drugs, ...incoming.drugs]) {
    const key = [
      drug.drugName.trim().toLowerCase(),
      drug.type,
      drug.route.trim().toLowerCase(),
      drug.concentration.trim().toLowerCase(),
      drug.unitLabel.trim().toLowerCase(),
    ].join("|");
    const existing = mergedDrugMap.get(key);
    if (!existing) {
      mergedDrugMap.set(key, { ...drug });
      continue;
    }
    mergedDrugMap.set(key, mergeDrugEntries(existing, drug));
  }
  return {
    ...base,
    name: base.name || incoming.name,
    species: base.species || incoming.species,
    breed: base.breed || incoming.breed,
    sex: base.sex || incoming.sex,
    age: base.age || incoming.age,
    color: base.color || incoming.color,
    weightKg: base.weightKg > 0 ? base.weightKg : incoming.weightKg,
    ownerName: base.ownerName || incoming.ownerName,
    ownerId: base.ownerId || incoming.ownerId,
    ownerPhone: base.ownerPhone || incoming.ownerPhone,
    flags: Array.from(new Set([...base.flags, ...incoming.flags])),
    drugs: [...mergedDrugMap.values()],
  };
}

function mergeForecastResults(params: {
  results: ForecastResult[];
  windowHours: 24 | 72;
  weekendMode: boolean;
  parseFailures: ForecastParseFailure[];
}): ForecastResult {
  const mergedPatients = new Map<string, ForecastPatientEntry>();
  for (const result of params.results) {
    for (const patient of result.patients) {
      const patientKey = `${patient.recordNumber.trim().toLowerCase()}|${patient.name.trim().toLowerCase()}`;
      const existing = mergedPatients.get(patientKey);
      if (!existing) {
        mergedPatients.set(patientKey, { ...patient, drugs: patient.drugs.map((d) => ({ ...d })) });
        continue;
      }
      mergedPatients.set(patientKey, mergePatientEntries(existing, patient));
    }
  }
  const patients = [...mergedPatients.values()].sort((a, b) =>
    a.recordNumber.localeCompare(b.recordNumber, undefined, { numeric: true }),
  );
  const totalFlags = patients.reduce(
    (sum, p) => sum + p.flags.length + p.drugs.reduce((s, d) => s + d.flags.length, 0),
    0,
  );
  return {
    windowHours: params.windowHours,
    weekendMode: params.weekendMode,
    patients,
    totalFlags,
    parsedAt: new Date().toISOString(),
    parseFailures: params.parseFailures.length > 0 ? params.parseFailures : undefined,
  };
}

function sortedJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => sortedJsonStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${sortedJsonStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildForecastParseContentHash(params: {
  parseInputs: Array<{ sourceLabel: string; rawText: string }>;
  parseFailures: ForecastParseFailure[];
  windowHours: 24 | 72;
  weekendMode: boolean;
  pdfSourceFormat: "smartflow" | "generic";
  exclusionSubstrings: string[];
}): string {
  return createHash("sha256")
    .update(
      sortedJsonStringify({
        inputs: params.parseInputs
          .map((entry) => ({
            sourceLabel: entry.sourceLabel,
            rawText: entry.rawText,
          }))
          .sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel)),
        failures: params.parseFailures
          .map((failure) => ({
            fileName: failure.fileName,
            message: failure.message,
          }))
          .sort((a, b) => `${a.fileName}:${a.message}`.localeCompare(`${b.fileName}:${b.message}`)),
      }),
      "utf8",
    )
    .update("\u0000window:", "utf8")
    .update(`${params.windowHours}:${params.weekendMode ? 1 : 0}`, "utf8")
    .update("\u0000source-format:", "utf8")
    .update(params.pdfSourceFormat, "utf8")
    .update("\u0000exclusions:", "utf8")
    .update(fingerprintForecastExclusions(params.exclusionSubstrings), "utf8")
    .digest("hex");
}

router.post(
  "/parse",
  parseRateLimit,
  requireAuth,
  ensureUserClinicMembership,
  requireEffectiveRole("technician"),
  // ORIGINAL
  // (req, res, next) => {
  //   const ct = String(req.headers["content-type"] ?? "");
  //   if (ct.includes("multipart/form-data")) return upload.single("file")(req, res, next);
  //   next();
  // },
  (req, res, next) => {
    const ct = String(req.headers["content-type"] ?? "");
    if (ct.includes("multipart/form-data")) return upload.any()(req, res, next);
    next();
  },
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId!;
    const authUser = req.authUser!;
    try {
      const rawBody = multipartOrJsonBody(req);
      const parsed = forecastParseRequestSchema.safeParse(rawBody);

      if (!parsed.success) {
        return res.status(400).json(apiError({
          code: "VALIDATION_FAILED",
          reason: "INVALID_PARSE_BODY",
          message: "Invalid JSON or form fields",
          requestId,
        }));
      }

      /**
       * Fold clinic exclusions + window into the idempotency hash so that adding/removing
       * an exclusion (or switching 24h/72h) invalidates cached parses for the same PDF.
       * Otherwise a re-upload of the same flowsheet returns a stale forecast that still
       * contains just-excluded drugs.
       */
      const exclusionSubstrings = await loadForecastExclusionSubstrings(clinicId);
      const windowHours = parsed.data.windowHours ?? defaultWindowHoursFromCalendar();
      const weekendMode =
        parsed.data.weekendMode ?? (windowHours === 72 && defaultWindowHoursFromCalendar() === 72);
      const [clinicSettings] = await db
        .select({ forecastPdfSourceFormat: clinics.forecastPdfSourceFormat })
        .from(clinics)
        .where(eq(clinics.id, clinicId))
        .limit(1);
      const pdfSourceFormat: "smartflow" | "generic" =
        clinicSettings?.forecastPdfSourceFormat === "generic" ? "generic" : "smartflow";

      const parseFailures: ForecastParseFailure[] = [];
      const parseInputs: Array<{ sourceLabel: string; rawText: string }> = [];
      const uploadedFiles = collectUploadedPdfFiles(req);
      if (uploadedFiles.length > 0) {
        for (const [index, file] of uploadedFiles.entries()) {
          const fileName = file.originalname?.trim() || `pdf-${index + 1}.pdf`;
          try {
            const out = await pdfParse(file.buffer as Buffer);
            const rawText = typeof out.text === "string" ? out.text.trim() : "";
            if (!rawText) {
              parseFailures.push({
                fileName,
                message: "לא ניתן היה לחלץ טקסט מהקובץ",
              });
              continue;
            }
            parseInputs.push({ sourceLabel: fileName, rawText });
          } catch (error) {
            console.error("[forecast/parse] pdf extraction failed", { fileName, error });
            parseFailures.push({
              fileName,
              message: "פענוח PDF נכשל",
            });
          }
        }
      } else if (typeof parsed.data.text === "string" && parsed.data.text.trim().length > 0) {
        parseInputs.push({ sourceLabel: "manual-input", rawText: parsed.data.text.trim() });
      }

      if (parseInputs.length === 0) {
        return res.status(400).json(apiError({
          code: "VALIDATION_FAILED",
          reason: "EMPTY_INPUT",
          message: "Provide PDF file(s) or non-empty text",
          requestId,
          errors: parseFailures.length > 0 ? parseFailures : undefined,
        }));
      }

      const contentHash = buildForecastParseContentHash({
        parseInputs,
        parseFailures,
        windowHours,
        weekendMode,
        pdfSourceFormat,
        exclusionSubstrings,
      });
      console.info(
        `[forecast/parse] ${new Date().toISOString()} contentHash=${contentHash} requestId=${requestId} clinicId=${clinicId}`,
      );

      const [idem] = await db
        .select()
        .from(pharmacyForecastParses)
        .where(
          and(
            eq(pharmacyForecastParses.clinicId, clinicId),
            eq(pharmacyForecastParses.createdBy, authUser.id),
            eq(pharmacyForecastParses.contentHash, contentHash),
            gt(pharmacyForecastParses.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (idem?.result != null) {
        const cached = forecastResultSchema.safeParse(idem.result);
        if (cached.success) {
          return res.json({ parseId: idem.id, ...cached.data });
        }
      }

      const partialResults: ForecastResult[] = [];
      for (const entry of parseInputs) {
        try {
          const result = await runForecastPipeline({
            rawText: entry.rawText,
            clinicId,
            windowHours,
            weekendMode,
            pdfSourceFormat,
            exclusionSubstrings,
          });
          partialResults.push(result);
        } catch (error) {
          console.error("[forecast/parse] forecast pipeline failed", {
            sourceLabel: entry.sourceLabel,
            error,
          });
          parseFailures.push({
            fileName: entry.sourceLabel,
            message: "ניתוח תרופות נכשל עבור הקובץ",
          });
        }
      }

      if (partialResults.length === 0) {
        return res.status(400).json(apiError({
          code: "PDF_PARSE_FAILED",
          reason: "ALL_FILES_FAILED",
          message: "All provided files failed to parse",
          requestId,
          errors: parseFailures,
        }));
      }

      const result = mergeForecastResults({
        results: partialResults,
        windowHours,
        weekendMode,
        parseFailures,
      });

      const parseId = randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.insert(pharmacyForecastParses).values({
        id: parseId,
        clinicId,
        createdBy: authUser.id,
        expiresAt,
        result: result as unknown as Record<string, unknown>,
        contentHash,
      });

      return res.json({ parseId, ...result });
    } catch (err) {
      console.error("[forecast/parse]", err);
      return res.status(500).json(apiError({
        code: "INTERNAL_ERROR",
        reason: "FORECAST_PARSE_FAILED",
        message: "Forecast parse failed",
        requestId,
      }));
    }
  },
);

router.post("/approve", requireAuth, ensureUserClinicMembership, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const authUser = req.authUser!;
  const parsed = approvePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => i.message).join("; ") || "Invalid approve payload";
    return res.status(400).json(apiError({
      code: "VALIDATION_FAILED",
      reason: "INVALID_APPROVE_BODY",
      message: detail,
      requestId,
    }));
  }

  // ORIGINAL
  // router.post("/approve", requireAuth, ensureUserClinicMembership, requireEffectiveRole("technician"), async (req, res) => {
  //   const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  //   const clinicId = req.clinicId!;
  //   const authUser = req.authUser!;
  //   const parsed = approvePayloadSchema.safeParse(req.body);
  //   // ... existing approve flow: load parse row, merge quantities, gate checks,
  //   // SMTP/mailto delivery, audit log, and response.
  // });
  try {
    const [parseRow] = await db
      .select()
      .from(pharmacyForecastParses)
      .where(
        and(
          eq(pharmacyForecastParses.id, parsed.data.parseId),
          eq(pharmacyForecastParses.clinicId, clinicId),
          eq(pharmacyForecastParses.createdBy, authUser.id),
          gt(pharmacyForecastParses.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!parseRow) {
      return res.status(400).json(apiError({
        code: "PARSE_SESSION_INVALID",
        reason: "PARSE_SESSION_INVALID",
        message: "Parse session is missing, expired, or invalid. Run Parse again before approving.",
        requestId,
      }));
    }

    const storedParsed = forecastResultSchema.safeParse(parseRow.result);
    if (!storedParsed.success) {
      console.error("[forecast/approve] stored parse corrupt", storedParsed.error);
      return res.status(500).json(apiError({
        code: "INTERNAL_ERROR",
        reason: "PARSE_STORAGE_CORRUPT",
        message: "Stored forecast could not be loaded",
        requestId,
      }));
    }

    const mergedResult = applyManualQuantities(storedParsed.data, parsed.data.manualQuantities);

    const gate = validateMergedForecastForApproval(mergedResult, {
      pharmacistDoseAckKeys: new Set(parsed.data.pharmacistDoseAcks ?? []),
      patientFlagAckKeys: new Set(parsed.data.patientFlagAcks ?? []),
      weightOverrideRecordNumbers: new Set(Object.keys(parsed.data.patientWeightOverrides ?? {})),
      confirmedDrugKeys: new Set(parsed.data.confirmedDrugKeys ?? []),
    });
    if (!gate.ok) {
      return res.status(400).json(apiError({
        code: "VALIDATION_FAILED",
        reason: gate.code,
        message: gate.message,
        requestId,
        errors: gate.errors,
      }));
    }

    const [clinicRow] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
    const pharmacyEmail = clinicRow?.pharmacyEmail?.trim() ?? "";

    const smtpHost = process.env.SMTP_HOST?.trim();
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    const dryRunEnabled = String(process.env.FORECAST_EMAIL_DRY_RUN ?? "").toLowerCase() === "true";

    const hasSmtp = Boolean(smtpHost && smtpUser && smtpPass);
    const deliveryPolicy = resolveForecastDeliveryPolicy(process.env);
    const canUseMailtoFallback = hasSmtp
      ? deliveryPolicy.allowMailtoOnSmtpFailure
      : deliveryPolicy.allowMailtoWithoutSmtp;

    if (!pharmacyEmail) {
      return res.status(400).json(apiError({
        code: "MISSING_PHARMACY_EMAIL",
        reason: "CLINIC_PHARMACY_EMAIL_REQUIRED",
        message: "Clinic pharmacy email is required for pharmacy orders (configure in admin settings)",
        requestId,
      }));
    }

    const orderId = `ord-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;

    if (mergedResult.patients.some((p) => p.flags.includes("PATIENT_UNKNOWN"))) {
      console.warn(`[forecast/approve] PATIENT_UNKNOWN present in approved order orderId=${orderId}`);
    }

    const { subject, html, text } = buildPharmacyOrderEmail({
      result: mergedResult,
      technicianName: authUser.name || authUser.email,
      locale: req.locale,
      auditOrOrderHint: orderId,
      auditTrace: parsed.data.auditTrace,
      patientWeightOverrides: parsed.data.patientWeightOverrides,
    });

    if (!dryRunEnabled && !hasSmtp && !canUseMailtoFallback) {
      return res.status(503).json(apiError({
        code: "SMTP_REQUIRED",
        reason: "SMTP_REQUIRED",
        message: "SMTP is required to send pharmacy orders in this environment.",
        requestId,
      }));
    }

    let deliveryMethod: "smtp" | "mailto" = hasSmtp ? "smtp" : "mailto";
    if (dryRunEnabled) {
      deliveryMethod = "smtp";
    }
    let smtpFallbackReason: string | undefined;

    await db.transaction(async (tx) => {
      const removed = await tx
        .delete(pharmacyForecastParses)
        .where(
          and(
            eq(pharmacyForecastParses.id, parsed.data.parseId),
            eq(pharmacyForecastParses.clinicId, clinicId),
            eq(pharmacyForecastParses.createdBy, authUser.id),
            gt(pharmacyForecastParses.expiresAt, new Date()),
          ),
        )
        .returning({ id: pharmacyForecastParses.id });

      if (removed.length === 0) {
        throw new ForecastParseSessionGoneError();
      }

      await tx.insert(pharmacyOrders).values({
        id: orderId,
        clinicId,
        approvedBy: authUser.id,
        windowHours: mergedResult.windowHours,
        delivery: deliveryMethod,
        payload: {
          result: mergedResult,
          manualQuantities: parsed.data.manualQuantities,
        } as unknown as Record<string, unknown>,
      });
    });

    let mailtoUrl: string | undefined;
    let mailtoBodyTruncated = false;

    if (!dryRunEnabled && hasSmtp) {
      try {
        const smtpOptions: SMTPTransport.Options & { family?: number } = {
          host: smtpHost,
          port: parseInt(process.env.SMTP_PORT ?? "587", 10),
          secure: process.env.SMTP_SECURE === "true",
          auth: { user: smtpUser, pass: smtpPass },
          // Force IPv4. Railway / Fly / Heroku containers commonly have no
          // outbound IPv6 route, so letting DNS resolve smtp.gmail.com to AAAA
          // first causes `ESOCKET · ENETUNREACH <ipv6>:587` before nodemailer
          // ever falls back to A records. Override via SMTP_IP_FAMILY=0 if a
          // host actually does have v6 and prefers it.
          family: parseIpFamilyEnv(process.env.SMTP_IP_FAMILY, 4),
          // Explicit timeouts keep the request from hanging when a network path
          // blocks port 587 (common on residential ISPs / corporate networks).
          // Defaults are intentionally short; override via env if needed.
          connectionTimeout: parseTimeoutEnv(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10_000),
          greetingTimeout: parseTimeoutEnv(process.env.SMTP_GREETING_TIMEOUT_MS, 10_000),
          socketTimeout: parseTimeoutEnv(process.env.SMTP_SOCKET_TIMEOUT_MS, 15_000),
        };
        const transporter = nodemailer.createTransport(smtpOptions);
        await transporter.sendMail({
          from: process.env.SMTP_FROM ?? smtpUser,
          to: pharmacyEmail,
          subject,
          text,
          html,
        });
        deliveryMethod = "smtp";
      } catch (e) {
        smtpFallbackReason = sanitizeSmtpError(e);
        if (!canUseMailtoFallback) {
          console.error(
            `[forecast/approve] SMTP failed and mailto fallback blocked orderId=${orderId} reason=${smtpFallbackReason}`,
            e,
          );
          return res.status(503).json(apiError({
            code: "SMTP_REQUIRED",
            reason: "SMTP_REQUIRED",
            message: "SMTP delivery failed. Mailto fallback is disabled in this environment.",
            requestId,
          }));
        }
        console.error(
          `[forecast/approve] SMTP failed, falling back to mailto orderId=${orderId} reason=${smtpFallbackReason}`,
          e,
        );
        deliveryMethod = "mailto";
        await db
          .update(pharmacyOrders)
          .set({ delivery: "mailto" })
          .where(eq(pharmacyOrders.id, orderId));
      }
    }

    if (!dryRunEnabled && deliveryMethod === "mailto") {
      const locale = typeof authUser.locale === "string" ? authUser.locale : undefined;
      const built = buildForecastMailtoUrl({
        pharmacyEmail,
        subject,
        body: text,
        locale,
      });
      mailtoUrl = built.url;
      mailtoBodyTruncated = built.truncated;
    }

    if (dryRunEnabled) {
      console.info("[forecast/approve] DRY_RUN enabled — email payload prepared without external send", {
        orderId,
        deliveryMethod: hasSmtp ? "smtp" : "mailto",
        to: pharmacyEmail,
        subject,
        textPreview: text.slice(0, 500),
        parseFailures: mergedResult.parseFailures ?? [],
      });
    }

    const meta = resolveAuditActorRole(req);
    logAudit({
      clinicId,
      actionType: "pharmacy_order_sent",
      performedBy: authUser.id,
      performedByEmail: authUser.email,
      targetId: orderId,
      targetType: "pharmacy_order",
      actorRole: meta,
      metadata: {
        order_id: orderId,
        patient_count: mergedResult.patients.length,
        window_hours: mergedResult.windowHours,
        delivery_method: deliveryMethod,
        patients: mergedResult.patients.map((p) => p.recordNumber).filter(Boolean),
      },
    });

    return res.json({
      orderId,
      deliveryMethod,
      mailtoUrl: deliveryMethod === "mailto" ? mailtoUrl : undefined,
      mailtoBodyTruncated: deliveryMethod === "mailto" ? mailtoBodyTruncated : undefined,
      smtpFallbackReason:
        !dryRunEnabled && deliveryMethod === "mailto" && smtpFallbackReason
          ? smtpFallbackReason
          : undefined,
    });
  } catch (err) {
    if (err instanceof ForecastParseSessionGoneError) {
      return res.status(400).json(apiError({
        code: "PARSE_SESSION_INVALID",
        reason: "PARSE_SESSION_INVALID",
        message: "Parse session is missing, expired, or invalid. Run Parse again before approving.",
        requestId,
      }));
    }
    console.error("[forecast/approve]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "FORECAST_APPROVE_FAILED",
      message: "Approve failed",
      requestId,
    }));
  }
});

/** Extend parse session TTL while user reviews forecast before approval. */
router.post("/parse/:id/keepalive", requireAuth, ensureUserClinicMembership, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const authUser = req.authUser!;
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    return res.status(400).json(apiError({
      code: "VALIDATION_FAILED",
      reason: "INVALID_PARSE_ID",
      message: "Invalid parse session id",
      requestId,
    }));
  }

  try {
    const now = new Date();
    const extendedExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const updated = await db
      .update(pharmacyForecastParses)
      .set({ expiresAt: extendedExpiresAt })
      .where(
        and(
          eq(pharmacyForecastParses.id, parsedId.data),
          eq(pharmacyForecastParses.clinicId, clinicId),
          eq(pharmacyForecastParses.createdBy, authUser.id),
          gt(pharmacyForecastParses.expiresAt, now),
        ),
      )
      .returning({ id: pharmacyForecastParses.id, expiresAt: pharmacyForecastParses.expiresAt });

    if (updated.length === 0) {
      return res.status(400).json(apiError({
        code: "PARSE_SESSION_INVALID",
        reason: "PARSE_SESSION_INVALID",
        message: "Parse session is missing, expired, or invalid. Run Parse again before approving.",
        requestId,
      }));
    }

    return res.json({ parseId: updated[0]!.id, expiresAt: updated[0]!.expiresAt?.toISOString() ?? null });
  } catch (err) {
    console.error("[forecast/keepalive]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "KEEPALIVE_FAILED",
      message: "Could not keep parse session alive",
      requestId,
    }));
  }
});

/** Admin: set pharmacy recipient email for ICU orders */
router.patch("/clinic/pharmacy-email", requireAuth, ensureUserClinicMembership, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const schema = z.object({
    pharmacyEmail: z.string().email().nullable().optional(),
    forecastPdfSourceFormat: z.enum(["smartflow", "generic"]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError({
      code: "VALIDATION_FAILED",
      reason: "INVALID_EMAIL",
      message: "Invalid pharmacy email",
      requestId,
    }));
  }
  const email = parsed.data.pharmacyEmail?.trim() ?? null;
  const forecastPdfSourceFormat = parsed.data.forecastPdfSourceFormat;
  try {
    await db
      .insert(clinics)
      .values({
        id: clinicId,
        pharmacyEmail: email,
        forecastPdfSourceFormat: forecastPdfSourceFormat ?? "smartflow",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: clinics.id,
        set: {
          pharmacyEmail: email,
          ...(forecastPdfSourceFormat ? { forecastPdfSourceFormat } : {}),
          updatedAt: new Date(),
        },
      });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "clinic_pharmacy_email_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: clinicId,
      targetType: "clinic",
      metadata: { pharmacyEmail: email, forecastPdfSourceFormat: forecastPdfSourceFormat ?? "smartflow" },
    });

    return res.json({ pharmacyEmail: email, forecastPdfSourceFormat: forecastPdfSourceFormat ?? "smartflow" });
  } catch (err) {
    console.error("[forecast/clinic-email]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "UPDATE_FAILED",
      message: "Could not update clinic email",
      requestId,
    }));
  }
});

router.get("/clinic/pharmacy-email", requireAuth, ensureUserClinicMembership, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  try {
    const [row] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
    return res.json({
      pharmacyEmail: row?.pharmacyEmail ?? null,
      forecastPdfSourceFormat: row?.forecastPdfSourceFormat === "generic" ? "generic" : "smartflow",
    });
  } catch (err) {
    console.error("[forecast/clinic-email get]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "READ_FAILED",
      message: "Could not read clinic email",
      requestId,
    }));
  }
});

/** Admin/API only: clinic substrings excluded in `runForecastPipeline` when computing pharmacy order output (not exposed in the SPA). */
router.get("/clinic/pharmacy-forecast-exclusions", requireAuth, ensureUserClinicMembership, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  try {
    const rows = await db
      .select()
      .from(pharmacyForecastExclusions)
      .where(eq(pharmacyForecastExclusions.clinicId, clinicId));
    return res.json({ exclusions: rows });
  } catch (err) {
    console.error("[forecast/exclusions get]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "READ_FAILED",
      message: "Could not load exclusions",
      requestId,
    }));
  }
});

router.post("/clinic/pharmacy-forecast-exclusions", requireAuth, ensureUserClinicMembership, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const schema = z.object({
    matchSubstring: z.string().min(1).max(200),
    note: z.string().max(500).nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError({
      code: "VALIDATION_FAILED",
      reason: "INVALID_BODY",
      message: "matchSubstring required (1–200 chars)",
      requestId,
    }));
  }
  const matchSubstring = parsed.data.matchSubstring.trim();
  try {
    const [row] = await db
      .insert(pharmacyForecastExclusions)
      .values({
        clinicId,
        matchSubstring,
        note: parsed.data.note?.trim() || null,
      })
      .returning();
    /** Invalidate cached parses so re-uploads immediately apply the new exclusion. */
    await db
      .delete(pharmacyForecastParses)
      .where(eq(pharmacyForecastParses.clinicId, clinicId));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "forecast_exclusion_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: String(row.id),
      targetType: "forecast_exclusion",
      metadata: { matchSubstring, note: parsed.data.note?.trim() || null },
    });

    return res.json({ exclusion: row });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json(apiError({
        code: "CONFLICT",
        reason: "DUPLICATE_EXCLUSION",
        message: "This match substring already exists for the clinic",
        requestId,
      }));
    }
    console.error("[forecast/exclusions post]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "INSERT_FAILED",
      message: "Could not add exclusion",
      requestId,
    }));
  }
});

router.delete("/clinic/pharmacy-forecast-exclusions/:id", requireAuth, ensureUserClinicMembership, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json(apiError({
      code: "VALIDATION_FAILED",
      reason: "INVALID_ID",
      message: "Invalid exclusion id",
      requestId,
    }));
  }
  try {
    await db
      .delete(pharmacyForecastExclusions)
      .where(and(eq(pharmacyForecastExclusions.id, id.data), eq(pharmacyForecastExclusions.clinicId, clinicId)));
    /** Invalidate cached parses so re-uploads immediately reflect the removed exclusion. */
    await db
      .delete(pharmacyForecastParses)
      .where(eq(pharmacyForecastParses.clinicId, clinicId));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "forecast_exclusion_deleted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: id.data,
      targetType: "forecast_exclusion",
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[forecast/exclusions delete]", err);
    return res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "DELETE_FAILED",
      message: "Could not delete exclusion",
      requestId,
    }));
  }
});

export default router;
