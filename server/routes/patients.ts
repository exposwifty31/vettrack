import { Router } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { animals, appointments, db, dispenseEvents, hospitalizations, inventoryJobs, owners, users, type HospitalizationStatus } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import { releaseProcedureBoundEquipment } from "../services/equipment-operational-state.service.js";
import { PURGE_AFTER_DAYS } from "../lib/cleanup-scheduler.js";
import {
  PatientDeleteBlockedError,
  restoreAnimalIfSoftDeleted,
  softDeletePatientByHospitalization,
} from "../services/patient-animal-lifecycle.service.js";

const router = Router();
router.use(requireAuth, requireEffectiveRole("technician"));

// ─── Error contract helpers ──────────────────────────────────────────────────

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incoming: unknown,
): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const VALID_STATUSES: HospitalizationStatus[] = [
  "admitted", "observation", "critical", "recovering", "discharged", "deceased",
];

const admitSchema = z.object({
  // Existing animal path
  animalId: z.string().optional(),
  // New animal path — trim() before min(1) so whitespace-only names are
  // rejected instead of silently creating/storing an empty name.
  animalName: z.string().trim().min(1).max(120).optional(),
  species: z.string().max(60).optional(),
  breed: z.string().max(60).optional(),
  sex: z.string().max(20).optional(),
  weightKg: z.number().positive().optional(),
  ownerName: z.string().max(120).optional(),
  ownerPhone: z.string().max(30).optional(),
  // Hospitalization fields
  admissionReason: z.string().max(500).optional(),
  ward: z.string().max(80).optional(),
  bay: z.string().max(40).optional(),
  admittingVetId: z.string().optional(),
}).refine(
  (d) => d.animalId || d.animalName,
  { message: "Either animalId or animalName is required" }
);

const statusSchema = z.object({
  // Discharge must use PATCH /:id/discharge (sets dischargedAt + pre-flight checks).
  status: z.enum(["admitted", "observation", "critical", "recovering", "deceased"]),
});

const dischargeSchema = z.object({
  dischargeNotes: z.string().max(1000).optional(),
  overrideReason: z.string().min(1).max(500).optional(),
});

const deletePatientSchema = z.object({
  dischargeNotes: z.string().max(1000).optional(),
  overrideReason: z.string().min(1).max(500).optional(),
});

// Partial edit of an active hospitalization. Touches the animal record
// (name/species/breed/sex/weightKg) and/or hospitalization fields
// (ward/bay/admissionReason/status). All fields are optional; omitted fields
// are left unchanged. Cannot be used to discharge — use /:id/discharge for that.
const updateSchema = z.object({
  // trim() before min(1) so whitespace-only input is rejected; otherwise
  // a whitespace-only string would pass validation and the handler's
  // subsequent .trim() would store "" — silently erasing the patient name.
  animalName: z.string().trim().min(1).max(120).optional(),
  species: z.string().max(60).nullable().optional(),
  breed: z.string().max(60).nullable().optional(),
  sex: z.string().max(20).nullable().optional(),
  weightKg: z.number().positive().nullable().optional(),
  ward: z.string().max(80).nullable().optional(),
  bay: z.string().max(40).nullable().optional(),
  admissionReason: z.string().max(500).nullable().optional(),
  status: z.enum(["admitted", "observation", "critical", "recovering", "discharged", "deceased"]).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function hospitalizationRow(h: typeof hospitalizations.$inferSelect, a: typeof animals.$inferSelect, o: typeof owners.$inferSelect | null, vetName: string | null) {
  return {
    id: h.id,
    clinicId: h.clinicId,
    animalId: h.animalId,
    admittedAt: h.admittedAt,
    dischargedAt: h.dischargedAt,
    status: h.status,
    ward: h.ward,
    bay: h.bay,
    admissionReason: h.admissionReason,
    admittingVetId: h.admittingVetId,
    admittingVetName: vetName,
    dischargeNotes: h.dischargeNotes,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    animal: {
      id: a.id,
      clinicId: a.clinicId,
      ownerId: a.ownerId,
      name: a.name,
      species: a.species,
      recordNumber: a.recordNumber,
      breed: a.breed,
      sex: a.sex,
      color: a.color,
      weightKg: a.weightKg ? Number(a.weightKg) : null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    },
    owner: o
      ? {
          id: o.id,
          clinicId: o.clinicId,
          fullName: o.fullName,
          phone: o.phone,
          nationalId: o.nationalId,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        }
      : null,
  };
}

// ─── GET /api/patients ───────────────────────────────────────────────────────
// List active hospitalizations (discharged_at IS NULL)

router.get("/", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";

    const rows = await db
      .select({
        h: hospitalizations,
        a: animals,
        o: owners,
        vetName: users.name,
      })
      .from(hospitalizations)
      .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
      .leftJoin(owners, eq(animals.ownerId, owners.id))
      .leftJoin(users, eq(hospitalizations.admittingVetId, users.id))
      .where(
        and(
          eq(hospitalizations.clinicId, clinicId),
          isNull(hospitalizations.dischargedAt),
          isNull(animals.deletedAt),
          q
            ? or(
                ilike(animals.name, `%${q}%`),
                ilike(owners.fullName, `%${q}%`),
              )
            : undefined,
          status && VALID_STATUSES.includes(status as HospitalizationStatus)
            ? eq(hospitalizations.status, status as HospitalizationStatus)
            : undefined,
        ),
      )
      .orderBy(desc(hospitalizations.admittedAt));

    res.json({
      patients: rows.map((r) => hospitalizationRow(r.h, r.a, r.o, r.vetName ?? null)),
    });
  } catch (err) {
    console.error("[patients] list failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PATIENTS_LIST_FAILED", message: "Failed to list active patients", requestId }));
  }
});

