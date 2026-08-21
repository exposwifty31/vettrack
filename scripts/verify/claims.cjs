/**
 * Claim DECISIONS, as pure functions.
 *
 * Every rule here takes plain data and returns plain data — no fs, no network,
 * no process.exit. That is the same split the RN migration repo's
 * `scripts/release-config/checks.js` uses, and for the same reason: a check that
 * has only ever seen good input is untested. Because these are pure, each
 * repository's claims-ledger suite can hand one a deliberately FALSE claim and
 * assert that it refuses —
 * a non-existent path, a version that drifted, a commit that never reached main,
 * an attestation that has gone stale. Proving refusal is the only way to know a
 * gate closes.
 *
 * DISPOSITIONS. Every scanned claim resolves to exactly one of:
 *   verified   — checked against the tree/git/report and true
 *   registered — cannot be checked here, and a written reason says why
 *   attested   — a human vouched for it, with a date and a re-verify recipe
 *   excluded   — an extraction rule declined it (reported, never silent)
 *   FAIL       — checked and false, or claimed with nothing backing it
 * There is no sixth disposition, and in particular there is no "skipped".
 */

const TARGETS = new Set(["physical-device", "sim", "eas-store", "app-store", "external-service"]);
const ATTESTATION_FIELDS = [
  "id",
  "claim",
  "target",
  "evidence",
  "attestedBy",
  "attestedAt",
  "staleAfterDays",
  "reverifyWith",
];

/** Drop a leading range operator so `~57.0.9` and `57.0.9` compare equal. */
function normalizeVersion(raw) {
  return String(raw ?? "").trim().replace(/^[\^~]|^>=?|^<=?|^=/, "").trim();
}

/**
 * Does the version a document CLAIMS match the range package.json DECLARES?
 *
 * Deliberately strict on exact versions: a doc that says 57.0.9 while the
 * manifest says 57.1.0 is drift, and drift is the whole point. `2.x` is the
 * documented way to claim a major line only — it compares the segments the
 * claim actually pins and ignores the rest.
 */
function satisfiesVersion(claimed, declared) {
  const want = normalizeVersion(claimed);
  const have = normalizeVersion(declared);
  if (!want) return { ok: false, reason: "claim carries no version" };
  if (!have) return { ok: false, reason: "not declared in package.json" };
  if (!/^\d/.test(have)) {
    return { ok: false, reason: `manifest range is not a version (${have})` };
  }
  const wantParts = want.split(".");
  const haveParts = have.split(".");
  for (let i = 0; i < wantParts.length; i += 1) {
    if (wantParts[i] === "x" || wantParts[i] === "*") continue;
    if (wantParts[i] !== haveParts[i]) {
      return { ok: false, reason: `doc says ${claimed}, package.json says ${declared}` };
    }
  }
  return { ok: true, reason: null };
}

/** A registry entry covers a claim when kind and target/pattern both match. */
function registryEntryFor(claim, registry) {
  const key = claim.target ?? claim.pattern ?? claim.sha ?? claim.script ?? claim.name;
  return (registry?.entries ?? []).find((entry) => {
    if (entry.kind && entry.kind !== claim.kind) return false;
    if (entry.match !== key) return false;
    if (Array.isArray(entry.docs) && entry.docs.length > 0 && !entry.docs.includes(claim.file)) {
      return false;
    }
    return true;
  });
}

/**
 * Registry entries that no live claim matches any more.
 *
 * This is the `(a-registry-reverse)` rule from manifest-vs-code.test.ts, and it
 * is what stops the registry from becoming the place lies go to be forgotten: an
 * exemption outlives the claim it excused, the claim's document gets rewritten,
 * and the entry silently keeps excusing nothing.
 */
function orphanRegistryEntries(registry, claims) {
  return (registry?.entries ?? []).filter(
    (entry) => !claims.some((claim) => registryEntryFor(claim, { entries: [entry] })),
  );
}

/**
 * PR-ledger entries that are no longer needed: the PR now HAS a merge commit
 * (history was rewritten, or the entry was wrong), or no document cites it.
 * Same self-cleaning rule as the registry — an exemption outliving its reason
 * is an unchecked claim wearing a green badge.
 */
