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
  const escape = (part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = pattern
    .split("**")
    .map((chunk) => chunk.split("*").map(escape).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${suffix ? "(?:.*/)?" : ""}${body}$`);
}

function createFacts(root, policy) {
  const statCache = new Map();
  const lineCache = new Map();
  const listingCache = new Map();

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dependencies = { ...(manifest.devDependencies ?? {}), ...(manifest.dependencies ?? {}) };

  const stat = (relative) => {
    if (!statCache.has(relative)) {
      try {
        statCache.set(relative, fs.statSync(path.join(root, relative)));
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
        return;
      }
      for (const entry of entries) {
        if (entry.name === "node_modules") continue;
        // `.github/workflows/ci.yml` is cited by name in the plan docs, so the
        // dot-directories the config names are walked; the rest are not.
        if (entry.name.startsWith(".") && !(policy.includeDotDirs ?? []).includes(entry.name)) {
          continue;
        }
        const relative = current === "" ? entry.name : `${current}/${entry.name}`;
        if ((policy.ignoredPathPrefixes ?? []).some((p) => `${relative}/`.startsWith(p))) continue;
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
          const text = fs.readFileSync(path.join(root, relative), "utf8");
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
      const target = stat(scope);
      if (target?.isFile()) {
        return fs.readFileSync(path.join(root, scope), "utf8").split(pattern).length - 1;
      }
      if (target?.isDirectory()) {
        return list(scope).filter((relative) => {
          if (relative.endsWith("/")) return false;
          try {
            return fs.readFileSync(path.join(root, relative), "utf8").includes(pattern);
          } catch {
            return false;
          }
        }).length;
      }
      // A scope that does not exist cannot support an absence claim: returning 0
      // would make "absent from a file that is not there" quietly true.
      return Number.NaN;
    },
  };
}

module.exports = { createFacts, globToRegExp };
