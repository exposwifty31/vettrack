/**
 * Unit tests for the walk's pure grading logic (classifyActual / evaluateRow).
 *
 * The load-bearing rule: for an expected-REDIRECT row, the walk grades the
 * redirect itself — did the page leave the requested path and land on the
 * declared target — NOT the surface the destination renders. A non-management
 * role redirected onto a gated desktop page correctly sees ManagementWebGate
 * there, and /equipment/board correctly lands on the /board kiosk chrome; both
 * are the redirect WORKING. (The first full walk misgraded 33 such rows broken.)
 */
import { describe, it, expect } from "vitest";
import type { ExpectedOutcome, OutcomeKind } from "./flow-inventory.manifest";
import { classifyActual, evaluateRow } from "./walk-helpers";

const surfaces = (over: Partial<Record<
  "hasCrash" | "hasWebGate" | "hasGuardScreen" | "hasDenied" | "hasKiosk",
  boolean
>> = {}) => ({
  hasCrash: false,
  hasWebGate: false,
  hasGuardScreen: false,
  hasDenied: false,
  hasKiosk: false,
  ...over,
});

const redirect = (to: string): ExpectedOutcome => ({ kind: "redirect", to, confidence: "firm" });
const render: ExpectedOutcome = { kind: "render", confidence: "firm" };

function grade(args: {
  requestedPath: string;
  finalUrl: string;
  expected: ExpectedOutcome;
  actual: OutcomeKind;
  surfaces?: ReturnType<typeof surfaces>;
  consoleErrors?: string[];
}) {
  return evaluateRow({
    surfaces: surfaces(),
    consoleErrors: [],
    ...args,
  });
}

describe("evaluateRow — redirect rows grade the redirect, not the destination surface", () => {
  it("passes when a gated role lands on the target and the destination shows ManagementWebGate", () => {
    const r = grade({
      requestedPath: "/meds",
      finalUrl: "http://x/equipment/tasks",
      expected: redirect("/equipment/tasks"),
      actual: "management-web-gate",
      surfaces: surfaces({ hasWebGate: true }),
    });
    expect(r.status).toBe("pass");
  });

  it("passes when the target is the kiosk (/equipment/board → /board renders BoardShell)", () => {
    const r = grade({
      requestedPath: "/equipment/board",
      finalUrl: "http://x/board",
      expected: redirect("/board"),
      actual: "kiosk",
      surfaces: surfaces({ hasKiosk: true }),
    });
    expect(r.status).toBe("pass");
  });

  it("passes when the target keeps its own query params (/equipment/scan → /equipment?scan=1)", () => {
    const r = grade({
      requestedPath: "/equipment/scan",
      finalUrl: "http://x/equipment?scan=1",
      expected: redirect("/equipment?scan=1"),
      actual: "redirect",
    });
    expect(r.status).toBe("pass");
  });

  it("breaks when the page never left the requested path", () => {
    const r = grade({
      requestedPath: "/meds",
      finalUrl: "http://x/meds",
      expected: redirect("/equipment/tasks"),
      actual: "render",
    });
    expect(r.status).toBe("broken");
  });

  it("breaks on a wrong redirect target", () => {
    const r = grade({
      requestedPath: "/meds",
      finalUrl: "http://x/home",
      expected: redirect("/equipment/tasks"),
      actual: "redirect",
    });
    expect(r.status).toBe("broken");
  });

  it("breaks when the redirect lands on a crashed destination", () => {
    const r = grade({
      requestedPath: "/meds",
      finalUrl: "http://x/equipment/tasks",
      expected: redirect("/equipment/tasks"),
      actual: "redirect",
      surfaces: surfaces({ hasCrash: true }),
    });
    expect(r.status).toBe("broken");
  });

  it("degrades when the destination logged console errors", () => {
    const r = grade({
      requestedPath: "/meds",
      finalUrl: "http://x/equipment/tasks",
      expected: redirect("/equipment/tasks"),
      actual: "redirect",
      consoleErrors: ["Failed to load resource: 403"],
    });
    expect(r.status).toBe("degraded");
  });
});

describe("evaluateRow — render rows", () => {
  it("passes a clean matched render", () => {
    const r = grade({
      requestedPath: "/home",
      finalUrl: "http://x/home",
      expected: render,
      actual: "render",
    });
    expect(r.status).toBe("pass");
  });

  it("breaks when a render row redirected away", () => {
    const r = grade({
      requestedPath: "/alerts",
      finalUrl: "http://x/signin",
      expected: render,
      actual: "redirect",
    });
    expect(r.status).toBe("broken");
  });

  it("degrades a rendered page with console errors; breaks one with an error boundary", () => {
    expect(
      grade({
        requestedPath: "/home",
        finalUrl: "http://x/home",
        expected: render,
        actual: "render",
        consoleErrors: ["boom"],
      }).status,
    ).toBe("degraded");
    expect(
      grade({
        requestedPath: "/home",
        finalUrl: "http://x/home",
        expected: render,
        actual: "render",
        surfaces: surfaces({ hasCrash: true }),
      }).status,
    ).toBe("broken");
  });
});

describe("classifyActual", () => {
  it("kiosk marker wins over everything", () => {
    expect(classifyActual("/board", "http://x/board", surfaces({ hasKiosk: true }))).toBe("kiosk");
  });

  it("staying on the path (with or without extra query) is render", () => {
    expect(classifyActual("/equipment", "http://x/equipment", surfaces())).toBe("render");
    expect(classifyActual("/equipment", "http://x/equipment?scan=1", surfaces())).toBe("render");
  });

  it("leaving the path with no marker surface is redirect", () => {
    expect(classifyActual("/meds", "http://x/equipment/tasks", surfaces())).toBe("redirect");
  });

  it("the T-31 console gate is reported wherever it renders", () => {
    expect(classifyActual("/home", "http://x/home", surfaces({ hasWebGate: true }))).toBe(
      "management-web-gate",
    );
  });
});
