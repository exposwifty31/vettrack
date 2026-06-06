import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const serviceFile = fs.readFileSync(
  path.join(repoRoot, "server", "services", "appointments.service.ts"),
  "utf8",
);
const tasksRoute = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "tasks.ts"),
  "utf8",
);
const apiClient = fs.readFileSync(path.join(repoRoot, "src", "lib", "api.ts"), "utf8");
const appointmentsPage = fs.readFileSync(
  path.join(repoRoot, "src", "pages", "appointments.tsx"),
  "utf8",
);
const recoveryFile = fs.readFileSync(
  path.join(repoRoot, "server", "lib", "inventory-job-recovery.ts"),
  "utf8",
);

describe("PR 1.7 — inventory deduction failure UX (billing inventory removed)", () => {
  it("completeTask no longer tracks inventoryEnqueueFailed", () => {
    expect(serviceFile).not.toContain("inventoryEnqueueFailed");
  });

  it("tasks complete route returns task only", () => {
    expect(tasksRoute).toContain("return res.json({ task })");
    expect(tasksRoute).not.toContain("inventoryWarning");
  });

  it("api.tasks.complete returns task only", () => {
    expect(apiClient).toMatch(/complete:\s*\(id:\s*string[\s\S]{0,200}\.then\(\(r\) => r\.task\)/);
    expect(apiClient).not.toContain("inventoryWarning");
  });

  it("appointments page shows success toast without inventory warning branch", () => {
    expect(appointmentsPage).toContain("toast.success(t.appointmentsPage.toast.taskCompleted)");
    expect(appointmentsPage).not.toContain("inventoryWarning");
    expect(appointmentsPage).not.toContain("inventoryDeductionWarning");
  });

  it("inventory recovery helper is a no-op stub", () => {
    expect(recoveryFile).toContain("no-op");
    expect(recoveryFile).not.toContain("inventoryJobs");
  });
});
