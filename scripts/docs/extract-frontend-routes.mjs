#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const routesPath = path.join(repoRoot, "src/app/routes.tsx");

function parseLazyImports(source) {
  const map = new Map();
  const re = /const\s+(\w+)\s*=\s*lazy\s*\([\s\S]*?import\s*\(\s*["']@\/([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) map.set(m[1], m[2]);
  return map;
}

/**
 * Wrapper elements that sit between `<Route>` and the page it renders. Naming
 * one of these as the route's component is what made 59 of 90 rows wrong: the
 * old parser took the FIRST `<Word>` inside the route body, which for any
 * guarded route is the guard.
 */
const WRAPPERS = new Set([
  "AuthGuard",
  "WebOnlyGuard",
  "CustodyGuard",
  "ManagementGuard",
  "ManagementWebGate",
  "Suspense",
  "ErrorBoundary",
  "Redirect",
  "RedirectPreserveSearch",
  "Route",
  "Switch",
  "Fragment",
]);

/**
 * The page a route renders is a `lazy()` import, so the import map is the
 * authoritative signal — prefer the first element inside the body that the map
 * knows. Falls back to the first non-wrapper element (a component defined
 * inline rather than lazily), then to the first element at all, so a route is
 * never reported as componentless just because it is shaped unusually.
 */
function pickPageComponent(inner, lazyImports) {
  const candidates = [...inner.matchAll(/<(\w+)/g)].map((m) => m[1]);
  return (
    candidates.find((c) => lazyImports.has(c)) ??
    candidates.find((c) => !WRAPPERS.has(c)) ??
    candidates[0]
  );
}

/**
 * Handles BOTH `<Route ...>…</Route>` and self-closing `<Route ... />`.
 * The previous single regex required a closing tag, so every
 * `<Route path="…" component={X} />` was invisible — which silently dropped
 * /home, /privacy, /terms, /support, /account-deletion and the signin/signup
 * wildcards from the generated inventory.
 */
function parseRoutes(source, lazyImports) {
  const entries = [];
  const openRe = /<Route\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = openRe.exec(source)) !== null) {
    const attrs = m[1];
    const selfClosing = m[2] === "/";
    const pathMatch = attrs.match(/\bpath="([^"]+)"/);
    if (!pathMatch) continue; // pathless catch-all (404) — not an addressable route
    const routePath = pathMatch[1];
    const attrComponent = attrs.match(/\bcomponent=\{(\w+)\}/)?.[1];

    let inner = "";
    if (!selfClosing) {
      const close = source.indexOf("</Route>", openRe.lastIndex);
      inner = close === -1 ? "" : source.slice(openRe.lastIndex, close);
    }

    const redirectMatch = inner.match(/<Redirect(?:PreserveSearch)?\s+to="([^"]+)"/);
    if (redirectMatch) {
      entries.push({
        path: routePath,
        kind: "redirect",
        to: redirectMatch[1],
        auth: inner.includes("<AuthGuard>"),
      });
      continue;
    }
    entries.push({
      path: routePath,
      kind: "route",
      component: attrComponent ?? pickPageComponent(inner, lazyImports),
      auth: inner.includes("<AuthGuard>"),
    });
  }
  return entries;
}

/**
 * `emitted` is claim-tracking, not bookkeeping: the FIRST section whose predicate matches
 * a route owns it. Without the `!emitted.has` guard, a route matching two predicates was
 * printed in both — `/admin/code-blue-history` appeared under Emergency AND Admin, and
 * `/admin/medication-integrity` under Admin AND Legacy redirects — which reads as two
 * separate routes in an inventory whose whole job is to be a faithful count.
 */
function section(lines, title, entries, pred, imports, emitted) {
  const filtered = entries.filter((entry) => !emitted.has(entry) && pred(entry));
  if (filtered.length === 0) return;
  lines.push(`## ${title}`, "", "| Path | Component | Notes |", "|------|-----------|-------|");
  for (const e of filtered) {
    emitted.add(e);
    if (e.kind === "redirect") {
      lines.push(`| \`${e.path}\` | Redirect | → \`${e.to}\` |`);
      continue;
    }
    const mod = e.component ? (imports.get(e.component) ?? e.component) : "—";
    lines.push(`| \`${e.path}\` | \`${mod}\` | ${e.auth ? "AuthGuard" : "public"} |`);
  }
  lines.push("");
}

export function generateFrontendRoutesMarkdown() {
  const source = readFileSync(routesPath, "utf8");
  const imports = parseLazyImports(source);
  const entries = parseRoutes(source, imports);
  const emitted = new Set();
  const generatedAt = new Date().toISOString().slice(0, 10);
  const lines = [
    "# VetTrack — Frontend Route Inventory",
    "",
    "All routes from `src/app/routes.tsx`. Page components are lazy-loaded via `React.lazy()` unless noted.",
    "",
    `Generated ${generatedAt}.`,
    "",
    "---",
    "",
  ];

  const pub = ["/", "/landing", "/signin/*?", "/signup/*?"];
  const s = (title, pred) => section(lines, title, entries, pred, imports, emitted);

  s("Public", (e) => pub.includes(e.path));
  s("Home", (e) => e.path === "/home");
  s("Equipment (canonical)", (e) => e.kind === "route" && (e.path.startsWith("/equipment") || ["/alerts", "/my-equipment", "/rooms", "/rooms/:id", "/locations", "/locations/:id", "/print"].includes(e.path)));
  s("Legacy equipment redirects", (e) => (e.kind === "redirect" && e.path.startsWith("/equipment")) || ["/appointments", "/display", "/scan"].includes(e.path));
  s("Emergency & safety", (e) => e.path.includes("code-blue") || e.path.includes("crash-cart") || e.path === "/handoff" || e.path.startsWith("/emergency-") || e.path === "/critical-kit-check");
  s("Admin & settings", (e) => e.path.startsWith("/admin") || ["/settings", "/help", "/audit-log"].includes(e.path));
  s("Platform & analytics", (e) => ["/inventory", "/inventory-items", "/procurement", "/analytics", "/analytics/shift-leaderboard", "/dashboard", "/whats-new"].includes(e.path) || e.path.startsWith("/shift-chat"));
  s("Legacy redirects (removed pages)", (e) => e.kind === "redirect" && ["/meds", "/pharmacy-forecast", "/patients", "/patients/:id", "/pending", "/billing", "/billing/:rest*", "/er", "/er/:rest*", "/shift-handover", "/pending-emergencies", "/stability", "/app-tour", "/admin/medication-integrity", "/analytics/outcome-kpi"].includes(e.path));

  // Catch-all. Every section above is a hand-written predicate, so any route
  // matching none of them used to vanish from the inventory with no warning —
  // which is how the /board Command Center kiosk stayed missing from a file
  // that reads as machine-generated and therefore authoritative. Nothing is
  // dropped now: whatever no predicate claims is listed here by construction.
  s("Other", (e) => !emitted.has(e));

  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(generateFrontendRoutesMarkdown());
}