// ─── GET /api/patients/pending ──────────────────────────────────────────────

router.get("/pending", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  try {
    const clinicId = req.clinicId!;
    const now = new Date();

    const rows = await db
      .select({
        h: hospitalizations,
        a: animals,
        o: owners,
        vetName: users.name,
      })
      .from(hospitalizations)
      .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
      .leftJoin(owners, eq(animals.ownerId, owners.id))
      .leftJoin(users, eq(hospitalizations.admittingVetId, users.id))
      .where(
        and(
          eq(hospitalizations.clinicId, clinicId),
          isNull(hospitalizations.dischargedAt),
          isNull(animals.deletedAt),

          // 🔥 תנאי Pending
          or(
            isNull(hospitalizations.admittingVetId),
            isNull(hospitalizations.ward),
            eq(hospitalizations.ward, ""),
            isNull(hospitalizations.bay),
            eq(hospitalizations.bay, "")
          )
        )
      )
      .orderBy(desc(hospitalizations.admittedAt));

    const patients = rows.map((r) => {
      const base = hospitalizationRow(r.h, r.a, r.o, r.vetName ?? null);

      const admittedAt = new Date(base.admittedAt);
      const waitingMinutes = Math.floor(
        (now.getTime() - admittedAt.getTime()) / 60000
      );

      return {
        ...base,
        waitingMinutes,
      };
    });

    res.json({ patients });
  } catch (err) {
    console.error("[patients] pending failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PATIENTS_PENDING_FAILED",
        message: "Failed to list pending patients",
        requestId,
      })
    );
  }
});

// ─── GET /api/patients/search ────────────────────────────────────────────────
// Search existing animals by name (for admit autocomplete)

router.get("/search", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) return res.json({ animals: [] });

    const rows = await db
      .select({
        id: animals.id,
        name: animals.name,
        species: animals.species,
        breed: animals.breed,
        ownerName: owners.fullName,
      })
      .from(animals)
      .leftJoin(owners, eq(animals.ownerId, owners.id))
      .where(
        and(
          eq(animals.clinicId, clinicId),
          isNull(animals.deletedAt),
          ilike(animals.name, `%${q}%`),
        ),
      )
      .orderBy(animals.name)
      .limit(10);

    res.json({ animals: rows });
  } catch (err) {
    console.error("[patients] search failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PATIENTS_SEARCH_FAILED", message: "Failed to search animals", requestId }));
  }
});

