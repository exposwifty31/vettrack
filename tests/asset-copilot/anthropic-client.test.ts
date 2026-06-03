import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAnthropicApiKey,
  isAnthropicConfigured,
  isAssetCopilotLlmEnabled,
} from "../../server/lib/anthropic-client.js";

describe("anthropic-client env", () => {
  const prior: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "ANTHROPIC_API_KEY",
      "ASSET_COPILOT_LLM_ENABLED",
      "ASSET_COPILOT_LLM_PROVIDER",
    ]) {
      prior[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("isAnthropicConfigured is false without a key", () => {
    expect(isAnthropicConfigured()).toBe(false);
    expect(getAnthropicApiKey()).toBeNull();
  });

  it("isAssetCopilotLlmEnabled requires flag and key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(isAssetCopilotLlmEnabled()).toBe(false);

    process.env.ASSET_COPILOT_LLM_ENABLED = "true";
    expect(isAssetCopilotLlmEnabled()).toBe(true);
  });

  it("isAssetCopilotLlmEnabled rejects non-anthropic provider", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ASSET_COPILOT_LLM_ENABLED = "true";
    process.env.ASSET_COPILOT_LLM_PROVIDER = "openai";
    expect(isAssetCopilotLlmEnabled()).toBe(false);
  });
});
