/**
 * Git facts — the I/O half of layer 2 ("what is written as done was in fact done").
 *
 * SHALLOW CLONES FAIL LOUD, THEY DO NOT DEGRADE. `actions/checkout` defaults to
 * `fetch-depth: 1`, and on such a clone `git log --merges` finds nothing and
 * `merge-base --is-ancestor` errors on unknown objects. A verifier that quietly
 * treated that as "cannot check" would be green in CI — the one place the gate
 * is supposed to bite — while checking nothing at all. So a shallow clone, or a
 * default branch that is not fetched, is reported as a CONFIGURATION FAILURE
 * with the fix, exactly like a missing adapter in this codebase's Port rule.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Absolute path to git, resolved from a fixed list rather than searched on PATH.
 *
 * A PATH lookup runs whichever `git` the environment happens to offer first, and
 * a writable directory early in PATH turns every call in this file into
 * arbitrary execution. That is a real property of CI runners and shared dev
 * machines, not a theoretical one, and this module exists to be trusted about
 * what history says. `VT_GIT_BINARY` is the escape hatch for an unusual install,
 * and it must itself be absolute — accepting a bare name there would put the
 * PATH search straight back.
 */
function resolveGitBinary() {
  const override = process.env.VT_GIT_BINARY;
  if (override) return path.isAbsolute(override) && fs.existsSync(override) ? override : null;
  return (
    ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git", "/bin/git"].find((candidate) =>
      fs.existsSync(candidate),
    ) ?? null
  );
}

const GIT_BINARY = resolveGitBinary();

/**
 * Shapes allowed to reach a git argv, checked HERE rather than trusted from the
 * caller.
 *
 * Everything below is derived from files: a sha or a PR number scraped out of a
 * Markdown document, a branch name read from verify.config.json. `shell: false`
 * with an argv array already makes injection impossible, but "the scanner only
 * ever produces good values" is an assumption about another module, not a
 * property of this one — and it is exactly the assumption that stops being true
 * the day someone adds an extraction rule. A leading `-` is rejected for the
 * same reason: it is not a shell problem, it is git reading an argument as a
 * flag.
 */
const SHA = /^[0-9a-f]{7,40}$/i;
const REF = /^\w[\w./-]*$/;
const REPO_PATH = /^[^\0\-][^\0]*$/;