// ─── GET /api/patients/:id ───────────────────────────────────────────────────
// Single hospitalization by ID

router.get("/:id", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;

    const rows = await db
      .select({
        h: hospitalizations,
        a: animals,
        o: owners,
        vetName: users.name,
      })
      .from(hospitalizations)
      .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
      .leftJoin(owners, eq(animals.ownerId, owners.id))
      .leftJoin(users, eq(hospitalizations.admittingVetId, users.id))
      .where(and(eq(hospitalizations.id, id), eq(hospitalizations.clinicId, clinicId)))
      .limit(1);

    if (!rows.length) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "HOSPITALIZATION_NOT_FOUND", message: "Hospitalization not found", requestId }));

    const r = rows[0]!;
    res.json({ patient: hospitalizationRow(r.h, r.a, r.o, r.vetName ?? null) });
  } catch (err) {
    console.error("[patients] get failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PATIENTS_GET_FAILED", message: "Failed to load hospitalization", requestId }));
  }
});

// ─── POST /api/patients ──────────────────────────────────────────────────────
// Admit a patient (create hospitalization; create animal/owner if needed)

router.post("/", requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parse = admitSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "ADMIT_VALIDATION_FAILED", message: parse.error.flatten().formErrors.join(", ") || "Invalid request", requestId }));

  const data = parse.data;
  const clinicId = req.clinicId!;

  try {
    let animalId = data.animalId;

    if (!animalId) {
      // Find or create animal
      const existing = await db
        .select({ id: animals.id })
        .from(animals)
        .where(and(eq(animals.clinicId, clinicId), eq(animals.name, data.animalName!)))
        .limit(1);

      if (existing.length) {
        animalId = existing[0]!.id;
      } else {
        // Optionally create owner first
        let ownerId: string | null = null;
        if (data.ownerName?.trim()) {
          const ownedId = randomUUID();
          await db.insert(owners).values({
            id: ownedId,
            clinicId,
            fullName: data.ownerName.trim(),
            phone: data.ownerPhone?.trim() || null,
          });
          ownerId = ownedId;
        }

        const newAnimalId = randomUUID();
        await db.insert(animals).values({
          id: newAnimalId,
          clinicId,
          ownerId,
          name: data.animalName!,
          species: data.species?.trim() || null,
          breed: data.breed?.trim() || null,
          sex: data.sex?.trim() || null,
          weightKg: data.weightKg ? String(data.weightKg) : null,
        });
        animalId = newAnimalId;
      }
    } else {
      // Verify animal belongs to this clinic
      const check = await db
        .select({ id: animals.id })
        .from(animals)
        .where(and(eq(animals.id, animalId), eq(animals.clinicId, clinicId)))
        .limit(1);
      if (!check.length) return res.status(400).json(apiError({ code: "ANIMAL_NOT_FOUND", reason: "ANIMAL_NOT_IN_CLINIC", message: "Animal not found in this clinic", requestId }));
    }

    const restored = await restoreAnimalIfSoftDeleted(clinicId, animalId);
    if (restored) {
      logAudit({
        clinicId,
        actionType: "animal_restored",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        actorRole: resolveAuditActorRole(req),
        targetId: animalId,
        targetType: "animal",
        metadata: { reason: "readmitted" },
      });
    }

    const hospId = randomUUID();
    await db.insert(hospitalizations).values({
      id: hospId,
      clinicId,
      animalId,
      admissionReason: data.admissionReason?.trim() || null,
      ward: data.ward?.trim() || null,
      bay: data.bay?.trim() || null,
      admittingVetId: data.admittingVetId || null,
    });

    // Return full record
    const rows = await db
      .select({ h: hospitalizations, a: animals, o: owners, vetName: users.name })
      .from(hospitalizations)
      .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
      .leftJoin(owners, eq(animals.ownerId, owners.id))
      .leftJoin(users, eq(hospitalizations.admittingVetId, users.id))
      .where(eq(hospitalizations.id, hospId))
      .limit(1);

    const r = rows[0]!;
    const result = hospitalizationRow(r.h, r.a, r.o, r.vetName ?? null);

    postSystemMessage(clinicId, "hosp_admitted", {
      hospitalizationId: hospId,
      animalId,
      animalName: r.a.name,
      admittedAt: r.h.admittedAt?.toISOString() ?? new Date().toISOString(),
    }).catch(() => {});

    res.status(201).json({ patient: result });
  } catch (err) {
    console.error("[patients] admit failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PATIENTS_ADMIT_FAILED", message: "Failed to admit patient", requestId }));
  }
});

