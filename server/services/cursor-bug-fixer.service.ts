import type {
  CursorBugFixerAgentSummary,
  CursorBugFixerBugReport,
  CursorBugFixerConfigResponse,
  CursorBugFixerDispatchResponse,
  CursorBugFixerRunSummary,
} from "../../shared/contracts/cursor-bug-fixer.v1.js";
import {
  cursorCreateAgent,
  cursorGetAgent,
  cursorGetRun,
  isCursorApiConfigured,
} from "../lib/cursor-cloud-agents-client.js";

export class CursorBugFixerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "DISABLED"
      | "NOT_CONFIGURED"
      | "MISSING_REPO"
      | "INVALID_REPORT"
      | "CURSOR_API_ERROR",
  ) {
    super(message);
    this.name = "CursorBugFixerError";
  }
}

export function isCursorBugFixerEnabled(): boolean {
  return process.env.ENABLE_CURSOR_BUG_FIXER?.trim() === "true";
}

export function getCursorBugFixerConfig(): CursorBugFixerConfigResponse {
  const repoUrl = process.env.CURSOR_BUG_FIXER_REPO_URL?.trim() ?? "";
  return {
    enabled: isCursorBugFixerEnabled(),
    apiKeyConfigured: isCursorApiConfigured(),
    repoUrlConfigured: repoUrl.length > 0,
    defaultRef: process.env.CURSOR_BUG_FIXER_DEFAULT_REF?.trim() || "main",
    autoCreatePr: process.env.CURSOR_BUG_FIXER_AUTO_CREATE_PR?.trim() !== "false",
  };
}

function assertBugFixerReady(): CursorBugFixerConfigResponse {
  const config = getCursorBugFixerConfig();
  if (!config.enabled) {
    throw new CursorBugFixerError("Cursor bug fixer is disabled", "DISABLED");
  }
  if (!config.apiKeyConfigured) {
    throw new CursorBugFixerError("CURSOR_API_KEY is not set", "NOT_CONFIGURED");
  }
  if (!config.repoUrlConfigured) {
    throw new CursorBugFixerError(
      "CURSOR_BUG_FIXER_REPO_URL is not set (GitHub URL required for Cloud Agents)",
      "MISSING_REPO",
    );
  }
  return config;
}

export function buildBugFixerPrompt(report: CursorBugFixerBugReport): string {
  const lines: string[] = [
    "You are an intelligent bug-fixing agent working on VetTrack — a veterinary hospital operations platform (React + Express + PostgreSQL).",
    "",
    "## Reported issue",
    `Title: ${report.title.trim()}`,
    `Description:`,
    report.description.trim(),
  ];

  if (report.severity) lines.push(`Severity: ${report.severity}`);
  if (report.pageUrl?.trim()) lines.push(`Page URL: ${report.pageUrl.trim()}`);
  if (report.appVersion?.trim()) lines.push(`App version: ${report.appVersion.trim()}`);
  if (report.deviceInfo?.trim()) lines.push(`Device: ${report.deviceInfo.trim()}`);
  if (report.supportTicketId) lines.push(`Support ticket id: ${report.supportTicketId}`);
  if (report.source) lines.push(`Source: ${report.source}`);
  if (report.context?.trim()) {
    lines.push("", "## Additional context", report.context.trim());
  }

  lines.push(
    "",
    "## Instructions",
    "1. Locate the relevant code paths and reproduce the issue from the report when feasible.",
    "2. Implement a minimal, focused fix — match existing conventions in the touched files.",
    "3. Run `npx tsc --noEmit` and targeted tests for files you change.",
    "4. Do NOT weaken: clinicId multi-tenancy, Phase 9 realtime/Code Blue/PWA frozen surfaces, or offline emergency mutation blocks.",
    "5. Summarize root cause and fix in your final reply.",
  );

  return lines.join("\n");
}

function mapAgent(agent: {
  id: string;
  name: string;
  status: string;
  url: string;
  latestRunId?: string | null;
  createdAt: string;
  updatedAt: string;
}): CursorBugFixerAgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    url: agent.url,
    latestRunId: agent.latestRunId ?? null,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function mapRun(run: {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  result?: string;
  git?: CursorBugFixerRunSummary["git"];
}): CursorBugFixerRunSummary {
  return {
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    durationMs: run.durationMs,
    result: run.result,
    git: run.git,
  };
}

export async function dispatchCursorBugFixer(
  report: CursorBugFixerBugReport,
): Promise<CursorBugFixerDispatchResponse> {
  const config = assertBugFixerReady();

  const title = report.title?.trim();
  const description = report.description?.trim();
  if (!title || !description) {
    throw new CursorBugFixerError("title and description are required", "INVALID_REPORT");
  }

  const repoUrl = process.env.CURSOR_BUG_FIXER_REPO_URL!.trim();
  const promptText = buildBugFixerPrompt({ ...report, title, description });
  const agentName = `Bug fix: ${title.slice(0, 80)}`;

  const modelId = process.env.CURSOR_BUG_FIXER_MODEL?.trim();
  const payload = {
    prompt: { text: promptText },
    name: agentName,
    repos: [{ url: repoUrl, startingRef: config.defaultRef }],
    autoCreatePR: config.autoCreatePr,
    mode: "agent" as const,
    ...(modelId ? { model: { id: modelId } } : {}),
  };

  try {
    const { agent, run } = await cursorCreateAgent(payload);
    return {
      agentId: agent.id,
      runId: run.id,
      agentUrl: agent.url,
      status: run.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CursorBugFixerError(message, "CURSOR_API_ERROR");
  }
}

export async function getCursorBugFixerAgent(
  agentId: string,
): Promise<CursorBugFixerAgentSummary> {
  assertBugFixerReady();
  const agent = await cursorGetAgent(agentId);
  return mapAgent(agent);
}

export async function getCursorBugFixerRun(
  agentId: string,
  runId: string,
): Promise<CursorBugFixerRunSummary> {
  assertBugFixerReady();
  const run = await cursorGetRun(agentId, runId);
  return mapRun(run);
}
