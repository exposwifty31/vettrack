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

function parseRoutes(source) {
  const entries = [];
  const routeRe = /<Route\s+path="([^"]+)"(?:\s+component=\{(\w+)\})?[^>]*>([\s\S]*?)<\/Route>/g;
  let m;
  while ((m = routeRe.exec(source)) !== null) {
    const routePath = m[1];
    const component = m[2];
    const inner = m[3] ?? "";
    const redirectMatch = inner.match(/<Redirect(?:PreserveSearch)?\s+to="([^"]+)"/);
    if (redirectMatch) {
      entries.push({ path: routePath, kind: "redirect", to: redirectMatch[1], auth: inner.includes("<AuthGuard>") });
      continue;
    }
    const componentMatch = inner.match(/<(\w+)\s*\/?>/);
    entries.push({ path: routePath, kind: "route", component: component ?? componentMatch?.[1], auth: inner.includes("<AuthGuard>") });
  }
  return entries;
}

function section(lines, title, entries, pred) {
  const filtered = entries.filter(pred);
  if (filtered.length === 0) return;
  lines.push(`## ${title}`, "", "| Path | Component | Notes |", "|------|-----------|-------|");
  for (const e of filtered) {
    if (e.kind === "redirect") {
      lines.push(`| \`${e.path}\` | Redirect | → \`${e.to}\` |`);
      continue;
    }
    const mod = e.component ? imports.get(e.component) ?? e.component : "—";
    lines.push(`| \`${e.path}\` | \`${mod}\` | ${e.auth ? "AuthGuard" : "public"} |`);
  }
  lines.push("");
}

export function generateFrontendRoutesMarkdown() {
  const source = readFileSync(routesPath, "utf8");
  globalThis.imports = parseLazyImports(source);
  const imports = parseLazyImports(source);
  const entries = parseRoutes(source);
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
  section(lines, "Public", entries, (e) => pub.includes(e.path));
  section(lines, "Home", entries, (e) => e.path === "/home");
  section(lines, "Equipment (canonical)", entries, (e) => e.kind === "route" && (e.path.startsWith("/equipment") || ["/alerts", "/my-equipment", "/rooms", "/rooms/:id", "/locations", "/locations/:id", "/print"].includes(e.path)));
  section(lines, "Legacy equipment redirects", entries, (e) => e.kind === "redirect" && e.path.startsWith("/equipment") || ["/appointments", "/display", "/scan"].includes(e.path));
  section(lines, "Emergency & safety", entries, (e) => e.path.includes("code-blue") || e.path.includes("crash-cart") || e.path === "/handoff" || e.path.startsWith("/emergency-") || e.path === "/critical-kit-check");
  section(lines, "Admin & settings", entries, (e) => e.path.startsWith("/admin") || ["/settings", "/help", "/audit-log"].includes(e.path));
  section(lines, "Platform & analytics", entries, (e) => ["/inventory", "/inventory-items", "/procurement", "/analytics", "/analytics/shift-leaderboard", "/dashboard", "/whats-new"].includes(e.path) || e.path.startsWith("/shift-chat"));
  section(lines, "Legacy redirects (removed pages)", entries, (e) => e.kind === "redirect" && ["/meds", "/pharmacy-forecast", "/patients", "/patients/:id", "/pending", "/billing", "/billing/:rest*", "/er", "/er/:rest*", "/shift-handover", "/pending-emergencies", "/stability", "/app-tour", "/admin/medication-integrity", "/analytics/outcome-kpi"].includes(e.path));

  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(generateFrontendRoutesMarkdown());
}