// ─── PATCH /api/patients/:id ────────────────────────────────────────────────
// Edit an active hospitalization's animal data and/or hospitalization fields.
// All body fields are optional; omitted keys are left unchanged. Cannot be
// used to discharge (status="discharged" is rejected) — use /:id/discharge
// for that, which runs pre-flight blocking-condition checks.

router.patch("/:id", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json(apiError({
      code: "VALIDATION_ERROR",
      reason: "UPDATE_VALIDATION_FAILED",
      message: parse.error.flatten().formErrors.join(", ") || "Invalid request",
      requestId,
    }));
  }

  const data = parse.data;
  if (data.status === "discharged") {
    return res.status(400).json(apiError({
      code: "VALIDATION_ERROR",
      reason: "USE_DISCHARGE_ENDPOINT",
      message: "Use PATCH /:id/discharge to discharge a patient",
      requestId,
    }));
  }

  const clinicId = req.clinicId!;
  const { id } = req.params;

  try {
    const [existing] = await db
      .select({
        id: hospitalizations.id,
        animalId: hospitalizations.animalId,
        status: hospitalizations.status,
      })
      .from(hospitalizations)
      .where(and(
        eq(hospitalizations.id, id),
        eq(hospitalizations.clinicId, clinicId),
        isNull(hospitalizations.dischargedAt),
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json(apiError({
        code: "NOT_FOUND",
        reason: "HOSPITALIZATION_NOT_FOUND",
        message: "Hospitalization not found or already discharged",
        requestId,
      }));
    }

    // Defense-in-depth: a deceased patient cannot be silently "resurrected"
    // through this generic edit endpoint. The frontend locks the status field
    // for terminal records, but a direct API caller must be rejected here too.
    if (
      data.status !== undefined &&
      existing.status === "deceased" &&
      data.status !== "deceased"
    ) {
      return res.status(409).json(apiError({
        code: "TERMINAL_STATUS_LOCKED",
        reason: "DECEASED_STATUS_IMMUTABLE",
        message: "Cannot change the status of a deceased patient",
        requestId,
      }));
    }

    const animalUpdate: Record<string, unknown> = {};
    if (data.animalName !== undefined) animalUpdate.name = data.animalName.trim();
    if (data.species !== undefined) animalUpdate.species = data.species?.trim() || null;
    if (data.breed !== undefined) animalUpdate.breed = data.breed?.trim() || null;
    if (data.sex !== undefined) animalUpdate.sex = data.sex?.trim() || null;
    if (data.weightKg !== undefined) animalUpdate.weightKg = data.weightKg != null ? String(data.weightKg) : null;

    const hospUpdate: Record<string, unknown> = {};
    if (data.ward !== undefined) hospUpdate.ward = data.ward?.trim() || null;
    if (data.bay !== undefined) hospUpdate.bay = data.bay?.trim() || null;
    if (data.admissionReason !== undefined) hospUpdate.admissionReason = data.admissionReason?.trim() || null;
    if (data.status !== undefined) hospUpdate.status = data.status;

    if (Object.keys(animalUpdate).length === 0 && Object.keys(hospUpdate).length === 0) {
      return res.status(400).json(apiError({
        code: "VALIDATION_ERROR",
        reason: "NO_FIELDS_TO_UPDATE",
        message: "At least one field is required",
        requestId,
      }));
    }

    await db.transaction(async (tx) => {
      if (Object.keys(animalUpdate).length > 0) {
        animalUpdate.updatedAt = new Date();
        await tx.update(animals)
          .set(animalUpdate)
          .where(and(eq(animals.id, existing.animalId), eq(animals.clinicId, clinicId)));
      }
      if (Object.keys(hospUpdate).length > 0) {
        hospUpdate.updatedAt = new Date();
        await tx.update(hospitalizations)
          .set(hospUpdate)
          .where(and(eq(hospitalizations.id, id), eq(hospitalizations.clinicId, clinicId)));
      }
    });

    const rows = await db
      .select({ h: hospitalizations, a: animals, o: owners, vetName: users.name })
      .from(hospitalizations)
      .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
      .leftJoin(owners, eq(animals.ownerId, owners.id))
      .leftJoin(users, eq(hospitalizations.admittingVetId, users.id))
      .where(eq(hospitalizations.id, id))
      .limit(1);

    if (!rows.length) {
      return res.status(404).json(apiError({
        code: "NOT_FOUND",
        reason: "HOSPITALIZATION_NOT_FOUND",
        message: "Hospitalization not found after update",
        requestId,
      }));
    }

    const r = rows[0]!;

    logAudit({
      clinicId,
      actionType: "patient_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      actorRole: resolveAuditActorRole(req),
      targetId: id,
      targetType: "hospitalization",
      metadata: {
        animalId: existing.animalId,
        animalFields: Object.keys(animalUpdate).filter((k) => k !== "updatedAt"),
        hospFields: Object.keys(hospUpdate).filter((k) => k !== "updatedAt"),
      },
    });

    if (data.status && (data.status === "critical" || data.status === "deceased")) {
      const eventType = data.status === "critical" ? "hosp_critical" : "hosp_deceased";
      postSystemMessage(clinicId, eventType, {
        hospitalizationId: id,
        status: data.status,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }

    res.json({ patient: hospitalizationRow(r.h, r.a, r.o, r.vetName ?? null) });
  } catch (err) {
    console.error("[patients] update failed", err);
    res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "PATIENTS_UPDATE_FAILED",
      message: "Failed to update patient",
      requestId,
    }));
  }
});