/** No git call may outlive this, and none may be truncated by the default buffer. */
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function git(root, args) {
  if (!GIT_BINARY) {
    return { ok: false, status: null, stdout: "", stderr: "git binary not found at a known absolute path" };
  }
  // BOUNDED ON BOTH AXES. With Node's defaults a git that waits on a lock or a
  // credential prompt hangs the verifier with no limit, and a diff larger than
  // the 1 MB default buffer comes back KILLED — which this module would then
  // report as "cannot diff", naming the wrong cause on the one document
  // (`docs/audit/PROOF_ALIGNMENT_LOG.md`, 8,700 lines) most likely to produce a
  // big diff.
  const result = spawnSync(GIT_BINARY, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * Line numbers a unified diff ADDS, as a pure function over the diff text.
 *
 * Pure so a fabricated diff can be handed to it: the `+++ b/path` header used to
 * be skipped BY PREFIX, and an added source line whose own text starts with `++`
 * renders as `+++…`. Skipping that left the cursor one behind for every later
 * line in the hunk, so claims after it were read at the wrong line number or
 * dropped from the added set entirely — a silent miscount no test could reach
 * while this lived inside a git call.
 */
function addedLinesFromDiff(stdout) {
  const added = new Set();
  let cursor = 0;
  let inHunk = false;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      cursor = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    // Only lines INSIDE a hunk are counted, so the file header cannot be one.
    if (!inHunk) continue;
    if (line.startsWith("+")) {
      added.add(cursor);
      cursor += 1;
    } else if (line.startsWith(" ")) {
      cursor += 1;
    }
  }
  return added;
}

/**
 * Build the git fact provider, or explain why layer 2 cannot run.
 * @returns {{ ready: boolean, problems: string[], facts: object|null, ref: string|null }}
 */
function createGitFacts(root, defaultBranch) {
  const problems = [];

  if (!GIT_BINARY) {
    problems.push(
      "git was not found at any known absolute path (/usr/bin/git, /usr/local/bin/git, " +
        "/opt/homebrew/bin/git, /bin/git). Set VT_GIT_BINARY to an absolute path.",
    );
    return { ready: false, problems, facts: null, ref: null };
  }

  if (!git(root, ["rev-parse", "--git-dir"]).ok) {
    problems.push("not a git repository — layer 2 (executed) cannot be checked here");
    return { ready: false, problems, facts: null, ref: null };
  }

  if (git(root, ["rev-parse", "--is-shallow-repository"]).stdout === "true") {
    problems.push(
      "shallow clone: commit and pull-request claims cannot be checked. " +
        "Set `fetch-depth: 0` on actions/checkout (see .github/workflows/ci.yml).",
    );
  }

  // Prefer the remote-tracking ref: on a PR checkout the local branch is the PR
  // branch, and `main` may exist only as origin/main.
  if (!REF.test(String(defaultBranch))) {
    problems.push(`defaultBranch in verify.config.json is not a valid ref name: ${defaultBranch}`);
    return { ready: false, problems, facts: null, ref: null };
  }

  const candidates = [`refs/remotes/origin/${defaultBranch}`, `refs/heads/${defaultBranch}`];
  const ref = candidates.find(
    (candidate) => git(root, ["rev-parse", "--verify", "--quiet", candidate]).ok,
  );
  if (!ref) {
    problems.push(
      `default branch "${defaultBranch}" is not present locally (tried ${candidates.join(", ")}). ` +
        `Fetch it before verifying: git fetch origin ${defaultBranch}:refs/remotes/origin/${defaultBranch}`,
    );
  }

  const commitCache = new Map();
  const ancestorCache = new Map();
  const prCache = new Map();

  const facts = {
    commitExists(sha) {
      if (!SHA.test(String(sha))) return false;
      if (!commitCache.has(sha)) {
        commitCache.set(sha, git(root, ["cat-file", "-e", `${sha}^{commit}`]).ok);
      }
      return commitCache.get(sha);
    },

    commitIsAncestorOfDefault(sha) {
      if (!ref || !SHA.test(String(sha))) return false;
      const key = `${sha}->${ref}`;
      if (!ancestorCache.has(key)) {
        ancestorCache.set(key, git(root, ["merge-base", "--is-ancestor", sha, ref]).ok);
      }
      return ancestorCache.get(key);
    },

    /**
     * The merge commit GitHub writes for a PR. The grep is anchored with the
     * trailing " from" so #1 does not match #10 — the off-by-substring that
     * would report every low-numbered PR as landed.
     */
    mergeCommitForPr(number) {
      if (!Number.isInteger(number) || number <= 0 || number > 999999) return null;
      if (!prCache.has(number)) {
        const search = git(root, [
          "log",
          ref ?? "HEAD",
          "--merges",
          "--fixed-strings",
          `--grep=Merge pull request #${number} from`,
          "--format=%H",
          "--max-count=1",
        ]);
        prCache.set(number, search.ok && search.stdout ? search.stdout : null);
      }
      return prCache.get(number);
    },

    /**
     * Does `path` exist in the tree of `sha`? Used for append-only log entries.
     * Both arguments are checked here, like every other entry point: this module
     * says it validates shapes rather than trusting callers, and an unvalidated
     * `sha` beginning with `-` is git reading an argument as a flag.
     */
    pathExistsAtCommit(sha, filePath) {
      if (!SHA.test(String(sha)) || !REPO_PATH.test(String(filePath))) return false;
      return git(root, ["cat-file", "-e", `${sha}:${filePath}`]).ok;
    },

    /**
     * Line numbers in `filePath` that this branch ADDED relative to the default
     * branch, working tree included.
     *
     * WHY AN APPEND-ONLY LOG IS SCANNED THIS WAY. `docs/audit/PROOF_ALIGNMENT_LOG.md`
     * is 8,700 lines of dated evidence entries, and its own first rule is that
     * entries are never edited retroactively. Its citations were true when
     * written; re-checking them against today's tree would demand edits the file
     * forbids, and 348 entries carry no commit to resolve them at. So the gate
     * checks what you APPEND: a new entry must be verifiable now, and history is
     * left as the record it is.
     */
    addedLines(filePath) {
      if (!ref) return null;
      const diff = git(root, ["diff", "--unified=0", "--no-color", ref, "--", filePath]);
      if (!diff.ok) return null;
      return addedLinesFromDiff(diff.stdout);
    },

    /** The commit the default-branch ref points at — reported, never assumed. */
    refHead() {
      if (!ref) return null;
      const result = git(root, ["log", "--format=%h %s", "--max-count=1", ref]);
      return result.ok ? result.stdout : null;
    },

    treeHash() {
      const result = git(root, ["rev-parse", "HEAD^{tree}"]);
      return result.ok ? result.stdout : null;
    },
  };

  return { ready: problems.length === 0, problems, facts, ref };
}

module.exports = { addedLinesFromDiff, createGitFacts, git, resolveGitBinary, SHA, REF, REPO_PATH };
