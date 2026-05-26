import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sheetPath = path.join(__dirname, "..", "src", "components", "sync-queue-sheet.tsx");
const sheetSource = fs.readFileSync(sheetPath, "utf8");

describe("Sync queue sheet conflict state", () => {
  it("clears conflict metadata before retrying an item", () => {
    const retryHandlerStart = sheetSource.indexOf("onRetry={async () => {");
    const retryHandlerEnd = sheetSource.indexOf("onDiscard={async () => {", retryHandlerStart);

    expect(retryHandlerStart).toBeGreaterThan(-1);
    expect(retryHandlerEnd).toBeGreaterThan(retryHandlerStart);

    const retryHandler = sheetSource.slice(retryHandlerStart, retryHandlerEnd);
    expect(retryHandler).toContain("await removeConflict(item.id)");
    expect(retryHandler).toContain("return retry(item.id!)");
  });
});
