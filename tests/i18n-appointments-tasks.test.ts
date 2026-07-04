/**
 * Phase 6 PR 6.8 — Appointments/Tasks copy migration + _meta introduction.
 *
 * - Asserts the new `_meta.appointmentsPageTerminology` metadata key
 *   exists in BOTH locales, that parity passes, and that `t._meta` is
 *   still `undefined` at runtime (PR 6.1's runtime filter holds).
 * - Asserts the English `appointmentsPage` values render as "Tasks"
 *   terminology and Hebrew as "משימות". Internal identifiers
 *   (vt_appointments table, /appointments route, appointmentsPage.*
 *   key path) are NOT renamed (per §17 forbidden).
 * - Asserts the 20 hardcoded Hebrew literals in `appointments.tsx`
 *   are migrated to the new locale keys.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { t } from "../src/lib/i18n";

describe("Phase 6 PR 6.8 — _meta.appointmentsPageTerminology", () => {
  it("exists in en.json at top-level `_meta`", () => {
    expect((enDict as Record<string, unknown>)._meta).toBeDefined();
    const meta = (enDict as { _meta?: { appointmentsPageTerminology?: string } })._meta;
    expect(typeof meta?.appointmentsPageTerminology).toBe("string");
    expect(meta?.appointmentsPageTerminology).toMatch(/Tasks\/משימות/);
  });

  it("exists in he.json at top-level `_meta`", () => {
    expect((heDict as Record<string, unknown>)._meta).toBeDefined();
    const meta = (heDict as { _meta?: { appointmentsPageTerminology?: string } })._meta;
    expect(typeof meta?.appointmentsPageTerminology).toBe("string");
  });

  it("is NOT exposed via the runtime `t` accessor (stripInternalKeys filter)", () => {
    expect((t as Record<string, unknown>)._meta).toBeUndefined();
  });
});

describe("Phase 6 PR 6.8 — terminology: English uses Tasks, Hebrew uses משימות", () => {
  it("English appointmentsPage.tasks reads 'Tasks'", () => {
    expect(enDict.appointmentsPage.tasks).toBe("Tasks");
  });

  it("Hebrew appointmentsPage.tasks reads 'משימות'", () => {
    expect(heDict.appointmentsPage.tasks).toBe("משימות");
  });

  it("English appointmentsPage.createTask uses Task wording", () => {
    expect(enDict.appointmentsPage.createTask).toContain("task");
  });
});

describe("Phase 6 PR 6.8 — new appointmentsPage.toast.* keys resolve in both locales", () => {
  it("taskCompleted", () => {
    expect(enDict.appointmentsPage.toast.taskCompleted).toBe("Task completed");
    expect(heDict.appointmentsPage.toast.taskCompleted).toBe("משימה הושלמה");
  });

  it("medicationAcknowledged", () => {
    expect(heDict.appointmentsPage.toast.medicationAcknowledged).toBe(
      "תרופה אושרה — טכנאי קיבל הודעה",
    );
  });

  it("autoUpdated", () => {
    expect(heDict.appointmentsPage.toast.autoUpdated).toBe(
      "משימה עודכנה אוטומטית על ידי כלל אוטומציה",
    );
  });

  it("validation toasts", () => {
    expect(heDict.appointmentsPage.toast.errorPickTechnician).toBe("בחר טכנאי לפני יצירת משימה.");
    expect(heDict.appointmentsPage.toast.errorPickDevice).toBe("נדרש לבחור מכשיר / נכס.");
    expect(heDict.appointmentsPage.toast.errorValidStartEnd).toBe("הזן שעות התחלה וסיום תקינות.");
    expect(heDict.appointmentsPage.toast.errorEndAfterStart).toBe(
      "שעת הסיום חייבת להיות אחרי שעת ההתחלה.",
    );
    expect(heDict.appointmentsPage.toast.errorMedicationViaCalculator).toBe(
      "משימות תרופות חייבות להיווצר דרך מחשבון התרופות.",
    );
  });
});

describe("Phase 6 PR 6.8 — empty-state and status-hint keys resolve", () => {
  it("empty.urgent/my/suggestions Hebrew", () => {
    expect(heDict.appointmentsPage.empty.urgentTitle).toBe("אין דחוף כרגע");
    expect(heDict.appointmentsPage.empty.urgentHint).toBe("הכל במסלול תקין.");
    expect(heDict.appointmentsPage.empty.myTitle).toBe("אין משימות מוקצות");
    expect(heDict.appointmentsPage.empty.myHint).toBe("בחר משימה מהתור כשאתה מוכן.");
    expect(heDict.appointmentsPage.empty.suggestionsTitle).toBe("אין הצעות");
    expect(heDict.appointmentsPage.empty.suggestionsHint).toBe("הכל נראה תקין כרגע.");
  });

  it("statusHint Hebrew + interpolation", () => {
    expect(heDict.appointmentsPage.statusHint.startNow).toBe("המשימה הבאה מוכנה — התחל עכשיו");
    expect(heDict.appointmentsPage.statusHint.overloaded).toBe("עומס גבוה — סקור משימות דחופות");
    expect(heDict.appointmentsPage.statusHint.pickFromQueue).toBe("משימות ממתינות לטיפול");
    // The accessor `t.appointmentsPage.statusHint.overdue(count)` should
    // render English "{count} overdue — review now" or Hebrew equivalent.
    // (Locale is set per test process, asserting raw template here.)
    expect(enDict.appointmentsPage.statusHint.overdue).toBe("{count} overdue — review now");
    expect(heDict.appointmentsPage.statusHint.overdue).toBe("{count} באיחור — סקור עכשיו");
  });

  it("statusAction English + Hebrew", () => {
    expect(enDict.appointmentsPage.statusAction.viewQueue).toBe("View queue");
    expect(heDict.appointmentsPage.statusAction.viewQueue).toBe("צפה בתור");
    expect(enDict.appointmentsPage.statusAction.reviewUrgent).toBe("Review urgent");
    expect(heDict.appointmentsPage.statusAction.reviewUrgent).toBe("סקור דחופות");
  });
});

describe("Phase 6 PR 6.8 — Tasks page source is Hebrew-free", () => {
  it("contains zero Hebrew literals", () => {
    // Page file renamed appointments.tsx → Tasks.tsx (2026-07-04, sanctioned
    // client-file rename; table/route/key namespace remain frozen per §17).
    const source = readFileSync(resolve(process.cwd(), "src/pages/Tasks.tsx"), "utf-8");
    const hebrewMatches = source.match(/[֐-׿]+/g);
    expect(hebrewMatches).toBeNull();
  });
});

describe("Phase 6 PR 6.8 — internal identifiers frozen (per §17)", () => {
  it("appointmentsPage.* key namespace path NOT renamed", () => {
    expect((enDict as Record<string, unknown>).appointmentsPage).toBeDefined();
    expect((enDict as Record<string, unknown>).tasksPage).toBeUndefined();
  });

  it("server route /appointments still exists (not renamed)", () => {
    // Static check: server/routes/appointments.ts exists, server/routes/tasks.ts is a separate file.
    expect(() => readFileSync(resolve(process.cwd(), "server/routes/appointments.ts"))).not.toThrow();
  });
});
