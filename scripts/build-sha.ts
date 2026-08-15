/**
 * Resolution of the commit SHA a production build was produced from.
 *
 * Consumed by vite.config.ts's `deployBuildInfo` plugin, which writes it into
 * dist/public/build-info.json — the file GET /api/version reports as `gitCommit`
 * and scripts/verify-prod-deploy.ts gates on.
 *
 * WHY THERE IS NO `git rev-parse` FALLBACK HERE
 * ---------------------------------------------
 * This module runs INSIDE the Docker build (`RUN pnpm build`), where every
 * obvious source of the SHA is structurally unreachable:
 *
 *   - `.git` is absent twice over. `railway up` "ignores .git and node_modules
 *     directories" unconditionally (docs.railway.com/cli/up), which `--no-gitignore`
 *     does not override, and `.dockerignore` lists `.git/` again.
 *   - GITHUB_SHA exists on the Actions runner but dies at the Docker boundary:
 *     the Dockerfile declares ARGs only for VITE_CLERK_PUBLISHABLE_KEY,
 *     ALLOW_EQUIPMENT_PILOT_MODE and VITE_PILOT_MODE.
 *   - RAILWAY_GIT_COMMIT_SHA is populated only "if the deploy originated from a
 *     GitHub trigger" (docs.railway.com/variables/reference). VetTrack deploys
 *     with `railway up --ci`, a CLI upload from a disconnected repo source, so it
 *     is absent at build time AND at runtime.
 *
 * That is why every build-info.json this pipeline produced carried
 * `gitCommit: null`. A git fallback would work on a developer laptop and quietly
 * keep returning null in the build that matters — a false green.
 *
 * The one channel that survives is the upload tarball itself. The SHA is resolved
 * on the HOST by scripts/write-build-sha.sh (which has both GITHUB_SHA and a real
 * .git) and written to BUILD_SHA_FILENAME in the repo root, so it travels in the
 * same tarball as the code it describes — atomic by construction, unlike a
 * Railway service variable set by a separate API call.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Producer (scripts/write-build-sha.sh) and consumer (this module) must agree on
 * this literal; a drift silently reinstates `gitCommit: null`. The name must also
 * stay unmatched by .gitignore, .railwayignore and .dockerignore — `railway up`
 * filters by .gitignore, so an ignored file would never reach the build.
 * tests/deploy-build-sha.test.ts pins both properties.
 */
export const BUILD_SHA_FILENAME = "vt-build-sha.txt";

export interface ResolveBuildShaOptions {
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Directory holding the deploy-context SHA file. Defaults to process.cwd(). */
  rootDir?: string;
}

/** Env vars first (kept so a future GitHub-triggered deploy still works), then the context file. */
export function resolveBuildSha(options: ResolveBuildShaOptions = {}): string | null {
  const env = options.env ?? process.env;
  const rootDir = options.rootDir ?? process.cwd();

  // `||`, not `??`: an empty-string env var must fall through. `"" ?? next` keeps
  // the empty string and reproduces the exact `gitCommit=` symptom from a
  // different cause.
  const fromEnv =
    env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    env.GITHUB_SHA?.trim() ||
    env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    "";
  if (fromEnv) return fromEnv;

  const file = path.resolve(rootDir, BUILD_SHA_FILENAME);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}
