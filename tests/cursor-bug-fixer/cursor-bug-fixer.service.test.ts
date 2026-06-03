import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildBugFixerPrompt,
  getCursorBugFixerConfig,
  dispatchCursorBugFixer,
  CursorBugFixerError,
} from "../../server/services/cursor-bug-fixer.service.js";

vi.mock("../../server/lib/cursor-cloud-agents-client.js", () => ({
  cursorCreateAgent: vi.fn(),
  isCursorApiConfigured: vi.fn(() => true),
}));

import { cursorCreateAgent } from "../../server/lib/cursor-cloud-agents-client.js";

const mockedCreate = vi.mocked(cursorCreateAgent);

describe("cursor-bug-fixer service", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "ENABLE_CURSOR_BUG_FIXER",
      "CURSOR_API_KEY",
      "CURSOR_BUG_FIXER_REPO_URL",
      "CURSOR_BUG_FIXER_DEFAULT_REF",
      "CURSOR_BUG_FIXER_AUTO_CREATE_PR",
    ]) {
      envBackup[key] = process.env[key];
    }
    process.env.ENABLE_CURSOR_BUG_FIXER = "true";
    process.env.CURSOR_API_KEY = "cursor_test_key";
    process.env.CURSOR_BUG_FIXER_REPO_URL = "https://github.com/example/vettrack";
    process.env.CURSOR_BUG_FIXER_DEFAULT_REF = "main";
    mockedCreate.mockReset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("getCursorBugFixerConfig reflects env", () => {
    const config = getCursorBugFixerConfig();
    expect(config.enabled).toBe(true);
    expect(config.apiKeyConfigured).toBe(true);
    expect(config.repoUrlConfigured).toBe(true);
    expect(config.defaultRef).toBe("main");
  });

  it("buildBugFixerPrompt includes report fields and guardrails", () => {
    const prompt = buildBugFixerPrompt({
      title: "Scan fails offline",
      description: "Equipment scan returns 500 when offline.",
      severity: "high",
      pageUrl: "/equipment",
    });
    expect(prompt).toContain("Scan fails offline");
    expect(prompt).toContain("clinicId multi-tenancy");
  });

  it("dispatchCursorBugFixer calls Cursor API", async () => {
    mockedCreate.mockResolvedValue({
      agent: {
        id: "bc-test",
        name: "Bug fix",
        status: "ACTIVE",
        url: "https://cursor.com/agents/bc-test",
        latestRunId: "run-test",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
      run: {
        id: "run-test",
        agentId: "bc-test",
        status: "CREATING",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
    });

    const result = await dispatchCursorBugFixer({
      title: "Bug",
      description: "Details",
      source: "manual",
    });

    expect(result.agentId).toBe("bc-test");
    expect(result.runId).toBe("run-test");
    expect(mockedCreate).toHaveBeenCalledOnce();
    const payload = mockedCreate.mock.calls[0]![0];
    expect(payload.repos?.[0]?.url).toBe("https://github.com/example/vettrack");
    expect(payload.prompt.text).toContain("Details");
  });

  it("throws when disabled", async () => {
    process.env.ENABLE_CURSOR_BUG_FIXER = "false";
    await expect(
      dispatchCursorBugFixer({ title: "x", description: "y" }),
    ).rejects.toBeInstanceOf(CursorBugFixerError);
  });
});