// ─── PATCH /api/patients/:id/status ─────────────────────────────────────────

router.patch("/:id/status", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parse = statusSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "STATUS_VALIDATION_FAILED", message: "Invalid status value", requestId }));

  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;

    const updated = await db
      .update(hospitalizations)
      .set({ status: parse.data.status, updatedAt: new Date() })
      .where(and(eq(hospitalizations.id, id), eq(hospitalizations.clinicId, clinicId), isNull(hospitalizations.dischargedAt)))
      .returning({ id: hospitalizations.id });

    if (!updated.length) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "HOSPITALIZATION_NOT_FOUND", message: "Hospitalization not found or already discharged", requestId }));

    const newStatus = parse.data.status;
    if (newStatus === "critical" || newStatus === "deceased") {
      const eventType = newStatus === "critical" ? "hosp_critical" : "hosp_deceased";
      postSystemMessage(clinicId, eventType, {
        hospitalizationId: id,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }

    res.json({ id: updated[0]!.id, status: parse.data.status });
  } catch (err) {
    console.error("[patients] status update failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PATIENTS_STATUS_FAILED", message: "Failed to update status", requestId }));
  }
});

// ─── PATCH /api/patients/:id/discharge ──────────────────────────────────────
//
// Fix B: pre-flight checks before discharge is committed.
// Blocks if any of the following exist for this hospitalization:
//   1. Open tasks (not completed or cancelled)
//   2. Unresolved emergency dispense events (EMERGENCY_PENDING)
//   3. Failed inventory jobs (inventoryStatus = FAILED)
//
// Pass ?override=true + body.overrideReason to force discharge despite violations.
// Override is audited.

const OPEN_TASK_STATUSES = ["pending", "assigned", "scheduled", "arrived", "approved", "in_progress"] as const;

