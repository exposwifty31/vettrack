/**
 * Claim DECISIONS, as pure functions.
 *
 * Every rule here takes plain data and returns plain data — no fs, no network,
 * no process.exit. That is the same split `scripts/release-config/checks.js`
 * uses, and it exists for the same reason: a check that has only ever seen good
 * input is untested. Because these are pure, `src/__tests__/claims-ledger.test.ts`
 * can hand each one a deliberately FALSE claim and assert that it refuses —
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
 * Is one attestation still standing? `now` is a parameter, never `Date.now()`,
 * so the staleness rule is testable without waiting ninety days.
 */
function attestationVerdict(entry, now, { scriptExists, fileExists } = {}) {
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
  const asScript = /^npm run ([\w:-]+)/.exec(recipe);
  if (asScript && scriptExists && !scriptExists(asScript[1])) {
    problems.push(`reverifyWith names a script package.json does not define: ${asScript[1]}`);
  } else if (!asScript && fileExists && !fileExists(recipe.split("#")[0])) {
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
 * Apply the RULE for one claim, ignoring registry and cross-repo dispositions.
 * Separated from `decide` so the wrapper can ask "would this verify on its own?"
 * — which is how an obsolete exemption is caught (see `decide`).
 */
function evaluateRule(claim, facts, context = {}) {
  switch (claim.kind) {
    case "path":
    case "dir": {
      if (claim.kind === "dir" ? facts.dirExists(claim.target) : facts.fileExists(claim.target)) {
        return { disposition: "verified" };
      }
      if (facts.suffixMatches(claim.target) > 0) {
        return { disposition: "verified", detail: "resolved as a path suffix" };
      }
      return { disposition: "fail", detail: `${claim.kind} does not exist: ${claim.target}` };
    }

    case "absent-dir": {
      return facts.dirExists(claim.target)
        ? { disposition: "fail", detail: `claims ${claim.target}/ does not exist, but it does` }
        : { disposition: "verified" };
    }

    case "absent-path": {
      return facts.fileExists(claim.target)
        ? {
            disposition: "fail",
            detail: `claims ${claim.target} does not exist, but it does`,
          }
        : { disposition: "verified" };
    }

    case "package": {
      return facts.dependencyRange(claim.name) !== null
        ? { disposition: "verified" }
        : { disposition: "fail", detail: `package.json declares no dependency "${claim.name}"` };
    }

    case "path-lines": {
      if (!facts.fileExists(claim.target)) {
        if (facts.suffixMatches(claim.target) > 0) {
          // The file exists somewhere; its line numbers are not checkable
          // without knowing WHICH file the shorthand meant.
          return { disposition: "verified", detail: "resolved as a path suffix (line range unchecked)" };
        }
        return { disposition: "fail", detail: `file does not exist: ${claim.target}` };
      }
      const total = facts.lineCount(claim.target);
      if (claim.from < 1 || claim.to < claim.from) {
        return { disposition: "fail", detail: `line range is malformed: ${claim.from}-${claim.to}` };
      }
      if (total !== null && claim.to > total) {
        return {
          disposition: "fail",
          detail: `cites lines ${claim.from}-${claim.to} but ${claim.target} has ${total}`,
        };
      }
      return { disposition: "verified" };
    }

    case "glob": {
      const hits = facts.globMatches(claim.pattern);
      return hits > 0
        ? { disposition: "verified" }
        : { disposition: "fail", detail: `glob matches nothing: ${claim.pattern}` };
    }

    case "dependency": {
      const declared = facts.dependencyRange(claim.name);
      const verdict = satisfiesVersion(claim.range, declared);
      return verdict.ok
        ? { disposition: "verified" }
        : { disposition: "fail", detail: `${claim.name}: ${verdict.reason}` };
    }

    case "script": {
      return facts.scriptExists(claim.script)
        ? { disposition: "verified" }
        : { disposition: "fail", detail: `package.json defines no script "${claim.script}"` };
    }

    case "absence": {
      const hits = facts.grepCount(claim.pattern, claim.scope);
      return hits === 0
        ? { disposition: "verified" }
        : {
            disposition: "fail",
            detail: `claims "${claim.pattern}" is absent from ${claim.scope}, found ${hits} occurrence(s)`,
          };
    }

    case "commit": {
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

    case "pull-request-cross-repo":
      return {
        disposition: "registered",
        detail: `${claim.repo} PR #${claim.number} — another repository's history, not reachable from here`,
      };

    case "pull-request": {
      if (facts.mergeCommitForPr(claim.number)) return { disposition: "verified" };

      // A REBASE- OR SQUASH-MERGED PR LEAVES NO MERGE COMMIT. This repo has at
      // least one (#2, rebase-merged 2026-08-04, head 7e135eb) and reporting it
      // as never landed would be a false alarm against a true sentence. The
      // ledger supplies only the IDENTIFIER a human read off the API; the proof
      // stays local and unfakeable — that head commit must be an ancestor of the
      // default branch. A wrong sha, or a PR that was closed unmerged, fails
      // here exactly as it should.
      const ledgerEntry = (context.prLedger?.entries ?? []).find((e) => e.number === claim.number);
      if (ledgerEntry) {
        if (!facts.commitExists(ledgerEntry.headSha)) {
          return {
            disposition: "fail",
            detail: `pr-ledger names head ${ledgerEntry.headSha} for #${claim.number}; no such commit`,
          };
        }
        return facts.commitIsAncestorOfDefault(ledgerEntry.headSha)
          ? { disposition: "verified", detail: `rebase/squash merge, head ${ledgerEntry.headSha.slice(0, 7)} on ${context.defaultBranch}` }
          : {
              disposition: "fail",
              detail: `#${claim.number}: ledger head ${ledgerEntry.headSha.slice(0, 7)} is not an ancestor of ${context.defaultBranch} — it did not land`,
            };
      }

      return {
        disposition: "fail",
        detail:
          `no merge commit for #${claim.number}. If it was rebase- or squash-merged, ` +
          `add its head sha to ${context.prLedgerPath ?? "docs/pr-ledger.json"}`,
      };
    }

    case "landing-uncited":
      return {
        disposition: "fail",
        detail: "landing claim cites neither a PR number nor a commit sha — say what landed",
      };

    case "attested": {
      const entry = (context.attestations?.entries ?? []).find((e) => e.id === claim.id);
      if (!entry) {
        return { disposition: "fail", detail: `no attestation with id "${claim.id}" in the ledger` };
      }
      const verdict = attestationVerdict(entry, context.now, facts);
      return verdict.ok
        ? { disposition: "attested", detail: `${entry.target}, ${entry.attestedAt}` }
        : { disposition: "fail", detail: `attestation "${entry.id}": ${verdict.problems.join("; ")}` };
    }

    case "green": {
      const gate = (context.gates ?? []).find((g) => g.command === claim.command || g.id === claim.command);
      return gate
        ? { disposition: "verified", detail: `backed by evidence gate ${gate.id}` }
        : {
            disposition: "fail",
            detail: `claims "${claim.command}" is green, but it is not a declared evidence gate`,
          };
    }

    case "marker-unknown":
      return { disposition: "fail", detail: `unknown vt-claim verb: ${claim.verb}` };

    default:
      return { disposition: "fail", detail: `no rule for claim kind "${claim.kind}"` };
  }
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
};
