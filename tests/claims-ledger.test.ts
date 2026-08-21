/**
 * The claim gate — proved by REFUSAL, not by passing.
 *
 * WHAT THIS BLOCKS
 * `pnpm verify:claims` makes the repository's own prose self-checking:
 * every path, line range, dependency version, npm script, declared absence,
 * landing citation and device attestation in a governed document is resolved
 * against the tree, against git, against a recorded evidence run, or against a
 * written attestation. This suite is what makes that binding — it runs inside
 * the existing `pnpm test` job, so a document that starts lying fails CI.
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
 * `scripts/verify/claims.cjs` and `scripts/verify/scan.cjs` take plain data and
 * return plain data, so a false input can be handed to them directly. The
 * repository-wide run at the bottom is the same `verify()` the CLI calls — one
 * implementation, so the command a human runs and the gate that blocks a PR can
 * never disagree.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { createRequire } from "node:module";
// A REAL IMPORT, not `require("node:buffer") as typeof import("node:buffer")`.
// That cast asserted a type rather than checking one, in a file whose whole
// subject is the difference between the two.
import { Buffer } from "node:buffer";

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
    helpers?: {
      scriptExists?(name: string): boolean;
      fileExists?(path: string): boolean;
      packageManager?: string;
    },
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
  scriptNameIn(recipe: string, packageManager?: string): string | null;
  isReentrantGate(command: string): boolean;
  gateInvocation(
    rawCommand: string,
    args: string[],
    platform: string,
    comspec?: string,
  ): { command: string; args: string[] };
  createOutputCollector(maxBytes: number): {
    stream(): { write(chunk: unknown): void; end(): void };
    note(line: string): void;
    readonly text: string;
    readonly truncated: boolean;
  };
  terminationProblem(outcome: {
    how?: string;
    code?: string | number | null;
    message?: string | null;
  }): string | null;
  GATE_TOKEN: RegExp;
};

type Scan = {
  extractFromMarkdown(
    text: string,
    where: { file: string },
    policy: unknown,
  ): { claims: Claim[]; excluded: { reason: string; raw: string }[] };
  codeSpans(line: string): { index: number; length: number; text: string }[];
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
  verify(options?: { root?: string; now?: string; enforceEvidence?: boolean }): VerifyResult;
};
const { globToRegExp, createFacts } = require("../scripts/verify/facts.cjs") as {
  globToRegExp(pattern: string, options?: { suffix?: boolean }): { test(subject: string): boolean };
  createFacts(
    root: string,
    policy: unknown,
  ): {
    grepCount(pattern: string, scope: string): number;
    fileExists(relative: string): boolean;
    lineCount(relative: string): number | null;
    globMatches(pattern: string): number;
    suffixMatches(reference: string): number;
  };
};
const gitFacts = require("../scripts/verify/git-facts.cjs") as {
  addedLinesFromDiff(stdout: string): Set<number>;
  resolveGitBinary(): string | { problem: string } | null;
  createGitFacts(
    root: string,
    defaultBranch: string,
  ): { facts: { pathExistsAtCommit(sha: string, filePath: string): boolean } | null };
};
const fingerprint = require("../scripts/verify/fingerprint.cjs") as {
  ENGINE_MODULES: string[];
  MODULE_REQUIRE: RegExp;
  fingerprintEngine(dir: string): { fingerprint: string; files: string[] };
};
const config = require("../verify.config.json") as {
  engineFingerprint: string;
  siblingRepo: string;
};
// Required once at the top rather than inside each `it`: three blocks below
// reached for the same two node builtins, and a require repeated per test is a
// place for the copies to drift apart.
const fs = require("node:fs") as {
  readdirSync(dir: string): string[];
  readFileSync(file: string, encoding: "utf8"): string;
  writeFileSync(file: string, contents: string): void;
  mkdtempSync(prefix: string): string;
  rmSync(target: string, options: { recursive: true; force: true }): void;
};
const path = require("node:path") as {
  join(...parts: string[]): string;
  basename(target: string): string;
};
const os = require("node:os") as { tmpdir(): string };
const REPO_ROOT = process.cwd();
const ENGINE_DIR = path.join(REPO_ROOT, "scripts", "verify");

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

/**
 * The clock the LAYER 4 UNIT CASES are measured against — pinned on purpose, so a
 * staleness budget can be tested without waiting ninety days. Named rather than
 * repeated seven times: an edit that moved one occurrence and not the rest would
 * leave the cases silently measuring different days, which is the drift these
 * very tests exist to catch. The repository-wide run at the bottom deliberately
 * does NOT use this — it uses the real date, so attestations can actually expire.
 */
