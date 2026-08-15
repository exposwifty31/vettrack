/**
 * Provenance of the deployed commit — the producer half.
 *
 * Every build-info.json this pipeline has ever produced carries
 * `gitCommit: null`, which made scripts/verify-prod-deploy.ts poll a
 * structurally unreachable predicate for 600s. The cause is the build
 * environment, not a missing env var:
 *
 *   - `railway up --ci` uploads a tarball and ignores `.git` unconditionally
 *     (docs.railway.com/cli/up, "File handling"); `.dockerignore` strips `.git/`
 *     again. So a `git rev-parse` fallback inside the build has nothing to read.
 *   - The Dockerfile declares ARGs only for VITE_CLERK_PUBLISHABLE_KEY /
 *     ALLOW_EQUIPMENT_PILOT_MODE / VITE_PILOT_MODE, so GITHUB_SHA dies at the
 *     Docker boundary even though the Actions runner has it.
 *   - RAILWAY_GIT_COMMIT_SHA is only populated "if the deploy originated from a
 *     GitHub trigger" (docs.railway.com/variables/reference). VetTrack deploys
 *     via `railway up --ci`, a CLI upload — so it is absent at build AND runtime.
 *
 * The only channel that survives is the upload tarball itself. The SHA is
 * therefore resolved on the HOST (which has both GITHUB_SHA and a real .git) and
 * written into the deploy context as a file, which rides in the same tarball as
 * the code it describes. These tests pin that contract end to end.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BUILD_SHA_FILENAME, resolveBuildSha } from "../scripts/build-sha.js";
import { deployBuildInfo } from "../vite.config.js";

const REPO_ROOT = process.cwd();
const WRITE_SCRIPT = resolve(REPO_ROOT, "scripts/write-build-sha.sh");

const SHA_ENV_KEYS = [
  "RAILWAY_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
];

/** A throwaway directory that is NOT inside any git repo. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "vt-build-sha-"));
}

/** process.env minus the SHA vars (CI sets GITHUB_SHA for real), plus overrides. */
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !SHA_ENV_KEYS.includes(k)) out[k] = v;
  }
  return { ...out, ...extra };
}

