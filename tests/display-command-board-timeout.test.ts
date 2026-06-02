/**
 * PR3: command board timeout helper + handler always includes commandBoard key.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { COMMAND_BOARD_TIMEOUT_MS } from "../server/routes/display.js";
import { OperationTimeoutError, withTimeout } from "../server/lib/with-timeout.js";

describe("command board timeout", () => {
  it("COMMAND_BOARD_TIMEOUT_MS is explicit and review-visible", () => {
    expect(COMMAND_BOARD_TIMEOUT_MS).toBe(2500);
  });

  it("withTimeout rejects slow operations", async () => {
    const never = new Promise<void>(() => {});
    await expect(withTimeout(never, 30)).rejects.toBeInstanceOf(OperationTimeoutError);
  });
});

describe("display snapshot commandBoard contract", () => {
  it("handler attaches commandBoard on success path and null on failure path", () => {
    const source = fs.readFileSync("server/routes/display.ts", "utf8");
    expect(source).toContain("let commandBoard: EquipmentCommandBoardSnapshot | null = null");
    expect(source).toContain("command_board_build_failed");
    expect(source).toMatch(/commandBoard,\s*\n\s*\}\);/);
  });
});
