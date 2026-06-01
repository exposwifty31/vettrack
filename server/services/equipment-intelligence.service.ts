import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  equipmentIntelligenceRecommendations,
  equipmentIntelligenceRuns,
} from "../db.js";
import { logAudit, resolveAuditActorRole, type AuditActorSource } from "../lib/audit.js";
import { buildEquipmentIntelligenceContext } from "../intelligence/context-builder.service.js";
import {
  partitionShiftHandoverRecommendations,
  runEquipmentIntelligenceEngine,
} from "../intelligence/intelligence-engine.service.js";
import type {
  IntelligenceAnalysisResponse,
  ShiftHandoverIntelligenceResponse,
} from "../../shared/equipment-intelligence.js";
import { createAppointment, type TaskAuditActor } from "./appointments.service.js";
import { resolveEffectiveRuntimePilotMode } from "../../shared/effective-pilot-mode.js";

export class EquipmentIntelligenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EquipmentIntelligenceError";
  }
}

async function persistRun(params: {
  clinicId: string;
  userId: string;
  kind: string;
  contextSummary: Record<string, unknown>;
  evidenceGraph: unknown;
  responsePayload: unknown;
  openaiModel: string | null;
  recommendations: Array<{
    id: string;
    finding: string;
    severity: string;
    confidence: string;
    evidence: string[];
    impact: string;
    recommendedAction: string;
    suggestedTaskType?: string;
  }>;
}): Promise<string> {
  const runId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(equipmentIntelligenceRuns).values({
      id: runId,
      clinicId: params.clinicId,
      userId: params.userId,
      kind: params.kind,
      contextSummary: params.contextSummary,
      evidenceGraph: params.evidenceGraph,
      responsePayload: params.responsePayload,
      openaiModel: params.openaiModel,
    });
    if (params.recommendations.length > 0) {
      await tx.insert(equipmentIntelligenceRecommendations).values(
        params.recommendations.map((r) => ({
          id: r.id,
          clinicId: params.clinicId,
          runId,
          finding: r.finding,
          severity: r.severity,
          confidence: r.confidence,
          evidence: r.evidence,
          impact: r.impact,
          recommendedAction: r.recommendedAction,
          suggestedTaskType: r.suggestedTaskType ?? null,
          status: "proposed",
        })),
      );
    }
  });
  return runId;
}

function auditIntelligence(
  actor: AuditActorSource & { authUser: { id: string; email: string } },
  clinicId: string,
  actionType:
    | "equipment_intelligence_analyze_requested"
    | "equipment_intelligence_analyze_completed"
    | "equipment_intelligence_shift_handover_requested"
    | "equipment_intelligence_shift_handover_completed"
    | "equipment_intelligence_recommendation_task_approved"
    | "equipment_intelligence_task_created",
  metadata: Record<string, unknown>,
  targetId?: string,
): void {
  logAudit({
    clinicId,
    actionType,
    performedBy: actor.authUser.id,
    performedByEmail: actor.authUser.email,
    targetId: targetId ?? null,
    targetType: "equipment_intelligence",
    metadata,
    actorRole: resolveAuditActorRole(actor),
  });
}

export async function analyzeCurrentEquipmentState(params: {
  clinicId: string;
  userId: string;
  userEmail: string;
  actor: AuditActorSource & { authUser: { id: string; email: string } };
}): Promise<IntelligenceAnalysisResponse> {
  auditIntelligence(params.actor, params.clinicId, "equipment_intelligence_analyze_requested", {
    userId: params.userId,
  });

  const { snapshot, graph } = await buildEquipmentIntelligenceContext(params.clinicId);
  const engine = await runEquipmentIntelligenceEngine({
    snapshot,
    graph,
    mode: "analyze",
    topLimit: 5,
  });

  const generatedAt = new Date().toISOString();
  const response: IntelligenceAnalysisResponse = {
    runId: "",
    generatedAt,
    executiveSummary: engine.executiveSummary,
    topRisks: engine.recommendations,
    evidence: graph,
    recommendedActions: engine.recommendations.map((r) => ({
      recommendationId: r.id,
      action: r.recommendedAction,
    })),
    confidenceLevels: engine.recommendations.map((r) => ({
      recommendationId: r.id,
      confidence: r.confidence,
    })),
    insufficientEvidence: engine.insufficientEvidence,
    insufficientEvidenceMessage: engine.insufficientEvidenceMessage,
  };

  const runId = await persistRun({
    clinicId: params.clinicId,
    userId: params.userId,
    kind: "analyze",
    contextSummary: {
      equipmentCount: snapshot.equipmentCount,
      metrics: snapshot.metrics,
      windowStart: snapshot.windowStart,
      windowEnd: snapshot.windowEnd,
    },
    evidenceGraph: graph,
    responsePayload: response,
    openaiModel: engine.openaiModel,
    recommendations: engine.recommendations,
  });
  response.runId = runId;

  auditIntelligence(
    params.actor,
    params.clinicId,
    "equipment_intelligence_analyze_completed",
    {
      runId,
      riskCount: engine.recommendations.length,
      insufficientEvidence: engine.insufficientEvidence,
      openaiModel: engine.openaiModel,
    },
    runId,
  );

  return response;
}

