/**
 * Self-check for the flow-walk manifest. Runs in `pnpm test` (no server needed).
 *
 * Three jobs:
 *  1. Structural invariants — the manifest is internally consistent.
 *  2. Coverage — every FLOW_INVENTORY.md canonical flow is represented.
 *  3. Drift guard — the guard classification of anchor routes still matches
 *     `src/app/routes.tsx`, so the manifest cannot silently rot when routes move.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  FLOW_ROWS,
  ROLE_ARCHETYPES,
  rowsForPlatform,
  webBoardRows,
  webWalkRows,
  expectedWebOutcome,
  expectedNativeOutcome,
  type FlowRow,
} from "./flow-inventory.manifest";

const routesText = readFileSync(
  join(process.cwd(), "src", "app", "routes.tsx"),
  "utf8",
);

/** Split routes.tsx into one text segment per `<Route …>` for token inspection. */
function segmentForPath(path: string): string | null {
  const segments = routesText.split("<Route");
  const needle = `path="${path}"`;
  for (const seg of segments) {
    if (seg.includes(needle)) return seg;
  }
  return null;
}

function guardTokens(segment: string) {
  return {
    redirect: /\bRedirect(PreserveSearch)?\b/.test(segment),
    webOnly: /\bWebOnlyGuard\b/.test(segment),
    management: /\bManagementGuard\b/.test(segment),
    auth: /\bAuthGuard\b/.test(segment),
    custody: /\bCustodyGuard\b/.test(segment),
  };
}

describe("flow-walk manifest — structural invariants", () => {
  it("has unique row ids", () => {
    const ids = FLOW_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every row has at least one path and one platform", () => {
    for (const row of FLOW_ROWS) {
      expect(row.paths.length, `${row.id} paths`).toBeGreaterThan(0);
      expect(row.platforms.length, `${row.id} platforms`).toBeGreaterThan(0);
    }
  });

  it("every redirect row declares a redirectTo target", () => {
    for (const row of FLOW_ROWS.filter((r) => r.guard === "redirect")) {
      expect(row.redirectTo, `${row.id} redirectTo`).toBeTruthy();
      expect(row.redirectTo!.startsWith("/"), `${row.id} redirectTo is a path`).toBe(true);
    }
  });

  it("management rows carry management gating; custody rows carry custody gating", () => {
    for (const row of FLOW_ROWS.filter((r) => r.guard === "management")) {
      expect(row.roleGating, `${row.id}`).toBe("management");
    }
    for (const row of FLOW_ROWS.filter((r) => r.guard === "custody")) {
      expect(row.roleGating, `${row.id}`).toBe("custody");
    }
  });

  it("web-only / management / kiosk rows are not offered to native platforms", () => {
    for (const row of FLOW_ROWS.filter((r) =>
      ["web-only", "management", "kiosk"].includes(r.guard),
    )) {
      expect(row.platforms.includes("iphone"), `${row.id} on iphone`).toBe(false);
      expect(row.platforms.includes("ipad"), `${row.id} on ipad`).toBe(false);
    }
  });
});

describe("flow-walk manifest — FLOW_INVENTORY coverage", () => {
  // One representative base path per FLOW_INVENTORY.md row (all four sections).
  const CANONICAL_BASES = [
    // Marketing
    "/signin", "/signup", "/privacy",
    // Core operational
    "/home", "/equipment", "/equipment/new", "/equipment/tasks", "/scan",
    "/equipment/scan", "/equipment/maintenance", "/equipment/intelligence",
    "/alerts", "/my-equipment", "/my-profile", "/rooms", "/locations",
    "/code-blue", "/crash-cart", "/handoff", "/critical-kit-check",
    "/emergency-equipment-log", "/emergency-equipment-history",
    "/inventory", "/inventory-items", "/settings", "/help", "/whats-new",
    "/shift-chat", "/shift-handover", "/pending",
    // Web-only / large-format
    "/board", "/equipment/board", "/print", "/code-blue/display",
    "/emergency-equipment-wall", "/dashboard", "/analytics", "/procurement",
    "/audit-log",
    // Admin
    "/admin", "/admin/shifts", "/admin/code-blue-history",
    // Legacy redirects
    "/appointments", "/equipment-tasks", "/display", "/meds",
    "/pharmacy-forecast", "/patients", "/billing", "/er",
  ];

  const allPaths = FLOW_ROWS.flatMap((r) => r.paths);

  it.each(CANONICAL_BASES)("covers %s", (base) => {
    const covered = allPaths.some((p) => p === base || p.startsWith(base + "/") || p.startsWith(base + "?"));
    expect(covered, `no manifest path covers ${base}`).toBe(true);
  });

  it("covers all 31 inventory rows plus the drift block (>= 30 row groups)", () => {
    expect(FLOW_ROWS.length).toBeGreaterThanOrEqual(30);
    // The management console is a post-inventory addition; assert it is present + tagged.
    const console_ = FLOW_ROWS.find((r) => r.id === "management-console");
    expect(console_?.drift).toBe(true);
    expect(console_?.paths).toContain("/ops/health");
  });
});

