/**
 * Tree + manifest facts — the I/O half of layer 1 ("what is written exists").
 *
 * Every read is cached for the life of one run: a governed document set cites
 * the same file dozens of times, and a stat storm is the difference between a
 * gate people run and a gate people skip.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Turn a shell-style glob into an anchored regex. A single `*` stops at `/`. */
function globToRegExp(pattern, { suffix = false } = {}) {
  // Tokenised, with NO placeholder character. An earlier version substituted a
  // sentinel for `**` and substituted it back afterwards; the sentinel it ended
  // up carrying was a literal NUL, which made the file read as binary to grep
  // and silently defeated a later edit that matched on the intended character.
  // Splitting is the same transformation with nothing to smuggle.
  // `?` is escaped as a LITERAL rather than expanded to `[^/]`: an unescaped `?`
  // is a regex quantifier on the token before it, so `foo?.ts` would compile to
  // /foo?\.ts/ and match `fo.ts` — a glob claim verifying against a file it does
  // not name. No governed document uses `?` as a wildcard; several name files
  // that contain one.
  // `**` BETWEEN SEPARATORS MATCHES ZERO DIRECTORIES. `docs/**/plan.md` names
  // `docs/plan.md` as well as `docs/g2/plan.md`. Translating the whole `/**/`
  // to `/.*/` demanded a directory in between, so the pattern failed against
  // the very file it was written for — a glob claim reported as a defect
  // because of the translation, which is the false alarm this module exists
  // not to produce.
  const escape = (part) => part.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
  const segment = (chunk) => chunk.split("*").map(escape).join("[^/]*");
  const ANY_DIRS = "(?:.*/)?";
  const leading = pattern.startsWith("**/");
  const body = (leading ? pattern.slice(3) : pattern)
    .split("/**/")
    .map((part) => part.split("**").map(segment).join(".*"))
    .join(`/${ANY_DIRS}`);
  return new RegExp(`^${suffix ? ANY_DIRS : ""}${leading ? ANY_DIRS : ""}${body}$`);
}