router.patch("/:id/discharge", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parse = dischargeSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "DISCHARGE_VALIDATION_FAILED", message: "Invalid discharge request", requestId }));

  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;
    const override = req.query.override === "true";
    const overrideReason = parse.data.overrideReason?.trim() ?? null;

    if (override && !overrideReason) {
      return res.status(400).json(apiError({ code: "OVERRIDE_REASON_REQUIRED", reason: "OVERRIDE_REASON_REQUIRED", message: "overrideReason is required when override=true", requestId }));
    }

    // Verify hospitalization exists and is not already discharged
    const [hosp] = await db
      .select({ id: hospitalizations.id, animalId: hospitalizations.animalId })
      .from(hospitalizations)
      .where(and(eq(hospitalizations.id, id), eq(hospitalizations.clinicId, clinicId), isNull(hospitalizations.dischargedAt)))
      .limit(1);

    if (!hosp) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "HOSPITALIZATION_NOT_FOUND", message: "Hospitalization not found or already discharged", requestId }));

    // ── Pre-flight checks ──────────────────────────────────────────────────
    if (!override) {
      const blockingConditions: Array<{ type: string; ids: string[] }> = [];

      // 1. Open tasks linked to this hospitalization
      const openTasks = await db
        .select({ id: appointments.id, status: appointments.status })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            eq(appointments.hospitalizationId, id),
            inArray(appointments.status, [...OPEN_TASK_STATUSES]),
          ),
        );
      if (openTasks.length > 0) {
        blockingConditions.push({ type: "open_tasks", ids: openTasks.map((t) => t.id) });
      }

      // 2. Unresolved emergency dispense events for this patient
      const unresolvedDispenses = await db
        .select({ id: dispenseEvents.id })
        .from(dispenseEvents)
        .where(
          and(
            eq(dispenseEvents.clinicId, clinicId),
            eq(dispenseEvents.patientId, hosp.animalId),
            eq(dispenseEvents.status, "EMERGENCY_PENDING"),
          ),
        );
      if (unresolvedDispenses.length > 0) {
        blockingConditions.push({ type: "unresolved_emergency_dispenses", ids: unresolvedDispenses.map((d) => d.id) });
      }

      // 3. Failed inventory jobs for this patient's tasks
      const failedInventoryJobs = await db
        .select({ id: inventoryJobs.id })
        .from(inventoryJobs)
        .where(
          and(
            eq(inventoryJobs.clinicId, clinicId),
            eq(inventoryJobs.animalId, hosp.animalId),
            eq(inventoryJobs.status, "failed"),
          ),
        );
      if (failedInventoryJobs.length > 0) {
        blockingConditions.push({ type: "failed_inventory_jobs", ids: failedInventoryJobs.map((j) => j.id) });
      }

      if (blockingConditions.length > 0) {
        return res.status(409).json({
          code: "BLOCKING_CONDITIONS_PREVENT_DISCHARGE",
          error: "BLOCKING_CONDITIONS_PREVENT_DISCHARGE",
          reason: "BLOCKING_CONDITIONS_PREVENT_DISCHARGE",
          message: "Discharge blocked: one or more clinical conditions must be resolved before discharging this patient. Pass ?override=true with overrideReason to force discharge.",
          blockingConditions,
          requestId,
        });
      }
    }

    const now = new Date();
    const updated = await db
      .update(hospitalizations)
      .set({
        dischargedAt: now,
        status: "discharged",
        dischargeNotes: parse.data.dischargeNotes?.trim() || null,
        updatedAt: now,
      })
      .where(and(eq(hospitalizations.id, id), eq(hospitalizations.clinicId, clinicId), isNull(hospitalizations.dischargedAt)))
      .returning({ id: hospitalizations.id, dischargedAt: hospitalizations.dischargedAt });

    if (!updated.length) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "HOSPITALIZATION_NOT_FOUND", message: "Hospitalization not found or already discharged", requestId }));

    void releaseProcedureBoundEquipment(clinicId, id);

    logAudit({
      clinicId,
      actionType: "patient_discharged",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      actorRole: resolveAuditActorRole(req),
      targetId: id,
      targetType: "hospitalization",
      metadata: {
        dischargedAt: updated[0]!.dischargedAt?.toISOString() ?? null,
        dischargeNotes: parse.data.dischargeNotes?.trim() || null,
        override,
        overrideReason,
      },
    });

    postSystemMessage(clinicId, "hosp_discharged", {
      hospitalizationId: id,
      status: "discharged",
      updatedAt: now.toISOString(),
    }).catch(() => {});

    res.json({ id: updated[0]!.id, dischargedAt: updated[0]!.dischargedAt });
  } catch (err) {
    console.error("[patients] discharge failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PATIENTS_DISCHARGE_FAILED", message: "Failed to discharge patient", requestId }));
  }
});