function runWriteScript(
  dir: string,
  env: Record<string, string>,
): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [WRITE_SCRIPT, dir], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("resolveBuildSha — env first, deploy-context file as the fallback that survives Docker", () => {
  it("prefers RAILWAY_GIT_COMMIT_SHA", () => {
    expect(
      resolveBuildSha({ env: { RAILWAY_GIT_COMMIT_SHA: "aaaa1111", GITHUB_SHA: "bbbb2222" } }),
    ).toBe("aaaa1111");
  });

  it("falls back to GITHUB_SHA, then VERCEL_GIT_COMMIT_SHA", () => {
    expect(resolveBuildSha({ env: { GITHUB_SHA: "bbbb2222" } })).toBe("bbbb2222");
    expect(resolveBuildSha({ env: { VERCEL_GIT_COMMIT_SHA: "cccc3333" } })).toBe("cccc3333");
  });

  it("treats an empty-string env var as absent instead of resolving to \"\"", () => {
    // `null ?? x` falls through but `"" ?? x` does not — an empty RAILWAY_GIT_COMMIT_SHA
    // would otherwise reproduce the identical `gitCommit=` symptom from a different cause.
    expect(
      resolveBuildSha({ env: { RAILWAY_GIT_COMMIT_SHA: "  ", GITHUB_SHA: "bbbb2222" } }),
    ).toBe("bbbb2222");
  });

  it("reads the deploy-context file when no env var is set — the Docker-build case", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, BUILD_SHA_FILENAME), "dddd4444eeee\n", "utf8");
      expect(resolveBuildSha({ env: {}, rootDir: dir })).toBe("dddd4444eeee");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when neither env nor context file supplies a SHA", () => {
    const dir = tempDir();
    try {
      expect(resolveBuildSha({ env: {}, rootDir: dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a blank context file rather than reporting an empty commit", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, BUILD_SHA_FILENAME), "\n", "utf8");
      expect(resolveBuildSha({ env: {}, rootDir: dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("write-build-sha.sh — resolves on the host, into the upload context", () => {
  it("writes GITHUB_SHA to the file the resolver reads", () => {
    const dir = tempDir();
    try {
      const { code } = runWriteScript(dir, childEnv({ GITHUB_SHA: "feedface00112233" }));
      expect(code).toBe(0);
      expect(readFileSync(join(dir, BUILD_SHA_FILENAME), "utf8").trim()).toBe("feedface00112233");
      expect(resolveBuildSha({ env: {}, rootDir: dir })).toBe("feedface00112233");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites rather than appends, so a re-run cannot bake a stale SHA", () => {
    const dir = tempDir();
    try {
      runWriteScript(dir, childEnv({ GITHUB_SHA: "1111111111111111" }));
      runWriteScript(dir, childEnv({ GITHUB_SHA: "2222222222222222" }));
      expect(readFileSync(join(dir, BUILD_SHA_FILENAME), "utf8").trim()).toBe("2222222222222222");
      expect(resolveBuildSha({ env: {}, rootDir: dir })).toBe("2222222222222222");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the host's git checkout when GITHUB_SHA is unset", () => {
    // deploy.sh may be run by hand from a developer machine, where GITHUB_SHA is absent
    // but .git is present. The host is the only place that fallback can legitimately live.
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dir = tempDir();
    try {
      const { code } = runWriteScript(dir, childEnv({ VT_BUILD_SHA_GIT_DIR: REPO_ROOT }));
      expect(code).toBe(0);
      expect(readFileSync(join(dir, BUILD_SHA_FILENAME), "utf8").trim()).toBe(head);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly instead of writing a blank file when no SHA can be resolved", () => {
    // A blank/stale file is worse than no file: the verifier would pass on the wrong
    // commit. set -e in deploy.sh turns this non-zero exit into an aborted deploy.
    const dir = tempDir();
    try {
      const { code, out } = runWriteScript(dir, childEnv());
      expect(code).not.toBe(0);
      expect(existsSync(join(dir, BUILD_SHA_FILENAME))).toBe(false);
      expect(out.toLowerCase()).toContain("sha");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the same filename literal the resolver reads", () => {
    // The whole fix hinges on producer and consumer agreeing on one filename.
    expect(readFileSync(WRITE_SCRIPT, "utf8")).toContain(BUILD_SHA_FILENAME);
  });

  it("is wired into deploy.sh ahead of the railway upload", () => {
    const deploy = readFileSync(resolve(REPO_ROOT, "deploy.sh"), "utf8");
    expect(deploy).toContain("write-build-sha.sh");
    expect(deploy.indexOf("write-build-sha.sh")).toBeLessThan(deploy.indexOf("railway_cli up"));
  });
});

describe("the SHA file survives every ignore filter between the repo and the build", () => {
  // Railway's `up` respects .gitignore/.railwayignore; Docker respects .dockerignore.
  // A future broadening of any of the three silently reintroduces gitCommit: null.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Compiles one ignore-file pattern into a RegExp over a repo-relative path.
   *
   * An earlier version of this only understood `*`, which made the guard below
   * report "not excluded" for four of the five pattern shapes that would really
   * exclude the file — `/vt-build-sha.txt`, `**​/vt-build-sha.txt`, `?` and
   * `[…]`. A guard that cannot see the pattern it is guarding against passes
   * for the wrong reason, which is worse than no guard at all.
   *
   * Where this is still imprecise it must OVER-match, never under-match: a
   * false positive fails the test loudly and gets read by a human, while a
   * false negative is exactly the silent pass this exists to prevent.
   */
  function patternToRegExp(pattern: string): RegExp {
    let anchored = pattern.startsWith("/");
    const body = anchored ? pattern.slice(1) : pattern;
    // gitignore(5): a pattern containing a non-trailing slash is relative to the
    // ignore file's directory; one without matches a basename at any depth.
    if (!anchored && body.includes("/")) anchored = true;

    let out = "";
    for (let i = 0; i < body.length; i += 1) {
      const c = body[i];
      if (c === "\\" && i + 1 < body.length) {
        i += 1;
        out += escapeRe(body[i]);
      } else if (c === "*") {
        if (body[i + 1] === "*") {
          i += 1;
          if (body[i + 1] === "/") {
            i += 1;
            out += "(?:.*/)?";
          } else {
            out += ".*";
          }
        } else {
          out += "[^/]*";
        }
      } else if (c === "?") {
        out += "[^/]";
      } else if (c === "[") {
        const close = body.indexOf("]", i + 1);
        if (close === -1) {
          out += "\\[";
        } else {
          const cls = body.slice(i + 1, close);
          out += `[${cls.startsWith("!") ? `^${cls.slice(1)}` : cls}]`;
          i = close;
        }
      } else {
        out += escapeRe(c);
      }
    }
    // `(?:/.*)?` because a pattern that names a directory also excludes its contents.
    return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${out}(?:/.*)?$`);
  }

  function matchesPattern(line: string, path: string): { negated: boolean; hit: boolean } | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const negated = trimmed.startsWith("!");
    const body = negated ? trimmed.slice(1) : trimmed;
    // A trailing slash makes the pattern directory-only, so it cannot exclude a
    // file — safe to skip only because the target is a file, which is asserted
    // by the `is not committed` case below (a tracked path would be a file too).
    if (body.endsWith("/")) return null;
    return { negated, hit: patternToRegExp(body).test(path) };
  }

  function excludes(ignoreFile: string, filename: string): boolean {
    const full = resolve(REPO_ROOT, ignoreFile);
    if (!existsSync(full)) return false;
    let excluded = false;
    for (const raw of readFileSync(full, "utf8").split("\n")) {
      const m = matchesPattern(raw, filename);
      if (m?.hit) excluded = !m.negated;
    }
    return excluded;
  }

  it("the pattern matcher models the ignore syntaxes it claims to", () => {
    // Guards the guard. Each left-hand pattern really would exclude the SHA file
    // if someone added it; the previous `*`-only matcher scored `false` on the
    // first four and this suite passed while blind to them.
    const excluding = [
      "vt-build-sha.txt",
      "/vt-build-sha.txt",
      "**/vt-build-sha.txt",
      "vt-build-sha.tx?",
      "vt-build-sha.[tx]xt",
      "*.txt",
      "vt-*",
      "**",
    ];
    const notExcluding = [
      "dist/vt-build-sha.txt", // anchored under a directory the file is not in
      "vt-build-sha.tx", // no implicit prefix matching
      "vt-build-sha.txt/", // directory-only pattern
      "vt-build-sha.[!t]xt", // negated class excludes the real character
      "# vt-build-sha.txt", // comment
    ];
    for (const p of excluding) {
      expect(matchesPattern(p, BUILD_SHA_FILENAME)?.hit ?? false).toBe(true);
    }
    for (const p of notExcluding) {
      expect(matchesPattern(p, BUILD_SHA_FILENAME)?.hit ?? false).toBe(false);
    }
  });

  it("is not matched by .railwayignore or .dockerignore", () => {
    expect(excludes(".railwayignore", BUILD_SHA_FILENAME)).toBe(false);
    expect(excludes(".dockerignore", BUILD_SHA_FILENAME)).toBe(false);
  });

  it("is not gitignored — `railway up` filters by .gitignore, so an ignored file never uploads", () => {
    // `git check-ignore -q` documents three outcomes and they are NOT all the
    // same: 0 = ignored, 1 = not ignored, 128 = it could not answer. Collapsing
    // every throw to "not ignored" meant a missing git binary or a broken repo
    // scored a PASS — the guard would report the file safe precisely when it had
    // learned nothing. Modelled as three cases so only one of them can pass.
    type IgnoreCheck =
      | { kind: "ignored" }
      | { kind: "not_ignored" }
      | { kind: "check_failed"; detail: string };

    const check = ((): IgnoreCheck => {
      try {
        execFileSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", BUILD_SHA_FILENAME], {
          stdio: "ignore",
        });
        return { kind: "ignored" };
      } catch (error) {
        const { status, code } = error as { status?: unknown; code?: unknown };
        if (status === 1) return { kind: "not_ignored" };
        return {
          kind: "check_failed",
          detail: `git check-ignore could not answer (status=${String(status)}, code=${String(code)})`,
        };
      }
    })();

    expect(check).toEqual({ kind: "not_ignored" });
  });

  it("is not committed — it is generated per deploy, never source", () => {
    // The file lives in an awkward spot by necessity: it must NOT be gitignored
    // (or `railway up` would filter it out of the upload) and must NOT be tracked
    // (a committed copy is a stale SHA waiting to make the verifier pass against
    // the wrong commit). deploy.sh rewrites it before every upload; this pins the
    // other half so `git add .` can't quietly turn it into source.
    const tracked = execFileSync(
      "git",
      ["-C", REPO_ROOT, "ls-files", "--", BUILD_SHA_FILENAME],
      { encoding: "utf8" },
    ).trim();
    expect(tracked).toBe("");
  });
});

describe("deployBuildInfo plugin — the resolved SHA actually reaches build-info.json", () => {
  it("is exported so its SHA resolution is reachable from a test", () => {
    expect(typeof deployBuildInfo).toBe("function");
  });

  it("carries a non-empty gitCommit when only the deploy-context file supplies it", async () => {
    // This is the exact Docker-build shape: no RAILWAY_/GITHUB_/VERCEL_ env var,
    // no .git, one file in the project root. Today this yields null.
    const dir = tempDir();
    const saved = SHA_ENV_KEYS.map((k) => [k, process.env[k]] as const);
    try {
      for (const k of SHA_ENV_KEYS) delete process.env[k];
      writeFileSync(join(dir, BUILD_SHA_FILENAME), "0badc0de99887766\n", "utf8");

      const plugin = deployBuildInfo("1.2.0", "1.2.0-testtag");
      (plugin.configResolved as (c: { root: string; build: { outDir: string } }) => void)({
        root: dir,
        build: { outDir: dir },
      });
      await (plugin.closeBundle as () => void | Promise<void>)();

      const payload = JSON.parse(readFileSync(join(dir, "build-info.json"), "utf8")) as {
        gitCommit: string | null;
        buildTag: string;
        appVersion: string;
      };
      expect(payload.gitCommit).toBe("0badc0de99887766");
      expect(payload.buildTag).toBe("1.2.0-testtag");
      expect(payload.appVersion).toBe("1.2.0");
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still prefers a build-time env var when one is present", async () => {
    const dir = tempDir();
    const saved = SHA_ENV_KEYS.map((k) => [k, process.env[k]] as const);
    try {
      for (const k of SHA_ENV_KEYS) delete process.env[k];
      process.env.RAILWAY_GIT_COMMIT_SHA = "abcdef0123456789";
      writeFileSync(join(dir, BUILD_SHA_FILENAME), "0badc0de99887766\n", "utf8");

      const plugin = deployBuildInfo("1.2.0", "1.2.0-testtag");
      (plugin.configResolved as (c: { root: string; build: { outDir: string } }) => void)({
        root: dir,
        build: { outDir: dir },
      });
      await (plugin.closeBundle as () => void | Promise<void>)();

      const payload = JSON.parse(readFileSync(join(dir, "build-info.json"), "utf8")) as {
        gitCommit: string | null;
      };
      expect(payload.gitCommit).toBe("abcdef0123456789");
    } finally {
      delete process.env.RAILWAY_GIT_COMMIT_SHA;
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
