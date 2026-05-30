import OpenAI from "openai";

/** Railway / OS env — never commit keys. */
export function resolveOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function resolveOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function createOpenAiClient(): OpenAI | null {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export function isOpenAiConfigured(): boolean {
  return resolveOpenAiApiKey() !== null;
}