function obsoletePrLedgerEntries(ledger, claims, facts) {
  const cited = new Set(claims.filter((c) => c.kind === "pull-request").map((c) => c.number));
  return (ledger?.entries ?? []).flatMap((entry) => {
    if (!cited.has(entry.number)) {
      return [{ entry, reason: "no governed document cites this pull request" }];
    }
    if (facts.mergeCommitForPr?.(entry.number)) {
      return [{ entry, reason: "this pull request now has a merge commit; the ledger entry is redundant" }];
    }
    return [];
  });
}

/** Attestation ledger entries nothing in the governed docs points at. */
function orphanAttestations(ledger, claims) {
  const referenced = new Set(claims.filter((c) => c.kind === "attested").map((c) => c.id));
  return (ledger?.entries ?? []).filter((entry) => !referenced.has(entry.id));
}

/** Whole-number days between two ISO dates, floor. */
function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / 86400000);
}

/**
 * The script name in a `reverifyWith` recipe, or null when the recipe is a path.
 *
 * PACKAGE-MANAGER AWARE, because the two repositories that share this engine do
 * not agree: this one runs `npm run <script>`, the Capacitor repo runs
 * `pnpm <script>` with no `run`. An npm-only reading sent every pnpm recipe down
 * the file-exists branch, where `pnpm cap:build:native` is reported as a path
 * that does not exist — a false alarm produced by the engine, in the module
 * whose whole purpose is not producing them.
 */
function scriptNameIn(recipe, packageManager = "npm") {
  const npmish = /^(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)/.exec(recipe);
  if (npmish) return npmish[1];
  if (packageManager !== "npm") {
    // The manager name comes out of `verify.config.json` — a file — and is
    // interpolated into a pattern. A metacharacter in it would silently change
    // what that pattern means, and `pnpm(` would make `new RegExp` throw from
    // inside a pure decision function. Same rule this module applies to every
    // other file-sourced string: check the shape at the boundary.
    if (!/^[\w.-]+$/.test(packageManager)) {
      throw new Error(`packageManager in verify.config.json is not a plain name: ${packageManager}`);
    }
    // `pnpm typecheck` is a script; `pnpm exec tsx x.ts` and `pnpm install` are
    // CLI verbs, and reading those as scripts would demand a `package.json`
    // entry named "exec".
    const bare = new RegExp(`^${packageManager}\\s+([a-z][\\w:.-]*)`).exec(recipe);
    if (bare && !PACKAGE_MANAGER_VERBS.has(bare[1])) return bare[1];
  }
  return null;
}

/** CLI verbs that are never a script name, whichever manager is in use. */
const PACKAGE_MANAGER_VERBS = new Set([
  "add",
  "audit",
  "create",
  "dlx",
  "exec",
  "init",
  "install",
  "link",
  "list",
  "outdated",
  "pack",
  "publish",
  "remove",
  "run",
  "store",
  "update",
  "why",
  "x",
]);

/**
 * WHAT A DECLARED EVIDENCE GATE MAY BE — the two predicates layer 3 refuses on.
 *
 * They live in this module rather than in `scripts/verify-evidence.mjs` for the
 * reason the header gives: a pure predicate can be handed a deliberately bad
 * input and asked to refuse, and a predicate that lives inside a CLI cannot.
 * Both were unreachable from any test until they moved here.
 *
 * isReentrantGate: a gate that runs the test suite would run the suite that
 * reads this report, forever. The first version was one regex anchored on `test`
 * followed by a boundary, which let `npm run test:ci`, `npm run test:unit`,
 * `jest` and `npx jest` straight through — the four spellings most likely to be
 * written. Widening that regex to cover every runner prefix took it to 46 on
 * regex complexity, so the rule is expressed the way a reader would state it
 * instead: split the command and look at each TOKEN. A runner prefix does not
 * need enumerating at all, and `npm run release:preflight:offline` is untouched
 * because none of its tokens name a test runner. A leading `-` counts too:
 * `node --test` is the Node test runner, and its token is `--test`.
 *
 * The bias is deliberate. A false refusal is a loud configuration error a human
 * fixes in a minute; a false acceptance runs the suite that reads this report
 * and hangs the job.
 *
 * GATE_TOKEN: the command comes out of `verify.config.json`, a file, and reaches
 * a process spawn. `shell: false` already means nothing parses it as shell; this
 * is about refusing to spawn an unexamined file-sourced string at all.
 */
