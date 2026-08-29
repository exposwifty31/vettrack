#!/usr/bin/env node
/**
 * Emits the server route manifest the RN repo's endpoint-drift guard is blocked on.
 *
 * The consumer is `src/lib/__tests__/endpoint-drift.test.ts` in
 * exposwifty31/VetTrack---RN-Migration-. Its TIER-2 suite is `describe.skip`
 * until `src/lib/__generated__/server-routes.manifest.json` exists, and the shape
 * below is that file's documented contract — do not change it here alone:
 *
 *   { "vettrackSha": "<40-char lowercase sha>", "routes": ["GET /api/equipment", ...] }
 *
 * `vettrackSha` is the revision this manifest describes. The guard refuses a
 * manifest whose sha differs from RN's own `VETTRACK_SHA` pin, so generating from
 * a revision other than that pin produces a file the guard rejects on purpose.
 *
 *   node scripts/generate-server-route-manifest.mjs [--out <path>] [--sha <sha>]
 *
 * Fail-loud by construction: an `app.use("/api/...", x)` whose `x` cannot be
 * resolved to a router file is an ERROR, not a silently missing route. A manifest
 * that quietly under-reports the surface would let the RN guard pass while the
 * paths it failed to list go unchecked — the exact "gate that disarmed itself"
 * failure this artifact exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const METHODS = ["get", "post", "put", "patch", "delete"];

const args = process.argv.slice(2);
/**
 * A flag that is present must carry a value. Returning `undefined` for a trailing
 * flag would let `??` substitute a default *silently*, and both defaults here are
 * dangerous: `--sha` would fall back to HEAD and stamp the manifest with a real,
 * plausible-looking revision the operator did not ask for, and `--out` would write
 * the default path while the intended file stays stale. The one guarantee this
 * artifact sells is that `vettrackSha` describes the routes beside it — a silent
 * substitution is precisely the thing it must not do.
 *
 * A value that itself looks like a flag is the same defect one step over
 * (`--out --sha x` would take "--sha" as the output path), so it is refused too.
 */
const argOf = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(
      `${flag} requires a value (got ${value === undefined ? "nothing" : `"${value}"`}). ` +
        `Refusing to fall back to a default: that would silently produce a manifest ` +
        `you did not ask for, which is the failure this generator exists to prevent.`,
    );
  }
  return value;
};
const OUT = argOf("--out") ?? path.join(ROOT, "server-routes.manifest.json");

function headSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim().toLowerCase();
}
const SHA = (argOf("--sha") ?? headSha()).toLowerCase();
if (!/^[0-9a-f]{40}$/.test(SHA)) {
  throw new Error(`--sha must be a 40-char lowercase sha, got: ${SHA}`);
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

/** `import x from "./y.js"` / `import { a, b as c } from "..."` -> alias -> absolute .ts path. */
function importMap(file, source) {
  const dir = path.dirname(file);
  const map = new Map();
  const re = /import\s+(?:type\s+)?(?:\{\s*([^}]+?)\s*\}|([A-Za-z_$][\w$]*))\s+from\s+"([^"]+)"/gs;
  for (const m of source.matchAll(re)) {
    const names = (m[1] ?? m[2] ?? "").split(",");
    const spec = m[3];
    if (!spec.startsWith(".")) continue;
    const resolved = path.resolve(dir, spec.replace(/\.js$/, ".ts"));
    for (const raw of names) {
      const alias = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias) map.set(alias, resolved);
    }
  }
  return map;
}

/** `router.get("/x", ...)` -> ["GET /x", ...] plus nested `router.use("/p", child)`. */
function routesOf(file, prefix, seen, problems) {
  const key = `${file}::${prefix}`;
  if (seen.has(key)) return [];
  seen.add(key);

  const source = read(file);
  if (source === null) {
    problems.push(`router file not found: ${file} (mounted at ${prefix})`);
    return [];
  }
  claimed.add(file);
  const imports = importMap(file, source);
  const out = [];

  const methodRe = new RegExp(String.raw`\brouter\.(${METHODS.join("|")})\(\s*"([^"]*)"`, "g");
  for (const m of source.matchAll(methodRe)) {
    out.push(`${m[1].toUpperCase()} ${join(prefix, m[2])}`);
  }

  for (const m of source.matchAll(/\brouter\.use\(\s*"([^"]+)"\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    const child = imports.get(m[2]);
    if (!child) continue; // a named middleware, not a mounted router
    out.push(...routesOf(child, join(prefix, m[1]), seen, problems));
  }

  // `mountXxxRoutes(router)` — a module that decorates THIS router in place, so
  // its declarations live at this same prefix. Missed by the two patterns above
  // because nothing is passed a path and nothing is passed to `app.use`.
  for (const m of source.matchAll(/\b(mount[A-Za-z0-9_$]*)\(\s*router\s*\)/g)) {
    const child = imports.get(m[1]);
    if (!child) {
      problems.push(`${path.relative(ROOT, file)} calls ${m[1]}(router) but it is not a local import — cannot follow`);
      continue;
    }
    out.push(...routesOf(child, prefix, seen, problems));
  }
  return out;
}