// ─── DELETE /api/patients/:id ────────────────────────────────────────────────
// Soft-delete the animal (ends active admission when needed). Hard purge runs
// automatically after PURGE_AFTER_DAYS with no re-admission or clinical writes.

router.delete("/:id", requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const parse = deletePatientSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    return res.status(400).json(apiError({
      code: "VALIDATION_ERROR",
      reason: "DELETE_VALIDATION_FAILED",
      message: parse.error.flatten().formErrors.join(", ") || "Invalid request",
      requestId,
    }));
  }

  try {
    const clinicId = req.clinicId!;
    const override = req.query.override === "true";
    const result = await softDeletePatientByHospitalization({
      clinicId,
      hospitalizationId: req.params.id,
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      actorRole: resolveAuditActorRole(req),
      override,
      overrideReason: parse.data.overrideReason,
      dischargeNotes: parse.data.dischargeNotes,
    });

    res.json({ ok: true, animalId: result.animalId, purgeAfterDays: PURGE_AFTER_DAYS });
  } catch (err) {
    if (err instanceof PatientDeleteBlockedError) {
      return res.status(409).json({
        code: "BLOCKING_CONDITIONS_PREVENT_DISCHARGE",
        error: "BLOCKING_CONDITIONS_PREVENT_DISCHARGE",
        reason: "BLOCKING_CONDITIONS_PREVENT_DISCHARGE",
        message:
          "Delete blocked: resolve open tasks, emergency dispenses, or failed inventory jobs first, or pass ?override=true with overrideReason.",
        blockingConditions: err.blockingConditions,
        requestId,
      });
    }
    if (err instanceof Error && err.message === "OVERRIDE_REASON_REQUIRED") {
      return res.status(400).json(apiError({
        code: "OVERRIDE_REASON_REQUIRED",
        reason: "OVERRIDE_REASON_REQUIRED",
        message: "overrideReason is required when override=true",
        requestId,
      }));
    }
    if (err instanceof Error && err.message === "HOSPITALIZATION_NOT_FOUND") {
      return res.status(404).json(apiError({
        code: "NOT_FOUND",
        reason: "HOSPITALIZATION_NOT_FOUND",
        message: "Hospitalization not found",
        requestId,
      }));
    }
    if (err instanceof Error && err.message === "ANIMAL_ALREADY_DELETED") {
      return res.status(409).json(apiError({
        code: "ANIMAL_ALREADY_DELETED",
        reason: "ANIMAL_ALREADY_DELETED",
        message: "Patient is already deleted",
        requestId,
      }));
    }
    console.error("[patients] delete failed", err);
    res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "PATIENTS_DELETE_FAILED",
      message: "Failed to delete patient",
      requestId,
    }));
  }
});

router.patch("/:id/assign", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;
    const userId = req.authUser!.id;

    const now = new Date();
    const { ward, bay } = req.body || {};

    const updateData: {
      admittingVetId: string;
      updatedAt: Date;
      ward?: string;
      bay?: string;
    } = {
      admittingVetId: userId,
      updatedAt: now,
    };

    if (ward !== undefined) updateData.ward = ward;
    if (bay !== undefined) updateData.bay = bay;

    const updated = await db
      .update(hospitalizations)
      .set(updateData)
      .where(
        and(
          eq(hospitalizations.id, id),
          eq(hospitalizations.clinicId, clinicId),
          isNull(hospitalizations.dischargedAt),
        ),
      )
      .returning({ id: hospitalizations.id });

    if (!updated.length) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "HOSPITALIZATION_NOT_FOUND",
          message: "Hospitalization not found",
          requestId,
        }),
      );
    }

    res.json({ id: updated[0]!.id, assigned: true });
  } catch (err) {
    console.error("[patients] assign failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PATIENTS_ASSIGN_FAILED",
        message: "Failed to assign patient",
        requestId,
      }),
    );
  }
});

export default router;