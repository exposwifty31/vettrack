const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

export const DEFAULT_ASSET_COPILOT_MODEL = "claude-sonnet-4-20250514";

export function getAnthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key || null;
}

export function isAnthropicConfigured(): boolean {
  return getAnthropicApiKey() != null;
}

/** LLM narration runs only when explicitly enabled and a key is present. */
export function isAssetCopilotLlmEnabled(): boolean {
  if (process.env.ASSET_COPILOT_LLM_ENABLED?.trim() !== "true") return false;
  const provider = (process.env.ASSET_COPILOT_LLM_PROVIDER?.trim() || "anthropic").toLowerCase();
  if (provider !== "anthropic") return false;
  return isAnthropicConfigured();
}

export function resolveAssetCopilotModel(): string {
  return process.env.ASSET_COPILOT_LLM_MODEL?.trim() || DEFAULT_ASSET_COPILOT_MODEL;
}

type AnthropicMessageResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { type?: string; message?: string };
};

export async function createClaudeTextCompletion(params: {
  system: string;
  userMessage: string;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: params.model ?? resolveAssetCopilotModel(),
      max_tokens: params.maxTokens ?? 1024,
      system: params.system,
      messages: [{ role: "user", content: params.userMessage }],
    }),
  });

  const body = (await res.json()) as AnthropicMessageResponse;
  if (!res.ok) {
    const detail = body.error?.message ?? JSON.stringify(body).slice(0, 300);
    throw new Error(`Anthropic API ${res.status}: ${detail}`);
  }

  const text = body.content?.find((block) => block.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Anthropic API returned no text content");
  }
  return text;
}