/** Every `server/routes/**` module that declares at least one `router.<method>("...")`. */
function routeDeclaringFiles() {
  const dir = path.join(ROOT, "server", "routes");
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !/\.(test|spec)\.ts$/.test(e.name)) {
        const src = read(full) ?? "";
        if (new RegExp(String.raw`\brouter\.(${METHODS.join("|")})\(\s*"`).test(src)) found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

const join = (prefix, sub) => {
  if (!sub || sub === "/") return prefix;
  return `${prefix.replace(/\/$/, "")}${sub.startsWith("/") ? sub : `/${sub}`}`;
};

const ENTRY_FILES = [path.join(ROOT, "server/app/routes.ts"), path.join(ROOT, "server/index.ts")];

const routes = new Set();
/** Every route module the walk actually reached — the orphan check below reads it. */
const claimed = new Set();
const problems = [];
const skippedNonRouters = [];

for (const entry of ENTRY_FILES) {
  const source = read(entry);
  if (source === null) {
    problems.push(`entry file not found: ${entry}`);
    continue;
  }
  const imports = importMap(entry, source);
  // identifier, or a factory call like createDisplayRouter()
  // `mountXxx(app, "/api/x", () => xRoutes)` — a helper that performs the app.use
  // itself (raw-body/HMAC stacks do this). Scanned BEFORE the plain form so its
  // path is claimed here rather than silently dropped.
  for (const m of source.matchAll(/\bmount[A-Za-z0-9_$]*\(\s*app\s*,\s*"(\/api[^"]*)"\s*,\s*(?:\(\s*\)\s*=>\s*)?([A-Za-z_$][\w$]*)\s*\)/g)) {
    const [, prefix, ident] = m;
    const file = imports.get(ident);
    if (!file) {
      problems.push(`helper mount at ${prefix} references ${ident}, which is not a local import — cannot follow`);
      continue;
    }
    const found = routesOf(file, prefix, new Set(), problems);
    if (found.length === 0) problems.push(`no routes extracted from ${path.relative(ROOT, file)} (helper-mounted at ${prefix})`);
    for (const r of found) routes.add(r);
    claimed.add(file);
  }

  const mountRe = /app\.use\(\s*"(\/api[^"]*)"\s*,\s*([A-Za-z_$][\w$]*)\s*(\(\s*\))?/g;
  for (const m of source.matchAll(mountRe)) {
    const [, prefix, ident] = m;
    const file = imports.get(ident);
    if (!file) {
      // Not an imported router: an inline handler, or a bare `express` reference.
      skippedNonRouters.push(`${prefix} <- ${ident} (no local import)`);
      continue;
    }
    if (!file.includes(`${path.sep}routes${path.sep}`)) {
      // middleware mounted on /api (rate limiter, i18n, tenant context, session)
      skippedNonRouters.push(`${prefix} <- ${ident} (${path.relative(ROOT, file)}: not a routes/ module)`);
      continue;
    }
    const found = routesOf(file, prefix, new Set(), problems);
    if (found.length === 0) problems.push(`no routes extracted from ${path.relative(ROOT, file)} (mounted at ${prefix})`);
    for (const r of found) routes.add(r);
  }
}

console.error(`mounts skipped as non-routers (${skippedNonRouters.length}):`);
for (const s of skippedNonRouters) console.error(`  - ${s}`);

/**
 * The invariant that makes this generator honest about its OWN blind spots.
 *
 * Express offers more registration forms than any regex set will ever cover, and a
 * form this script does not recognise produces a SHORTER manifest, not an error —
 * which is how a route silently escapes the RN guard. So instead of trusting the
 * pattern list, assert the outcome: every module under `server/routes/` that
 * declares an endpoint must have been reached by the walk.
 *
 * Found by exactly this class of miss: `mountEquipmentWaitlistRoutes(router)`
 * (server/routes/equipment.ts) and `mountRfidRoutes(app, "/api/rfid", …)`
 * (server/index.ts) are neither `app.use(prefix, router)` nor `router.use(...)`,
 * so the first version of this script dropped `/api/equipment/:id/waitlist` and
 * the whole `/api/rfid` surface without a word.
 */
const orphans = routeDeclaringFiles().filter((f) => !claimed.has(f));
for (const f of orphans) {
  problems.push(
    `${path.relative(ROOT, f)} declares routes but was never reached from an entry file — ` +
      `it is mounted by a form this generator does not recognise. Teach the walk that form; ` +
      `do NOT delete this check, it is the only thing that notices a silently missing surface.`,
  );
}

if (problems.length > 0) {
  console.error(`\nERRORS (${problems.length}):`);
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}

const manifest = { vettrackSha: SHA, routes: [...routes].sort() };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.error(`\nwrote ${OUT}: ${manifest.routes.length} routes @ ${SHA}`);
