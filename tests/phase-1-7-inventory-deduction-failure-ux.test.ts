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
const apiClient = fs.readFileSync(
  path.join(repoRoot, "src", "lib", "api.ts"),
  "utf8",
);
const medsPage = fs.readFileSync(
  path.join(repoRoot, "src", "pages", "meds.tsx"),
  "utf8",
);
const enLocale = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "locales", "en.json"), "utf8"),
);
const heLocale = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "locales", "he.json"), "utf8"),
);

describe("PR 1.7 — Inventory deduction failure UX (static checks)", () => {
  describe("Backend: non-blocking failure flag", () => {
    it("completeTask tracks inventoryEnqueueFailed flag on queue error", () => {
      expect(serviceFile).toContain("inventoryEnqueueFailed = true");
    });

    it("completeTask returns { task, inventoryEnqueueFailed } — not bare serialized", () => {
      expect(serviceFile).toContain("return { task: serialized, inventoryEnqueueFailed }");
    });

    it("inventory enqueue failure is caught and does not re-throw", () => {
      // Verify the catch block sets the flag but does not throw
      const catchBlock = serviceFile.match(/inventoryEnqueueFailed = true[\s\S]*?console\.error/);
      expect(catchBlock).not.toBeNull();
      // No re-throw in this path — task completion still returns successfully
      expect(serviceFile).not.toMatch(/inventoryEnqueueFailed = true[\s\S]{0,200}throw /);
    });

    it("existing repair/recovery pipeline is preserved (recovery scanner still present)", () => {
      const recoveryFile = fs.readFileSync(
        path.join(repoRoot, "server", "lib", "inventory-job-recovery.ts"),
        "utf8",
      );
      expect(recoveryFile).toContain("inventoryJobs");
    });
  });

  describe("Route: inventoryWarning propagation", () => {
    it("tasks route destructures inventoryEnqueueFailed from completeTask result", () => {
      expect(tasksRoute).toContain("{ task, inventoryEnqueueFailed }");
    });

    it("tasks route returns inventoryWarning in JSON response", () => {
      expect(tasksRoute).toContain("inventoryWarning: inventoryEnqueueFailed");
    });

    it("task completion success path still returns task object", () => {
      expect(tasksRoute).toContain('res.json({ task, inventoryWarning: inventoryEnqueueFailed })');
    });
  });

  describe("Frontend: warning UX", () => {
    it("api.tasks.complete returns full response (not just task)", () => {
      // Must return the full response object so inventoryWarning is accessible
      expect(apiClient).toContain("inventoryWarning?: boolean");
      // Must NOT strip to .task immediately (that would drop the warning flag).
      // Anchors on the function *definition* (`complete: (id: string`) so the URL
      // inside the function body does not cause a false positive via vetApprove.
      expect(apiClient).not.toMatch(/complete:\s*\(id:\s*string[\s\S]{0,200}\.then\(\(r\) => r\.task\)/);
    });

    it("meds.tsx completeMutation reads result and shows warning toast when inventoryWarning is true", () => {
      expect(medsPage).toContain("result.inventoryWarning");
      expect(medsPage).toContain("toast.warning");
      expect(medsPage).toContain("inventoryDeductionWarning");
    });

    it("success toast still fires on task completion (regression check)", () => {
      expect(medsPage).toContain("toast.success(t.medsPage.taskCompleted)");
    });

    it("error toast still fires on task completion failure (regression check)", () => {
      expect(medsPage).toContain("toast.error(error.message || t.medsPage.taskCompleteFailed)");
    });
  });

  describe("Locale: warning message present in both locales", () => {
    it("en.json has inventoryDeductionWarning under medsPage", () => {
      expect(enLocale.medsPage?.inventoryDeductionWarning).toBeTruthy();
    });

    it("he.json has inventoryDeductionWarning under medsPage", () => {
      expect(heLocale.medsPage?.inventoryDeductionWarning).toBeTruthy();
    });

    it("warning messages are non-empty strings", () => {
      expect(typeof enLocale.medsPage.inventoryDeductionWarning).toBe("string");
      expect(enLocale.medsPage.inventoryDeductionWarning.length).toBeGreaterThan(10);
      expect(typeof heLocale.medsPage.inventoryDeductionWarning).toBe("string");
      expect(heLocale.medsPage.inventoryDeductionWarning.length).toBeGreaterThan(10);
    });
  });
});
