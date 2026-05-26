import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sheetPath = path.join(__dirname, "..", "src", "components", "sync-queue-sheet.tsx");
const hookPath = path.join(__dirname, "..", "src", "hooks", "use-sync.tsx");
const sheetSource = fs.readFileSync(sheetPath, "utf8");
const hookSource = fs.readFileSync(hookPath, "utf8");

describe("Sync queue sheet — Phase 6", () => {
  it("uses i18n section headers for dead letter and pending", () => {
    expect(sheetSource).toContain("t.syncQueueSheet.deadLetterSection");
    expect(sheetSource).toContain("t.syncQueueSheet.pendingSection");
    expect(sheetSource).toContain("t.syncQueueSheet.failedSection");
  });

  it("uses i18n discard confirmation copy", () => {
    expect(sheetSource).toContain("t.syncQueueSheet.discardConfirmTitle");
    expect(sheetSource).toContain("t.syncQueueSheet.discardConfirmBody");
    expect(sheetSource).not.toContain("Remove this action from queue?");
  });

  it("uses distinct status labels for dead vs conflict", () => {
    expect(sheetSource).toContain("t.syncQueueSheet.statusDead");
    expect(sheetSource).toContain("t.syncQueueSheet.statusConflict");
  });

  it("requires discard confirmation for dead and conflict rows", () => {
    expect(sheetSource).toContain('item.status === "dead"');
    expect(sheetSource).toContain('item.status === "conflict"');
    expect(sheetSource).toContain("requireDiscardConfirm");
  });

  it("delegates retry to hook (conflict cleared in use-sync)", () => {
    expect(sheetSource).toContain("onRetry={() => retry(item.id!)}");
    expect(hookSource).toContain("await removeConflict(id)");
    expect(hookSource).toContain('status: "pending"');
    expect(hookSource).toContain("conflictPayload: null");
  });

  it("delegates discard to hook with removeConflict", () => {
    expect(hookSource).toContain("await removeConflict(id)");
    expect(hookSource).toMatch(/discard[\s\S]*removePendingSync/);
  });
});
