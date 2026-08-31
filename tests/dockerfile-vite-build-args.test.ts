/**
 * A `VITE_*` variable set on the Railway service does NOT automatically reach the
 * client bundle. Railway builds this repo with the Dockerfile (`railway.json`
 * `"builder": "DOCKERFILE"`), and a Docker stage only sees a variable it declares
 * as `ARG`. Vite then inlines `import.meta.env.VITE_*` from the build environment,
 * so an undeclared variable compiles to `undefined` — silently, with no build
 * error and no runtime error.
 *
 * That is not hypothetical. `VITE_SENTRY_DSN` was set on the service on
 * 2026-08-31 and shipped in the 07:48 deploy with no `ARG`, so
 * `src/instrument.ts` saw `undefined`, its `if (import.meta.env.VITE_SENTRY_DSN)`
 * guard was false, `Sentry.init` never ran, and the web app stayed crash-blind.
 * Nothing failed. It was found by looking at a browser network log and noticing
 * that no request to the Sentry ingest host was ever made.
 *
 * `VITE_CLERK_PUBLISHABLE_KEY` is the control: it IS declared, and Clerk works in
 * production. The two sat four lines apart.
 *
 * So: every `VITE_*` the client reads must either be declared in the Dockerfile,
 * or be listed below as deliberately unset, with a reason a reader can check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DOCKERFILE = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
const DOCKERFILE_LINES = DOCKERFILE.split("\n");

/**
 * Client-read `VITE_*` variables that are deliberately NOT baked into the image.
 * Each reason states what makes `undefined` the correct value in the Railway web
 * build — not merely that nobody set it.
 */
const INTENTIONALLY_UNSET: Record<string, string> = {
  VITE_API_ORIGIN:
    "src/lib/api-origin.ts falls back to same-origin, which is correct here: the " +
    "Railway image serves the API and the bundle from one server. It is baked " +
    "separately into the Capacitor shell by scripts/build-native-shell.sh.",
  VITE_EQUIPMENT_RECOVERY_UI:
    'Feature flag compared === "true" (src/lib/equipment-recovery-ui-flag.ts); ' +
    "absent means off, which is the intended mainline default.",
  VITE_OFFLINE_PHASE9_POST_SYNC_RECONCILIATION:
    'Feature flag compared === "true" (src/lib/offline-phase9-post-sync-flag.ts); ' +
    "absent means off, which is the intended mainline default.",
  VITE_VAPID_PUBLIC_KEY:
    "src/hooks/use-push-notifications.tsx fetches the key from the server first " +
    "and only falls back to the build-time value, so the server path is primary " +
    "and an unset build-time key is not a broken subscription.",
};

/** Every `VITE_*` name the client actually reads. */
function referencedViteVars(): Set<string> {
  const found = new Set<string>();
  // The digit matters: VITE_OFFLINE_PHASE9_… would be truncated by [A-Z_]+, and a
  // guard that checks a truncated name checks nothing.
  const pattern = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      for (const m of readFileSync(full, "utf8").matchAll(pattern)) found.add(m[1]);
    }
  };
  walk(join(process.cwd(), "src"));
  return found;
}

const argLine = (name: string): number =>
  DOCKERFILE_LINES.findIndex((l) => new RegExp(`^ARG\\s+${name}(\\s|=|$)`).test(l.trim()));
const envLine = (name: string): number =>
  DOCKERFILE_LINES.findIndex((l) => new RegExp(`^ENV\\s+${name}=`).test(l.trim()));
const hasEnv = (name: string): boolean => envLine(name) !== -1;
/**
 * The line that RUNS `pnpm build` — an ARG declared after it is declared too late.
 * Anchored to `RUN` on purpose: a comment mentioning `pnpm build` is prose, and
 * matching it made this guard report the wrong line the first time it ran.
 */
const buildLine = (): number =>
  DOCKERFILE_LINES.findIndex((l) => /^RUN\b/.test(l.trim()) && /\bpnpm build\b/.test(l));

describe("Dockerfile passes every client-read VITE_* into the build", () => {
  it("declares an ARG (or documents the omission) for each VITE_* the client reads", () => {
    const missing = [...referencedViteVars()]
      .filter((name) => argLine(name) === -1 && !(name in INTENTIONALLY_UNSET))
      .sort();
    expect(missing, "VITE_* read by src/ but neither ARG-declared nor documented as unset").toEqual(
      [],
    );
  });

  it("pairs each declared ARG with an ENV, as VITE_CLERK_PUBLISHABLE_KEY does", () => {
    const unpaired = [...referencedViteVars()]
      .filter((name) => argLine(name) !== -1 && !hasEnv(name))
      .sort();
    expect(unpaired, "ARG declared without a matching ENV line").toEqual([]);
  });

  it("declares every ARG *and* its ENV before the line that runs pnpm build", () => {
    // Both halves, not just the ARG. An ENV left below the build is nonsense the
    // file should reject even though the ARG above would still feed `pnpm build`
    // on its own — the pair is this Dockerfile's convention, and a split one
    // reads as configured while only half of it is positioned to matter.
    const build = buildLine();
    expect(build, "no `RUN ... pnpm build` line found in the Dockerfile").toBeGreaterThan(-1);
    const tooLate = [...referencedViteVars()]
      .flatMap((name) => [
        argLine(name) > build ? `ARG ${name}` : null,
        envLine(name) > build ? `ENV ${name}` : null,
      ])
      .filter((entry): entry is string => entry !== null)
      .sort();
    expect(tooLate, "declared after pnpm build, so it is not positioned to reach the build").toEqual(
      [],
    );
  });

  it("keeps the intentionally-unset list from rotting", () => {
    const referenced = referencedViteVars();
    const stale = Object.keys(INTENTIONALLY_UNSET)
      .filter((name) => !referenced.has(name) || argLine(name) !== -1)
      .sort();
    expect(
      stale,
      "listed as intentionally unset but no longer read by src/, or now ARG-declared — delete the entry",
    ).toEqual([]);
  });

  it("REGRESSION: VITE_SENTRY_DSN reaches the build, so Sentry.init can run", () => {
    // The specific failure this file exists for. src/instrument.ts gates Sentry.init
    // on this value; undefined means the web app ships crash-blind and says nothing.
    expect(referencedViteVars().has("VITE_SENTRY_DSN")).toBe(true);
    expect(argLine("VITE_SENTRY_DSN"), "no `ARG VITE_SENTRY_DSN` in the Dockerfile").toBeGreaterThan(
      -1,
    );
    expect(hasEnv("VITE_SENTRY_DSN"), "no matching ENV line").toBe(true);
    expect(argLine("VITE_SENTRY_DSN")).toBeLessThan(buildLine());
    expect(envLine("VITE_SENTRY_DSN"), "ENV sits below the build").toBeLessThan(buildLine());
  });
});
