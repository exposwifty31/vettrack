/**
 * Claim EXTRACTION, as pure functions over text.
 *
 * WHY EXTRACTION IS ITS OWN MODULE
 * The verifier's failure mode is not "misses a lie" — it is "reports a lie that
 * is not there". `src/__tests__/manifest-vs-code.test.ts` spends fifty lines on
 * exactly this: "a false alarm in a safety net is worse than no safety net,
 * because it burns the signal the net exists to carry." Every rule below is
 * therefore narrow on purpose, and everything a rule declines to claim is
 * REPORTED as an explicit exclusion with the rule that excluded it — never
 * dropped on the floor. A silent skip and a passing check look identical from
 * the outside, and only one of them is honest.
 *
 * WHAT IS AUTO-EXTRACTED AND WHAT NEEDS A MARKER
 * Anything a machine can read unambiguously out of ordinary prose is derived
 * with no annotation burden: paths in inline code spans, `name@range` pairs,
 * `npm run <script>`, the structure tree, landing citations. Natural-language
 * NEGATION ("no op-sqlite dependency has ever existed") and human ATTESTATION
 * ("verified green on a physical Pixel 7") cannot be parsed out of prose without
 * guessing, so those two — and only those two — use an HTML-comment marker,
 * which changes nothing about how the document renders.
 */

/** Fences whose contents are shell commands (script claims are read from these). */
const SHELL_LANGS = new Set(["bash", "sh", "shell", "console", "zsh"]);

/** Extensions that make a code span a file reference rather than prose. */
const FILE_EXT = "ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|svg|png|jpg|ya?ml|sql|sh|html|txt|lock|xml|plist";

const CODE_SPAN = /`([^`\n]+)`/g;

/**
 * A scoped npm package named in PROSE rather than in a code span.
 *
 * WHY THIS RULE EXISTS. `SCAFFOLD-PLAN.md` carried the frozen auth SDK as
 * **@clerk/clerk-expo** — bold, not backticked — and it stayed wrong through the
 * swap to `@clerk/expo` because this scanner only read code spans. CodeRabbit
 * caught it on PR #85; the gate did not. A frozen-stack line is exactly where a
 * package gets named in prose, so prose is exactly where it has to be read.
 *
 * SCOPED ONLY, for the same reason the code-span rule is scoped only: an
 * unscoped pattern would claim ordinary hyphenated words as packages. The
 * lookbehind keeps it off e-mail addresses, `~~struck~~` text handled below, and
 * anything already inside a code span (those are blanked before this runs).
 */
const PROSE_PACKAGE = /(?<![\w@/~-])(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)/gi;

/** Character ranges covered by `~~strikethrough~~` — retracted text is not a claim. */
function struckRanges(line) {
  const ranges = [];
  for (const m of line.matchAll(/~~[\s\S]*?~~/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}
// The body is captured wholesale and trimmed in `parseMarker`, rather than
// with `\\s*([^>]*?)\\s*`: that shape lets the engine split the padding many
// ways on a non-matching line, which is a backtracking cost paid on every
// line of every governed document for no expressive gain.
const MARKER = /<!--\s*vt-claim:([^>]*)-->/g;

/**
 * A LANDING claim ("this work is done and in main") must cite what landed.
 *
 * THE VOCABULARY IS NARROW BECAUSE THE FIRST VERSION WAS NOT. A trigger of
 * /MERGED|landed|✅/ reported five non-defects on this repo's own docs: the
 * literal `NOT-MERGED` inside a shell snippet, two "✅ CLOSED" checklist
 * headings, "op-sqlite never landed" (a NEGATIVE claim), and "the write-queue
 * landed on MMKV" (a claim about a design decision, not a merge). Each would
 * have been a permanent red against nothing, which is how a gate teaches people
 * to ignore it. The lookbehind is what rejects `NOT-MERGED`; requiring
 * "landed in/as" plus a citation sigil is what rejects the prose uses.
 */
const LANDING_STRICT = /(?<![\w-])MERGED\b|\bmerged to main\b|\blanded (?:in|as) [#`]/;

/**
 * Weaker: the line is TALKING about merges, so a `#123` on it is a pull-request
 * reference rather than an upstream issue number. Bare `#\d` is deliberately
 * NOT enough — `README.md` and `G2-PLAN.md` both cite react-native-nfc-manager
 * issue #833, which is not a PR of this repo and never will be.
 */
