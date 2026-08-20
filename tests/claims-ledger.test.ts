/**
 * The claim gate — proved by REFUSAL, not by passing.
 *
 * WHAT THIS BLOCKS
 * `pnpm verify:claims` makes the repository's own prose self-checking:
 * every path, line range, dependency version, npm script, declared absence,
 * landing citation and device attestation in a governed document is resolved
 * against the tree, against git, against a recorded evidence run, or against a
 * written attestation. This suite is what makes that binding — it runs inside
 * the existing `npm test` job, so a document that starts lying fails CI.
 *
 * WHY THE RED CASES ARE THE POINT
 * A verifier that has only ever seen a true document is untested, and a gate
 * nobody has watched close is a gate nobody should trust. Every block below
 * leads with a FABRICATED FALSE claim and asserts the rule refuses it — a path
 * that is not there, a version that drifted, a commit that never reached main,
 * an attestation that has gone stale, an evidence report for a different tree.
 * Only then does it assert the healthy case. That is the same shape
 * `tests/board-frozen-surface-guard.test.ts` and the i18n source guards use.
 *
 * WHY THE PURE/IMPURE SPLIT MATTERS HERE
 * `scripts/verify/claims.js` and `scripts/verify/scan.js` take plain data and
 * return plain data, so a false input can be handed to them directly. The
 * repository-wide run at the bottom is the same `verify()` the CLI calls — one
 * implementation, so the command a human runs and the gate that blocks a PR can
 * never disagree (the failure mode `env-contract.js` already names).
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type Disposition = "verified" | "registered" | "attested" | "fail";
type Verdict = { disposition: Disposition; detail?: string };
type Claim = Record<string, unknown> & { kind: string };

type Rules = {
  decide(claim: Claim, facts: unknown, context?: unknown): Verdict;
  evaluateRule(claim: Claim, facts: unknown, context?: unknown): Verdict;
  satisfiesVersion(claimed: string, declared: string | null): { ok: boolean; reason: string | null };
  attestationVerdict(
    entry: unknown,
    now: string,
    helpers?: { scriptExists?(name: string): boolean; fileExists?(path: string): boolean },
  ): { ok: boolean; problems: string[] };
  evidenceVerdict(input: {
    report: unknown;
    gates: { id: string; command: string }[];
    treeHash: string | null;
    enforce: boolean;
  }): { ok: boolean; problems: string[]; note?: string };
  orphanRegistryEntries(registry: unknown, claims: Claim[]): { match: string }[];
  orphanAttestations(ledger: unknown, claims: Claim[]): { id: string }[];
  obsoletePrLedgerEntries(
    ledger: unknown,
    claims: Claim[],
    facts: unknown,
  ): { entry: { number: number }; reason: string }[];
};

type Scan = {
  extractFromMarkdown(
    text: string,
    where: { file: string },
    policy: unknown,
  ): { claims: Claim[]; excluded: { reason: string }[] };
};

type VerifyResult = {
  ok: boolean;
  counts: Record<string, number>;
  failures: { file: string; line: number; kind: string; detail: string }[];
  claims: (Claim & Verdict)[];
};

const rules = require("../scripts/verify/claims.cjs") as Rules;
const scan = require("../scripts/verify/scan.cjs") as Scan;
const { verify } = require("../scripts/verify/run.cjs") as {
  verify(options?: { now?: string; enforceEvidence?: boolean }): VerifyResult;
};

/** A fact provider that answers exactly what a case needs and nothing else. */
function factsWith(overrides: Record<string, unknown> = {}) {
  return {
    fileExists: () => false,
    dirExists: () => false,
    lineCount: () => null,
    suffixMatches: () => 0,
    globMatches: () => 0,
    dependencyRange: () => null,
    scriptExists: () => false,
    grepCount: () => 0,
    commitExists: () => false,
    commitIsAncestorOfDefault: () => false,
    mergeCommitForPr: () => null,
    ...overrides,
  };
}

const POLICY = {
  packageManager: "pnpm",
  packageManagerBuiltins: ["install", "exec", "add", "run"],
  ignoredPathPrefixes: [],
  dependencyAliases: {
    "React Native": "react-native",
    React: "react",
    "Gesture Handler": "react-native-gesture-handler",
  },
  statusDocs: ["PLAN.md"],
  crossRepoNames: ["vettrack"],
  treeBlocks: [{ file: "PLAN.md", afterHeading: "## Structure" }],
};

