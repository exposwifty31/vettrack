import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  animals,
  db,
  hospitalizations,
  shiftPatientHandoffItems,
  shiftPatientHandoffs,
  users,
} from "../db.js";
import { logAudit } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import type {
  CancelHandoffResponse,
  CreateHandoffResponse,
  HandoffDetailResponse,
  HandoffEligiblePatientsResponse,
  HandoffEligibleStaffResponse,
  HandoffItemDetail,
  HandoffListItem,
  MyHandoffsResponse,
  ReviewHandoffResponse,
  SubmitHandoffResponse,
  UpsertItemRequest,
  UpsertItemResponse,
} from "../../shared/patient-handoff-types.js";

const TERMINAL_HOSP_STATUSES = ["discharged", "deceased"] as const;

// Roles permitted to participate in a technician-to-technician handoff
// (matches ROLE_HIERARCHY >= technician in server/middleware/auth.ts).
const HANDOFF_ELIGIBLE_ROLES = [
  "admin",
  "vet",
  "senior_technician",
  "lead_technician",
  "vet_tech",
  "technician",
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

function apiError(code: string, status: number, message: string): Error & { code: string; httpStatus: number } {
  const e = new Error(message) as Error & { code: string; httpStatus: number };
  e.code = code;
  e.httpStatus = status;
  return e;
}

// ─── Eligible patients ────────────────────────────────────────────────────────

export async function listEligiblePatients(clinicId: string): Promise<HandoffEligiblePatientsResponse> {
  const rows = await db
    .select({
      hospitalizationId: hospitalizations.id,
      animalId: animals.id,
      animalName: animals.name,
      status: hospitalizations.status,
      ward: hospitalizations.ward,
      bay: hospitalizations.bay,
    })
    .from(hospitalizations)
    .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
    .where(
      and(
        eq(hospitalizations.clinicId, clinicId),
        eq(animals.clinicId, clinicId),
        isNull(hospitalizations.dischargedAt),
        notInArray(hospitalizations.status, [...TERMINAL_HOSP_STATUSES]),
      ),
    )
    .orderBy(desc(hospitalizations.admittedAt))
    .limit(200);

  return { patients: rows };
}

// ─── Eligible staff ───────────────────────────────────────────────────────────

export async function listEligibleStaff(
  clinicId: string,
  excludeUserId: string,
): Promise<HandoffEligibleStaffResponse> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.clinicId, clinicId),
        eq(users.status, "active"),
        inArray(users.role, [...HANDOFF_ELIGIBLE_ROLES]),
        sql`${users.id} != ${excludeUserId}`,
      ),
    )
    .orderBy(users.displayName)
    .limit(200);

  return {
    staff: rows.map((r) => ({
      id: r.id,
      displayName: r.displayName ?? r.id,
      role: r.role,
    })),
  };
}

// ─── Create draft header ──────────────────────────────────────────────────────