const MERGE_CONTEXT = /(?<![\w-])MERGED\b|\bmerged\b|\blanded\b|\bPRs?\s+#/;

/** Hex that is only read as a commit when the line is talking about commits. */
const COMMIT_CONTEXT = /\b(?:commit|sha|SHA|revision|pin(?:ned)?)\b/;

/**
 * A path-shaped code span. Anchored: a span is a file reference only if the
 * WHOLE span is one, so prose that merely contains a filename is not claimed.
 */
const PATH_SPAN = new RegExp(`^([\\w@][\\w./@+-]*\\.(?:${FILE_EXT}))(?::(\\d+)(?:-(\\d+))?)?$`);
const DIR_SPAN = /^([\w@][\w./@+-]*\/)$/;

/** `name@range` / `@scope/name@range` — the last `@` that is not the scope sigil. */
function splitDependencySpan(span) {
  const at = span.lastIndexOf("@");
  if (at <= 0) return null;
  const name = span.slice(0, at);
  const range = span.slice(at + 1);
  if (!/^@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?$/i.test(name)) return null;
  if (!/^[\^~]?\d[\w.\-+]*$/.test(range)) return null;
  return { name, range };
}

/**
 * Reasons a span that LOOKS like a path is not claimed as one. Each is a rule,
 * not a special case, and each is reported so the count is visible.
 */
function pathExclusion(target, policy) {
  if (/^(?:~|\/|https?:)/.test(target)) return "outside-repo";
  // `@AGENTS.md` is CLAUDE.md's import directive and `@/` is the tsconfig path
  // alias — neither is a file reference. A real scoped package path
  // (`@vettrack/contracts/src/…`) has a non-empty scope AND a name after it.
  if (target.startsWith("@") && !/^@[\w.-]+\/[\w.-]+/.test(target)) return "not-a-path-sigil";
  if (/[<>]|NNN|\bXXX\b|\{/.test(target)) return "template-placeholder";
  // `vettrack.uk/equipment` is a URL written without its scheme.
  if (/^[\w-]+\.(?:uk|com|io|dev|app|org|net)\//.test(target)) return "outside-repo";
  // Compare against `target + "/"` as well: a directory claim arrives with its
  // trailing slash already stripped, so "ios" would miss the "ios/" prefix.
  for (const prefix of policy.ignoredPathPrefixes ?? []) {
    if (target.startsWith(prefix) || `${target}/`.startsWith(prefix)) {
      return `generated-or-ignored:${prefix}`;
    }
  }
  return null;
}

/** Strip inline code, links and emphasis so a prose scan sees plain words. */
function plainProse(line) {
  return line.replace(CODE_SPAN, " $1 ").replace(/\*\*|__|\*/g, "");
}

/**
 * Package aliases as they appear in PROSE ("React Native 0.86.2"). Ordered
 * LONGEST FIRST and joined into one alternation, because JS alternation takes
 * the first branch that matches at a position: with "React" ahead of "React
 * Native", the frozen-stack line would report React@0.86.2 — a fabricated
 * mismatch, which is the exact class of false alarm this file exists to avoid.
 */
function buildAliasPattern(aliases) {
  const names = Object.keys(aliases).sort((a, b) => b.length - a.length);
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // A bare major counts: this project's docs write "React 18" and "Capacitor 8"
  // as often as "React Native 0.86.2", and both are version claims about the
  // manifest. `satisfiesVersion` compares only the segments the claim pins.
  return new RegExp(`\\b(${escaped.join("|")})\\s+([\\^~]?\\d+(?:\\.(?:\\d+|x)){0,2})\\b`, "g");
}

/**
 * Parse one marker body: `absent op-sqlite scope=package.json`.
 * Returns `{ verb, value, opts }`, or null when the verb is unknown — an
 * unknown verb is a defect the caller reports, never a silent no-op.
 */
function parseMarker(body) {
  const parts = body.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [verb, ...rest] = parts;
  const opts = {};
  const values = [];
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq > 0) opts[part.slice(0, eq)] = part.slice(eq + 1);
    else values.push(part);
  }
  return { verb, value: values.join(" "), opts };
}

/**
 * Extract every claim (and every declined span) from one markdown document.
 *
 * @param {string} text
 * @param {{ file: string }} where
 * @param {object} policy  verify.config.json's resolved policy block
 * @returns {{ claims: object[], excluded: object[] }}
 */