const OBSERVED_ON = "2026-08-20";

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
    expect(rules.attestationVerdict(sound, OBSERVED_ON, helpers).ok).toBe(true);
  });

  it("refuses a missing field, an unknown target, and a future date", () => {
    expect(
      rules.attestationVerdict({ ...sound, attestedBy: "" }, OBSERVED_ON, helpers).problems,
    ).toContain("missing field: attestedBy");
    expect(
      rules.attestationVerdict({ ...sound, target: "vibes" }, OBSERVED_ON, helpers).problems.join(" "),
    ).toContain("unknown target");
    expect(
      rules
        .attestationVerdict({ ...sound, attestedAt: "2027-01-01" }, OBSERVED_ON, helpers)
        .problems.join(" "),
    ).toContain("in the future");
  });

  it("refuses a re-verify recipe nobody can follow", () => {
    expect(
      rules
        .attestationVerdict({ ...sound, reverifyWith: "npm run nope" }, OBSERVED_ON, {
          ...helpers,
          scriptExists: () => false,
        })
        .problems.join(" "),
    ).toContain("does not define");

    expect(
      rules
        .attestationVerdict({ ...sound, reverifyWith: "docs/gone.md" }, OBSERVED_ON, {
          ...helpers,
          fileExists: () => false,
        })
        .problems.join(" "),
    ).toContain("does not exist");
  });

  it("refuses a document that points at an attestation the ledger does not hold", () => {
    const verdict = rules.evaluateRule({ kind: "attested", id: "ghost" }, factsWith(), {
      attestations: { entries: [] },
      now: OBSERVED_ON,
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
// The refusals that were unreachable — every one of these was a path the engine
// could take in silence, and silence is the one disposition it does not have
// ---------------------------------------------------------------------------

describe("the engine refuses what it says it refuses", () => {
  it("rejects every spelling of a gate that would re-enter the test suite", () => {
    // The first pattern anchored on `test` followed by a boundary, so these five
    // — the likeliest spellings — went straight through the filter and were
    // EXECUTED, re-entering the suite that reads the report this command writes.
    for (const command of [
      "npm test",
      "npm run test",
      "npm run test:ci",
      "npm run test:unit",
      "jest",
      "npx jest",
      "pnpm test",
      "npm run verify:claims",
    ]) {
      expect(`${command} -> ${rules.isReentrantGate(command)}`).toBe(`${command} -> true`);
    }
    // …and lets the real gates through, or the refusal is just a broken tool.
    for (const command of [
      "pnpm typecheck",
      "pnpm i18n:check",
      "pnpm depcruise:check",
      "pnpm architecture:gates",
      "npm run typecheck",
    ]) {
      expect(`${command} -> ${rules.isReentrantGate(command)}`).toBe(`${command} -> false`);
    }
  });

  it("rejects a gate token carrying shell punctuation", () => {
    for (const token of ['"quoted"', "a;rm", "a|b", "$(x)", "a&&b", "`x`", "a>b"]) {
      expect(`${token} -> ${rules.GATE_TOKEN.test(token)}`).toBe(`${token} -> false`);
    }
    for (const token of ["pnpm", "typecheck", "depcruise:check", "--platform=ios", "./bin/x"]) {
      expect(`${token} -> ${rules.GATE_TOKEN.test(token)}`).toBe(`${token} -> true`);
    }
  });

  it("treats `?` in a glob as a literal, not as a quantifier", () => {
    // Unescaped, `foo?.ts` compiles to /foo?\.ts/ — which matches `fo.ts`, so the
    // glob claim verifies against a file it does not name.
    expect(globToRegExp("foo?.ts").test("fo.ts")).toBe(false);
    expect(globToRegExp("foo?.ts").test("foo?.ts")).toBe(true);
    expect(globToRegExp("server/routes/*.ts", { suffix: true }).test("server/routes/a.ts")).toBe(true);
  });

  it("matches a `**` between separators against zero directories", () => {
    // `docs/**/plan.md` NAMES `docs/plan.md`. Translating the whole `/**/` to
    // `/.*/` demanded a directory in between, so the glob failed against the
    // file it was written for and the claim was reported as a defect — the
    // false alarm, not the miss.
    expect(globToRegExp("docs/**/plan.md").test("docs/plan.md")).toBe(true);
    expect(globToRegExp("docs/**/plan.md").test("docs/g2/plan.md")).toBe(true);
    expect(globToRegExp("docs/**/plan.md").test("docs/a/b/plan.md")).toBe(true);
    expect(globToRegExp("docs/**/plan.md").test("other/plan.md")).toBe(false);
    expect(globToRegExp("**/x.ts").test("x.ts")).toBe(true);
    expect(globToRegExp("**/x.ts").test("a/b/x.ts")).toBe(true);
    // The single-star rule is unchanged: one `*` still stops at a separator.
    expect(globToRegExp("docs/*.md").test("docs/a/b.md")).toBe(false);
  });

  it("refuses an absence claim when the walk could not read a directory", () => {
    // The THIRD face of one rule. An unreadable file was refused in the file
    // branch of `grepCount`, then in its directory branch — and the traversal
    // itself still returned quietly, so a scope that was never fully walked
    // counted zero hits and the absence verified. Stubbed rather than chmod-ed
    // because this suite may run as root, where chmod 000 is not a refusal and
    // the test would pass without ever reaching the branch.
    const fsModule = require("node:fs") as typeof import("node:fs");
    const real = fsModule.readdirSync;
    const spy = vi.spyOn(fsModule, "readdirSync").mockImplementation(((
      target: Parameters<typeof real>[0],
      options: Parameters<typeof real>[1],
    ) => {
      if (String(target).endsWith("/scripts/verify")) throw new Error("EACCES");
      return (real as (...a: unknown[]) => unknown)(target, options);
    }) as typeof real);
    try {
      const facts = createFacts(REPO_ROOT, POLICY);
      expect(Number.isNaN(facts.grepCount("no-such-token-anywhere", "scripts"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a target that resolves outside the checkout", () => {
    // Every target here comes out of a DOCUMENT — a path span, or a marker
    // carrying its own scope. `path.join` resolves `../../etc` happily, so a
    // claim about THIS repository could be answered by a file it does not
    // contain: verified, and about the wrong tree. The absence case is the
    // dangerous one, because a 0 there reads as "confirmed absent".
    const facts = createFacts(REPO_ROOT, POLICY);
    expect(Number.isNaN(facts.grepCount("root", "../../etc/passwd"))).toBe(true);
    expect(facts.fileExists("../../etc/passwd")).toBe(false);
    expect(facts.lineCount("../../etc/passwd")).toBeNull();
    expect(facts.fileExists("a/../../../etc/passwd")).toBe(false);
    // A path inside the checkout still resolves, including a harmless `..`.
    expect(facts.fileExists("package.json")).toBe(true);
    expect(facts.fileExists("docs/../package.json")).toBe(true);
  });

  it("refuses a path that reaches outside through a symbolic link", () => {
    // LEXICAL CONTAINMENT IS NOT CONTAINMENT. The first version of the guard
    // compared `path.resolve` output and stopped, but `statSync` and
    // `readFileSync` FOLLOW links: a tracked `docs/proof.md` pointing at
    // `/external/proof.md` passed the string check and read the outside file
    // anyway, so a claim came back verified from data this repository does not
    // contain. Reproduced before the fix — the lexical check passed and the
    // read escaped — and refused after.
    const osModule = require("node:os") as typeof import("node:os");
    const fsModule = require("node:fs") as typeof import("node:fs");
    // UNIQUE, and cleaned up even if setup throws. The first version used a fixed
    // name in the repository root and `rm -rf`'d it in `finally`: a pre-existing
    // untracked directory of that name, or a parallel run of this suite, would
    // have been deleted. A test that guards against reading outside the tree
    // should not be the thing that destroys something inside it.
    const outside = fsModule.mkdtempSync(path.join(osModule.tmpdir(), "vt-outside-"));
    let probe: string | undefined;
    try {
      probe = fsModule.mkdtempSync(path.join(REPO_ROOT, ".vt-symlink-probe-"));
      const rel = path.basename(probe);
      fsModule.writeFileSync(path.join(outside, "secret.md"), "outside-token\n");
      fsModule.symlinkSync(path.join(outside, "secret.md"), path.join(probe, "link.md"));
      fsModule.symlinkSync(outside, path.join(probe, "dir"));
      const facts = createFacts(REPO_ROOT, POLICY);
      expect(facts.fileExists(`${rel}/link.md`)).toBe(false);
      expect(facts.lineCount(`${rel}/link.md`)).toBeNull();
      expect(Number.isNaN(facts.grepCount("outside-token", `${rel}/link.md`))).toBe(true);
      expect(Number.isNaN(facts.grepCount("outside-token", `${rel}/dir`))).toBe(true);
      // A file genuinely inside the checkout still resolves.
      expect(facts.fileExists("package.json")).toBe(true);
    } finally {
      if (probe) fsModule.rmSync(probe, { recursive: true, force: true });
      fsModule.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses a glob or suffix match that resolves outside the checkout", () => {
    // `list` yields NAMES and does not follow them, so a tracked symlink pointing
    // outside is an ordinary-looking entry. `fileExists` rejected it through
    // `insideRoot` and `globMatches` did not — the containment rule fixed in one
    // function and left open in its twin, which is the shape of defect this
    // engine has now produced often enough to look for on purpose.
    //
    // The probe must NOT be a dot directory here: `list` skips those, so a
    // dot-named fixture would pass this test without ever reaching the code.
    const osModule = require("node:os") as typeof import("node:os");
    const fsModule = require("node:fs") as typeof import("node:fs");
    const outside = fsModule.mkdtempSync(path.join(osModule.tmpdir(), "vt-outside-glob-"));
    let probe: string | undefined;
    try {
      probe = fsModule.mkdtempSync(path.join(REPO_ROOT, "vt-glob-probe-"));
      const rel = path.basename(probe);
      fsModule.writeFileSync(path.join(outside, "escaped.md"), "outside\n");
      fsModule.symlinkSync(path.join(outside, "escaped.md"), path.join(probe, "escaped.md"));
      const escaped = createFacts(REPO_ROOT, POLICY);
      expect(escaped.fileExists(`${rel}/escaped.md`)).toBe(false);
      expect(escaped.globMatches(`${rel}/*.md`)).toBe(0);
      expect(escaped.suffixMatches(`${rel}/escaped.md`)).toBe(0);
      // Containment, not a blanket refusal: a real file in the same directory
      // still counts. A guard that answers 0 to everything is not a guard.
      fsModule.writeFileSync(path.join(probe, "real.md"), "inside\n");
      const contained = createFacts(REPO_ROOT, POLICY);
      expect(contained.globMatches(`${rel}/*.md`)).toBe(1);
      expect(contained.suffixMatches(`${rel}/real.md`)).toBe(1);
    } finally {
      if (probe) fsModule.rmSync(probe, { recursive: true, force: true });
      fsModule.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses an absence claim about a target it cannot examine", () => {
    // MEASURED BEFORE THE FIX: `absent ../../etc/passwd` came back VERIFIED. The
    // path escapes the checkout, `insideRoot` refuses it, `fileExists` reports a
    // plain false, and the rule read that false as confirmation — so a document
    // could assert the absence of anything outside the repository and the gate
    // would agree, having never been able to look.
    //
    // Absence is the one rule that turns "no evidence" into a pass, which makes
    // it the one rule that must tell an unexaminable target from a missing one.
    // It is also the rule this whole engine was built around: it is what would
    // have caught the dependency the docs named for months and never had.
    const facts = createFacts(REPO_ROOT, POLICY);

    expect(rules.decide({ kind: "absent-path", target: "../../etc/passwd", raw: "x" }, facts, {}))
      .toMatchObject({ disposition: "fail" });
    expect(rules.decide({ kind: "absent-dir", target: "../../etc", raw: "x" }, facts, {}))
      .toMatchObject({ disposition: "fail" });

    // A genuinely missing path INSIDE the tree still verifies — the guard is
    // containment, not a blanket refusal that would make absence unusable.
    expect(
      rules.decide({ kind: "absent-path", target: "src/no-such-file.zzz", raw: "x" }, facts, {}),
    ).toMatchObject({ disposition: "verified" });
    // And a target that is present still fails, as it always did.
    expect(rules.decide({ kind: "absent-path", target: "package.json", raw: "x" }, facts, {}))
      .toMatchObject({ disposition: "fail" });
  });

  it("exposes withinRoot on the real facts contract", () => {
    // The absence rules read `facts.withinRoot?.(...)`, which lets the suite's
    // synthetic stubs keep answering about their synthetic trees. That optional
    // call is only safe while the REAL contract always provides it — without
    // this test, deleting `withinRoot` would silently restore the old pass.
    const facts = createFacts(REPO_ROOT, POLICY) as unknown as {
      withinRoot?: (relative: string) => boolean;
    };
    expect(typeof facts.withinRoot).toBe("function");
    expect(facts.withinRoot?.("package.json")).toBe(true);
    expect(facts.withinRoot?.("../../etc/passwd")).toBe(false);
  });

  it("matches a wildcard-dense glob without building a backtracking tree", () => {
    // The previous translation built a regex whose adjacent `[^/]*` groups
    // backtracked against each other. Measured on this engine before the change:
    // `*a` four times matched in 1.1ms, six in 51ms, eight in 996ms, and ten did
    // not finish in five seconds — from a pattern well under the scanner's
    // 200-character span cap. A glob is written in a governed document, so a
    // documentation edit could wedge the gate with no verdict at all.
    const pattern = `docs/${"*a".repeat(64)}.md`;
    const subject = `docs/${"a".repeat(40)}X`;
    const started = Date.now();
    expect(globToRegExp(pattern).test(subject)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("stays bounded on a leading star followed by a long near-match suffix", () => {
    // The shape the wildcard-dense case above does NOT reach, and the reason
    // the word "linear" was wrong in this suite and in `facts`: one star at the
    // front and a long literal after it, so every retry rechecks that literal.
    // The bound is O(pattern x subject) per segment — 111,361 comparisons for
    // exactly this case, reproduced from the review that caught the overclaim.
    // Bounded is the property worth pinning, and it holds because both factors
    // are capped: the scanner truncates a span at 200 characters and a subject
    // is one path segment.
    const pattern = `docs/*${"a".repeat(192)}b.md`;
    const subject = `docs/${"a".repeat(768)}.md`;
    const started = Date.now();
    expect(globToRegExp(pattern).test(subject)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses an absence scope whose listing the walk shortened", () => {
    // `list` skips `node_modules`, unnamed dot entries and ignored prefixes.
    // Correct for a glob; not evidence of absence. A token sitting in a skipped
    // file made `grepCount` return 0, and a 0 there reads as "confirmed absent"
    // over a tree that was never fully walked — the same silent pass as an
    // unreadable file, arriving through the filters instead of through an error.
    const facts = createFacts(REPO_ROOT, POLICY);
    expect(Number.isNaN(facts.grepCount("zzz-no-such-token", "."))).toBe(true);
    // A scope with nothing filtered out of it still answers.
    expect(facts.grepCount("zzz-no-such-token", "scripts/verify")).toBe(0);
  });

  it("refuses a package manager that would change what the script pattern means", () => {
    // The value is file-sourced and interpolated into a RegExp. `scriptNameIn`
    // has checked its shape since the second round; the scanner read the same
    // field and did not — so an unbalanced value threw from inside the scan as
    // an unhandled error where a configuration error belongs.
    expect(() =>
      scan.extractFromMarkdown("`pnpm run x`", { file: "PLAN.md" }, { ...POLICY, packageManager: "pn(m" }),
    ).toThrow(/not a plain name/);
  });

  it("resolves a cross-repo GLOB through the prefix registry, not only a path", () => {
    // A glob claim keeps its key in `pattern`. The fail branch read only
    // `target ?? name`, so the key was "" for every glob and no cross-repo
    // prefix could match one — a glob into the sibling repository failed
    // instead of resolving to `registered`, while the identical path did not.
    const context = {
      crossRepoPrefixes: [{ prefix: "sibling-repo/", reason: "lives in the sibling checkout" }],
    };
    const verdict = rules.decide(
      { kind: "glob", pattern: "sibling-repo/docs/*.md", raw: "sibling-repo/docs/*.md" },
      factsWith({ globMatches: () => 0, suffixMatches: () => 0 }),
      context,
    );
    expect(verdict.disposition).toBe("registered");
  });

  it("reports a bad VT_GIT_BINARY as itself, not as a missing git", () => {
    // Both used to return null and produce one message listing the fixed paths
    // and advising the reader to set VT_GIT_BINARY — the variable they had
    // already set, wrongly, which sent them looking for a missing install.
    const previous = process.env.VT_GIT_BINARY;
    process.env.VT_GIT_BINARY = "/nope/not/here";
    try {
      const resolved = gitFacts.resolveGitBinary();
      // `null` also satisfies "not a string", and `null` is exactly what the
      // OLD code returned here — so that assertion alone did not separate the
      // fix from the regression it guards.
      expect(resolved).toMatchObject({ problem: expect.stringContaining("VT_GIT_BINARY") });
    } finally {
      if (previous === undefined) delete process.env.VT_GIT_BINARY;
      else process.env.VT_GIT_BINARY = previous;
    }
  });

  it("refuses a VT_GIT_BINARY that names a directory", () => {
    // `existsSync` is TRUE for a directory. One reaches `spawnSync`, fails
    // EACCES, and comes back out as "not a git repository" — the wrong cause the
    // override branch exists to prevent, arriving through the one shape the
    // check never tested for. Twin of the case directly above.
    const previous = process.env.VT_GIT_BINARY;
    process.env.VT_GIT_BINARY = REPO_ROOT;
    try {
      const resolved = gitFacts.resolveGitBinary();
      expect(resolved).toMatchObject({ problem: expect.stringContaining("VT_GIT_BINARY") });
    } finally {
      if (previous === undefined) delete process.env.VT_GIT_BINARY;
      else process.env.VT_GIT_BINARY = previous;
    }
  });

  it("escapes packageManager before it becomes a pattern", () => {
    // The shape check admits `.`, and `.` is a wildcard, so `tool.v1` matched
    // `toolXv1` and claimed a script the manifest never defines. VALIDATING A
    // STRING IS NOT ESCAPING IT, and the comment beside the code said so while
    // the code did not do it. Both modules that read the field are covered.
    expect(rules.scriptNameIn("toolXv1 lint", "tool.v1")).toBeNull();
    expect(rules.scriptNameIn("tool.v1 lint", "tool.v1")).toBe("lint");

    const wrong = scan.extractFromMarkdown("run `toolXv1 run lint`", { file: "doc.md" }, {
      ...POLICY,
      packageManager: "tool.v1",
    });
    expect(wrong.claims.some((claim) => claim.kind === "script")).toBe(false);

    const right = scan.extractFromMarkdown("run `tool.v1 run lint`", { file: "doc.md" }, {
      ...POLICY,
      packageManager: "tool.v1",
    });
    expect(
      right.claims.some(
        (claim) => claim.kind === "script" && (claim as { script?: string }).script === "lint",
      ),
    ).toBe(true);
  });

  it("keeps a multibyte character whole across chunk boundaries", () => {
    // The collector decoded each `data` event on its own, so a character split
    // across two events became two replacement characters and the gate log
    // misreported what the gate printed. It lived in an inline closure inside
    // the runner where no test could reach it — a later change could restore
    // per-chunk decoding and this suite would stay green. That is why it is a
    // function now, and why this test exists rather than a comment.
    const collector = rules.createOutputCollector(1000);
    const stream = collector.stream();
    // THE SPLIT IS THE TEST. U+1F600 is four bytes and they are handed over in
    // two separate writes on purpose, because that is what a pipe does under
    // load; a single write would pass with or without the fix.
    stream.write(Buffer.from([0x41, 0xf0, 0x9f])); // "A" + first 2 bytes of U+1F600
    stream.write(Buffer.from([0x98, 0x80, 0x42])); // its last 2 bytes + "B"
    stream.end();
    expect(collector.text).toBe("A\u{1F600}B");
    expect(collector.text).not.toContain("\uFFFD");
    expect(collector.truncated).toBe(false);
  });

  it("keeps the truncation marker inside the byte budget it names", () => {
    // The marker used to be appended AFTER the cap, so the recorded output
    // exceeded the very limit the marker announced. A cap exceeded by the note
    // announcing the cap is not a cap. The runner's own diagnostics — timeout,
    // spawn error — go through the same budget for the same reason.
    const limit = 64;
    const collector = rules.createOutputCollector(limit);
    const stream = collector.stream();
    stream.write(Buffer.from("x".repeat(500), "utf8"));
    stream.end();
    expect(collector.truncated).toBe(true);
    expect(Buffer.byteLength(collector.text, "utf8")).toBeLessThanOrEqual(limit);
    expect(collector.text).toContain("truncated");

    // A note after truncation cannot push it back over the line — AND must
    // still arrive. Routing diagnostics through the output budget meant a gate
    // that filled the budget and then timed out was recorded as failed with the
    // reason missing: exactly when a hang is most likely, the word "timeout"
    // disappeared. A failure without its cause is the defect this engine keeps
    // finding in itself, so the note now has reserved room.
    const refusal = "\nrefused: gate exceeded 1ms and was killed";
    const beforeRefusal = collector.text;
    collector.note(refusal);
    expect(collector.text).toContain("refused: gate exceeded");
    // AND WHAT ARRIVED IS THE DIAGNOSTIC, not merely something. Asserting that
    // the text changed would pass on a stray newline; asserting that what was
    // appended is a leading run of the message is the property the caller needs.
    expect(refusal.startsWith(collector.text.slice(beforeRefusal.length))).toBe(true);
    expect(Buffer.byteLength(collector.text, "utf8")).toBeLessThanOrEqual(limit);
  });

  it("bounds the recorded text by its own bytes, not the bytes it was fed", () => {
    // This cap has been wrong THREE times, each by measuring the wrong thing:
    // `output.length` (UTF-16 code units), then the INPUT byte length. A
    // malformed input byte decodes to U+FFFD — three bytes out for one byte in
    // — so a gate emitting invalid bytes inside the budget still blew through
    // the ceiling. Measured before this fix: a 64-byte cap recorded 130 bytes.
    const collector = rules.createOutputCollector(64);
    const stream = collector.stream();
    stream.write(Buffer.from(new Array(40).fill(0xff)));
    stream.end();
    expect(Buffer.byteLength(collector.text, "utf8")).toBeLessThanOrEqual(64);
    expect(collector.truncated).toBe(true);
  });

  it("trims the truncation marker when the budget cannot hold it", () => {
    // A ceiling below the marker's own length used to emit the whole marker and
    // nothing else — 31 bytes recorded against a 10-byte cap. In that case the
    // marker is the thing that gets cut: a note overflowing the limit it
    // announces is precisely the defect this helper exists to prevent.
    const collector = rules.createOutputCollector(10);
    const stream = collector.stream();
    stream.write(Buffer.from("x".repeat(200), "utf8"));
    stream.end();
    expect(Buffer.byteLength(collector.text, "utf8")).toBeLessThanOrEqual(10);
    expect(collector.truncated).toBe(true);
  });

  it("keeps room for the diagnostic even at a ceiling the marker alone would fill", () => {
    // Reserving room for the note was not enough while the MARKER could still
    // run to `maxBytes`: at a small ceiling it consumed the reserve and the
    // record came back as the marker alone, so the note was dropped after all —
    // the same defect one layer below where it had just been fixed.
    //
    // Between the two, the note wins. "output truncated" is a property of the
    // log; "gate exceeded 600000ms and was killed" is the reason the gate
    // failed, and a failure recorded without its cause is what this engine
    // keeps catching in itself. Ten bytes cannot hold the words — the point is
    // that the diagnostic is not silently discarded.
    const collector = rules.createOutputCollector(10);
    const stream = collector.stream();
    stream.write(Buffer.from("x".repeat(200), "utf8"));
    stream.end();
    expect(collector.truncated).toBe(true);

    const beforeNote = collector.text;
    const refusal = "\nrefused: gate exceeded 600000ms and was killed";
    collector.note(refusal);
    // NOT `not.toBe(beforeNote)`. That passes on any change at all — a lone
    // newline, a stray marker fragment — while claiming the diagnostic
    // survived. Ten bytes cannot hold the words, so the assertion is that what
    // landed is a LEADING RUN of the message: the note was cut, not replaced.
    //
    // AND NOT `startsWith` ALONE, which was this assertion's first draft: the
    // message begins with "\n", so a `note()` that appended only a newline
    // satisfied it and the probe that should have failed passed. The run has to
    // reach the words. Probed by making `note()` append "\n" and nothing else —
    // green before this line, red after it.
    const appended = collector.text.slice(beforeNote.length);
    expect(refusal.startsWith(appended)).toBe(true);
    expect(appended.trim().length).toBeGreaterThan(0);
    expect(Buffer.byteLength(collector.text, "utf8")).toBeLessThanOrEqual(10);
  });

  it("tells a kill that worked from a kill that left the tree running", () => {
    // The runner used to read these two as one event. POSIX `ESRCH` and
    // `taskkill` exit 128 both mean "already gone" — which is what the kill was
    // FOR, so saying anything would be a false alarm. `EPERM` and a non-zero
    // taskkill mean processes are still running against the checkout after the
    // gate was recorded as failed, and the old bare `catch {}` said nothing
    // about either. Asked here as a pure decision because half of it belongs to
    // a platform this suite does not run on.
    expect(rules.terminationProblem({ how: "signal", code: "ESRCH", message: "kill ESRCH" })).toBeNull();
    expect(rules.terminationProblem({ how: "taskkill", code: 0 })).toBeNull();
    expect(rules.terminationProblem({ how: "taskkill", code: 128 })).toBeNull();

    expect(rules.terminationProblem({ how: "signal", code: "EPERM", message: "kill EPERM" })).toContain("EPERM");
    expect(rules.terminationProblem({ how: "taskkill", code: 1 })).toContain("exit 1");
    // A killer that never started reports a spawn error, not an exit status.
    expect(
      rules.terminationProblem({ how: "taskkill", code: "ENOENT", message: "spawn taskkill.exe ENOENT" }),
    ).toContain("ENOENT");
    // No cause at all is still a problem — silence is the thing being fixed.
    expect(rules.terminationProblem({ how: "signal" })).not.toBeNull();
  });

  it("proves an unwatched killer would have taken the whole runner down", () => {
    // NOT A STYLE POINT. `spawn` reports a failure to start as an asynchronous
    // `error` event, and an `error` event with no listener is THROWN. The
    // runner's `try`/`catch` could never catch it, so a `taskkill.exe` that
    // would not start killed the evidence run itself — losing the report for
    // every other gate, at the exact moment the timeout existed to produce one.
    // Demonstrated by running both shapes in a real child node process.
    const childProcess = require("node:child_process") as typeof import("node:child_process");
    const spawnOptions = { encoding: "utf8" as const, timeout: 20_000 };
    const missing = "/nonexistent/System32/taskkill.exe";

    const unwatched = childProcess.spawnSync(
      process.execPath,
      [
        "-e",
        `const {spawn}=require("node:child_process");` +
          `try{spawn(${JSON.stringify(missing)},["/T"],{stdio:"ignore",shell:false}).unref()}catch{};` +
          `setTimeout(()=>console.log("REPORT WRITTEN"),200)`,
      ],
      spawnOptions,
    );
    expect(unwatched.status).not.toBe(0);
    expect(unwatched.stdout ?? "").not.toContain("REPORT WRITTEN");
    expect(unwatched.stderr ?? "").toContain("Unhandled 'error' event");

    const watched = childProcess.spawnSync(
      process.execPath,
      [
        "-e",
        `const {spawn}=require("node:child_process");` +
          `const k=spawn(${JSON.stringify(missing)},["/T"],{stdio:"ignore",shell:false});` +
          `k.on("error",e=>console.log("warning:",e.code));k.on("exit",()=>{});k.unref();` +
          `setTimeout(()=>console.log("REPORT WRITTEN"),200)`,
      ],
      spawnOptions,
    );
    expect(watched.status).toBe(0);
    expect(watched.stdout ?? "").toContain("REPORT WRITTEN");
    expect(watched.stdout ?? "").toContain("ENOENT");
  });

  it("routes a Windows command shim through the command processor", () => {
    // `npm.cmd` with `shell: false` CANNOT START: a `.cmd` is a script, not an
    // executable image. The branch that renamed the token announced Windows
    // support the code did not have — the same shape as calling the glob matcher
    // linear. Asked here from a machine that is not Windows, which is the whole
    // reason this decision is a pure function rather than an inline branch.
    expect(rules.gateInvocation("npm", ["run", "typecheck"], "win32", "C:\\cmd.exe")).toEqual({
      command: "C:\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "typecheck"],
    });
    // No COMSPEC in the environment is not a reason to fail to launch.
    expect(rules.gateInvocation("pnpm", ["test"], "win32", undefined).command).toBe("cmd.exe");
    // POSIX is untouched, and so is a command that was never a shim.
    expect(rules.gateInvocation("npm", ["run", "typecheck"], "linux", undefined)).toEqual({
      command: "npm",
      args: ["run", "typecheck"],
    });
    expect(rules.gateInvocation("node", ["x.mjs"], "win32", "C:\\cmd.exe")).toEqual({
      command: "node",
      args: ["x.mjs"],
    });
  });

  it("reads an uppercase object id as a commit citation", () => {
    // git resolves `ABCDEF1` and `abcdef1` to the same object. A lowercase-only
    // test did not report an uppercase citation as WRONG — it produced no claim
    // at all, and "no claim" is the one outcome this engine has no label for.
    const claims = extract("Superseded by commit `ABCDEF1234567`, now on main.");
    expect(claims.filter((claim) => claim.kind === "commit").map((claim) => claim.sha)).toEqual([
      "ABCDEF1234567",
    ]);
  });

  it("counts an added line whose own text starts with `++`", () => {
    const diff = [
      "diff --git a/docs/audit/PROOF_ALIGNMENT_LOG.md b/docs/audit/PROOF_ALIGNMENT_LOG.md",
      "--- a/docs/audit/PROOF_ALIGNMENT_LOG.md",
      "+++ b/docs/audit/PROOF_ALIGNMENT_LOG.md",
      "@@ -10,0 +11,3 @@",
      "+++ a line of the log that starts with two plus signs",
      "+the entry after it",
      "+and the one after that",
    ].join("\n");
    // Skipping every `+++` line dropped the first and left the cursor one behind,
    // so the two entries after it were checked at lines 11 and 12 — the wrong
    // ones — in an append-only document where only added lines are checked.
    expect([...gitFacts.addedLinesFromDiff(diff)]).toEqual([11, 12, 13]);
  });

  it("refuses a flag-shaped sha before it reaches a git argv", () => {
    const { facts } = gitFacts.createGitFacts(REPO_ROOT, "main");
    // `expect(...).not.toBeNull()` is a runtime check the compiler cannot use to
    // narrow a `const`, so the three assertions below repeat it to the type.
    expect(facts).not.toBeNull();
    expect(facts!.pathExistsAtCommit("--upload-pack=touch /tmp/x", "README.md")).toBe(false);
    expect(facts!.pathExistsAtCommit("-fffffff", "README.md")).toBe(false);
    expect(facts!.pathExistsAtCommit("abcdef1", "-README.md")).toBe(false);
  });

  it("reads a marker inside a code span as documentation, not as a claim", () => {
    // AGENTS.md documents the syntax by showing it. Reading the demonstration as
    // live made an `attested <id>` EXAMPLE satisfy the "referenced by a governed
    // document" rule on its own — which is exactly what stops a stale
    // attestation from ever being reported.
    const shown = scan.extractFromMarkdown(
      "Write it as `<!-- vt-claim: attested some-id -->` in the document.",
      { file: "PLAN.md" },
      POLICY,
    );
    expect(shown.claims).toEqual([]);
    expect(shown.excluded.map((e) => e.reason)).toContain("marker-is-an-example");

    const real = extract("The shell is live. <!-- vt-claim: attested some-id -->");
    expect(real).toContainEqual(expect.objectContaining({ kind: "attested", id: "some-id" }));
  });

  it("does not read a store id beside `SHA-256` as a commit, and still reads a real one", () => {
    // README cites the App Store Connect app as `6778937527` on a line that also
    // says "Play App Signing SHA-256". The bare `sha` fired and the gate reported
    // "no such commit" about a store record. The first attempt refused every
    // all-decimal token — which silenced `8455807`, a REAL commit cited in
    // G2-PLAN.md, because roughly one short sha in twenty-five is all digits.
    expect(
      extract("no AAB uploaded, so the Play App Signing SHA-256 for ASC app `6778937527` does not exist"),
    ).toEqual([]);
    expect(extract("superseded by the pre-reg commit `8455807`")).toContainEqual(
      expect.objectContaining({ kind: "commit", sha: "8455807" }),
    );
    expect(extract("frozen by commit `b043585`")).toContainEqual(
      expect.objectContaining({ kind: "commit", sha: "b043585" }),
    );
  });

  it("reads a package in a code span the way it reads one in prose", () => {
    // A package inside a code span was asserted live whatever the sentence said,
    // so "and no `@clerk/clerk-expo` at any version" — a correct statement of
    // absence — was reported as a missing dependency.
    const absent = scan.extractFromMarkdown(
      "carries `@clerk/expo` and no `@clerk/clerk-expo` at any version",
      { file: "PLAN.md" },
      POLICY,
    );
    expect(absent.claims.map((c) => c.raw)).toEqual(["@clerk/expo"]);
    expect(absent.excluded.map((e) => e.reason)).toContain("package-declared-absent");

    // "swapped X for the renamed Y" names X as former and Y as live. Reading the
    // second as gone would leave the auth SDK unchecked — the one thing these
    // documents were wrong about for months.
    const swapped = scan.extractFromMarkdown(
      "PR #75 swapped `@clerk/clerk-expo` 2.x for the renamed `@clerk/expo`",
      { file: "PLAN.md" },
      POLICY,
    );
    // `PLAN.md` is a status document, so "PR #75" on the same line is correctly a
    // pull-request claim; this assertion is about the packages.
    expect(swapped.claims.filter((c) => c.kind === "package").map((c) => c.raw)).toEqual([
      "@clerk/expo",
    ]);

    // …and a deletion verb a clause away is NOT a statement about the package:
    // packages get the two readings prose gets, not the path rule's third one.
    expect(
      extract("the positional-array form was removed, and this repo is on `@tanstack/react-query` ^5.101.4"),
    ).toContainEqual(expect.objectContaining({ kind: "package", raw: "@tanstack/react-query" }));
  });

  it("refuses `npm t`, npm's own alias for the test script", () => {
    expect(rules.isReentrantGate("npm t")).toBe(true);
    expect(rules.isReentrantGate("pnpm t")).toBe(true);
    // …without claiming an ordinary token that merely starts with t.
    expect(rules.isReentrantGate("node t.js")).toBe(false);
    expect(rules.isReentrantGate("pnpm typecheck")).toBe(false);
  });

  it("refuses a package manager name that is not a plain name", () => {
    // It comes from verify.config.json and is interpolated into a pattern:
    // `pnpm(` made `new RegExp` throw from inside a pure decision function.
    expect(() => rules.scriptNameIn("pnpm( x", "pnpm(")).toThrow(/not a plain name/);
    expect(rules.scriptNameIn("pnpm typecheck", "pnpm")).toBe("typecheck");
  });

  it("refuses an absence claim when a file under the directory scope cannot be read", () => {
    // The file branch already returned NaN for this; the directory branch counted
    // an unreadable file as one that does not contain the pattern, so the absence
    // claim passed BECAUSE a file could not be opened.
    const cannotRead = factsWith({ grepCount: () => Number.NaN });
    const verdict = rules.evaluateRule(
      { kind: "absence", pattern: "sqlite", scope: "src" },
      cannotRead,
    );
    expect(verdict.disposition).toBe("fail");
    expect(verdict.detail).toContain("cannot read scope");
  });

  it("reads a fence as closed only by a run at least as wide as its opener", () => {
    // A three-backtick line inside a four-backtick block is CONTENT. Closing on
    // it flipped the state early and read the rest of the block as prose.
    const nested = [
      "````markdown",
      "outer",
      "```",
      "`src/does-not-exist.ts` is inside the outer fence",
      "````",
      "`src/lib/api.ts` is after it",
    ].join("\n");
    const claims = extract(nested);
    expect(claims.map((c) => c.line)).toEqual([6]);
    // An ordinary fence still opens and closes: the span inside it is not read
    // as prose, and the one after it is. Asserted without a package-manager
    // command, because the two repositories declare different managers.
    const ordinary = extract(
      ["```text", "`src/does-not-exist.ts`", "```", "`src/lib/api.ts`"].join("\n"),
    );
    expect(ordinary.map((c) => c.line)).toEqual([4]);
  });

  it("refuses a gate that names a test runner with a flag", () => {
    // `REENTRANT_TOKEN` anchored each alternative at the start of a token, so
    // `node --test` produced `--test` and passed the filter — and running it
    // starts the Node test runner, which runs the suite that reads this report.
    expect(rules.isReentrantGate("node --test")).toBe(true);
    expect(rules.isReentrantGate("node --test-reporter=spec app.test.js")).toBe(true);
  });

  it("refuses a line-range claim on a file it cannot read", () => {
    // `lineCount` returns null when the read fails, and the comparison used to
    // be skipped in that case — reporting `verified` for a range nothing
    // checked. The sibling rule (`grepCount` -> NaN -> fail) already refused it.
    const unreadable = factsWith({ fileExists: () => true, lineCount: () => null });
    const verdict = rules.evaluateRule(
      { kind: "path-lines", target: "src/lib/api.ts", from: 1, to: 15 },
      unreadable,
    );
    expect(verdict.disposition).toBe("fail");
    expect(verdict.detail).toContain("cannot read");
  });

  it("does not read a marker the document struck out", () => {
    // Every other rule honours `~~retracted~~`; markers did not, because they
    // were collected before the retraction pass ran. Worst case is the same as
    // the code-span hole: a retracted `attested <id>` still satisfied the
    // "referenced by a governed document" rule on its own, which is what stops a
    // stale attestation from ever being reported.
    const sameLine = scan.extractFromMarkdown(
      "~~<!-- vt-claim: attested old-device-check -->~~",
      { file: "PLAN.md" },
      POLICY,
    );
    expect(sameLine.claims).toEqual([]);
    expect(sameLine.excluded.map((e) => e.reason)).toContain("marker-retracted");

    // The run carries across lines, so the marker need not sit on the `~~` line.
    const acrossLines = scan.extractFromMarkdown(
      ["~~this note was withdrawn", "<!-- vt-claim: absent sqlite scope=deps -->", "still struck~~"].join(
        "\n",
      ),
      { file: "PLAN.md" },
      POLICY,
    );
    expect(acrossLines.claims).toEqual([]);
    expect(acrossLines.excluded.map((e) => e.reason)).toContain("marker-retracted");

    // A live marker still counts, and so does one inside a fence — `~~` in a
    // shell block is two tildes, not a strikethrough.
    expect(extract("The shell is live. <!-- vt-claim: attested some-id -->")).toContainEqual(
      expect.objectContaining({ kind: "attested", id: "some-id" }),
    );
    expect(
      extract(["```bash", "# <!-- vt-claim: absent sqlite scope=deps -->", "```"].join("\n")).map(
        (c) => c.kind,
      ),
    ).toContain("absence");
  });

  it("reports an unterminated ~~ run instead of silently blanking the rest of the file", () => {
    // `retracted` carries across lines by design. An odd number of runs left it
    // true to the end of the document, so every later line was read as struck and
    // its claims vanished — with no failure and no exclusion. The vacuous-scan
    // guard only fires at zero claims, so a partial skip like this passed.
    const claims = extract(
      ["~~this correction was never closed", "", "`src/lib/api.ts` is the client"].join("\n"),
    );
    expect(claims.map((c) => c.kind)).toContain("strikethrough-unterminated");
    expect(rules.evaluateRule({ kind: "strikethrough-unterminated" }, factsWith()).disposition).toBe(
      "fail",
    );
    // A closed run stays quiet, and the line after it is read normally.
    const closed = extract(["~~struck~~ text", "`src/lib/api.ts` is the client"].join("\n"));
    expect(closed.map((c) => c.kind)).not.toContain("strikethrough-unterminated");
    expect(closed).toContainEqual(expect.objectContaining({ kind: "path", target: "src/lib/api.ts" }));
  });

  it("reads a `` `x` `` span whole, so its contents cannot leak into the prose scan", () => {
    // These documents cite files as `` `src/lib/api.ts` `` — a longer fence around
    // a backticked reference. A single-backtick regex read that as two spans each
    // holding one space, and everything between them fell into prose: never
    // claimed, never declined, invisible. It also left the `~~` in `` `~~` ``
    // outside any span, so the strikethrough scanner treated a literal as a
    // delimiter — which is how this was found.
    const spans = scan.codeSpans("Cite files as `` `src/lib/api.ts` ``, not bare.");
    expect(spans).toHaveLength(1);
    expect(spans[0].text.trim()).toBe("`src/lib/api.ts`");
    // An opener with no closer is not a span, and does not swallow the line.
    expect(scan.codeSpans("a ` b")).toEqual([]);
    expect(scan.codeSpans("`a` and `b`").map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("reads `~~` inside a code span as literal text, not as a delimiter", () => {
    // Markdown renders `` `~~` `` as two tildes. Splitting on it regardless opened
    // a run that never closed on the first document to DOCUMENT the syntax — the
    // unterminated-run check above found it on the paragraph describing itself.
    const documented = extract(
      ["- An unterminated `~~` run blanks the rest of the file.", "`src/lib/api.ts` is the client"].join(
        "\n",
      ),
    );
    expect(documented.map((c) => c.kind)).not.toContain("strikethrough-unterminated");
    expect(documented).toContainEqual(
      expect.objectContaining({ kind: "path", target: "src/lib/api.ts" }),
    );
  });

  it("reports a struck code span as a former name instead of dropping it", () => {
    const found = scan.extractFromMarkdown(
      "~~`old/path.ts`~~ became `new/path.ts`",
      { file: "PLAN.md" },
      POLICY,
    );
    expect(found.claims.map((c) => c.raw)).toEqual(["new/path.ts"]);
    expect(found.excluded).toContainEqual(
      expect.objectContaining({ raw: "old/path.ts", reason: "former-name" }),
    );
  });

  it("reads a re-verify recipe with the package manager the repository uses", () => {
    // An npm-only reading sent every pnpm recipe down the file-exists branch,
    // where `pnpm cap:build:native` is reported as a path that does not exist.
    expect(rules.scriptNameIn("pnpm cap:build:native", "pnpm")).toBe("cap:build:native");
    expect(rules.scriptNameIn("pnpm run typecheck", "pnpm")).toBe("typecheck");
    expect(rules.scriptNameIn("pnpm exec tsx a.ts", "pnpm")).toBeNull();
    expect(rules.scriptNameIn("RESUBMISSION_RUNBOOK.md", "pnpm")).toBeNull();
  });

  it("reports an unparseable ledger as itself, not as a hundred failed claims", () => {
    // One `catch` around read-and-parse made a stray comma indistinguishable from
    // a missing file: the run continued on `{ entries: [] }`, and every claim the
    // ledger excused reported the wrong cause.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-claims-"));
    try {
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: {} }));
      fs.writeFileSync(path.join(dir, "PLAN.md"), "`package.json` is the manifest\n");
      fs.writeFileSync(path.join(dir, "registry.json"), "{ oops, not json }");
      fs.writeFileSync(
        path.join(dir, "verify.config.json"),
        JSON.stringify({
          defaultBranch: "main",
          governedDocs: ["PLAN.md"],
          registry: "registry.json",
          attestations: "attestations.json",
          prLedger: "pr-ledger.json",
          evidenceReport: "evidence.json",
          evidenceGates: [],
        }),
      );
      expect(() => verify({ root: dir })).toThrow(/registry\.json is not valid JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the reverse checks and the append-only filter", () => {
  /**
   * A repository whose ONLY citation of an excused claim is a line in an
   * append-only document that is already on `main`.
   *
   * This is the shape that took main red: `run.cjs` narrows an append-only
   * document's claims to the lines the BRANCH added — correct, and what keeps
   * 348 historical entries from being re-judged — and then hands that narrowed
   * set to the reverse checks, which ask a GLOBAL question ("does any live
   * claim anywhere reach this entry?"). On a branch the citing line is added,
   * so the entry matches and the gate is green. On `main` the diff is empty,
   * the citation is invisible, and the entry is reported as an orphan. Same
   * code, same entry, opposite verdicts — the asymmetry is deterministic, not
   * flaky, and every registry / PR-ledger / attestation entry whose sole
   * citation lives in the log inherits it the moment its branch merges.
   */
  function fixtureOnMain(): string {
    const childProcess = require("node:child_process") as typeof import("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-appendonly-"));
    const git = (...args: string[]) =>
      childProcess.spawnSync("git", args, { cwd: dir, encoding: "utf8" as const });

    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: {} }));
    // The excused claim: a path deliberately not in the tree, cited once, in the log.
    // WORDING MATTERS, and it cost a false RED: "removed the helper `X`" is
    // classified `deletion-record` and never becomes a claim, so the first
    // version of this fixture orphaned the entry for a reason unrelated to the
    // defect. The scanner was right; the harness was wrong.
    fs.writeFileSync(path.join(dir, "LOG.md"), "2026-01-01 - the audit cited `src/gone.ts` in its findings.\n");
    fs.writeFileSync(
      path.join(dir, "registry.json"),
      JSON.stringify({
        entries: [
          { kind: "path", match: "src/gone.ts", reason: "deleted; this log line records the deletion" },
        ],
      }),
    );
    // A SECOND, ORDINARY governed document, because a repository whose only
    // governed document is append-only is degenerate: on `main` the judged set
    // would be empty and the `vacuous-scan` guard would fire for a reason that
    // is not the defect. The real repository has twenty non-append-only docs.
    fs.writeFileSync(path.join(dir, "NOTES.md"), "The manifest is `package.json`.\n");
    fs.writeFileSync(
      path.join(dir, "verify.config.json"),
      JSON.stringify({
        defaultBranch: "main",
        governedDocs: ["LOG.md", "NOTES.md"],
        appendOnlyDocs: ["LOG.md"],
        registry: "registry.json",
        attestations: "attestations.json",
        prLedger: "pr-ledger.json",
        evidenceReport: "evidence.json",
        evidenceGates: [],
      }),
    );

    git("init", "-b", "main");
    git("config", "user.email", "gate@example.invalid");
    git("config", "user.name", "gate");
    git("add", "-A");
    git("commit", "-m", "seed");
    // A clean tree against `refs/heads/main` is the main condition: `addedLines`
    // returns an EMPTY set rather than null, which is the branch this exercises.
    // (null takes the `append-only-undiffable` path instead and proves nothing.)
    return dir;
  }

  it("REFUSES to orphan a registry entry whose only citation is already on main", () => {
    const dir = fixtureOnMain();
    try {
      const result = verify({ root: dir, now: "2026-01-02" });
      const orphans = result.failures.filter((f) => f.kind === "registry-orphan");
      expect(orphans).toEqual([]);
      // And the append-only protection is INTACT: the historical line is still
      // not re-judged, so the run carries no claim-level failure either. If the
      // fix had simply stopped filtering, this assertion would catch it.
      expect(result.failures).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still judges a claim on the line a branch adds, and still excuses it by the registry", () => {
    // The other half of the asymmetry, asserted so the fix cannot be "ignore the
    // append-only rule": an ADDED line must reach the claim-level rules.
    const dir = fixtureOnMain();
    try {
      fs.writeFileSync(
        path.join(dir, "LOG.md"),
        "2026-01-01 - the audit cited `src/gone.ts` in its findings.\n2026-01-02 - and again `src/gone.ts`.\n",
      );
      const result = verify({ root: dir, now: "2026-01-02" });
      expect(result.failures).toEqual([]);
      expect(result.counts.registered).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the engine's own source", () => {
  it("carries no control bytes", () => {
    // A previous globToRegExp substituted a sentinel for `**` and substituted it
    // back; the sentinel it shipped with was a literal NUL. Nothing failed —
    // the transformation still worked — but grep read the file as binary and a
    // later edit that matched on the intended character silently did nothing,
    // leaving twenty glob claims failing against a fix that looked applied.
    const offenders = fs
      .readdirSync(ENGINE_DIR)
      .filter((name) => name.endsWith(".js") || name.endsWith(".cjs"))
      .filter((name) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(
        fs.readFileSync(path.join(ENGINE_DIR, name), "utf8"),
      ));
    expect(offenders).toEqual([]);
  });
});

describe("the shared engine", () => {
  it("matches the fingerprint recorded in verify.config.json", () => {
    // The engine exists as two copies, in two repositories, and nothing offline
    // can compare them. This does not prove they agree — it makes changing one
    // of them impossible to do QUIETLY: the recorded value stops matching, and
    // updating it is a reviewable line that says "the shared engine changed",
    // which is the moment someone decides whether the sibling needs it too.
    const actual = fingerprint.fingerprintEngine(ENGINE_DIR);
    expect(`${actual.fingerprint} (sibling: ${config.siblingRepo})`).toBe(
      `${config.engineFingerprint} (sibling: ${config.siblingRepo})`,
    );
  });

  it("hashes every module, so a new one cannot slip in unhashed", () => {
    // Both sides used to derive from ENGINE_MODULES — `fingerprintEngine`
    // iterates that same list to build `files` — so a module added to the
    // directory and left out of the list kept the lengths equal and the test
    // passed while the module sat outside the fingerprint. That is the case this
    // test is named for, so it compares against what is actually on disk.
    const { files } = fingerprint.fingerprintEngine(ENGINE_DIR);
    const onDisk = fs
      .readdirSync(ENGINE_DIR)
      .filter((name) => name.endsWith(".js") || name.endsWith(".cjs"));
    expect(onDisk).not.toEqual([]);
    expect([...files].sort()).toEqual([...onDisk].sort());
  });
});

describe("this repository's governed documents", () => {
  // THE REAL DATE, not a pinned one. A pinned `now` froze layer 4: an
  // attestation past its staleness budget still resolved as `attested` here, and
  // only the CLI run in CI — which uses the real clock — would ever have said so.
  // The budget is the point of the layer; a suite that cannot see it expire is
  // not checking it. Built in `beforeAll` rather than in the describe body so a
  // configuration error fails a named test instead of aborting collection.
  let result: VerifyResult;
  beforeAll(() => {
    result = verify();
  });

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
