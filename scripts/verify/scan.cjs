/**
 * Claim EXTRACTION, as pure functions over text.
 *
 * WHY EXTRACTION IS ITS OWN MODULE
 * The verifier's failure mode is not "misses a lie" — it is "reports a lie that
 * is not there". The RN migration repo's `manifest-vs-code.test.ts` spends fifty
 * lines on exactly this: "a false alarm in a safety net is worse than no safety
 * net, because it burns the signal the net exists to carry." Every rule below is
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

/** Exclusion reasons written in more than one place, so the two cannot diverge. */
const FORMER_NAME = "former-name";
const DELETION_RECORD = "deletion-record";

/** Fences whose contents are shell commands (script claims are read from these). */
const SHELL_LANGS = new Set(["bash", "sh", "shell", "console", "zsh"]);

/** Extensions that make a code span a file reference rather than prose. */
const FILE_EXT = "ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|svg|png|jpg|ya?ml|sql|sh|html|txt|lock|xml|plist";

/** Index of the next run of EXACTLY `width` backticks at or after `from`, or -1. */
function closingFence(line, from, width) {
  let j = from;
  while (j < line.length) {
    if (line[j] !== "`") {
      j += 1;
      continue;
    }
    let k = j;
    while (line[k] === "`") k += 1;
    if (k - j === width) return j;
    j = k;
  }
  return -1;
}

/**
 * Inline code spans, as a linear scan rather than a regex.
 *
 * MULTI-BACKTICK DELIMITERS ARE WHY. Markdown writes a span that itself contains
 * a backtick with a longer fence: these documents cite files as `` `src/lib/api.ts` ``
 * in exactly that form. A single-backtick regex read that line as two spans each
 * containing one space, and the path between them fell into prose — never
 * claimed, never declined, invisible. It also left the `~~` in `` `~~` ``
 * outside any span, so the strikethrough scanner treated a literal as a
 * delimiter and opened a run that never closed.
 *
 * Linear, with no backtracking, for the same reason `inDeletionClause` is: this
 * runs on every line of every governed document.
 *
 * @returns {{ index: number, length: number, text: string }[]} in source order
 */
function codeSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    const open = i;
    while (line[i] === "`") i += 1;
    const width = i - open;
    const close = closingFence(line, i, width);
    // An opener with no matching closer is not a span; scanning resumes after it
    // rather than restarting, so this stays linear.
    if (close === -1) continue;
    spans.push({ index: open, length: close + width - open, text: line.slice(i, close) });
    i = close + width;
  }
  return spans;
}

/** Replace every code span with `render(span)`, keeping everything else. */
function replaceSpans(line, render) {
  const spans = codeSpans(line);
  if (spans.length === 0) return line;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += line.slice(cursor, span.index) + render(span);
    cursor = span.index + span.length;
  }
  return out + line.slice(cursor);
}

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
  return replaceSpans(line, (span) => ` ${span.text} `).replace(/\*\*|__|\*/g, "");
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
 * Returns `{ verb, value, opts }`, or null when the body is EMPTY. An unknown
 * verb comes back as a `verb` the caller does not recognise and is reported as a
 * `marker-unknown` claim — a defect either way, never a silent no-op.
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

/** Character ranges covered by an inline `code span` on this line. */
function codeSpanRanges(line) {
  return codeSpans(line).map((span) => [span.index, span.index + span.length]);
}

/** Is `index` inside any of these ranges? */
function within(ranges, index) {
  return ranges.some(([from, to]) => index >= from && index < to);
}

/**
 * Fence state. Returns true when the line IS the fence marker and the caller
 * should move on.
 */