export async function createHandoff(
  clinicId: string,
  outgoingUserId: string,
  receivingUserId: string,
): Promise<CreateHandoffResponse> {
  if (receivingUserId === outgoingUserId) {
    throw apiError("RECEIVING_USER_INVALID", 400, "Receiving user cannot be the outgoing user");
  }

  const [receiver] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, receivingUserId), eq(users.clinicId, clinicId), eq(users.status, "active")))
    .limit(1);

  if (!receiver) {
    throw apiError("RECEIVING_USER_UNAVAILABLE", 409, "Receiving user not found or not active in this clinic");
  }

  if (!HANDOFF_ELIGIBLE_ROLES.includes(receiver.role as (typeof HANDOFF_ELIGIBLE_ROLES)[number])) {
    throw apiError("RECEIVING_USER_INVALID_ROLE", 400, "Receiving user role is not eligible for handoffs");
  }

  const id = randomUUID();
  const now = new Date();

  await db.insert(shiftPatientHandoffs).values({
    id,
    clinicId,
    outgoingUserId,
    receivingUserId,
    status: "draft",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  return { id, status: "draft", version: 1, createdAt: now.toISOString() };
}

// ─── List mine ────────────────────────────────────────────────────────────────

export async function getMyHandoffs(clinicId: string, userId: string): Promise<MyHandoffsResponse> {
  // Aliases
  const outUser = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .as("out_user");
  const recUser = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .as("rec_user");

  const rows = await db
    .select({
      id: shiftPatientHandoffs.id,
      outgoingUserId: shiftPatientHandoffs.outgoingUserId,
      outgoingUserName: outUser.displayName,
      receivingUserId: shiftPatientHandoffs.receivingUserId,
      receivingUserName: recUser.displayName,
      status: shiftPatientHandoffs.status,
      version: shiftPatientHandoffs.version,
      createdAt: shiftPatientHandoffs.createdAt,
      submittedAt: shiftPatientHandoffs.submittedAt,
      reviewedAt: shiftPatientHandoffs.reviewedAt,
      cancelledAt: shiftPatientHandoffs.cancelledAt,
      patientCount: sql<number>`(
        SELECT COUNT(*) FROM vt_shift_patient_handoff_items
        WHERE handoff_id = ${shiftPatientHandoffs.id}
      )::int`,
    })
    .from(shiftPatientHandoffs)
    .leftJoin(outUser, eq(outUser.id, shiftPatientHandoffs.outgoingUserId))
    .leftJoin(recUser, eq(recUser.id, shiftPatientHandoffs.receivingUserId))
    .where(
      and(
        eq(shiftPatientHandoffs.clinicId, clinicId),
        sql`(${shiftPatientHandoffs.outgoingUserId} = ${userId} OR ${shiftPatientHandoffs.receivingUserId} = ${userId})`,
      ),
    )
    .orderBy(desc(shiftPatientHandoffs.createdAt))
    .limit(100);

  const toItem = (r: (typeof rows)[number]): HandoffListItem => ({
    id: r.id,
    outgoingUserId: r.outgoingUserId,
    outgoingUserName: r.outgoingUserName ?? r.outgoingUserId,
    receivingUserId: r.receivingUserId,
    receivingUserName: r.receivingUserName ?? r.receivingUserId,
    status: r.status as HandoffListItem["status"],
    version: r.version,
    patientCount: r.patientCount,
    createdAt: toIso(r.createdAt)!,
    submittedAt: toIso(r.submittedAt),
    reviewedAt: toIso(r.reviewedAt),
    cancelledAt: toIso(r.cancelledAt),
  });

  return {
    outgoing: rows.filter((r) => r.outgoingUserId === userId).map(toItem),
    incoming: rows.filter((r) => r.receivingUserId === userId && r.outgoingUserId !== userId).map(toItem),
  };
}

// ─── Get detail ───────────────────────────────────────────────────────────────

export async function getHandoffDetail(
  clinicId: string,
  handoffId: string,
  callerId: string,
  callerRole: string,
): Promise<HandoffDetailResponse> {
  const outUser = db.select({ id: users.id, displayName: users.displayName }).from(users).as("out_user");
  const recUser = db.select({ id: users.id, displayName: users.displayName }).from(users).as("rec_user");

  const [header] = await db
    .select({
      id: shiftPatientHandoffs.id,
      outgoingUserId: shiftPatientHandoffs.outgoingUserId,
      outgoingUserName: outUser.displayName,
      receivingUserId: shiftPatientHandoffs.receivingUserId,
      receivingUserName: recUser.displayName,
      status: shiftPatientHandoffs.status,
      version: shiftPatientHandoffs.version,
      createdAt: shiftPatientHandoffs.createdAt,
      submittedAt: shiftPatientHandoffs.submittedAt,
      reviewedAt: shiftPatientHandoffs.reviewedAt,
      cancelledAt: shiftPatientHandoffs.cancelledAt,
    })
    .from(shiftPatientHandoffs)
    .leftJoin(outUser, eq(outUser.id, shiftPatientHandoffs.outgoingUserId))
    .leftJoin(recUser, eq(recUser.id, shiftPatientHandoffs.receivingUserId))
    .where(and(eq(shiftPatientHandoffs.id, handoffId), eq(shiftPatientHandoffs.clinicId, clinicId)))
    .limit(1);

  if (!header) throw apiError("NOT_FOUND", 404, "Handoff not found");

  const isParticipant = header.outgoingUserId === callerId || header.receivingUserId === callerId;
  const isAdmin = callerRole === "admin";
  if (!isParticipant && !isAdmin) throw apiError("FORBIDDEN", 403, "Not a participant of this handoff");

  const itemRows = await db
    .select({
      id: shiftPatientHandoffItems.id,
      hospitalizationId: shiftPatientHandoffItems.hospitalizationId,
      animalId: shiftPatientHandoffItems.animalId,
      animalName: animals.name,
      ward: hospitalizations.ward,
      bay: hospitalizations.bay,
      status: shiftPatientHandoffItems.status,
      skipReason: shiftPatientHandoffItems.skipReason,
      currentStability: shiftPatientHandoffItems.currentStability,
      pendingTasksNote: shiftPatientHandoffItems.pendingTasksNote,
      criticalWarnings: shiftPatientHandoffItems.criticalWarnings,
      clinicalNote: shiftPatientHandoffItems.clinicalNote,
      patientSnapshot: shiftPatientHandoffItems.patientSnapshot,
      version: shiftPatientHandoffItems.version,
      updatedAt: shiftPatientHandoffItems.updatedAt,
    })
    .from(shiftPatientHandoffItems)
    .leftJoin(animals, eq(shiftPatientHandoffItems.animalId, animals.id))
    .leftJoin(hospitalizations, eq(shiftPatientHandoffItems.hospitalizationId, hospitalizations.id))
    .where(eq(shiftPatientHandoffItems.handoffId, handoffId))
    .orderBy(shiftPatientHandoffItems.createdAt);

  const items: HandoffItemDetail[] = itemRows.map((r) => ({
    id: r.id,
    hospitalizationId: r.hospitalizationId,
    animalId: r.animalId,
    animalName: r.animalName ?? r.animalId,
    ward: r.ward ?? null,
    bay: r.bay ?? null,
    status: r.status as HandoffItemDetail["status"],
    skipReason: r.skipReason ?? null,
    currentStability: r.currentStability,
    pendingTasksNote: r.pendingTasksNote,
    criticalWarnings: r.criticalWarnings,
    clinicalNote: r.clinicalNote,
    patientSnapshot: (r.patientSnapshot ?? {}) as Record<string, unknown>,
    version: r.version,
    updatedAt: toIso(r.updatedAt)!,
  }));

  return {
    id: header.id,
    outgoingUserId: header.outgoingUserId,
    outgoingUserName: header.outgoingUserName ?? header.outgoingUserId,
    receivingUserId: header.receivingUserId,
    receivingUserName: header.receivingUserName ?? header.receivingUserId,
    status: header.status as HandoffDetailResponse["status"],
    version: header.version,
    patientCount: items.length,
    createdAt: toIso(header.createdAt)!,
    submittedAt: toIso(header.submittedAt),
    reviewedAt: toIso(header.reviewedAt),
    cancelledAt: toIso(header.cancelledAt),
    items,
  };
}

// ─── Upsert item ──────────────────────────────────────────────────────────────

export async function upsertItem(
  clinicId: string,
  handoffId: string,
  hospitalizationId: string,
  callerId: string,
  body: UpsertItemRequest,
): Promise<UpsertItemResponse> {
  const [header] = await db
    .select({
      outgoingUserId: shiftPatientHandoffs.outgoingUserId,
      status: shiftPatientHandoffs.status,
    })
    .from(shiftPatientHandoffs)
    .where(and(eq(shiftPatientHandoffs.id, handoffId), eq(shiftPatientHandoffs.clinicId, clinicId)))
    .limit(1);

  if (!header) throw apiError("NOT_FOUND", 404, "Handoff not found");
  if (header.outgoingUserId !== callerId) throw apiError("FORBIDDEN", 403, "Only the outgoing user can edit items");
  if (header.status !== "draft") throw apiError("HANDOFF_NOT_DRAFT", 409, "Handoff is not in draft status");

  // Fetch hosp + animal to populate animalId
  const [hosp] = await db
    .select({ id: hospitalizations.id, animalId: hospitalizations.animalId })
    .from(hospitalizations)
    .where(and(eq(hospitalizations.id, hospitalizationId), eq(hospitalizations.clinicId, clinicId)))
    .limit(1);

  if (!hosp) throw apiError("HOSPITALIZATION_NOT_FOUND", 404, "Hospitalization not found");

  const now = new Date();
  const existingRows = await db
    .select({ id: shiftPatientHandoffItems.id, version: shiftPatientHandoffItems.version })
    .from(shiftPatientHandoffItems)
    .where(
      and(
        eq(shiftPatientHandoffItems.handoffId, handoffId),
        eq(shiftPatientHandoffItems.hospitalizationId, hospitalizationId),
      ),
    )
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    // First save — INSERT with conflict handling
    const id = randomUUID();
    const newStatus = body.status ?? "draft";

    const inserted = await db
      .insert(shiftPatientHandoffItems)
      .values({
        id,
        clinicId,
        handoffId,
        hospitalizationId,
        animalId: hosp.animalId,
        status: newStatus,
        skipReason: body.skipReason ?? null,
        currentStability: body.currentStability ?? "",
        pendingTasksNote: body.pendingTasksNote ?? "",
        criticalWarnings: body.criticalWarnings ?? "",
        clinicalNote: body.clinicalNote ?? "",
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: shiftPatientHandoffItems.id });

    if (inserted.length === 0) {
      // Another request already created this item
      throw apiError("CONFLICT_STALE_DRAFT", 409, "Item was created by another request — please refresh");
    }

    return { id, status: newStatus as UpsertItemResponse["status"], version: 1, updatedAt: now.toISOString() };
  }

  // UPDATE with optional optimistic concurrency
  const patch: Record<string, unknown> = { updatedAt: now, version: existing.version + 1 };
  if (body.status !== undefined) patch.status = body.status;
  if (body.skipReason !== undefined) patch.skipReason = body.skipReason;
  if (body.currentStability !== undefined) patch.currentStability = body.currentStability;
  if (body.pendingTasksNote !== undefined) patch.pendingTasksNote = body.pendingTasksNote;
  if (body.criticalWarnings !== undefined) patch.criticalWarnings = body.criticalWarnings;
  if (body.clinicalNote !== undefined) patch.clinicalNote = body.clinicalNote;

  const whereClause =
    body.version !== undefined
      ? and(
          eq(shiftPatientHandoffItems.id, existing.id),
          eq(shiftPatientHandoffItems.version, body.version),
        )
      : eq(shiftPatientHandoffItems.id, existing.id);

  const updated = await db
    .update(shiftPatientHandoffItems)
    .set(patch)
    .where(whereClause!)
    .returning({ status: shiftPatientHandoffItems.status, version: shiftPatientHandoffItems.version });

  if (updated.length === 0) {
    throw apiError("CONFLICT_STALE_DRAFT", 409, "Item was modified by another request — please refresh");
  }

  return {
    id: existing.id,
    status: updated[0].status as UpsertItemResponse["status"],
    version: updated[0].version,
    updatedAt: now.toISOString(),
  };
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitHandoff(
  clinicId: string,
  handoffId: string,
  callerId: string,
  callerEmail: string,
  callerRole: string,
  version: number,
): Promise<SubmitHandoffResponse> {
  const [header] = await db
    .select({
      outgoingUserId: shiftPatientHandoffs.outgoingUserId,
      receivingUserId: shiftPatientHandoffs.receivingUserId,
      status: shiftPatientHandoffs.status,
      version: shiftPatientHandoffs.version,
    })
    .from(shiftPatientHandoffs)
    .where(and(eq(shiftPatientHandoffs.id, handoffId), eq(shiftPatientHandoffs.clinicId, clinicId)))
    .limit(1);

  if (!header) throw apiError("NOT_FOUND", 404, "Handoff not found");
  if (header.outgoingUserId !== callerId) throw apiError("FORBIDDEN", 403, "Only the outgoing user can submit");
  if (header.status !== "draft") throw apiError("HANDOFF_NOT_DRAFT", 409, "Handoff is not in draft status");
  if (header.version !== version) throw apiError("CONFLICT_STALE_DRAFT", 409, "Stale version — please refresh");

  // Validate receiver still active
  const [receiver] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, header.receivingUserId), eq(users.clinicId, clinicId), eq(users.status, "active")))
    .limit(1);
  if (!receiver) throw apiError("RECEIVING_USER_UNAVAILABLE", 409, "Receiving user is no longer active");

  // Fetch all items
  const items = await db
    .select({
      id: shiftPatientHandoffItems.id,
      hospitalizationId: shiftPatientHandoffItems.hospitalizationId,
      animalId: shiftPatientHandoffItems.animalId,
      animalName: animals.name,
      status: shiftPatientHandoffItems.status,
    })
    .from(shiftPatientHandoffItems)
    .leftJoin(animals, eq(shiftPatientHandoffItems.animalId, animals.id))
    .where(eq(shiftPatientHandoffItems.handoffId, handoffId));

  if (items.length === 0) throw apiError("NO_ITEMS", 400, "No patients in this handoff");

  const notReady = items.filter((i) => i.status !== "ready" && i.status !== "skipped");
  if (notReady.length > 0) {
    throw apiError(
      "ITEMS_NOT_READY",
      409,
      `${notReady.length} patient(s) are still in draft — mark them ready or skip them before submitting`,
    );
  }

  // Validate non-skipped patients
  const activeItems = items.filter((i) => i.status === "ready");
  const invalidated: Array<{ id: string; hospitalizationId: string; reason: string }> = [];
  const snapshots: Map<string, Record<string, unknown>> = new Map();

  if (activeItems.length > 0) {
    const hospIds = activeItems.map((i) => i.hospitalizationId);
    const hospRows = await db
      .select({
        id: hospitalizations.id,
        status: hospitalizations.status,
        ward: hospitalizations.ward,
        bay: hospitalizations.bay,
        dischargedAt: hospitalizations.dischargedAt,
      })
      .from(hospitalizations)
      .where(and(inArray(hospitalizations.id, hospIds), eq(hospitalizations.clinicId, clinicId)));

    const hospById = new Map(hospRows.map((h) => [h.id, h]));

    for (const item of activeItems) {
      const hosp = hospById.get(item.hospitalizationId);
      if (!hosp || hosp.dischargedAt || TERMINAL_HOSP_STATUSES.includes(hosp.status as typeof TERMINAL_HOSP_STATUSES[number])) {
        invalidated.push({
          id: item.id,
          hospitalizationId: item.hospitalizationId,
          reason: !hosp ? "hospitalization_not_found" : "patient_discharged",
        });
      } else {
        snapshots.set(item.id, {
          hospitalizationId: item.hospitalizationId,
          animalId: item.animalId,
          animalName: item.animalName ?? item.animalId,
          status: hosp.status,
          ward: hosp.ward ?? null,
          bay: hosp.bay ?? null,
        });
      }
    }
  }

  if (invalidated.length > 0) {
    // Persist invalidated status so UI can show affected items
    // version is intentionally NOT incremented; invalidation is a server-side preflight result
    await db
      .update(shiftPatientHandoffItems)
      .set({ status: "invalidated", updatedAt: new Date() })
      .where(
        and(
          eq(shiftPatientHandoffItems.clinicId, clinicId),
          inArray(
            shiftPatientHandoffItems.id,
            invalidated.map((i) => i.id),
          ),
        ),
      );

    const err = apiError("HANDOFF_ITEMS_INVALIDATED", 409, "Some patients became unavailable") as Error & {
      code: string;
      httpStatus: number;
      invalidatedItems: typeof invalidated;
    };
    err.invalidatedItems = invalidated;
    throw err;
  }

  // Commit: write snapshots + status transition
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const [itemId, snapshot] of snapshots) {
      await tx
        .update(shiftPatientHandoffItems)
        .set({ patientSnapshot: snapshot, updatedAt: now })
        .where(eq(shiftPatientHandoffItems.id, itemId));
    }

    // Guard by version + status to prevent concurrent submit races
    const updated = await tx
      .update(shiftPatientHandoffs)
      .set({
        status: "submitted",
        submittedAt: now,
        version: version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(shiftPatientHandoffs.id, handoffId),
          eq(shiftPatientHandoffs.clinicId, clinicId),
          eq(shiftPatientHandoffs.status, "draft"),
          eq(shiftPatientHandoffs.version, version),
        ),
      )
      .returning({ id: shiftPatientHandoffs.id });

    if (updated.length === 0) {
      throw apiError("CONFLICT_STALE_DRAFT", 409, "Handoff version changed — please refresh");
    }

    // Event insertion must be inside transaction for atomicity
    await insertRealtimeDomainEvent(tx, {
      clinicId,
      type: "PATIENT_HANDOFF_SUBMITTED",
      payload: { handoffId, receivingUserId: header.receivingUserId, patientCount: activeItems.length },
      category: "PATIENT",
    });
  });

  logAudit({
    clinicId,
    actionType: "patient_handoff_submitted",
    performedBy: callerId,
    performedByEmail: callerEmail,
    actorRole: callerRole,
    targetId: handoffId,
    targetType: "shift_patient_handoff",
    metadata: { patientCount: activeItems.length },
  });

  return { id: handoffId, status: "submitted", version: version + 1, submittedAt: now.toISOString() };
}

