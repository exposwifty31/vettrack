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

describe("this suite is testing the source, not a stale compiled copy of it", () => {
  it("has no emitted .js shadowing a tracked .ts it imports through", () => {
    // This is not hypothetical and it is not cheap. A stray `tsc` (no --noEmit) left
    // scripts/build-sha.js and vite.config.js on disk, and BOTH of this file's
    // imports bind to a real emitted .js over the .ts it was written for — Vite's
    // DEFAULT_CONFIG_FILES resolves vite.config.js BEFORE vite.config.ts, and
    // `from "../scripts/build-sha.js"` resolves to a real sibling .js when one
    // exists. Measured, same total mutation of resolveBuildSha in the .ts:
    //   stale scripts/build-sha.js present -> 6 passed   (green against dead code)
    //   stale file moved aside             -> 6 failed
    // So the suite reported success while the shipped source was never loaded.
    //
    // .gitignore:125-133 already names this hazard and ignores the artifacts. That
    // stops them being COMMITTED; it does nothing about the shadowing, which happens
    // locally, silently, and only to whoever ran tsc. CI is a fresh checkout and
    // never sees it — so this is precisely the class of defect that cannot be caught
    // by CI being green, only by a check that runs where the artifact lives.
    const tracked = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "*.ts", "scripts/*.ts"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

    const shadowed = tracked.filter((ts) => {
      const emitted = ts.replace(/\.ts$/, ".js");
      if (!existsSync(resolve(REPO_ROOT, emitted))) return false;
      // A .js that is itself tracked is a real source file, not emit.
      const isTracked = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", emitted], {
        encoding: "utf8",
      }).trim();
      return isTracked === "";
    });

    expect({
      shadowed,
      hint: "delete the emitted .js/.d.ts — a stale copy silently wins over the .ts",
    }).toEqual({
      shadowed: [],
      hint: "delete the emitted .js/.d.ts — a stale copy silently wins over the .ts",
    });
  });
});

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

  it("exits non-zero when the write itself fails, instead of announcing success", () => {
    // The regression test the `set -eu` finding asked for and did not get. Without
    // errexit this is the ONE case that goes wrong, and it goes wrong silently: a
    // resolvable SHA plus an unwritable destination. The redirection fails, the
    // banner still prints, and the script exits 0 — so deploy.sh runs `railway up`
    // with no SHA file and every existing case here stays green, because they all
    // exercise the path where NO SHA could be resolved (which exits 1 either way).
    //
    // Measured on this script, `set -eu` vs `set -u`, same invocation:
    //   set -eu -> exit=1, no banner
    //   set -u  -> exit=0, "🔖 Deploy context SHA: … -> /nonexistent/dir/…"
    //
    // A nonexistent parent rather than a chmod'd directory, so the case still
    // discriminates when the suite runs as root (CI containers usually do).
    const { code, out } = runWriteScript(
      "/nonexistent/dir",
      childEnv({ GITHUB_SHA: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }),
    );
    expect(code).not.toBe(0);
    // The sharper half: silence. A zero exit is the symptom, but the banner is what
    // makes a human believe the file is there.
    expect(out).not.toContain("Deploy context SHA:");
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
   *
   * `directoryOnly` is the trailing-slash form. A first pass skipped those
   * outright on the reasoning that a directory pattern cannot exclude a file —
   * true of the one path this is called with today, false of the signature,
   * which takes any path. `generated/` really does exclude
   * `generated/vt-build-sha.txt`, so the skip would have gone quiet the moment
   * the SHA file moved out of the repo root. It now requires a segment BELOW
   * the match instead of skipping: `generated/` hits `generated/anything` and
   * not a plain file named `generated`, which is the actual rule.
   */
  /**
   * `.dockerignore` is NOT gitignore. Docker and BuildKit parse it with
   * moby/patternmatcher, which runs `filepath.Clean` over every pattern — so
   * `./x`, `x/` and `a/../x` all collapse to `x`, and its patterns are always
   * relative to the context root rather than matching a basename at any depth.
   *
   * Feeding those files to a gitignore compiler was a silent under-match, and it
   * had teeth: a single `./vt-build-sha.txt` line in `.dockerignore` drops the
   * SHA out of the build context and returns `gitCommit: null` — the exact
   * regression this file exists to prevent — while `excludes()` reported the
   * file safe and the suite stayed green.
   */
  type Dialect = "git" | "docker";

  /** `filepath.Clean`, restricted to what an ignore-file pattern can contain. */
  function cleanPath(pattern: string): string {
    const parts: string[] = [];
    for (const seg of pattern.split("/")) {
      if (seg === "" || seg === ".") continue;
      // A `..` that pops past the root leaves the segment stack empty, which
      // widens the pattern. That is the over-match direction, so it is allowed.
      if (seg === "..") {
        parts.pop();
        continue;
      }
      parts.push(seg);
    }
    return parts.join("/");
  }

  function patternToRegExp(pattern: string, directoryOnly: boolean): RegExp | null {
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
          // Two class forms a JS regex CANNOT express the way git's wildmatch
          // reads them, both verified against real `git check-ignore`:
          //   `[]t]`  — a leading `]` is a literal member for wildmatch, but
          //             opens an empty (never-matching) class in JS.
          //   `[\t]`  — `\` means "the next char, literally" for wildmatch; JS
          //             reads it as an escape, so this silently becomes TAB.
          // Both under-match, which is the one direction this compiler promises
          // never to go. Return null and let the caller treat it as a hit.
          // An empty `cls` IS the leading-`]` form: `[]t]` terminates the class at
          // the very first `]`, so the scanner sees `[]` where wildmatch sees a
          // class containing `]` and `t`. Checking for a leading `]` in `cls` never
          // fires, because that character was already consumed as the terminator.
          if (cls.replace(/^!/, "") === "" || cls.includes("\\")) return null;
          out += `[${cls.startsWith("!") ? `^${cls.slice(1)}` : cls}]`;
          i = close;
        }
      } else {
        out += escapeRe(c);
      }
    }
    // A plain pattern that names a directory also excludes its contents, so the
    // tail is optional; a directory-only one matches ONLY the contents, so it is
    // required. That single difference is the whole of the trailing-slash rule.
    const tail = directoryOnly ? "/.*" : "(?:/.*)?";
    try {
      return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${out}${tail}$`);
    } catch {
      // A malformed class such as `[\]]` throws. Uncaught, one such line anywhere
      // in an ignore file takes the whole guard down; swallowed, it would skip the
      // line and under-match. Null keeps the promise: the caller counts it a hit.
      return null;
    }
  }

  function matchesPattern(
    line: string,
    path: string,
    dialect: Dialect = "git",
  ): { negated: boolean; hit: boolean; directoryOnly: boolean } | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const negated = trimmed.startsWith("!");
    const withoutBang = negated ? trimmed.slice(1) : trimmed;

    if (dialect === "docker") {
      // Clean collapses `./x`, `x/` and `a/../x` to `x`, which also means the
      // directory-only concept does not survive normalisation. Docker patterns
      // are root-relative, never basename-at-any-depth, so always anchor.
      const cleaned = cleanPath(withoutBang);
      if (cleaned === "") return null;
      const rx = patternToRegExp(`/${cleaned}`, false);
      return { negated, hit: rx === null || rx.test(path), directoryOnly: false };
    }

    const directoryOnly = withoutBang.endsWith("/");
    const body = directoryOnly ? withoutBang.slice(0, -1) : withoutBang;
    if (body === "") return null; // a bare "/" names nothing
    const rx = patternToRegExp(body, directoryOnly);
    // `rx === null` means "this compiler cannot model the pattern faithfully".
    // Counted as a HIT, because over-matching fails loudly and under-matching is
    // the silent pass. Never flip this to `false` for a quieter suite.
    return { negated, hit: rx === null || rx.test(path), directoryOnly };
  }

  /** The whole-file rule, split out so the multi-line cases can drive it directly. */
  function excludesFromLines(lines: string[], filename: string, dialect: Dialect): boolean {
    let excluded = false;
    // gitignore(5): "It is not possible to re-include a file if a parent directory
    // of that file is excluded." A later `!generated/vt-build-sha.txt` after
    // `generated/` does NOT bring the file back — git never descends into the
    // directory to consider it. Without this the loop un-excluded on the negation
    // and reported the file safe when git had dropped it: a silent pass.
    let excludedByDirectory = false;
    for (const raw of lines) {
      const m = matchesPattern(raw, filename, dialect);
      if (!m?.hit) continue;
      if (m.negated) {
        if (excludedByDirectory) continue; // unreachable re-include
        excluded = false;
      } else {
        excluded = true;
        excludedByDirectory = m.directoryOnly;
      }
    }
    return excluded;
  }

  function excludes(ignoreFile: string, filename: string): boolean {
    const full = resolve(REPO_ROOT, ignoreFile);
    if (!existsSync(full)) return false;
    return excludesFromLines(
      readFileSync(full, "utf8").split("\n"),
      filename,
      ignoreFile.endsWith(".dockerignore") ? "docker" : "git",
    );
  }

  it("the pattern matcher models the ignore syntaxes it claims to", () => {
    // Guards the guard. Every pattern below really would (or would not) exclude
    // the path beside it under gitignore(5); the original `*`-only matcher
    // scored FALSE on four of the first five, and this suite passed while blind
    // to them. Two paths, because a matcher checked against one root-level file
    // can hide a rule — the directory-only case did exactly that.
    const NESTED = `generated/${BUILD_SHA_FILENAME}`;
    const cases: Array<[pattern: string, path: string, hit: boolean]> = [
      // root-level file
      ["vt-build-sha.txt", BUILD_SHA_FILENAME, true],
      ["/vt-build-sha.txt", BUILD_SHA_FILENAME, true], // root-anchored
      ["**/vt-build-sha.txt", BUILD_SHA_FILENAME, true],
      ["vt-build-sha.tx?", BUILD_SHA_FILENAME, true],
      ["vt-build-sha.[tx]xt", BUILD_SHA_FILENAME, true],
      ["*.txt", BUILD_SHA_FILENAME, true],
      ["vt-*", BUILD_SHA_FILENAME, true],
      ["**", BUILD_SHA_FILENAME, true],
      ["dist/vt-build-sha.txt", BUILD_SHA_FILENAME, false], // anchored elsewhere
      ["vt-build-sha.tx", BUILD_SHA_FILENAME, false], // no prefix matching
      ["vt-build-sha.[!t]xt", BUILD_SHA_FILENAME, false], // class excludes the real char
      ["# vt-build-sha.txt", BUILD_SHA_FILENAME, false], // comment
      // directory-only patterns — a trailing slash matches the CONTENTS
      ["generated/", NESTED, true],
      ["/generated/", NESTED, true],
      ["**/generated/", NESTED, true],
      ["generated", NESTED, true], // no slash: the dir and everything under it
      ["generated/", "generated", false], // ...but never a plain FILE of that name
      ["vt-build-sha.txt/", BUILD_SHA_FILENAME, false], // same rule, at the root
      ["/", BUILD_SHA_FILENAME, false], // a bare slash names nothing
    ];
    for (const [pattern, path, hit] of cases) {
      expect({ pattern, path, hit: matchesPattern(pattern, path)?.hit ?? false }).toEqual({
        pattern,
        path,
        hit,
      });
    }
  });

  it("over-matches rather than under-matches on classes it cannot model", () => {
    // The docstring promises to err toward a false positive. It did not: verified
    // against real `git check-ignore`, all three of these DO ignore the file while
    // the compiler scored them false — a silent pass, the one outcome the guard
    // exists to prevent. `[]t]` puts a literal `]` in the class (empty class in
    // JS), `[\t]` means a literal `t` to wildmatch but TAB to JS, and `[\]]` does
    // not even compile as a JS regex, which took the whole guard down by throwing.
    for (const pattern of ["vt-build-sha.tx[]t]", "vt-build-sha.tx[\\t]", "[\\]]"]) {
      expect({ pattern, hit: matchesPattern(pattern, BUILD_SHA_FILENAME)?.hit ?? false }).toEqual({
        pattern,
        hit: true,
      });
    }
  });

  it("reads .dockerignore with Docker's rules, not git's", () => {
    // Docker/BuildKit parse .dockerignore with moby/patternmatcher, which runs
    // filepath.Clean on every pattern. Verified against that library: each line
    // below excludes the SHA file, so the build context loses it and
    // build-info.json regresses to `gitCommit: null`. Under git's rules all three
    // score false, which is what this compiler used to return for a .dockerignore.
    for (const line of ["./vt-build-sha.txt", "vt-build-sha.txt/", "a/../vt-build-sha.txt"]) {
      expect({ line, excluded: excludesFromLines([line], BUILD_SHA_FILENAME, "docker") }).toEqual({
        line,
        excluded: true,
      });
      // Same line under git's rules genuinely does NOT exclude it — the dialects
      // disagree, which is the entire reason this split exists.
      expect({ line, excluded: excludesFromLines([line], BUILD_SHA_FILENAME, "git") }).toEqual({
        line,
        excluded: false,
      });
    }
  });

  it("does not re-include a file whose parent directory is excluded", () => {
    // gitignore(5): "It is not possible to re-include a file if a parent directory
    // of that file is excluded" — git never descends into the directory, so the
    // negation is dead. Confirmed against real `git check-ignore`. The loop used to
    // honour the negation and report the file safe.
    const NESTED = `generated/${BUILD_SHA_FILENAME}`;
    expect(excludesFromLines(["generated/", `!${NESTED}`], NESTED, "git")).toBe(true);
    expect(excludesFromLines(["/generated/", `!/${NESTED}`], NESTED, "git")).toBe(true);
    // A negation still works when the exclusion came from a FILE pattern, which is
    // the case git does honour — so this is a scoped rule, not a blanket one.
    expect(excludesFromLines([NESTED, `!${NESTED}`], NESTED, "git")).toBe(false);
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