function createFacts(root, policy) {
  const statCache = new Map();
  const lineCache = new Map();
  const listingCache = new Map();
  /** Listings whose walk hit a directory it could not read. See `grepCount`. */
  const partialListings = new Set();
  /**
   * Listings the walk deliberately SHORTENED — `node_modules`, an unnamed dot
   * entry, an ignored prefix. Correct for a glob, and not evidence of absence:
   * a token sitting in a skipped file makes `grepCount` return 0, and a 0 there
   * reads as "confirmed absent" over a tree that was never fully walked. The
   * same silent pass as an unreadable file, arriving through the filters
   * instead of through an error.
   */
  const filteredListings = new Set();

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dependencies = { ...(manifest.devDependencies ?? {}), ...(manifest.dependencies ?? {}) };

  const REPO_ROOT = path.resolve(root);
  // Compared against the RESOLVED root, because a checkout can itself sit under
  // a link (a `/tmp` that is really `/private/tmp`); measuring a resolved target
  // against an unresolved root would refuse every path in such a checkout.
  const REAL_ROOT = (() => {
    try {
      return fs.realpathSync(REPO_ROOT);
    } catch {
      return REPO_ROOT;
    }
  })();

  const contains = (base, full) => full === base || full.startsWith(base + path.sep);

  /**
   * Resolve `relative` beneath the checkout, or null when it escapes.
   *
   * Every target reaching this module comes out of a DOCUMENT — a path span, or
   * a marker carrying its own scope (`scope=package.json`). `path.join` happily
   * resolves `../../etc`, so a claim about this repository could be answered by
   * a file this repository does not contain: verified, and about the wrong
   * tree. Checked once here rather than trusted at each call site, which is the
   * rule `git-facts` already applies to everything it hands to an argv.
   *
   * LEXICAL CONTAINMENT IS NOT CONTAINMENT. The first version of this guard
   * compared `path.resolve` output and stopped there, but `statSync` and
   * `readFileSync` FOLLOW symbolic links: a tracked `docs/proof.md` pointing at
   * `/external/proof.md` passed the string check and then read the outside file
   * anyway. The claim came back verified from data this repository does not
   * contain — a guard that announced containment without delivering it, which is
   * the half-true guard this engine exists to refuse.
   */
  const insideRoot = (relative) => {
    const full = path.resolve(REPO_ROOT, relative);
    if (!contains(REPO_ROOT, full)) return null;
    try {
      return contains(REAL_ROOT, fs.realpathSync(full)) ? full : null;
    } catch {
      // Nothing there to resolve. An ABSENT path is not an escape: the caller
      // refuses it in the ordinary way (false / null / NaN), and treating it as
      // a containment failure would turn every claim about a missing file into
      // the wrong kind of error.
      return full;
    }
  };

  const stat = (relative) => {
    if (!statCache.has(relative)) {
      const full = insideRoot(relative);
      try {
        statCache.set(relative, full === null ? null : fs.statSync(full));
      } catch {
        statCache.set(relative, null);
      }
    }
    return statCache.get(relative);
  };

  /** Every path under `dir`, skipping dotfiles and the generated trees. */
  const list = (dir) => {
    if (listingCache.has(dir)) return listingCache.get(dir);
    const out = [];
    const walk = (current) => {
      let entries;
      try {
        entries = fs.readdirSync(path.join(root, current), { withFileTypes: true });
      } catch {
        // A directory that cannot be read makes this listing PARTIAL, and
        // returning quietly is the THIRD face of one rule: an unreadable file
        // was refused in the file branch of `grepCount`, then in its directory
        // branch, and the traversal itself still came back short. Only absence
        // needs the guard — a glob EXISTENCE claim against a short listing
        // fails loudly on its own, while absence would pass because the tree
        // was never fully walked.
        partialListings.add(dir);
        return;
      }
      for (const entry of entries) {
        if (entry.name === "node_modules") {
          filteredListings.add(dir);
          continue;
        }
        // `.github/workflows/ci.yml` is cited by name in the plan docs, so the
        // dot-directories the config names are walked; the rest are not.
        if (entry.name.startsWith(".") && !(policy.includeDotDirs ?? []).includes(entry.name)) {
          filteredListings.add(dir);
          continue;
        }
        const relative = current === "" ? entry.name : `${current}/${entry.name}`;
        if ((policy.ignoredPathPrefixes ?? []).some((p) => `${relative}/`.startsWith(p))) {
          filteredListings.add(dir);
          continue;
        }
        out.push(entry.isDirectory() ? `${relative}/` : relative);
        if (entry.isDirectory()) walk(relative);
      }
    };
    walk(dir);
    listingCache.set(dir, out);
    return out;
  };

  return {
    fileExists(relative) {
      return stat(relative)?.isFile() ?? false;
    },

    dirExists(relative) {
      return stat(relative)?.isDirectory() ?? false;
    },

    lineCount(relative) {
      if (!lineCache.has(relative)) {
        try {
          const full = insideRoot(relative);
          if (full === null) throw new Error("outside the repository root");
          const text = fs.readFileSync(full, "utf8");
          // A trailing newline terminates the last line; it does not add one.
          lineCache.set(relative, text.replace(/\n$/, "").split("\n").length);
        } catch {
          lineCache.set(relative, null);
        }
      }
      return lineCache.get(relative);
    },

    /**
     * How many paths the glob matches, read as a SUFFIX for the same reason
     * `suffixMatches` exists: the docs write `services/equipment-*.ts` and
     * `lib/authority/enforcement/*` for files that live under `server/`, and
     * that is an ordinary, correct way to name them. Anchoring at the repo root
     * failed twenty such patterns on this repo's own README and ARCHITECTURE —
     * twenty true sentences reported as defects.
     */
    globMatches(pattern) {
      const matcher = globToRegExp(pattern, { suffix: true });
      return list("").filter((entry) => matcher.test(entry.replace(/\/$/, ""))).length;
    },

    /**
     * How many paths in the tree END WITH this reference.
     *
     * Docs cite files by the shortest unambiguous fragment — `api.ts`,
     * `screens/NfcSpikeScreen.tsx`, `components/autopilot/useProposalDecisions.ts`
     * — and every one of those is a correct, ordinary way to refer to a file
     * that really is there. Demanding a root-relative path would fail on
     * accurate prose, which is the false-alarm mode this gate must not have.
     * A reference that matches nothing still fails.
     */
    suffixMatches(reference) {
      const needle = `/${reference.replace(/\/$/, "")}`;
      const exact = stat(reference);
      return (
        list("").filter((relative) => relative.replace(/\/$/, "").endsWith(needle)).length +
        (exact ? 1 : 0)
      );
    },

    dependencyRange(name) {
      return dependencies[name] ?? null;
    },

    scriptExists(name) {
      return Object.prototype.hasOwnProperty.call(manifest.scripts ?? {}, name);
    },

    /**
     * Occurrences backing an ABSENCE claim.
     *  - `scope=deps` counts DEPENDENCY NAMES matching the pattern. That is the
     *    honest reading of "this repo has no SQLite package": a substring scan of
     *    package.json would also hit a script name or a URL and report a
     *    dependency that is not there.
     *  - a file scope counts literal occurrences in that file.
     *  - a directory scope counts files under it whose text contains the pattern.
     */
    grepCount(pattern, scope) {
      if (scope === "deps") {
        return Object.keys(dependencies).filter((name) => name.includes(pattern)).length;
      }
      // A scope outside the checkout is not evidence of absence about THIS
      // repository — `stat` already refuses it, and NaN carries that refusal to
      // `absenceRule` instead of a 0 that reads as verified.
      if (insideRoot(scope) === null) return Number.NaN;
      const target = stat(scope);
      if (target?.isFile()) {
        // A file that stats but cannot be read (permissions, a broken symlink)
        // is not evidence of absence — it is a scope this run could not check,
        // and NaN is how that reaches the caller as a failure rather than a 0.
        try {
          return fs.readFileSync(path.resolve(REPO_ROOT, scope), "utf8").split(pattern).length - 1;
        } catch {
          return Number.NaN;
        }
      }
      if (target?.isDirectory()) {
        // SAME RULE AS THE FILE BRANCH. Returning false for a file that cannot be
        // read counts it as a file that does not contain the pattern, so the
        // absence claim passes BECAUSE a file could not be opened. One unreadable
        // file makes the whole scope uncheckable.
        const entries = list(scope);
        // Incomplete for EITHER reason. A directory that could not be read and a
        // directory whose contents were filtered out are the same thing to an
        // absence claim: files under the scope that this run never opened.
        if (partialListings.has(scope) || filteredListings.has(scope)) return Number.NaN;
        let unreadable = 0;
        const hits = entries.filter((relative) => {
          if (relative.endsWith("/")) return false;
          // Checked PER ENTRY, not once for the scope: the walk lists a symbolic
          // link as an ordinary file, so a single link inside the directory is a
          // door out of the tree. One that escapes makes the scope uncheckable
          // for the same reason an unreadable file does.
          const full = insideRoot(relative);
          if (full === null) {
            unreadable += 1;
            return false;
          }
          try {
            return fs.readFileSync(full, "utf8").includes(pattern);
          } catch {
            unreadable += 1;
            return false;
          }
        }).length;
        return unreadable > 0 ? Number.NaN : hits;
      }
      // A scope that does not exist cannot support an absence claim: returning 0
      // would make "absent from a file that is not there" quietly true.
      return Number.NaN;
    },
  };
}

module.exports = { createFacts, globToRegExp };