// ─── Review ───────────────────────────────────────────────────────────────────

export async function reviewHandoff(
  clinicId: string,
  handoffId: string,
  callerId: string,
  callerEmail: string,
  callerRole: string,
  version: number,
): Promise<ReviewHandoffResponse> {
  const [header] = await db
    .select({
      receivingUserId: shiftPatientHandoffs.receivingUserId,
      status: shiftPatientHandoffs.status,
      version: shiftPatientHandoffs.version,
    })
    .from(shiftPatientHandoffs)
    .where(and(eq(shiftPatientHandoffs.id, handoffId), eq(shiftPatientHandoffs.clinicId, clinicId)))
    .limit(1);

  if (!header) throw apiError("NOT_FOUND", 404, "Handoff not found");
  if (header.receivingUserId !== callerId) throw apiError("FORBIDDEN", 403, "Only the receiving user can mark reviewed");
  if (header.status !== "submitted") throw apiError("HANDOFF_NOT_SUBMITTED", 409, "Handoff is not in submitted status");
  if (header.version !== version) throw apiError("CONFLICT_STALE_DRAFT", 409, "Stale version — please refresh");

  const now = new Date();

  await db.transaction(async (tx) => {
    // Guard by version + status to prevent concurrent review races
    const updated = await tx
      .update(shiftPatientHandoffs)
      .set({ status: "reviewed", reviewedAt: now, version: version + 1, updatedAt: now })
      .where(
        and(
          eq(shiftPatientHandoffs.id, handoffId),
          eq(shiftPatientHandoffs.clinicId, clinicId),
          eq(shiftPatientHandoffs.status, "submitted"),
          eq(shiftPatientHandoffs.version, version),
        ),
      )
      .returning({ id: shiftPatientHandoffs.id });

    if (updated.length === 0) {
      throw apiError("CONFLICT_STALE_DRAFT", 409, "Handoff version changed — please refresh");
    }

    // Event insertion must be inside transaction for atomicity
    await insertRealtimeDomainEvent(tx, {
      clinicId,
      type: "PATIENT_HANDOFF_REVIEWED",
      payload: { handoffId },
      category: "PATIENT",
    });
  });

  logAudit({
    clinicId,
    actionType: "patient_handoff_reviewed",
    performedBy: callerId,
    performedByEmail: callerEmail,
    actorRole: callerRole,
    targetId: handoffId,
    targetType: "shift_patient_handoff",
  });

  return { id: handoffId, status: "reviewed", version: version + 1, reviewedAt: now.toISOString() };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelHandoff(
  clinicId: string,
  handoffId: string,
  callerId: string,
  callerEmail: string,
  callerRole: string,
  version: number,
): Promise<{ id: string; status: "cancelled"; version: number; cancelledAt: string }> {
  const [header] = await db
    .select({
      outgoingUserId: shiftPatientHandoffs.outgoingUserId,
      status: shiftPatientHandoffs.status,
      version: shiftPatientHandoffs.version,
    })
    .from(shiftPatientHandoffs)
    .where(and(eq(shiftPatientHandoffs.id, handoffId), eq(shiftPatientHandoffs.clinicId, clinicId)))
    .limit(1);

  if (!header) throw apiError("NOT_FOUND", 404, "Handoff not found");
  if (header.outgoingUserId !== callerId) throw apiError("FORBIDDEN", 403, "Only the outgoing user can cancel");
  if (header.status !== "draft") throw apiError("HANDOFF_NOT_DRAFT", 409, "Only draft handoffs can be cancelled");
  if (header.version !== version) throw apiError("CONFLICT_STALE_DRAFT", 409, "Stale version — please refresh");

  const now = new Date();

  await db.transaction(async (tx) => {
    // Guard by version + status to prevent concurrent cancel races
    const updated = await tx
      .update(shiftPatientHandoffs)
      .set({ status: "cancelled", cancelledAt: now, version: version + 1, updatedAt: now })
      .where(
        and(
          eq(shiftPatientHandoffs.id, handoffId),
          eq(shiftPatientHandoffs.clinicId, clinicId),
          eq(shiftPatientHandoffs.status, "draft"),
          eq(shiftPatientHandoffs.version, version),
        ),
      )
      .returning({ id: shiftPatientHandoffs.id });

    if (updated.length === 0) {
      throw apiError("CONFLICT_STALE_DRAFT", 409, "Handoff version changed — please refresh");
    }
  });

  logAudit({
    clinicId,
    actionType: "patient_handoff_cancelled",
    performedBy: callerId,
    performedByEmail: callerEmail,
    actorRole: callerRole,
    targetId: handoffId,
    targetType: "shift_patient_handoff",
  });

  return { id: handoffId, status: "cancelled", version: version + 1, cancelledAt: now.toISOString() };
}