function handleFence(state, line, ctx) {
  const fence = /^\s*(`{3,})\s*(\S*)/.exec(line);
  if (!fence) return false;
  const width = fence[1].length;
  if (state.fenceLang === null) {
    state.fenceLang = fence[2].toLowerCase();
    state.fenceWidth = width;
    state.treeArmed = ctx.treeBlocks.some((b) => b.afterHeading === state.lastHeading);
    state.treeStack = [];
    return true;
  }
  // FENCES NEST BY WIDTH. A three-backtick line inside a four-backtick block is
  // CONTENT, not the closing fence — which is how a document that shows a fenced
  // example gets its remaining lines misclassified. Only a run at least as wide
  // as the opener closes it.
  if (width < state.fenceWidth) return true;
  state.fenceLang = null;
  state.fenceWidth = null;
  state.treeArmed = false;
  return true;
}

/**
 * Markers are HTML comments and are honoured everywhere, including inside a
 * fence — a fenced block is exactly where an absence claim about config text
 * wants to sit.
 *
 * TWO MASKS, BOTH FOR THE SAME REASON: a marker the document is only SHOWING is
 * not a marker the document is MAKING.
 *
 * `spans` — a marker inside an inline code span is an example. `AGENTS.md`
 * documents the syntax by showing it, and reading that demonstration as live
 * made the documentation itself a claim.
 *
 * `struck` — a marker inside `~~retracted~~` text was written and then taken
 * back. Every other rule in this file honours that; markers did not, because
 * they were read before the retraction pass ran. Both holes have the same worst
 * case: an `attested <id>` marker that is only being shown or has been retracted
 * still satisfies the "referenced by a governed document" rule on its own, which
 * is exactly what stops a stale attestation from ever being reported.
 *
 * Inside a fence `struck` is empty, because `~~` in a shell block is two tildes.
 */
function collectMarkerClaims(rawLine, index, ctx, struck = []) {
  const spans = codeSpanRanges(rawLine);
  for (const m of rawLine.matchAll(MARKER)) {
    if (within(spans, m.index)) {
      ctx.decline(index, m[0], "marker-is-an-example");
      continue;
    }
    if (within(struck, m.index)) {
      ctx.decline(index, m[0], "marker-retracted");
      continue;
    }
    const parsed = parseMarker(m[1]);
    if (!parsed) {
      ctx.decline(index, m[0], "marker-empty");
      continue;
    }
    const { verb, value, opts } = parsed;
    if (verb === "absent") {
      ctx.push(index, { kind: "absence", raw: m[0], pattern: value, scope: opts.scope ?? "package.json" });
    } else if (verb === "attested") {
      ctx.push(index, { kind: "attested", raw: m[0], id: value });
    } else if (verb === "absent-file") {
      ctx.push(index, { kind: "absent-path", raw: m[0], target: value });
    } else if (verb === "green") {
      ctx.push(index, { kind: "green", raw: m[0], command: value });
    } else {
      ctx.push(index, { kind: "marker-unknown", raw: m[0], verb });
    }
  }
}

/**
 * One line of a STRUCTURE TREE fence.
 *
 * INDENTATION IS THE PATH. A structure tree nests by indent, so the bare token
 * `app/` under `src/` means `src/app/`, not a top-level `app/`. Reading tokens
 * flat reported eleven non-existent directories on this repo's own AGENTS.md —
 * every one of them a real directory, just at the wrong depth.
 */
function collectTreeClaim(state, line, index, ctx) {
  const indent = line.length - line.trimStart().length;
  const token = line.trim().split(/\s+/)[0];
  if (!token || !(DIR_SPAN.test(token) || PATH_SPAN.test(token))) return;
  while (state.treeStack.length > 0 && state.treeStack[state.treeStack.length - 1].indent >= indent) {
    state.treeStack.pop();
  }
  const prefix = state.treeStack.length > 0 ? state.treeStack[state.treeStack.length - 1].prefix : "";
  const full = prefix + token;
  if (token.endsWith("/")) state.treeStack.push({ indent, prefix: full });
  const target = full.replace(/\/$/, "");
  const exclusion = pathExclusion(target, ctx.policy);
  if (exclusion) ctx.decline(index, full, exclusion);
  else ctx.push(index, { kind: token.endsWith("/") ? "dir" : "path", raw: full, target });
}

/**
 * Blank `~~struck-through~~` text, and report which ranges were struck.
 *
 * RETRACTED TEXT IS NOT A CLAIM. "~~An untracked pnpm-lock.yaml sits beside the
 * tracked package-lock.json~~" is a statement the author struck out; reading it
 * as live reports a defect for a correction — the most demoralising false alarm
 * available, since it punishes exactly the behaviour the gate wants. The state
 * is carried ACROSS lines because this repo's corrections routinely span three
 * (docs/ota-acceptance.md:156-158). Struck text is blanked rather than deleted
 * so `m.index` still lines up with the source, and the RANGES come back so the
 * prose scan can report a struck package as excluded instead of dropping it.
 */
function blankRetracted(state, rawLine, index) {
  // DELIMITERS ARE `~~` OUTSIDE AN INLINE CODE SPAN. Inside one it is literal
  // text — markdown renders `` `~~` `` as two tildes — and splitting on it
  // regardless opened a run that never closed on the first document to DOCUMENT
  // the syntax. Found by the unterminated-run check below, on the very paragraph
  // describing that check.
  const spans = codeSpanRanges(rawLine);
  const marks = [];
  for (let i = 0; i + 1 < rawLine.length; i += 1) {
    if (rawLine[i] === "~" && rawLine[i + 1] === "~" && !within(spans, i)) {
      marks.push(i);
      i += 1;
    }
  }

  let rebuilt = "";
  const struck = [];
  let cursor = 0;
  const take = (from, to) => {
    if (state.retracted) {
      rebuilt += " ".repeat(to - from);
      struck.push([from, to]);
    } else {
      rebuilt += rawLine.slice(from, to);
    }
  };
  for (const mark of marks) {
    take(cursor, mark);
    state.retracted = !state.retracted;
    state.retractedFrom = state.retracted ? index : null;
    rebuilt += "  ";
    struck.push([mark, mark + 2]);
    cursor = mark + 2;
  }
  take(cursor, rawLine.length);
  return { line: rebuilt, struck };
}

/**
 * Scoped packages named in prose. Read from the RAW line with only code spans
 * blanked, so a struck package is REPORTED as excluded rather than disappearing:
 * blanking it first made the exclusion branch below unreachable, which is a
 * silent skip wearing the costume of a rule.
 */
function collectProsePackages(rawLine, struck, index, ctx) {
  const proseOnly = replaceSpans(rawLine, (span) => " ".repeat(span.length));
  for (const m of proseOnly.matchAll(PROSE_PACKAGE)) {
    const start = m.index;
    if (within(struck, start)) {
      ctx.decline(index, m[1], FORMER_NAME);
      continue;
    }
    const before = proseOnly.slice(0, start);
    const after = proseOnly.slice(start + m[1].length);
    if (FORMER_BEFORE.test(before) || RENAME_ARROW.test(after)) {
      ctx.decline(index, m[1], FORMER_NAME);
      continue;
    }
    if (NEGATED_AFTER.test(after) || NEGATED_BEFORE.test(before)) {
      ctx.decline(index, m[1], "package-declared-absent");
      continue;
    }
    ctx.push(index, { kind: "package", raw: m[1], name: m[1] });
  }
}

/** Versions written as prose ("React Native 0.86.2"), via the declared aliases. */
function collectAliasVersions(line, index, ctx) {
  if (!ctx.aliasPattern) return;
  const prose = plainProse(line);
  for (const m of prose.matchAll(ctx.aliasPattern)) {
    const pkg = ctx.policy.dependencyAliases[m[1]];
    if (pkg) ctx.push(index, { kind: "dependency", raw: `${m[1]} ${m[2]}`, name: pkg, range: m[2] });
  }
}

/** Landing citations on a status document; bare commit shas everywhere else. */
function collectCitations(line, index, ctx) {
  if (ctx.isStatusDoc && MERGE_CONTEXT.test(line)) {
    collectLandingClaims(line, index, ctx.push, LANDING_STRICT.test(line), ctx.policy);
    return;
  }
  if (!COMMIT_CONTEXT.test(line)) return;
  for (const { text } of codeSpans(line)) {
    const sha = text.trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) ctx.push(index, { kind: "commit", raw: sha, sha });
  }
}

/** Inside a fence: a structure tree, a shell block, or nothing readable. */
function collectFencedClaims(state, rawLine, index, ctx) {
  if (state.treeArmed) collectTreeClaim(state, rawLine, index, ctx);
  else if (SHELL_LANGS.has(state.fenceLang)) collectScriptClaims(rawLine, index, ctx.policy, ctx.push);
  // no prose/inline-span scanning inside any other fence
}

/**
 * A code span inside struck text was blanked before `classifySpan` could see it,
 * so it produced neither a claim nor an exclusion. Retracted is the right
 * reading; invisible is not — "`old/path.ts` -> `new/path.ts`" should say it
 * declined the left-hand side, the same way the prose scan does.
 */
function collectStruckSpans(rawLine, struck, index, ctx) {
  if (struck.length === 0) return;
  for (const span of codeSpans(rawLine)) {
    if (within(struck, span.index)) ctx.decline(index, span.text.trim(), FORMER_NAME);
  }
}

/** Every inline code span on a line, classified. */
function collectSpanClaims(line, index, ctx) {
  for (const span of codeSpans(line)) {
    classifySpan(
      span.text.trim(),
      index,
      ctx.policy,
      ctx.push,
      ctx.decline,
      line.slice(span.index + span.length),
      line.slice(0, span.index),
    );
  }
}

/** Everything read from a line of ordinary prose, in the order it is read. */
function collectProseClaims(state, rawLine, index, ctx) {
  if (/^\s*#{1,6}\s/.test(rawLine)) state.lastHeading = rawLine.trim();
  // The retraction pass runs FIRST because the marker scan needs its mask. It is
  // also the only thing here that advances `state.retracted`, so it must happen
  // exactly once per prose line whatever else does or does not fire.
  const { line, struck } = blankRetracted(state, rawLine, index);
  collectMarkerClaims(rawLine, index, ctx, struck);
  collectScriptClaims(line, index, ctx.policy, ctx.push);
  collectSpanClaims(line, index, ctx);
  collectStruckSpans(rawLine, struck, index, ctx);
  collectProsePackages(rawLine, struck, index, ctx);
  collectAliasVersions(line, index, ctx);
  collectCitations(line, index, ctx);
}

/**
 * Extract every claim (and every declined span) from one markdown document.
 *
 * The loop is a list of STAGES in a fixed order, each its own function. It was
 * one 165-line body scoring 97 on cognitive complexity — a quality-gate failure,
 * and more to the point a function nobody could hold in their head while
 * deciding whether a rule was too broad, which is the only question that matters
 * in this file.
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

  const at = (line) => ({ file: where.file, line: line + 1 });
  const ctx = {
    policy,
    push: (line, claim) => claims.push({ ...at(line), ...claim }),
    decline: (line, raw, reason) => excluded.push({ ...at(line), raw, reason }),
    aliasPattern: buildAliasPattern(policy.dependencyAliases ?? {}),
    treeBlocks: (policy.treeBlocks ?? []).filter((b) => b.file === where.file),
    isStatusDoc: (policy.statusDocs ?? []).includes(where.file),
  };

  const state = {
    fenceLang: null,
    /** Backtick width of the OPEN fence — only a run this wide or wider closes it. */
    fenceWidth: null,
    lastHeading: "",
    treeArmed: false,
    /** Indentation stack for the structure tree — see `collectTreeClaim`. */
    treeStack: [],
    /** Inside a `~~struck-through~~` run, which may span several lines. */
    retracted: false,
    retractedFrom: null,
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (handleFence(state, rawLine, ctx)) continue;
    if (state.fenceLang !== null) {
      collectMarkerClaims(rawLine, i, ctx);
      collectFencedClaims(state, rawLine, i, ctx);
    } else {
      collectProseClaims(state, rawLine, i, ctx);
    }
  }

  // AN ODD NUMBER OF `~~` RUNS BLANKS THE REST OF THE FILE. Every line after it
  // is read as retracted, and its claims vanish with no failure and no
  // exclusion. The vacuous-scan guard in run.js only fires when the total is
  // zero, so a partial skip like this passed the gate in silence — the one thing
  // this engine says it does not do.
  if (state.retracted) {
    ctx.push(state.retractedFrom ?? lines.length - 1, {
      kind: "strikethrough-unterminated",
      raw: "~~",
    });
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
  for (const { text } of codeSpans(line)) {
    const sha = text.trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) {
      cited = true;
      push(index, { kind: "commit", raw: sha, sha });
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

/**
 * The three readings that turn a path or directory reference into something
 * OTHER than a live claim, shared by both branches of `classifySpan` because
 * both need exactly the same three and duplicating them is how the two drift.
 */
function contextualReading(before, after) {
  if (RENAME_ARROW.test(after) || FORMER_BEFORE.test(before)) return FORMER_NAME;
  if (inDeletionClause(before)) return DELETION_RECORD;
  if (NEGATED_AFTER.test(after) || NEGATED_BEFORE.test(before)) return "absent";
  return null;
}

/**
 * One inline code span -> at most one claim, or one reported exclusion.
 *
 * EVERY PATH OUT OF HERE IS REPORTED. Five of them used to be a bare `return`:
 * an oversized span, a span containing whitespace, an i18n key namespace written
 * with a `*`, an empty span, and — the big one — every span that simply is not
 * path-shaped. The module header promises that a declined span is reported with
 * the rule that declined it, and five silent exits made that promise false. The
 * counts are grouped by reason in the CLI, so the volume costs one line.
 */
function classifySpan(span, index, policy, push, decline, after = "", before = "") {
  if (!span) {
    decline(index, "``", "empty-span");
    return;
  }
  if (span.length > 200) {
    decline(index, `${span.slice(0, 60)}…`, "span-too-long");
    return;
  }

  // A span with whitespace is a shell fragment, not a path:
  // `plutil -p ios/*/Info.plist`, `find . -name pnpm-lock.yaml …`.
  if (/\s/.test(span)) {
    decline(index, span, "shell-fragment");
    return;
  }

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
    if (exclusion) decline(index, span, exclusion);
    else if (span.includes("/")) push(index, { kind: "glob", raw: span, pattern: span });
    else decline(index, span, "not-a-path-glob");
    return;
  }

  // One context object rather than a six-argument tail repeated at both call
  // sites: the two helpers took eight parameters each, over the limit, and the
  // plumbing was identical in both.
  const at = { index, policy, push, decline, after, before };

  const asPath = PATH_SPAN.exec(span);
  if (asPath) {
    classifyPathSpan(asPath, span, at);
    return;
  }

  const asDir = DIR_SPAN.exec(span);
  if (asDir) {
    classifyDirSpan(asDir, span, at);
    return;
  }

  // Not path-shaped at all: `useUser`, `clinicId`, `off | shadow | enforce`.
  // Reported, because "nothing matched" and "nothing was checked" have to be
  // distinguishable from outside.
  decline(index, span, "not-claim-shaped");
}

/** A path-shaped span, read in the context of the prose around it. */
function classifyPathSpan(asPath, span, at) {
  const { index, policy, push, decline, after, before } = at;
  const target = asPath[1];
  const exclusion = pathExclusion(target, policy);
  if (exclusion) {
    decline(index, span, exclusion);
    return;
  }
  const reading = contextualReading(before, after);
  if (reading === FORMER_NAME || reading === DELETION_RECORD) {
    decline(index, span, reading);
    return;
  }
  if (reading === "absent") {
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
    return;
  }
  push(index, { kind: "path", raw: span, target, bare });
}

/** A directory-shaped span, read in the same three ways as a file reference. */
function classifyDirSpan(asDir, span, at) {
  const { index, policy, push, decline, after, before } = at;
  const target = asDir[1].replace(/\/$/, "");
  const exclusion = pathExclusion(target, policy);
  if (exclusion) {
    decline(index, span, exclusion);
    return;
  }
  // Same three readings as a file reference: "`src/shared/` no longer exists"
  // is a statement that it is GONE, not a claim that it is there.
  const reading = contextualReading(before, after);
  if (reading === FORMER_NAME || reading === DELETION_RECORD) {
    decline(index, span, reading);
    return;
  }
  if (reading === "absent") {
    push(index, { kind: "absent-dir", raw: span, target });
    return;
  }
  push(index, { kind: "dir", raw: span, target });
}

module.exports = {
  extractFromMarkdown,
  buildAliasPattern,
  splitDependencySpan,
  parseMarker,
  codeSpans,
  pathExclusion,
  SHELL_LANGS,
  PROSE_PACKAGE,
  inDeletionClause,
  LANDING_STRICT,
  MERGE_CONTEXT,
};