export async function generateShiftHandoverIntelligence(params: {
  clinicId: string;
  userId: string;
  userEmail: string;
  actor: AuditActorSource & { authUser: { id: string; email: string } };
}): Promise<ShiftHandoverIntelligenceResponse> {
  auditIntelligence(
    params.actor,
    params.clinicId,
    "equipment_intelligence_shift_handover_requested",
    { userId: params.userId },
  );

  const { snapshot, graph } = await buildEquipmentIntelligenceContext(params.clinicId);
  const engine = await runEquipmentIntelligenceEngine({
    snapshot,
    graph,
    mode: "shift_handover",
    topLimit: 8,
  });

  const partitions = partitionShiftHandoverRecommendations(engine.recommendations);
  const generatedAt = new Date().toISOString();

  const response: ShiftHandoverIntelligenceResponse = {
    runId: "",
    generatedAt,
    executiveSummary: engine.executiveSummary,
    ...partitions,
    evidence: graph,
    insufficientEvidence: engine.insufficientEvidence,
    insufficientEvidenceMessage: engine.insufficientEvidenceMessage,
  };

  const allRecs = engine.recommendations;
  const runId = await persistRun({
    clinicId: params.clinicId,
    userId: params.userId,
    kind: "shift_handover",
    contextSummary: {
      equipmentCount: snapshot.equipmentCount,
      openShiftSessionId: snapshot.openShiftSessionId,
      metrics: snapshot.metrics,
    },
    evidenceGraph: graph,
    responsePayload: response,
    openaiModel: engine.openaiModel,
    recommendations: allRecs,
  });
  response.runId = runId;

  auditIntelligence(
    params.actor,
    params.clinicId,
    "equipment_intelligence_shift_handover_completed",
    { runId, riskCount: allRecs.length },
    runId,
  );

  return response;
}

export async function createTaskFromIntelligenceRecommendation(params: {
  clinicId: string;
  recommendationId: string;
  confirmed: boolean;
  notes?: string;
  actor: AuditActorSource & { authUser: { id: string; email: string; role: string } };
}): Promise<{ taskId: string; recommendationId: string }> {
  if (!params.confirmed) {
    throw new EquipmentIntelligenceError(
      "APPROVAL_REQUIRED",
      400,
      "Human approval is required (confirmed: true).",
    );
  }

  if (resolveEffectiveRuntimePilotMode()) {
    throw new EquipmentIntelligenceError(
      "PILOT_MODE_TASKS_UNAVAILABLE",
      501,
      "Task creation from intelligence is unavailable in equipment pilot mode.",
    );
  }

  // Serialize concurrent confirmed requests for the same recommendation: a row lock
  // (SELECT ... FOR UPDATE) makes the second caller block until the first commits the
  // `task_created` status, at which point it returns the existing task instead of
  // creating a duplicate appointment.
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .select()
      .from(equipmentIntelligenceRecommendations)
      .where(
        and(
          eq(equipmentIntelligenceRecommendations.id, params.recommendationId),
          eq(equipmentIntelligenceRecommendations.clinicId, params.clinicId),
        ),
      )
      .limit(1)
      .for("update");

    if (!rec) {
      throw new EquipmentIntelligenceError("RECOMMENDATION_NOT_FOUND", 404, "Recommendation not found.");
    }
    if (rec.status === "task_created" && rec.taskId) {
      return { taskId: rec.taskId, recommendationId: rec.id };
    }

    const taskType = (rec.suggestedTaskType ?? "inspection") as "maintenance" | "repair" | "inspection";
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);

    auditIntelligence(
      params.actor,
      params.clinicId,
      "equipment_intelligence_recommendation_task_approved",
      { recommendationId: rec.id, runId: rec.runId, taskType },
      rec.id,
    );

    const taskActor: TaskAuditActor = {
      userId: params.actor.authUser.id,
      email: params.actor.authUser.email,
      role: params.actor.authUser.role,
    };

    const appointment = await createAppointment(
      params.clinicId,
      {
        startTime: now.toISOString(),
        endTime: end.toISOString(),
        taskType,
        priority: rec.severity === "critical" || rec.severity === "high" ? "high" : "normal",
        notes: params.notes?.trim() || rec.recommendedAction,
        vetId: null,
        metadata: {
          source: "equipment_intelligence",
          recommendationId: rec.id,
          runId: rec.runId,
          finding: rec.finding,
          evidence: rec.evidence,
        },
      },
      taskActor,
    );

    await tx
      .update(equipmentIntelligenceRecommendations)
      .set({
        status: "task_created",
        taskId: appointment.id,
        approvedById: params.actor.authUser.id,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(equipmentIntelligenceRecommendations.id, rec.id),
          eq(equipmentIntelligenceRecommendations.clinicId, params.clinicId),
        ),
      );

    auditIntelligence(
      params.actor,
      params.clinicId,
      "equipment_intelligence_task_created",
      { recommendationId: rec.id, taskId: appointment.id, runId: rec.runId },
      appointment.id,
    );

    return { taskId: appointment.id, recommendationId: rec.id };
  });
}