describe("flow-walk manifest — drift guard vs routes.tsx", () => {
  // Anchor path → the manifest row whose guard classification it must match.
  // All anchors are exact `path="…"` literals present in routes.tsx.
  const ANCHORS: Array<{ path: string; guard: FlowRow["guard"] }> = [
    { path: "/meds", guard: "redirect" },
    { path: "/shift-handover", guard: "redirect" },
    { path: "/equipment/scan", guard: "redirect" },
    { path: "/equipment/maintenance", guard: "redirect" },
    { path: "/board", guard: "kiosk" },
    { path: "/code-blue", guard: "auth" },
    { path: "/code-blue/display", guard: "web-only" },
    { path: "/dashboard", guard: "management" },
    { path: "/analytics", guard: "management" },
    { path: "/procurement", guard: "management" },
    { path: "/audit-log", guard: "web-only" },
    { path: "/admin/integrations", guard: "management" },
    { path: "/admin", guard: "auth" },
    { path: "/admin/metrics", guard: "auth" },
  ];

  it.each(ANCHORS)("$path is still guard=$guard in routes.tsx", ({ path, guard }) => {
    const seg = segmentForPath(path);
    expect(seg, `path="${path}" not found in routes.tsx`).not.toBeNull();
    const tok = guardTokens(seg!);

    switch (guard) {
      case "redirect":
        expect(tok.redirect, `${path} should be a Redirect`).toBe(true);
        break;
      case "kiosk":
        expect(tok.auth && !tok.webOnly && !tok.redirect, `${path} should be AuthGuard-only kiosk`).toBe(true);
        break;
      case "web-only":
        expect(tok.webOnly && !tok.management, `${path} should be WebOnlyGuard w/o ManagementGuard`).toBe(true);
        break;
      case "management":
        expect(tok.webOnly && tok.management, `${path} should be WebOnlyGuard + ManagementGuard`).toBe(true);
        break;
      case "auth":
        expect(tok.auth && !tok.webOnly && !tok.redirect, `${path} should be AuthGuard-only`).toBe(true);
        break;
      default:
        throw new Error(`unhandled anchor guard ${guard}`);
    }

    // The manifest must classify the same path the same way.
    const row = FLOW_ROWS.find((r) => r.paths.includes(path));
    expect(row, `no manifest row contains ${path}`).toBeDefined();
    expect(row!.guard, `${path} manifest guard`).toBe(guard);
  });
});

describe("flow-walk manifest — outcome derivation", () => {
  const row = (id: string) => FLOW_ROWS.find((r) => r.id === id)!;

  it("desktop web is management-only (T-31): non-management roles gate on every desktop route", () => {
    // Plain auth page, management surface, custody surface — all desktop-target, so
    // the AuthGuard console gate decides the outcome regardless of the inner guard.
    for (const id of ["home", "management-dashboard", "alerts", "emergency-wall"]) {
      const r = row(id);
      expect(expectedWebOutcome(r, "admin"), `${id} admin`).toMatchObject({ kind: "render", confidence: "firm" });
      expect(expectedWebOutcome(r, "senior_technician"), `${id} lead`).toMatchObject({ kind: "render" });
      expect(expectedWebOutcome(r, "vet"), `${id} vet`).toMatchObject({ kind: "management-web-gate", confidence: "firm" });
      expect(expectedWebOutcome(r, "technician"), `${id} tech`).toMatchObject({ kind: "management-web-gate", confidence: "firm" });
      expect(expectedWebOutcome(r, "student"), `${id} student`).toMatchObject({ kind: "management-web-gate", confidence: "firm" });
    }
  });

  it("kiosk + marketing escape the desktop console gate for every role", () => {
    for (const r of ROLE_ARCHETYPES) {
      expect(expectedWebOutcome(row("board-kiosk"), r), `board ${r}`).toMatchObject({ kind: "kiosk" });
      expect(expectedWebOutcome(row("signin"), r), `signin ${r}`).toMatchObject({ kind: "render" });
    }
  });

  it("native (mobile target) is NOT desktop-gated: custody + web-only guards fire there", () => {
    // The console gate is desktop-only; on native the real per-route guards run.
    expect(expectedNativeOutcome(row("alerts"), "student")).toMatchObject({ kind: "redirect", to: "/equipment" });
    expect(expectedNativeOutcome(row("alerts"), "technician")).toMatchObject({ kind: "render" });
    expect(expectedNativeOutcome(row("emergency-wall"), "admin")).toMatchObject({ kind: "guard-redirect", to: "/home" });
  });

  it("redirect rows redirect to their declared target on every platform", () => {
    const meds = row("legacy-meds");
    for (const r of ROLE_ARCHETYPES) {
      expect(expectedWebOutcome(meds, r)).toMatchObject({ kind: "redirect", to: "/equipment/tasks" });
      expect(expectedNativeOutcome(meds, r)).toMatchObject({ kind: "redirect", to: "/equipment/tasks" });
    }
  });

  it("web/board platform partitions are non-empty and disjoint from native-only rows", () => {
    expect(rowsForPlatform("web").length).toBeGreaterThan(10);
    expect(rowsForPlatform("board").length).toBeGreaterThan(0);
    expect(rowsForPlatform("marketing").length).toBe(3);
  });

  it("web walk list: management roles see all rows; gated roles sample the gate", () => {
    const full = webBoardRows();
    // management.web roles enter the console → full set.
    expect(webWalkRows("admin").length).toBe(full.length);
    expect(webWalkRows("senior_technician").length).toBe(full.length);
    // gated roles: fewer rows, but at least one desktop (auth) sample to prove the gate.
    const techList = webWalkRows("technician");
    expect(techList.length).toBeLessThan(full.length);
    expect(techList.some((r) => r.guard === "auth")).toBe(true);
    // and they still walk the ungated marketing + kiosk rows.
    expect(techList.some((r) => r.guard === "marketing")).toBe(true);
    expect(techList.some((r) => r.guard === "kiosk")).toBe(true);
  });
});
