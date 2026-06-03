const CURSOR_API_BASE = "https://api.cursor.com";

export type CursorCreateAgentRequest = {
  prompt: { text: string };
  name?: string;
  model?: { id: string };
  repos?: Array<{
    url: string;
    startingRef?: string;
    prUrl?: string;
  }>;
  autoCreatePR?: boolean;
  workOnCurrentBranch?: boolean;
  mode?: "agent" | "plan";
};

export type CursorAgentRecord = {
  id: string;
  name: string;
  status: string;
  url: string;
  latestRunId?: string | null;
  createdAt: string;
  updatedAt: string;
  repos?: Array<{ url: string; startingRef?: string; prUrl?: string }>;
  autoCreatePR?: boolean;
};

export type CursorRunRecord = {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  result?: string;
  git?: {
    branches?: Array<{
      repoUrl: string;
      branch?: string;
      prUrl?: string;
    }>;
  };
};

export type CursorCreateAgentResponse = {
  agent: CursorAgentRecord;
  run: CursorRunRecord;
};

function getCursorApiKey(): string | null {
  const key = process.env.CURSOR_API_KEY?.trim();
  return key || null;
}

export function isCursorApiConfigured(): boolean {
  return getCursorApiKey() != null;
}

function authorizationHeader(apiKey: string): string {
  const encoded = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function cursorRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = getCursorApiKey();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not configured");
  }

  const res = await fetch(`${CURSOR_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: authorizationHeader(apiKey),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : text.slice(0, 400) || res.statusText;
    throw new Error(`Cursor API ${res.status}: ${message}`);
  }

  return parsed as T;
}

export async function cursorGetMe(): Promise<{ apiKeyName?: string; userEmail?: string }> {
  return cursorRequest("GET", "/v1/me");
}

export async function cursorCreateAgent(
  payload: CursorCreateAgentRequest,
): Promise<CursorCreateAgentResponse> {
  return cursorRequest("POST", "/v1/agents", payload);
}

export async function cursorGetAgent(agentId: string): Promise<CursorAgentRecord> {
  return cursorRequest("GET", `/v1/agents/${encodeURIComponent(agentId)}`);
}

export async function cursorGetRun(
  agentId: string,
  runId: string,
): Promise<CursorRunRecord> {
  return cursorRequest(
    "GET",
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
  );
}