function extractFromMarkdown(text, where, policy) {
  const claims = [];
  const excluded = [];
  const lines = text.split("\n");
  const aliasPattern = buildAliasPattern(policy.dependencyAliases ?? {});
  const treeBlocks = (policy.treeBlocks ?? []).filter((b) => b.file === where.file);
  const isStatusDoc = (policy.statusDocs ?? []).includes(where.file);

  let fenceLang = null;
  let lastHeading = "";
  let treeArmed = false;
  /** Indentation stack for the structure tree — see the tree branch below. */
  let treeStack = [];
  /** Inside a `~~struck-through~~` run, which may span several lines. */
  let retracted = false;

  const at = (line) => ({ file: where.file, line: line + 1 });
  const push = (line, claim) => claims.push({ ...at(line), ...claim });
  const decline = (line, raw, reason) => excluded.push({ ...at(line), raw, reason });

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const fence = /^\s*```+\s*(\S*)/.exec(line);

    if (fence) {
      if (fenceLang === null) {
        fenceLang = fence[1].toLowerCase();
        treeArmed = treeBlocks.some((b) => b.afterHeading === lastHeading);
        treeStack = [];
      } else {
        fenceLang = null;
        treeArmed = false;
      }
      continue;
    }

    // Markers are HTML comments and are honoured everywhere, including inside a
    // fence — a fenced block is exactly where an absence claim about config text
    // wants to sit.
    for (const m of line.matchAll(MARKER)) {
      const parsed = parseMarker(m[1]);
      if (!parsed) {
        decline(i, m[0], "marker-empty");
        continue;
      }
      const { verb, value, opts } = parsed;
      if (verb === "absent") {
        push(i, { kind: "absence", raw: m[0], pattern: value, scope: opts.scope ?? "package.json" });
      } else if (verb === "attested") {
        push(i, { kind: "attested", raw: m[0], id: value });
      } else if (verb === "absent-file") {
        push(i, { kind: "absent-path", raw: m[0], target: value });
      } else if (verb === "green") {
        push(i, { kind: "green", raw: m[0], command: value });
      } else {
        push(i, { kind: "marker-unknown", raw: m[0], verb });
      }
    }

    if (fenceLang !== null) {
      if (treeArmed) {
        // INDENTATION IS THE PATH. A structure tree nests by indent, so the
        // bare token `app/` under `src/` means `src/app/`, not a top-level
        // `app/`. Reading tokens flat reported eleven non-existent directories
        // on this repo's own AGENTS.md — every one of them a real directory,
        // just at the wrong depth.
        const indent = line.length - line.trimStart().length;
        const token = line.trim().split(/\s+/)[0];
        if (!token || !(DIR_SPAN.test(token) || PATH_SPAN.test(token))) continue;
        while (treeStack.length > 0 && treeStack[treeStack.length - 1].indent >= indent) {
          treeStack.pop();
        }
        const prefix = treeStack.length > 0 ? treeStack[treeStack.length - 1].prefix : "";
        const full = prefix + token;
        if (token.endsWith("/")) treeStack.push({ indent, prefix: full });
        const target = full.replace(/\/$/, "");
        const exclusion = pathExclusion(target, policy);
        if (exclusion) decline(i, full, exclusion);
        else push(i, { kind: token.endsWith("/") ? "dir" : "path", raw: full, target });
        continue;
      }
      if (SHELL_LANGS.has(fenceLang)) {
        collectScriptClaims(line, i, policy, push);
      }
      continue; // no prose/inline-span scanning inside any other fence
    }

    if (/^\s*#{1,6}\s/.test(line)) lastHeading = line.trim();

    // RETRACTED TEXT IS NOT A CLAIM. "~~An untracked pnpm-lock.yaml sits beside
    // the tracked package-lock.json~~" is a statement the author struck out;
    // reading it as live reports a defect for a correction — the most demoralising
    // false alarm available, since it punishes exactly the behaviour the gate
    // wants. The state is carried ACROSS lines because this repo's corrections
    // routinely span three (docs/ota-acceptance.md:156-158). Struck text is
    // blanked rather than deleted so `m.index` still lines up with the source.
    {
      const segments = line.split("~~");
      let rebuilt = "";
      for (let k = 0; k < segments.length; k += 1) {
        rebuilt += retracted ? " ".repeat(segments[k].length) : segments[k];
        if (k < segments.length - 1) {
          retracted = !retracted;
          rebuilt += "  ";
        }
      }
      line = rebuilt;
    }

    collectScriptClaims(line, i, policy, push);

    for (const m of line.matchAll(CODE_SPAN)) {
      classifySpan(
        m[1].trim(),
        i,
        policy,
        push,
        decline,
        line.slice(m.index + m[0].length),
        line.slice(0, m.index),
      );
    }

    // Blank out code spans (keeping offsets) so a package already claimed as a
    // span is not claimed twice, then read what prose alone still names.
    const proseOnly = line.replace(CODE_SPAN, (match) => " ".repeat(match.length));
    const struck = struckRanges(line);
    for (const m of proseOnly.matchAll(PROSE_PACKAGE)) {
      const start = m.index;
      if (struck.some(([from, to]) => start >= from && start < to)) {
        decline(i, m[1], "former-name");
        continue;
      }
      const before = proseOnly.slice(0, start);
      const after = proseOnly.slice(start + m[1].length);
      if (FORMER_BEFORE.test(before) || RENAME_ARROW.test(after)) {
        decline(i, m[1], "former-name");
        continue;
      }
      if (NEGATED_AFTER.test(after) || NEGATED_BEFORE.test(before)) {
        decline(i, m[1], "package-declared-absent");
        continue;
      }
      push(i, { kind: "package", raw: m[1], name: m[1] });
    }

    if (aliasPattern) {
      const prose = plainProse(line);
      for (const m of prose.matchAll(aliasPattern)) {
        const pkg = policy.dependencyAliases[m[1]];
        if (pkg) push(i, { kind: "dependency", raw: `${m[1]} ${m[2]}`, name: pkg, range: m[2] });
      }
    }

    if (isStatusDoc && MERGE_CONTEXT.test(line)) {
      collectLandingClaims(line, i, push, LANDING_STRICT.test(line), policy);
    } else if (COMMIT_CONTEXT.test(line)) {
      for (const m of line.matchAll(CODE_SPAN)) {
        const span = m[1].trim();
        if (/^[0-9a-f]{7,40}$/.test(span)) push(i, { kind: "commit", raw: span, sha: span });
      }
    }
  }

  return { claims, excluded };
}

/** `npm run x` / `pnpm x` — a script name the manifest must actually define. */
function collectScriptClaims(line, index, policy, push) {
  const manager = policy.packageManager ?? "npm";
  const runPattern = new RegExp(`\\b${manager}\\s+run\\s+([\\w:-]+)`, "g");
  for (const m of line.matchAll(runPattern)) {
    push(index, { kind: "script", raw: m[0], script: m[1] });
  }
  if (manager === "pnpm") {
    // `pnpm test` is a script; `pnpm exec …` / `pnpm install` are CLI verbs.
    const builtins = new Set(policy.packageManagerBuiltins ?? []);
    for (const m of line.matchAll(/\bpnpm\s+([\w:.-]+)/g)) {
      // "pnpm 9.15.9" is a version statement and "pnpm workspace:" is a protocol
      // prefix; neither is a script. A script name starts with a letter and uses
      // colons only BETWEEN segments.
      if (!/^[a-z][\w-]*(?::[\w-]+)*$/.test(m[1])) continue;
      if (!builtins.has(m[1]) && m[1] !== "run") {
        push(index, { kind: "script", raw: m[0], script: m[1] });
      }
    }
  }
}

/**
 * A landing line must cite what landed: a PR number or a commit sha.
 * `requireCitation` is false for lines that merely DISCUSS merges — those still
 * yield their PR/commit references, but their silence is not a defect.
 */
function collectLandingClaims(line, index, push, requireCitation, policy) {
  let cited = false;
  for (const m of line.matchAll(/#(\d{1,4})\b/g)) {
    cited = true;
    // "account-deletion web page already exists (vettrack PR #153)" names
    // ANOTHER repository's PR. Checking it against this repo's history would
    // report a defect for a sentence that is both correct and explicitly
    // qualified — so the qualifier is honoured.
    // Read the qualifier by splitting, not by matching backwards over the whole
    // prefix: `(\w[\w-]*)\s+(?:PRs?\s+)?$` has overlapping alternatives and
    // backtracks super-linearly on a long line that does not end in a qualifier —
    // which is most lines. Same rule, linear cost.
    const prefix = line.slice(0, m.index);
    const words = /\s$/.test(prefix) ? prefix.trimEnd().split(/\s+/) : [];
    let candidate = words[words.length - 1] ?? "";
    if (/^PRs?$/i.test(candidate)) candidate = words[words.length - 2] ?? "";
    // Trailing word run only: the token before "PR" is often "(vettrack", and an
    // earlier version captured `vettrack` because it matched word characters
    // rather than a whole whitespace-delimited token. Done with a split rather
    // than `(\w[\w-]*)$` — that pattern's two halves overlap, so it backtracks
    // from every start position on a token that does not end in a word run.
    const parts = candidate.split(/[^\w-]+/);
    const tail = parts[parts.length - 1] ?? "";
    const repo = /^\w/.test(tail) ? tail : undefined;
    if (repo && (policy.crossRepoNames ?? []).includes(repo)) {
      push(index, { kind: "pull-request-cross-repo", raw: m[0], number: Number(m[1]), repo });
      continue;
    }
    push(index, { kind: "pull-request", raw: m[0], number: Number(m[1]) });
  }
  for (const m of line.matchAll(CODE_SPAN)) {
    const span = m[1].trim();
    if (/^[0-9a-f]{7,40}$/.test(span)) {
      cited = true;
      push(index, { kind: "commit", raw: span, sha: span });
    }
  }
  if (!cited && requireCitation) {
    push(index, { kind: "landing-uncited", raw: line.trim().slice(0, 160) });
  }
}

/**
 * Prose that turns a path reference into an ASSERTION OF ABSENCE. `G2-PLAN.md`
 * says "`src/lib/nfc-platform.ts` does not exist" — reading that as a positive
 * path claim would report a defect for a sentence that is already correct, and
 * correct about the very thing the reader needs to know.
 */
const NEGATED_AFTER =
  /^\s*(?:—\s*)?(?:does not exist|no longer exists?|never existed|was (?:removed|deleted)|were (?:removed|deleted)|has been (?:removed|deleted)|is gone|does not\b)/i;

/**
 * The same assertion with the negation in front: "and no `yarn.lock` exists
 * either". Only an IMMEDIATELY preceding negation counts — allowing words in
 * between turns "there is no reason to touch `src/foo.ts`" into a claim that
 * the file is absent, which is the opposite of what the sentence says.
 */
const NEGATED_BEFORE = /\b(?:no|nor|without|never)\s+$/i;

/**
 * `\`src/pages/appointments.tsx\` -> \`src/pages/Tasks.tsx\`` records a rename.
 * The left side is the FORMER name and is not expected to exist; the right side
 * is, and is still checked. Reading both as live references reports a defect for
 * a document that is doing exactly the right thing — writing down what moved.
 */
const RENAME_ARROW = /^\s*(?:→|->|=>|➜)\s*`/;

/**
 * The other half of the same idiom, written the other way round: "renamed from
 * `appointments.tsx`", "formerly `src/pages/x.tsx`". The named file is the one
 * that MOVED, so its absence is the point of the sentence.
 */
const FORMER_BEFORE = /\b(?:renamed from|renamed|formerly|previously|was called|used to be)\s+$/i;

/**
 * A DELETION RECORD: "deleted root cruft (`Archive.zip`, `all-files.md`, …)",
 * "removed verified-dead `shared/permissions.ts`". These lines exist to say what
 * is gone, so their paths are expected to be absent — but the verb can sit a
 * clause away from the span, and reading it as a positive claim reported seven
 * defects on one true line of TASKS.md.
 *
 * The window is BOUNDED and stops at a sentence break — ". " or ";" or the word
 * "see" — so a later "…, see `src/foo.ts`" is still checked normally. It stops
 * on ". " rather than on any dot because every path it has to scan past contains
 * one, which is how the first version of this rule reached exactly one filename. The span is
 * DECLINED rather than asserted-absent: a deletion verb this far away is good
 * evidence that a path is not being claimed, and poor evidence that it is gone.
 * Declining is reported in the excluded-by-rule counts; asserting would risk
 * calling a live file missing.
 */
const DELETION_VERB = /\b(?:deleted|removed|dropped|purged)\b/i;

/** How far back a deletion verb may sit from the span it covers. */
const DELETION_WINDOW = 320;

/**
 * Is this span inside a deletion clause? Expressed as two linear string
 * operations rather than one regex: the regex form
 * `verb(?:(?!\.\s|;|see)[\s\S]){0,320}$` backtracks over every start position
 * on a line that does not match, and this rule runs on every code span of every
 * governed document. Same rule, same window, no pathological case.
 */
function inDeletionClause(before) {
  const window = before.slice(-DELETION_WINDOW);
  const lower = window.toLowerCase();
  const breakAt = Math.max(lower.lastIndexOf(". "), lower.lastIndexOf(";"), lower.lastIndexOf(" see "));
  return DELETION_VERB.test(breakAt >= 0 ? window.slice(breakAt) : window);
}

/** One inline code span -> at most one claim, or one reported exclusion. */
function classifySpan(span, index, policy, push, decline, after = "", before = "") {
  if (!span || span.length > 200) return;

  // A span with whitespace is a shell fragment, not a path:
  // `plutil -p ios/*/Info.plist`, `find . -name pnpm-lock.yaml …`.
  if (/\s/.test(span)) return;

  // `@scope/name` (optionally with a subpath) is an npm package reference.
  // Scoped-only on purpose: an unscoped rule would claim `equipment-row-status`
  // and `not-a-signature` as packages, which is how a checker earns its
  // reputation for crying wolf.
  const scoped = /^(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)(?:\/.*)?$/i.exec(span);
  if (scoped && !new RegExp(`\\.(?:${FILE_EXT})$`).test(span)) {
    push(index, { kind: "package", raw: span, name: scoped[1] });
    return;
  }

  const dep = splitDependencySpan(span);
  if (dep) {
    push(index, { kind: "dependency", raw: span, name: dep.name, range: dep.range });
    return;
  }

  if (span.includes("*")) {
    const exclusion = pathExclusion(span, policy);
    // A `/` is required, not just a dot: `common.*`, `appointmentsPage.*` and
    // `home.shift.*` are i18n key namespaces, not file globs, and checking them
    // against the filesystem would fail forever for a non-defect.
    if (span.includes("/") && !exclusion) push(index, { kind: "glob", raw: span, pattern: span });
    else if (exclusion) decline(index, span, exclusion);
    return;
  }

  const asPath = PATH_SPAN.exec(span);
  if (asPath) {
    const target = asPath[1];
    const exclusion = pathExclusion(target, policy);
    if (exclusion) {
      decline(index, span, exclusion);
      return;
    }
    if (RENAME_ARROW.test(after) || FORMER_BEFORE.test(before)) {
      decline(index, span, "former-name");
      return;
    }
    if (inDeletionClause(before)) {
      decline(index, span, "deletion-record");
      return;
    }
    if (NEGATED_AFTER.test(after) || NEGATED_BEFORE.test(before)) {
      push(index, { kind: "absent-path", raw: span, target });
      return;
    }
    // A reference with no `/` is a SHORTHAND ("`api.ts`", "`RootNavigator.tsx`"),
    // not a location. Resolving it by basename is the honest reading; demanding
    // an exact root-relative path would fail on ordinary, correct prose.
    const bare = !target.includes("/");
    if (asPath[2]) {
      push(index, {
        kind: "path-lines",
        raw: span,
        target,
        bare,
        from: Number(asPath[2]),
        to: Number(asPath[3] ?? asPath[2]),
      });
    } else {
      push(index, { kind: "path", raw: span, target, bare });
    }
    return;
  }

  const asDir = DIR_SPAN.exec(span);
  if (asDir && span.includes("/")) {
    const target = asDir[1].replace(/\/$/, "");
    const exclusion = pathExclusion(target, policy);
    if (exclusion) {
      decline(index, span, exclusion);
      return;
    }
    // Same three readings as a file reference: "`src/shared/` no longer exists"
    // is a statement that it is GONE, not a claim that it is there.
    if (RENAME_ARROW.test(after) || FORMER_BEFORE.test(before)) {
      decline(index, span, "former-name");
      return;
    }
    if (inDeletionClause(before)) {
      decline(index, span, "deletion-record");
      return;
    }
    if (NEGATED_AFTER.test(after) || NEGATED_BEFORE.test(before)) {
      push(index, { kind: "absent-dir", raw: span, target });
      return;
    }
    push(index, { kind: "dir", raw: span, target });
  }
}

module.exports = {
  extractFromMarkdown,
  buildAliasPattern,
  splitDependencySpan,
  parseMarker,
  pathExclusion,
  SHELL_LANGS,
  PROSE_PACKAGE,
  struckRanges,
  inDeletionClause,
  LANDING_STRICT,
  MERGE_CONTEXT,
};
