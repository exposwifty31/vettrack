import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_ROOT = path.resolve(__dirname, "..", "src");
const SOURCE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

// Strings that must never appear as raw UI literals in src/ files.
// Add a new entry whenever a hardcoded string is removed from a component.
const FORBIDDEN_LITERALS = [
  // Previously hardcoded English UI labels now covered by t.adminPage.*
  "Signed up ",
  "Joined ",
  "Deleted Equipment",
  "No deleted equipment.",
  "No deleted users.",
  "User deleted",
  "Failed to delete user",
  // Previously hardcoded helper text on new-equipment.tsx (issue #268) — now t.newEquipment.fields.maintenanceIntervalDays.description
  "Set to auto-alert when maintenance is overdue.",
  // Previously hardcoded Hebrew UI text now covered by t.adminPage.* / t.common.*
  // Note: only add tokens that are specific enough to not false-positive on Hebrew word roots
  "מחק",            // delete button (t.adminPage.deleteUser / t.common.delete)
  "שחזר",           // restore button (t.adminPage.restore / t.adminPage.restoreUser)
  "ביטול",          // cancel button — use t.adminPage.cancel or t.common.cancel
  "מחיקת",          // "deletion of" prefix in dialog title
  "המשתמש יסומן",  // "user will be marked" in dialog body
];

// Paths to exclude from scanning (i18n system files are the only allowed home for translation strings)
const EXCLUDED_DIRS = new Set(["__tests__", "lib"]);
// Specific files allowed to contain these strings (i18n infrastructure only)
const EXCLUDED_FILES = new Set([
  "i18n.ts",
  "i18n.tsx",
]);

function walk(dirPath, failures) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(fullPath, failures);
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    const relPath = path.relative(path.resolve(__dirname, ".."), fullPath);

    for (const token of FORBIDDEN_LITERALS) {
      if (content.includes(token)) {
        failures.push(
          `Forbidden UI literal "${token}" found in ${relPath}`
        );
      }
    }
  }
}

describe("UI hardcoded string guard", () => {
  it("no forbidden literals in src files", () => {
    const failures = [];
    walk(SRC_ROOT, failures);
    expect(failures, failures.join("\n")).toHaveLength(0);
  });
});