const extract = (markdown: string, file = "PLAN.md") =>
  scan.extractFromMarkdown(markdown, { file }, POLICY).claims;

// ---------------------------------------------------------------------------
// Layer 1 — EXISTS
// ---------------------------------------------------------------------------

describe("layer 1 — what is written exists", () => {
  it("refuses a path that is not in the tree, and accepts one that is", () => {
    const claim = { kind: "path", target: "src/does-not-exist.ts" };
    expect(rules.evaluateRule(claim, factsWith()).disposition).toBe("fail");
    expect(
      rules.evaluateRule(claim, factsWith({ fileExists: () => true })).disposition,
    ).toBe("verified");
  });

  it("accepts a SHORTHAND reference that resolves as a path suffix", () => {
    // `api.ts` and `components/autopilot/useProposalDecisions.ts` are ordinary,
    // correct ways to name a file that is really there. Demanding a
    // root-relative path would fail on accurate prose.
    const claim = { kind: "path", target: "api.ts", bare: true };
    expect(
      rules.evaluateRule(claim, factsWith({ suffixMatches: () => 1 })).disposition,
    ).toBe("verified");
    expect(rules.evaluateRule(claim, factsWith()).disposition).toBe("fail");
  });

  it("refuses a line range that runs past the end of the file", () => {
    const facts = factsWith({ fileExists: () => true, lineCount: () => 24 });
    const verdict = rules.evaluateRule(
      { kind: "path-lines", target: "src/lib/haptics.ts", from: 34, to: 34 },
      facts,
    );
    expect(verdict.disposition).toBe("fail");
    expect(verdict.detail).toContain("has 24");
    expect(
      rules.evaluateRule({ kind: "path-lines", target: "src/lib/haptics.ts", from: 1, to: 24 }, facts)
        .disposition,
    ).toBe("verified");
  });

  it("refuses a dependency version the manifest does not carry", () => {
    // The defect class, from the sibling RN repo's first run: a frozen-stack
    // line said "Gesture Handler 3.x" while package.json carried ~2.32.0.
    expect(rules.satisfiesVersion("3.x", "~2.32.0").ok).toBe(false);
    expect(rules.satisfiesVersion("2.x", "~2.32.0").ok).toBe(true);
    expect(rules.satisfiesVersion("0.86.2", "0.87.0").ok).toBe(false);
    expect(rules.satisfiesVersion("~57.0.9", "~57.0.9").ok).toBe(true);
    // A `file:` range is not a version and must not be read as one.
    expect(rules.satisfiesVersion("1.0.0", "file:.vendor/vettrack/shared").ok).toBe(false);
  });

  it("refuses an ABSENCE claim the dependency set contradicts", () => {
    // The shape of the defect this gate exists for: a document asserts a
    // dependency is absent, the dependency comes back, and nothing notices.
    const claim = { kind: "absence", pattern: "sqlite", scope: "deps" };
    const verdict = rules.evaluateRule(claim, factsWith({ grepCount: () => 1 }));
    expect(verdict.disposition).toBe("fail");
    expect(verdict.detail).toContain("found 1 occurrence");
    expect(rules.evaluateRule(claim, factsWith({ grepCount: () => 0 })).disposition).toBe("verified");
  });

  it("refuses an absence claim whose SCOPE does not exist", () => {
    // NaN, not 0: "absent from a file that is not there" must not be true.
    expect(
      rules.evaluateRule(
        { kind: "absence", pattern: "x", scope: "no-such-file.json" },
        factsWith({ grepCount: () => Number.NaN }),
      ).disposition,
    ).toBe("fail");
  });

  it("refuses a documented package script the manifest does not define", () => {
    const claim = { kind: "script", script: "verify:claims" };
    expect(rules.evaluateRule(claim, factsWith()).disposition).toBe("fail");
    expect(
      rules.evaluateRule(claim, factsWith({ scriptExists: () => true })).disposition,
    ).toBe("verified");
  });

  it("refuses a package reference the manifest does not declare", () => {
    const claim = { kind: "package", name: "@clerk/clerk-expo" };
    expect(rules.evaluateRule(claim, factsWith()).disposition).toBe("fail");
    expect(
      rules.evaluateRule(claim, factsWith({ dependencyRange: () => "^4.5.0" })).disposition,
    ).toBe("verified");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — EXECUTED
// ---------------------------------------------------------------------------

describe("layer 2 — what is written as done was in fact done", () => {
  const context = { defaultBranch: "main" };

  it("refuses a commit that does not exist, and one that never reached main", () => {
    expect(
      rules.evaluateRule({ kind: "commit", sha: "deadbee" }, factsWith(), context).detail,
    ).toContain("no such commit");

    const orphaned = rules.evaluateRule(
      { kind: "commit", sha: "deadbee" },
      factsWith({ commitExists: () => true }),
      context,
    );
    expect(orphaned.disposition).toBe("fail");
    expect(orphaned.detail).toContain("not an ancestor of main");

    expect(
      rules.evaluateRule(
        { kind: "commit", sha: "deadbee" },
        factsWith({ commitExists: () => true, commitIsAncestorOfDefault: () => true }),
        context,
      ).disposition,
    ).toBe("verified");
  });

  it("refuses a landing claim that cites nothing", () => {
    const claims = extract("**Slice 2 — Storage port.** ✅ **MERGED to main (2026-08-04).**");
    expect(claims.map((c) => c.kind)).toContain("landing-uncited");
    expect(rules.evaluateRule({ kind: "landing-uncited" }, factsWith()).disposition).toBe("fail");
  });

  it("accepts a landing claim that cites a pull request", () => {
    const claims = extract("**Slice 3 — Clerk auth.** ✅ **MERGED to main (#4, 2026-08-04).**");
    expect(claims.map((c) => c.kind)).not.toContain("landing-uncited");
    expect(claims).toContainEqual(expect.objectContaining({ kind: "pull-request", number: 4 }));
  });

  it("proves a REBASE-merged pull request through the ledger, not around it", () => {
    // A rebase-merged PR has no merge commit, and reading that as "never
    // landed" is a false alarm against a true sentence. The
    // ledger supplies only the head sha; the proof stays local — that commit
    // must be an ancestor of the default branch, so a wrong sha still fails.
    const claim = { kind: "pull-request", number: 2 };
    const ledger = { entries: [{ number: 2, headSha: "7e135eb0733149f213e46e61ecdec4bd561fd8bf" }] };

    expect(rules.evaluateRule(claim, factsWith(), { ...context }).disposition).toBe("fail");

    expect(
      rules.evaluateRule(claim, factsWith({ commitExists: () => true }), {
        ...context,
        prLedger: ledger,
      }).detail,
    ).toContain("did not land");

    expect(
      rules.evaluateRule(
        claim,
        factsWith({ commitExists: () => true, commitIsAncestorOfDefault: () => true }),
        { ...context, prLedger: ledger },
      ).disposition,
    ).toBe("verified");
  });

  it("does not check ANOTHER repository's pull request against this history", () => {
    const claims = extract("| P6 | account-deletion page already exists (vettrack PR #153), merged |");
    expect(claims).toContainEqual(
      expect.objectContaining({ kind: "pull-request-cross-repo", number: 153, repo: "vettrack" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — WORKS
// ---------------------------------------------------------------------------

describe("layer 3 — the declared gates actually ran, and passed, on this tree", () => {
  const gates = [{ id: "typecheck", command: "npm run typecheck" }];
  const green = { treeHash: "abc123", dirty: false, results: [{ id: "typecheck", exitCode: 0 }] };

  it("refuses a report for a different tree", () => {
    const verdict = rules.evidenceVerdict({ report: green, gates, treeHash: "zzz999", enforce: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("working tree is");
  });

  it("refuses a report recorded over a dirty working copy", () => {
    const verdict = rules.evidenceVerdict({
      report: { ...green, dirty: true },
      gates,
      treeHash: "abc123",
      enforce: true,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("DIRTY");
  });

  it("refuses a gate that never ran, and one that ran red", () => {
    expect(
      rules.evidenceVerdict({
        report: { ...green, results: [] },
        gates,
        treeHash: "abc123",
        enforce: true,
      }).problems[0],
    ).toContain("never ran");

    expect(
      rules.evidenceVerdict({
        report: { ...green, results: [{ id: "typecheck", exitCode: 1 }] },
        gates,
        treeHash: "abc123",
        enforce: true,
      }).problems[0],
    ).toContain("exited 1");
  });

  it("accepts a current, green report — and stays quiet outside CI when there is none", () => {
    expect(rules.evidenceVerdict({ report: green, gates, treeHash: "abc123", enforce: true }).ok).toBe(
      true,
    );
    // A developer mid-edit has not run verify:evidence; failing their local
    // `pnpm test` for that is a false alarm aimed at normal work.
    const local = rules.evidenceVerdict({ report: null, gates, treeHash: "abc123", enforce: false });
    expect(local.ok).toBe(true);
    expect(local.note).toBeTruthy();
    expect(
      rules.evidenceVerdict({ report: null, gates, treeHash: "abc123", enforce: true }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — ATTESTED
// ---------------------------------------------------------------------------

describe("layer 4 — what the repository cannot prove is vouched for, dated, and expires", () => {
  const sound = {
    id: "g1-device-smoke",
    claim: "NFC isSupported=true on a physical Pixel 7",
    target: "physical-device",
    evidence: "SCAFFOLD-PLAN.md",
    attestedBy: "repo owner",
    attestedAt: "2026-08-04",
    staleAfterDays: 120,
    reverifyWith: "docs/device-test-w3b.md",
  };
  const helpers = { scriptExists: () => true, fileExists: () => true };

  it("refuses an attestation past its staleness budget", () => {
    const verdict = rules.attestationVerdict(sound, "2026-12-31", helpers);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("stale");
    expect(rules.attestationVerdict(sound, "2026-08-20", helpers).ok).toBe(true);
  });

  it("refuses a missing field, an unknown target, and a future date", () => {
    expect(
      rules.attestationVerdict({ ...sound, attestedBy: "" }, "2026-08-20", helpers).problems,
    ).toContain("missing field: attestedBy");
    expect(
      rules.attestationVerdict({ ...sound, target: "vibes" }, "2026-08-20", helpers).problems.join(" "),
    ).toContain("unknown target");
    expect(
      rules
        .attestationVerdict({ ...sound, attestedAt: "2027-01-01" }, "2026-08-20", helpers)
        .problems.join(" "),
    ).toContain("in the future");
  });

  it("refuses a re-verify recipe nobody can follow", () => {
    expect(
      rules
        .attestationVerdict({ ...sound, reverifyWith: "npm run nope" }, "2026-08-20", {
          ...helpers,
          scriptExists: () => false,
        })
        .problems.join(" "),
    ).toContain("does not define");

    expect(
      rules
        .attestationVerdict({ ...sound, reverifyWith: "docs/gone.md" }, "2026-08-20", {
          ...helpers,
          fileExists: () => false,
        })
        .problems.join(" "),
    ).toContain("does not exist");
  });

  it("refuses a document that points at an attestation the ledger does not hold", () => {
    const verdict = rules.evaluateRule({ kind: "attested", id: "ghost" }, factsWith(), {
      attestations: { entries: [] },
      now: "2026-08-20",
    });
    expect(verdict.disposition).toBe("fail");
    expect(verdict.detail).toContain("no attestation with id");
  });
});

// ---------------------------------------------------------------------------
// The exemptions cannot rot
// ---------------------------------------------------------------------------

describe("exemptions are self-cleaning", () => {
  it("fails a registry entry that no live claim matches", () => {
    const registry = { entries: [{ kind: "path", match: "src/gone.ts", reason: "x" }] };
    expect(rules.orphanRegistryEntries(registry, [])).toHaveLength(1);
    expect(
      rules.orphanRegistryEntries(registry, [{ kind: "path", target: "src/gone.ts" } as Claim]),
    ).toHaveLength(0);
  });

  it("fails a registry entry whose claim now verifies on its own", () => {
    // A planned file gets built. Without this rule the entry keeps "excusing"
    // it, the check is silently gone, and everything stays green.
    const registry = { entries: [{ kind: "path", match: "src/built.ts", reason: "planned" }] };
    const verdict = rules.decide(
      { kind: "path", target: "src/built.ts" },
      factsWith({ fileExists: () => true }),
      { registry },
    );
    expect(verdict.disposition).toBe("fail");
    expect(verdict.detail).toContain("obsolete");
  });

  it("fails a pr-ledger entry nothing cites, or that no longer needs to exist", () => {
    const ledger = { entries: [{ number: 2, headSha: "7e135eb" }] };
    expect(rules.obsoletePrLedgerEntries(ledger, [], factsWith())[0].reason).toContain(
      "no governed document",
    );
    const cited = [{ kind: "pull-request", number: 2 } as Claim];
    expect(
      rules.obsoletePrLedgerEntries(ledger, cited, factsWith({ mergeCommitForPr: () => "abc" }))[0]
        .reason,
    ).toContain("now has a merge commit");
    expect(rules.obsoletePrLedgerEntries(ledger, cited, factsWith())).toHaveLength(0);
  });

  it("fails an attestation no governed document references", () => {
    const ledger = { entries: [{ id: "orphan" }] };
    expect(rules.orphanAttestations(ledger, [])).toHaveLength(1);
    expect(
      rules.orphanAttestations(ledger, [{ kind: "attested", id: "orphan" } as Claim]),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The scanner does not cry wolf
// ---------------------------------------------------------------------------

describe("extraction refuses to invent defects", () => {
  it("reads a NEGATED reference as an absence claim, in either word order", () => {
    expect(extract("`src/lib/nfc-platform.ts` does not exist")).toContainEqual(
      expect.objectContaining({ kind: "absent-path", target: "src/lib/nfc-platform.ts" }),
    );
    expect(extract("and no `yarn.lock` exists either")).toContainEqual(
      expect.objectContaining({ kind: "absent-path", target: "yarn.lock" }),
    );
    // ...but only an IMMEDIATELY preceding negation counts.
    expect(extract("there is no reason to touch `src/lib/api.ts` here")).toContainEqual(
      expect.objectContaining({ kind: "path", target: "src/lib/api.ts" }),
    );
  });

  it("ignores RETRACTED text, including a strikethrough that spans lines", () => {
    expect(extract("~~`src/gone.ts` was the plan~~ — it never shipped")).not.toContainEqual(
      expect.objectContaining({ target: "src/gone.ts" }),
    );
    const multiline = "~~An untracked `pnpm-lock.yaml` sits\nbeside `package-lock.json`.~~ **One lockfile.**";
    expect(extract(multiline).map((c) => c.target)).not.toContain("pnpm-lock.yaml");
  });

  it("ignores a superseded value quoted inside a correction note", () => {
    // The repo's own convention: a correction quotes what the line used to say.
    // Reading that as live punishes exactly the behaviour the gate wants.
    const corrected = 'Gesture Handler 2.x. *Corrected (previously read ~~"Gesture Handler 3.x"~~).*';
    const versions = extract(corrected)
      .filter((c) => c.kind === "dependency")
      .map((c) => c.range);
    expect(versions).toEqual(["2.x"]);
  });

  it("does not mistake an i18n key namespace for a file glob", () => {
    const kinds = extract("Keys live under `appointmentsPage.*` and `home.shift.*`.").map((c) => c.kind);
    expect(kinds).not.toContain("glob");
    expect(extract("Files under `src/components/equipment/detail/*`")).toContainEqual(
      expect.objectContaining({ kind: "glob" }),
    );
  });

  it("does not mistake a pnpm VERSION or a workspace protocol for a script", () => {
    // "pnpm 9.15.9" and "pnpm workspace:" both sit in this repo's own CLAUDE.md.
    const scripts = extract("Node >= 22.12, pnpm 9.15.9 — pnpm workspace: root app")
      .filter((c) => c.kind === "script")
      .map((c) => c.script);
    expect(scripts).toEqual([]);
    expect(extract("Run `pnpm typecheck` after every change")).toContainEqual(
      expect.objectContaining({ kind: "script", script: "typecheck" }),
    );
  });

  it("does not mistake a shell fragment for a path", () => {
    expect(extract("Run `find . -name pnpm-lock.yaml -not -path '*/node_modules/*'`")).toEqual([]);
  });

  it("prefers the LONGER package alias, so React Native is not read as React", () => {
    const claims = extract("**Expo SDK ~57.0.9 · React Native 0.86.2 · React 19.2.3.**");
    expect(claims).toContainEqual(expect.objectContaining({ name: "react-native", range: "0.86.2" }));
    expect(claims).toContainEqual(expect.objectContaining({ name: "react", range: "19.2.3" }));
    expect(claims.filter((c) => c.name === "react")).toHaveLength(1);
  });

  it("resolves a structure tree by INDENTATION, not by bare token", () => {
    const tree = ["## Structure", "", "```text", "src/", "  core/ports/     ports", "```"].join("\n");
    const targets = extract(tree).map((c) => c.target);
    expect(targets).toContain("src/core/ports");
    expect(targets).not.toContain("core/ports");
  });

  it("does not read `@AGENTS.md` or `@/` as file references", () => {
    expect(extract("`CLAUDE.md` imports this file (`@AGENTS.md`) via the `@/` alias.").map((c) => c.target))
      .not.toContain("@AGENTS.md");
  });

  it("does not demand a citation from a line that merely DISCUSSES merges", () => {
    for (const line of [
      "Abort if any line prints `NOT-MERGED`:",
      "### 2B. ESLint flat config — ✅ CLOSED (verify only)",
      "op-sqlite never landed — persistence is MMKV",
      "Slices 1–12 landed; Slice 13 is the last product gate",
    ]) {
      expect(extract(line).map((c) => c.kind)).not.toContain("landing-uncited");
    }
  });
});

// ---------------------------------------------------------------------------
// The gate itself, over the real repository
// ---------------------------------------------------------------------------

describe("the engine's own source", () => {
  it("carries no control bytes", () => {
    // A previous globToRegExp substituted a sentinel for `**` and substituted it
    // back; the sentinel it shipped with was a literal NUL. Nothing failed —
    // the transformation still worked — but grep read the file as binary and a
    // later edit that matched on the intended character silently did nothing,
    // leaving twenty glob claims failing against a fix that looked applied.
    const fs = require("node:fs") as {
      readdirSync(dir: string): string[];
      readFileSync(file: string, encoding: "utf8"): string;
    };
    const path = require("node:path") as { join(...parts: string[]): string };
    const dir = path.join(process.cwd(), "scripts", "verify");
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".cjs"))
      .filter((name) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(
        fs.readFileSync(path.join(dir, name), "utf8"),
      ));
    expect(offenders).toEqual([]);
  });
});

describe("the shared engine", () => {
  const fingerprint = require("../scripts/verify/fingerprint.cjs") as {
    fingerprintEngine(dir: string): { fingerprint: string; files: string[] };
  };
  const config = require("../verify.config.json") as {
    engineFingerprint: string;
    siblingRepo: string;
  };

  it("matches the fingerprint recorded in verify.config.json", () => {
    // The engine exists as two copies, in two repositories, and nothing offline
    // can compare them. This does not prove they agree — it makes changing one
    // of them impossible to do QUIETLY: the recorded value stops matching, and
    // updating it is a reviewable line that says "the shared engine changed",
    // which is the moment someone decides whether the sibling needs it too.
    const path = require("node:path") as { join(...parts: string[]): string };
    const actual = fingerprint.fingerprintEngine(
      path.join(process.cwd(), "scripts", "verify"),
    );
    expect(`${actual.fingerprint} (sibling: ${config.siblingRepo})`).toBe(
      `${config.engineFingerprint} (sibling: ${config.siblingRepo})`,
    );
  });

  it("hashes every module, so a new one cannot slip in unhashed", () => {
    const path = require("node:path") as { join(...parts: string[]): string };
    const { files } = fingerprint.fingerprintEngine(
      path.join(process.cwd(), "scripts", "verify"),
    );
    expect(files).toHaveLength(6);
  });
});

describe("this repository's governed documents", () => {
  const result = verify({ now: "2026-08-20" });

  it("extracted real claims (guards a silently-empty scan)", () => {
    // An empty scan passes every assertion below for the wrong reason.
    expect(result.counts.claims).toBeGreaterThan(100);
    expect(result.counts.verified).toBeGreaterThan(0);
  });

  it("covers all four layers (guards a scanner that quietly stopped finding a kind)", () => {
    const kinds = new Set(result.claims.map((c) => c.kind));
    for (const kind of ["path", "dependency", "script", "absence", "commit", "attested"]) {
      expect(kinds).toContain(kind);
    }
  });

  it("makes no unaccounted claim", () => {
    const lines = result.failures.map((f) => `${f.file}:${f.line} [${f.kind}] ${f.detail}`);
    expect(lines).toEqual([]);
  });
});
