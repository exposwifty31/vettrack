import type { CopilotAnswer } from "../../shared/contracts/asset-copilot.v1.js";
import {
  ASSET_COPILOT_RESOLVER_VERSION,
  type CopilotExplainResponse,
} from "../../shared/contracts/asset-copilot.v1.js";
import { translate } from "../../lib/i18n/index.js";
import { loadLocale, normalizeLocale } from "../../lib/i18n/loader.js";
import type { Locale } from "../../lib/i18n/types.js";
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

function formatUnknownForLocale(code: string, locale?: string): string {
  const lc: Locale = normalizeLocale(locale);
  const primary = loadLocale(lc);
  const fallback = loadLocale("en");
  const key = `equipmentTruth.unknowns.${code}`;
  const translated = translate(primary, key, undefined, { fallbackDict: fallback, locale: lc });
  if (translated !== key) return translated;
  return code.replace(/_/g, " ");
}

function copilotText(
  locale: string | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const lc: Locale = normalizeLocale(locale);
  const primary = loadLocale(lc);
  const fallback = loadLocale("en");
  return translate(primary, key, params, { fallbackDict: fallback, locale: lc });
}

export function buildTemplateNarrative(
  answer: CopilotAnswer,
  equipmentName?: string | null,
  locale?: string,
): string {
  const lines: string[] = [];
  if (equipmentName?.trim()) {
    lines.push(copilotText(locale, "assetCopilot.equipmentLine", { name: equipmentName.trim() }));
  }
  if (answer.claims.length === 0 && answer.unknowns.length > 0) {
    const gaps = answer.unknowns.map((code) => formatUnknownForLocale(code, locale)).join("; ");
    lines.push(copilotText(locale, "assetCopilot.limitedEvidenceStatus", { gaps }));
    return lines.join("\n");
  }
  for (const claim of answer.claims) {
    const freshness = claim.confidence.evidenceFreshness;
    const strength = claim.confidence.evidenceStrength;
    lines.push(`${claim.key}: ${claim.value} (strength ${strength}, ${freshness})`);
  }
  if (answer.unknowns.length > 0) {
    const gaps = answer.unknowns.map((code) => formatUnknownForLocale(code, locale)).join("; ");
    lines.push(copilotText(locale, "assetCopilot.gapsLine", { gaps }));
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

export type ExplainEquipmentCopilotParams = ResolveCopilotAnswerParams & {
  locale?: string;
};

export async function explainEquipmentCopilot(
  params: ExplainEquipmentCopilotParams,
): Promise<CopilotExplainResponse> {
  const { answer, graph } = await resolveCopilotAnswer(params);
  const equipmentName = graph.equipment?.name ?? null;
  const locale = params.locale;

  const safety = validateCopilotAnswerSafety(answer, graph);
  if (!safety.safe) {
    const safeAnswer = buildSafeUnknownAnswer(params.equipmentId);
    return {
      answer: safeAnswer,
      narrative: buildTemplateNarrative(safeAnswer, equipmentName, locale),
      llmUsed: false,
      validationFailed: true,
    };
  }

  let narrative = buildTemplateNarrative(answer, equipmentName, locale);
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
