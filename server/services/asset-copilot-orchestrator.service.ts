import type { CopilotAnswer } from "../../shared/contracts/asset-copilot.v1.js";
import {
  ASSET_COPILOT_RESOLVER_VERSION,
  type CopilotExplainResponse,
} from "../../shared/contracts/asset-copilot.v1.js";
import { validateCopilotAnswerSafety } from "../domain/equipment/copilot/ai-safety-validator.js";
import type { EvidenceGraph } from "../domain/equipment/evidence/graph.types.js";
import {
  createClaudeTextCompletion,
  isAssetCopilotLlmEnabled,
} from "../lib/anthropic-client.js";
import {
  resolveCopilotAnswer,
  type ResolveCopilotAnswerParams,
} from "./asset-copilot-resolve.service.js";

const COPILOT_SYSTEM_PROMPT = `You are VetTrack Asset Copilot — an evidence-only assistant for hospital equipment.
Rules:
- Narrate ONLY the structured claims provided. Do not invent locations, people, or readiness.
- If unknowns are listed, state clearly what is not known.
- Never suggest checkout, return, scan, or any state change.
- Keep the response concise (under 12 sentences). Plain language for clinical staff.`;

function buildSafeUnknownAnswer(equipmentId: string): CopilotAnswer {
  return {
    resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
    equipmentId,
    claims: [],
    unknowns: ["insufficient_validated_evidence"],
    citations: [],
  };
}

export function buildTemplateNarrative(
  answer: CopilotAnswer,
  equipmentName?: string | null,
): string {
  const lines: string[] = [];
  if (equipmentName?.trim()) {
    lines.push(`Equipment: ${equipmentName.trim()}`);
  }
  if (answer.claims.length === 0 && answer.unknowns.length > 0) {
    lines.push(`Status: limited evidence (${answer.unknowns.join(", ")}).`);
    return lines.join("\n");
  }
  for (const claim of answer.claims) {
    const freshness = claim.confidence.evidenceFreshness;
    const strength = claim.confidence.evidenceStrength;
    lines.push(`${claim.key}: ${claim.value} (strength ${strength}, ${freshness})`);
  }
  if (answer.unknowns.length > 0) {
    lines.push(`Gaps: ${answer.unknowns.join(", ")}`);
  }
  return lines.join("\n");
}

function buildLlmUserPayload(answer: CopilotAnswer, equipmentName?: string | null): string {
  return JSON.stringify(
    {
      equipmentName: equipmentName ?? null,
      claims: answer.claims.map((c) => ({
        key: c.key,
        value: c.value,
        strength: c.confidence.evidenceStrength,
        freshness: c.confidence.evidenceFreshness,
        citationCount: c.citations.length,
      })),
      unknowns: answer.unknowns,
    },
    null,
    2,
  );
}

async function narrateWithClaude(
  answer: CopilotAnswer,
  equipmentName?: string | null,
): Promise<string> {
  return createClaudeTextCompletion({
    system: COPILOT_SYSTEM_PROMPT,
    userMessage: `Summarize this equipment evidence for staff:\n${buildLlmUserPayload(answer, equipmentName)}`,
    maxTokens: 768,
  });
}

export type ExplainEquipmentCopilotParams = ResolveCopilotAnswerParams;

export async function explainEquipmentCopilot(
  params: ExplainEquipmentCopilotParams,
): Promise<CopilotExplainResponse> {
  const { answer, graph } = await resolveCopilotAnswer(params);
  const equipmentName = graph.equipment?.name ?? null;

  const safety = validateCopilotAnswerSafety(answer, graph);
  if (!safety.safe) {
    const safeAnswer = buildSafeUnknownAnswer(params.equipmentId);
    return {
      answer: safeAnswer,
      narrative: buildTemplateNarrative(safeAnswer, equipmentName),
      llmUsed: false,
      validationFailed: true,
    };
  }

  let narrative = buildTemplateNarrative(answer, equipmentName);
  let llmUsed = false;

  if (isAssetCopilotLlmEnabled()) {
    try {
      narrative = await narrateWithClaude(answer, equipmentName);
      llmUsed = true;
    } catch (err) {
      console.error("[asset-copilot] Claude narration failed; using template narrative", err);
    }
  }

  return {
    answer,
    narrative,
    llmUsed,
    validationFailed: false,
  };
}
