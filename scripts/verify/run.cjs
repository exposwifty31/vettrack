/**
 * Claim verification — the engine, as one function over the repository.
 *
 * WHY THIS IS COMMONJS AND THE CLI IS NOT
 * Two consumers need the same verdict and must never disagree: the CLI
 * (`scripts/verify-claims.mjs`, for humans and CI) and the jest wrapper
 * (`src/__tests__/claims-ledger.test.ts`, which is what actually blocks a PR).
 * `env-contract.js` already names the failure mode of letting them diverge —
 * "both halves green while asserting different things" — so the decision lives
 * here, once, in the module format jest can require under the repo's
 * `moduleResolution: bundler` tsconfig.
 *
 * WHAT IT CHECKS is documented on the CLI; this file is the mechanism.
 */

const fs = require("node:fs");
const path = require("node:path");

const scan = require("./scan.cjs");
const rules = require("./claims.cjs");
const { createFacts } = require("./facts.cjs");
const { createGitFacts } = require("./git-facts.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * @param {{ root?: string, now?: string, enforceEvidence?: boolean }} options
 *   `now` is injected rather than read from the clock so the attestation
 *   staleness rule is testable without waiting ninety days.
 */
function verify({ root = REPO_ROOT, now = new Date().toISOString().slice(0, 10), enforceEvidence } = {}) {
  const ROOT = root;
  // Layer 3 binds only where the evidence report is guaranteed fresh, and that
  // is narrower than "in CI": a sharded test job runs on a different runner from
  // the job that produced the report, so a bare CI check would demand evidence
  // that job could not have. The signal is therefore explicit — the one CI step
  // that runs `verify:evidence` first sets VT_ENFORCE_EVIDENCE=1. Everywhere
  // else layer 3 reports a note, because failing a developer's local run for not
  // having run the gates is a false alarm aimed at normal work.
  const ENFORCE_EVIDENCE = enforceEvidence ?? process.env.VT_ENFORCE_EVIDENCE === "1";
  const readJson = (relative, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
    } catch {
      return fallback;
    }
  };

  const config = readJson("verify.config.json", null);
  if (!config) throw new Error("verify.config.json is missing or unreadable");

  const registry = readJson(config.registry, { entries: [] });
  const attestations = readJson(config.attestations, { entries: [] });
  const prLedger = readJson(config.prLedger, { entries: [] });
  const evidence = readJson(config.evidenceReport, null);

  const facts = createFacts(ROOT, config);
  const git = createGitFacts(ROOT, config.defaultBranch);

  const claims = [];
  const excluded = [];
  const failures = [];
  const notes = [];

  for (const file of config.governedDocs) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) {
      failures.push({ file, line: 0, kind: "governed-doc", detail: "governed document does not exist" });
      continue;
    }
    const found = scan.extractFromMarkdown(fs.readFileSync(absolute, "utf8"), { file }, config);

    // An append-only document is scanned in FULL (the fence/retraction state
    // machine needs the whole text to be correct) and then filtered to the lines
    // this branch added. Filtering the text instead would leave the scanner
    // reading fenced blocks as prose.
    if ((config.appendOnlyDocs ?? []).includes(file)) {
      const added = git.facts?.addedLines(file);
      if (added === null || added === undefined) {
        failures.push({
          file,
          line: 0,
          kind: "append-only-undiffable",
          detail: `cannot diff against ${config.defaultBranch} — new entries in this append-only document cannot be checked`,
        });
      } else {
        claims.push(...found.claims.filter((claim) => added.has(claim.line)));
        excluded.push(...found.excluded.filter((item) => added.has(item.line)));
      }
      continue;
    }

    claims.push(...found.claims);
    excluded.push(...found.excluded);
  }

  // GUARD THE GUARD. A scan that found nothing passes every assertion below for
  // the wrong reason. `manifest-vs-code.test.ts` carries the same check on its
  // own source walk, and for the same reason: an empty match set makes an
  // assertion vacuously true.
  if (claims.length === 0) {
    failures.push({
      file: "verify.config.json",
      line: 0,
      kind: "vacuous-scan",
      detail: `scanned ${config.governedDocs.length} document(s) and extracted no claims — the scanner or the scope is broken`,
    });
  }

  // Layer 2 cannot run on a shallow clone. Report it as a failure of the
  // CONFIGURATION rather than of the claims, and never as silence.
  const needsGit = claims.some((c) => c.kind === "commit" || c.kind === "pull-request");
  if (needsGit && !git.ready) {
    for (const problem of git.problems) {
      failures.push({ file: ".github/workflows/ci.yml", line: 0, kind: "git-unavailable", detail: problem });
    }
  }

  const combinedFacts = { ...facts, ...(git.facts ?? {}) };
  const context = {
    registry,
    attestations,
    gates: config.evidenceGates,
    crossRepoPrefixes: config.crossRepoPrefixes,
    prLedger,
    prLedgerPath: config.prLedger,
    defaultBranch: config.defaultBranch,
    now,
  };

  const byDisposition = { verified: 0, registered: 0, attested: 0, fail: 0 };
  const decided = [];
  for (const claim of claims) {
    if ((claim.kind === "commit" || claim.kind === "pull-request") && !git.ready) continue;
    const verdict = rules.decide(claim, combinedFacts, context);
    byDisposition[verdict.disposition] = (byDisposition[verdict.disposition] ?? 0) + 1;
    decided.push({ ...claim, ...verdict });
    if (verdict.disposition === "fail") {
      failures.push({ file: claim.file, line: claim.line, kind: claim.kind, detail: verdict.detail, raw: claim.raw });
    }
  }

  // Reverse checks: a registry entry or an attestation that no live claim
  // reaches is an exemption still excusing something that no longer exists.
  for (const orphan of rules.orphanRegistryEntries(registry, claims)) {
    failures.push({
      file: config.registry,
      line: 0,
      kind: "registry-orphan",
      detail: `entry "${orphan.match}" (${orphan.kind ?? "any"}) matches no claim in any governed document — delete it`,
    });
  }
  for (const { entry, reason } of rules.obsoletePrLedgerEntries(prLedger, claims, combinedFacts)) {
    failures.push({
      file: config.prLedger,
      line: 0,
      kind: "pr-ledger-obsolete",
      detail: `entry for #${entry.number}: ${reason} — delete it`,
    });
  }
  for (const orphan of rules.orphanAttestations(attestations, claims)) {
    failures.push({
      file: config.attestations,
      line: 0,
      kind: "attestation-orphan",
      detail: `attestation "${orphan.id}" is referenced by no governed document — delete it or point a document at it`,
    });
  }

  // Layer 3: the declared gates must have run, and passed, on this tree.
  const evidenceResult = rules.evidenceVerdict({
    report: evidence,
    gates: config.evidenceGates,
    treeHash: git.facts?.treeHash() ?? null,
    enforce: ENFORCE_EVIDENCE,
  });
  if (!evidenceResult.ok) {
    for (const problem of evidenceResult.problems) {
      failures.push({ file: config.evidenceReport, line: 0, kind: "evidence", detail: problem });
    }
  } else if (evidenceResult.note) {
    notes.push(evidenceResult.note);
  }

  return {
    ok: failures.length === 0,
    // WHICH REF LAYER 2 MEASURED AGAINST, always reported. A stale origin/main
    // changes the verdict silently: pointed at a ref 19 merges behind, this
    // repo's docs produced 11 failures, every one of them a true sentence about
    // work that HAD landed. The check was right and the ground truth was wrong,
    // and nothing on screen said so. Naming the ref and its head makes that
    // visible in one line instead of costing an investigation.
    ref: git.ref,
    refHead: git.ref && git.facts ? git.facts.refHead() : null,
    counts: {
      claims: claims.length,
      excluded: excluded.length,
      ...byDisposition,
      failures: failures.length,
    },
    failures,
    notes,
    excluded,
    claims: decided,
    evidenceEnforced: ENFORCE_EVIDENCE,
  };
}


module.exports = { verify, REPO_ROOT };