const REENTRANT_TOKEN = /^(?:t|test(?:[:-][\w:-]+)?|verify:[\w:-]+|jest|vitest)$/;

/**
 * Would running this declared gate re-enter the verifier?
 *
 * A leading dash run and a trailing `=value` are STRIPPED before the test rather
 * than encoded in the pattern: `node --test` is the Node test runner and its
 * token is `--test`, and folding that into the regex pushed it past the
 * complexity limit for no gain in what it recognises. Bare `t` is in the
 * alternation because it is npm's own alias for `test`.
 */
function isReentrantGate(command) {
  return String(command)
    .split(/\s+/)
    .some((token) => REENTRANT_TOKEN.test(token.replace(/^-+/, "").split("=")[0]));
}

const GATE_TOKEN = /^[\w./:@=-]+$/;

/**
 * Is one attestation still standing? `now` is a parameter, never `Date.now()`,
 * so the staleness rule is testable without waiting ninety days.
 */
function attestationVerdict(entry, now, { scriptExists, fileExists, packageManager } = {}) {
  const problems = [];
  for (const field of ATTESTATION_FIELDS) {
    if (entry?.[field] === undefined || entry?.[field] === null || entry?.[field] === "") {
      problems.push(`missing field: ${field}`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  if (!TARGETS.has(entry.target)) problems.push(`unknown target: ${entry.target}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.attestedAt)) {
    problems.push(`attestedAt is not YYYY-MM-DD: ${entry.attestedAt}`);
  }
  if (!Number.isInteger(entry.staleAfterDays) || entry.staleAfterDays <= 0) {
    problems.push(`staleAfterDays must be a positive integer: ${entry.staleAfterDays}`);
  }

  const age = daysBetween(entry.attestedAt, now);
  if (age === null) problems.push("attestedAt could not be parsed");
  else if (age < 0) problems.push(`attestedAt is in the future (${entry.attestedAt})`);
  else if (Number.isInteger(entry.staleAfterDays) && age > entry.staleAfterDays) {
    problems.push(`stale: attested ${age}d ago, budget ${entry.staleAfterDays}d — re-run: ${entry.reverifyWith}`);
  }

  // A recipe nobody can follow is not a recipe. `reverifyWith` is either a
  // script this manifest defines or a document that exists.
  const recipe = String(entry.reverifyWith ?? "");
  const asScript = scriptNameIn(recipe, packageManager);
  if (asScript !== null && scriptExists && !scriptExists(asScript)) {
    problems.push(`reverifyWith names a script package.json does not define: ${asScript}`);
  } else if (asScript === null && fileExists && !fileExists(recipe.split("#")[0])) {
    problems.push(`reverifyWith names a path that does not exist: ${recipe}`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Does the recorded evidence run back the gates the config declares?
 *
 * `enforce` is false outside CI on purpose. The report is written by
 * `npm run verify:evidence`, and demanding a fresh one from every local
 * `npm test` would put the suite permanently red on any working tree a
 * developer is mid-edit on — a false alarm aimed at normal work.
 */
function evidenceVerdict({ report, gates, treeHash, enforce }) {
  if (!report) {
    return enforce
      ? { ok: false, problems: ["no evidence report — run `npm run verify:evidence`"] }
      : { ok: true, problems: [], note: "no evidence report (not enforced outside CI)" };
  }
  const problems = [];
  // A run taken over a dirty working copy proves something about code that was
  // never committed. Under enforcement that is not evidence.
  if (report.dirty === true) {
    problems.push("evidence was recorded over a DIRTY working copy — re-run on a clean tree");
  }
  if (report.treeHash !== treeHash) {
    problems.push(
      `evidence is for tree ${String(report.treeHash).slice(0, 12)}, working tree is ${String(treeHash).slice(0, 12)}`,
    );
  }
  for (const gate of gates ?? []) {
    const result = (report.results ?? []).find((r) => r.id === gate.id);
    if (!result) problems.push(`gate never ran: ${gate.id} (${gate.command})`);
    else if (result.exitCode !== 0) {
      problems.push(`gate failed: ${gate.id} exited ${result.exitCode}`);
    }
  }
  if (!enforce && problems.length > 0) {
    return { ok: true, problems: [], note: `evidence not current (${problems[0]})` };
  }
  return { ok: problems.length === 0, problems };
}

/**
 * One rule per claim kind.
 *
 * A LOOKUP, NOT A SWITCH. The switch this replaced carried seventeen branches in
 * one function and scored 51 on cognitive complexity against a limit of 15,
 * which is a quality-gate failure on both repositories. The branches never
 * interacted — each reads its own claim and returns its own disposition — so
 * splitting them costs nothing and makes each rule separately readable and
 * separately testable. A `Map` rather than an object literal: a claim kind is
 * scanned out of a Markdown document, and `RULES["constructor"]` on an object
 * would find something on `Object.prototype` and call it.
 */

function pathRule(claim, facts) {
  if (claim.kind === "dir" ? facts.dirExists(claim.target) : facts.fileExists(claim.target)) {
    return { disposition: "verified" };
  }
  if (facts.suffixMatches(claim.target) > 0) {
    return { disposition: "verified", detail: "resolved as a path suffix" };
  }
  return { disposition: "fail", detail: `${claim.kind} does not exist: ${claim.target}` };
}

function absentDirRule(claim, facts) {
  return facts.dirExists(claim.target)
    ? { disposition: "fail", detail: `claims ${claim.target}/ does not exist, but it does` }
    : { disposition: "verified" };
}

function absentPathRule(claim, facts) {
  return facts.fileExists(claim.target)
    ? { disposition: "fail", detail: `claims ${claim.target} does not exist, but it does` }
    : { disposition: "verified" };
}

function packageRule(claim, facts) {
  return facts.dependencyRange(claim.name) !== null
    ? { disposition: "verified" }
    : { disposition: "fail", detail: `package.json declares no dependency "${claim.name}"` };
}

function pathLinesRule(claim, facts) {
  if (!facts.fileExists(claim.target)) {
    if (facts.suffixMatches(claim.target) > 0) {
      // The file exists somewhere; its line numbers are not checkable without
      // knowing WHICH file the shorthand meant.
      return { disposition: "verified", detail: "resolved as a path suffix (line range unchecked)" };
    }
    return { disposition: "fail", detail: `file does not exist: ${claim.target}` };
  }
  const total = facts.lineCount(claim.target);
  if (claim.from < 1 || claim.to < claim.from) {
    return { disposition: "fail", detail: `line range is malformed: ${claim.from}-${claim.to}` };
  }
  // A file that stats but cannot be read is not a verified line range — it is a
  // range this run could not check. `null` used to skip the comparison and fall
  // through to `verified`, which is the same silent pass `grepCount` was changed
  // to refuse one commit ago; the two rules now agree.
  if (total === null) {
    return {
      disposition: "fail",
      detail: `cannot read ${claim.target} to check that it has line ${claim.to}`,
    };
  }
  if (claim.to > total) {
    return {
      disposition: "fail",
      detail: `cites lines ${claim.from}-${claim.to} but ${claim.target} has ${total}`,
    };
  }
  return { disposition: "verified" };
}

function globRule(claim, facts) {
  return facts.globMatches(claim.pattern) > 0
    ? { disposition: "verified" }
    : { disposition: "fail", detail: `glob matches nothing: ${claim.pattern}` };
}

function dependencyRule(claim, facts) {
  const verdict = satisfiesVersion(claim.range, facts.dependencyRange(claim.name));
  return verdict.ok
    ? { disposition: "verified" }
    : { disposition: "fail", detail: `${claim.name}: ${verdict.reason}` };
}

function scriptRule(claim, facts) {
  return facts.scriptExists(claim.script)
    ? { disposition: "verified" }
    : { disposition: "fail", detail: `package.json defines no script "${claim.script}"` };
}

function absenceRule(claim, facts) {
  const hits = facts.grepCount(claim.pattern, claim.scope);
  if (hits === 0) return { disposition: "verified" };
  // NaN means the scope could not be read at all. "Absent from a file this run
  // could not open" is not a verified absence, and it is not the same failure as
  // finding the pattern — so it does not borrow that message.
  if (Number.isNaN(hits)) {
    return { disposition: "fail", detail: `cannot read scope "${claim.scope}" to check that "${claim.pattern}" is absent` };
  }
  return {
    disposition: "fail",
    detail: `claims "${claim.pattern}" is absent from ${claim.scope}, found ${hits} occurrence(s)`,
  };
}

function commitRule(claim, facts, context) {
  if (!facts.commitExists(claim.sha)) {
    return { disposition: "fail", detail: `no such commit in this repository: ${claim.sha}` };
  }
  return facts.commitIsAncestorOfDefault(claim.sha)
    ? { disposition: "verified" }
    : {
        disposition: "fail",
        detail: `commit ${claim.sha} exists but is not an ancestor of ${context.defaultBranch ?? "main"}`,
      };
}

function crossRepoPrRule(claim) {
  return {
    disposition: "registered",
    detail: `${claim.repo} PR #${claim.number} — another repository's history, not reachable from here`,
  };
}

function pullRequestRule(claim, facts, context) {
  if (facts.mergeCommitForPr(claim.number)) return { disposition: "verified" };

  // A REBASE- OR SQUASH-MERGED PR LEAVES NO MERGE COMMIT. This repo has at least
  // one (#2, rebase-merged 2026-08-04, head 7e135eb) and reporting it as never
  // landed would be a false alarm against a true sentence. The ledger supplies
  // only the IDENTIFIER a human read off the API; the proof stays local and
  // unfakeable — that head commit must be an ancestor of the default branch. A
  // wrong sha, or a PR that was closed unmerged, fails here exactly as it should.
  const ledgerEntry = (context.prLedger?.entries ?? []).find((e) => e.number === claim.number);
  if (!ledgerEntry) {
    return {
      disposition: "fail",
      detail:
        `no merge commit for #${claim.number}. If it was rebase- or squash-merged, ` +
        `add its head sha to ${context.prLedgerPath ?? "docs/pr-ledger.json"}`,
    };
  }
  if (!facts.commitExists(ledgerEntry.headSha)) {
    return {
      disposition: "fail",
      detail: `pr-ledger names head ${ledgerEntry.headSha} for #${claim.number}; no such commit`,
    };
  }
  const head = String(ledgerEntry.headSha).slice(0, 7);
  return facts.commitIsAncestorOfDefault(ledgerEntry.headSha)
    ? { disposition: "verified", detail: `rebase/squash merge, head ${head} on ${context.defaultBranch}` }
    : {
        disposition: "fail",
        detail: `#${claim.number}: ledger head ${head} is not an ancestor of ${context.defaultBranch} — it did not land`,
      };
}

function landingUncitedRule() {
  return {
    disposition: "fail",
    detail: "landing claim cites neither a PR number nor a commit sha — say what landed",
  };
}

function attestedRule(claim, facts, context) {
  const entry = (context.attestations?.entries ?? []).find((e) => e.id === claim.id);
  if (!entry) {
    return { disposition: "fail", detail: `no attestation with id "${claim.id}" in the ledger` };
  }
  const verdict = attestationVerdict(entry, context.now, { ...facts, packageManager: context.packageManager });
  return verdict.ok
    ? { disposition: "attested", detail: `${entry.target}, ${entry.attestedAt}` }
    : { disposition: "fail", detail: `attestation "${entry.id}": ${verdict.problems.join("; ")}` };
}

function greenRule(claim, _facts, context) {
  const gate = (context.gates ?? []).find((g) => g.command === claim.command || g.id === claim.command);
  return gate
    ? { disposition: "verified", detail: `backed by evidence gate ${gate.id}` }
    : {
        disposition: "fail",
        detail: `claims "${claim.command}" is green, but it is not a declared evidence gate`,
      };
}

function markerUnknownRule(claim) {
  return { disposition: "fail", detail: `unknown vt-claim verb: ${claim.verb}` };
}

/**
 * An odd number of `~~` runs blanks every line after it, and the claims on those
 * lines vanish with no failure and no exclusion — the silent skip this engine
 * refuses to have. The scanner reports the opening position; this makes it a
 * failure with the fix in it.
 */
function unterminatedStrikethroughRule() {
  return {
    disposition: "fail",
    detail:
      "unterminated ~~strikethrough~~ run: every line after this one was read as retracted, " +
      "so its claims were never checked — close the run",
  };
}

const RULES = new Map([
  ["path", pathRule],
  ["dir", pathRule],
  ["absent-dir", absentDirRule],
  ["absent-path", absentPathRule],
  ["package", packageRule],
  ["path-lines", pathLinesRule],
  ["glob", globRule],
  ["dependency", dependencyRule],
  ["script", scriptRule],
  ["absence", absenceRule],
  ["commit", commitRule],
  ["pull-request-cross-repo", crossRepoPrRule],
  ["pull-request", pullRequestRule],
  ["landing-uncited", landingUncitedRule],
  ["attested", attestedRule],
  ["green", greenRule],
  ["marker-unknown", markerUnknownRule],
  ["strikethrough-unterminated", unterminatedStrikethroughRule],
]);

/**
 * Apply the RULE for one claim, ignoring registry and cross-repo dispositions.
 * Separated from `decide` so the wrapper can ask "would this verify on its own?"
 * — which is how an obsolete exemption is caught (see `decide`).
 */
function evaluateRule(claim, facts, context = {}) {
  const rule = RULES.get(claim.kind);
  if (!rule) return { disposition: "fail", detail: `no rule for claim kind "${claim.kind}"` };
  return rule(claim, facts, context);
}

/**
 * Resolve ONE claim, applying the declared exemptions on top of the rule.
 *
 * AN EXEMPTION THAT IS NO LONGER NEEDED IS A FAILURE, NOT A PASS. If the
 * underlying rule would verify on its own, the registry entry (or the
 * cross-repo prefix) is excusing nothing and gets deleted. Without this the
 * registry becomes the place claims go to stop being checked: a planned file
 * gets built, the entry keeps "excusing" it, and the check is gone forever with
 * everything green. It is the same argument `(a-registry-reverse)` makes in
 * manifest-vs-code.test.ts, extended from "entry matches no claim" to "entry
 * matches a claim that no longer needs it".
 */
function decide(claim, facts, context = {}) {
  const verdict = evaluateRule(claim, facts, context);
  const entry = registryEntryFor(claim, context.registry);

  if (entry) {
    return verdict.disposition === "verified"
      ? {
          disposition: "fail",
          detail: `registry entry "${entry.match}" is obsolete — this claim now verifies on its own; delete the entry`,
        }
      : { disposition: "registered", detail: entry.reason };
  }

  if (verdict.disposition === "fail") {
    const target = claim.target ?? claim.name ?? "";
    const crossRepo = (context.crossRepoPrefixes ?? []).find(
      (p) => target.startsWith(p.prefix) || `${target}/`.startsWith(p.prefix),
    );
    if (crossRepo) return { disposition: "registered", detail: crossRepo.reason };
  }

  return verdict;
}

module.exports = {
  ATTESTATION_FIELDS,
  GATE_TOKEN,
  REENTRANT_TOKEN,
  RULES,
  isReentrantGate,
  TARGETS,
  attestationVerdict,
  daysBetween,
  decide,
  evaluateRule,
  evidenceVerdict,
  normalizeVersion,
  obsoletePrLedgerEntries,
  orphanAttestations,
  orphanRegistryEntries,
  registryEntryFor,
  satisfiesVersion,
  scriptNameIn,
};
