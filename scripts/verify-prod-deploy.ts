#!/usr/bin/env tsx
/**
 * Poll production /api/version until gitCommit matches target, then run API smoke probes.
 * Usage: tsx scripts/verify-prod-deploy.ts <target-sha-prefix> [--timeout 600] [--prod https://vettrack.uk]
 *
 * TWO invariants, in two different failure directions. The second exists because
 * guarding only the first kept shipping the opposite bug.
 *
 *   A. AN UNVERIFIABLE INPUT IS NEVER A MATCH. An input this script cannot
 *      interpret must stop it, not slip past. Guards against a FALSE PASS.
 *   B. A VERIFIABLE INPUT IS NEVER REJECTED FOR A REASON THE SCRIPT INVENTED. A
 *      false FAIL is a second bug class, not the safe side of the first, and this
 *      file shipped one in three of four review rounds. Concretely: every
 *      normalisation the target gets, the reported value must get too.
 *
 * Both were violated in ONE shape, repeatedly: a value that was FALSY BUT PRESENT
 * satisfied the check written to reject it. The cause was never a bad check — it
 * was three structures in which "absent", "empty" and "malformed" were the SAME
 * VALUE, so nothing downstream could tell them apart. Each is now a tagged type,
 * which is why the bug class is unrepresentable rather than guarded:
 *
 *   1. argv    -> parseArgs() returns `absent | present(value)` per input and
 *                 flags consume their values. An omitted argument and one supplied
 *                 as empty are different values; an unknown flag or stray
 *                 positional is an error, not a silent revert to a default.
 *   2. a poll  -> classifyPoll() returns a tagged PollOutcome; diagnose() maps the
 *                 accumulated observations to a verdict. See waitForDeploy.
 *   3. a body  -> fetchJson() returns `parsed | unparseable`, so "could not be
 *                 parsed" and "was an empty object" are distinguishable. Without
 *                 this, a 200 declaring application/json and serving the SPA shell
 *                 was reported as a build that forgot its SHA — sending an operator
 *                 to the wrong file during an incident whose fault is routing.
 *
 * The /api/health block is a DIAGNOSTIC HINT and is wrapped so nothing inside it
 * can reach `pass`, the exit code, or the verdict. That is structural, not a
 * convention each future edit must remember: a hint that can fail the gate is not
 * a hint. It gates in the same order as classifyPoll — transport (status +
 * content-type; 200 AND 503 are both health reports, see server/routes/health.ts)
 * -> unparseable -> parsed-non-object -> the checks object -> the worker field.
 * AN ABSENT READING IS NOT A BAD READING.
 *
 * A NOTE ON THE COMMENTS HERE, earned the hard way: nine comments in this file
 * asserted invariants the code did not hold, and one of them ("this state can only
 * be produced by a real JSON 200") let a defect survive a full restructure. A
 * comment that misstates the code is worse than no comment. If you change a gate,
 * change the sentence above it or delete it.
 *
 * Env tunables:
 *   VT_VERIFY_POLL_SECS        seconds between polls (default 10)
 *   VT_VERIFY_NULL_GRACE_SECS  seconds a missing gitCommit is tolerated before it is
 *                              reported as such rather than polled to timeout (default 60)
 */
import { execSync } from "node:child_process";

const DEFAULT_PROD = "https://vettrack.uk";
const DEFAULT_TIMEOUT_SECS = 600;

/**
 * An input that was not supplied is a DIFFERENT THING from one supplied as empty.
 *
 * Collapsing them is the single root cause behind this file's repeat defect: the
 * caller's `$GITHUB_SHA` or `$(git rev-parse HEAD | head -c 8)` coming back empty
 * is a broken command line and must be loud, while omitting the argument entirely
 * is a legitimate request for the default. Once both are the string "", no amount
 * of care at the point of use can tell them apart — so they are never both "".
 */
type ArgValue = { readonly kind: "absent" } | { readonly kind: "present"; readonly value: string };

const ABSENT: ArgValue = { kind: "absent" };

type ParsedArgs = {
  readonly target: ArgValue;
  readonly prod: ArgValue;
  readonly timeout: ArgValue;
};

const KNOWN_FLAGS = ["--prod", "--timeout"] as const;
type KnownFlag = (typeof KNOWN_FLAGS)[number];

function isKnownFlag(token: string): token is KnownFlag {
  return (KNOWN_FLAGS as readonly string[]).includes(token);
}

/**
 * Left-to-right argv parse in which a flag CONSUMES its value.
 *
 * The old parser built positionals as "every token not starting with --", so
 * `--prod https://x` put the URL into the positional list and it became the
 * target. That is why the header used to warn that the target must come FIRST —
 * a documented footgun standing in for a parser bug. Consuming values removes it,
 * and leaves anything unconsumed as unambiguous junk that must stop the run:
 * `--timout 20` silently restored the 600s default before, and a stray positional
 * was dropped on the floor. Both are "an input this script cannot interpret".
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<KnownFlag, ArgValue>(KNOWN_FLAGS.map((f) => [f, ABSENT]));
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    if (!isKnownFlag(token)) {
      throw new Error(
        `unknown flag ${JSON.stringify(token)}. Known flags are ${KNOWN_FLAGS.join(", ")}. ` +
          "Refusing to run: an unrecognised flag was previously ignored, which silently " +
          "restored the default it was meant to override (a misspelled `--timout 20` left " +
          `the timeout at ${DEFAULT_TIMEOUT_SECS}s), and a verifier running on settings the ` +
          "caller did not ask for cannot be trusted about what it verified.",
      );
    }
    if (flags.get(token)?.kind === "present") {
      throw new Error(`${token} was given more than once; refusing to guess which value wins.`);
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(
        `${token} needs a value (got ${next === undefined ? "end of arguments" : JSON.stringify(next)}). ` +
          "A flag whose value is missing must not fall back to the default — that is how a " +
          "typo becomes a silent change of what is being verified.",
      );
    }
    flags.set(token, { kind: "present", value: next });
    i += 1; // consume the value, so it can never be read as the target
  }

  if (positionals.length > 1) {
    throw new Error(
      `unexpected extra argument(s) ${positionals.slice(1).map((a) => JSON.stringify(a)).join(", ")}. ` +
        "Exactly one positional is accepted: the target commit. Extra tokens were previously " +
        "ignored, which hides a mistyped flag (its value is left over as a positional).",
    );
  }

  return {
    target: positionals.length === 1 ? { kind: "present", value: positionals[0] } : ABSENT,
    prod: flags.get("--prod") ?? ABSENT,
    timeout: flags.get("--timeout") ?? ABSENT,
  };
}

/** `git rev-parse HEAD`, or "" when this is not a usable checkout. Never throws. */
function gitHeadOrEmpty(): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Shortest prefix accepted as a commit identifier.
 *
 * 7 is git's own `--short` default and the length GitHub's commit UI offers for
 * copy-paste, so it is the shortest thing a human legitimately pastes here.
 * Below that, a "target" is almost certainly a stray token — a bare `--timeout`
 * value, a branch fragment — and prefix-matching on 2-3 characters would match a
 * large share of all commits. A verifier an accident can satisfy is worse than no
 * verifier, so a shorter target is rejected outright rather than clamped.
 */
const MIN_TARGET_LEN = 7;

/**
 * Seconds from an env var. Tunable so tests can collapse the cadence.
 *
 * Three cases, deliberately not two — the same absent/empty/malformed split the
 * argv parser makes, because the same failure lives here:
 *
 *   unset or blank  → the fallback. An unset `${{ vars.X }}` in a workflow expands
 *                     to exactly "", and `Number("")` is 0, which would pass a naive
 *                     `>= 0` guard and mean "poll with no delay" / "no grace at all".
 *   malformed       → THROW. `Number("abc")` is NaN and a negative is below the
 *                     floor; both used to revert to the default in silence, so the
 *                     verifier ran on a cadence the caller never asked for and had
 *                     no way to notice. That is the same defect that makes a
 *                     misspelled `--timout` a hard error above — a typo must not
 *                     quietly change what the run actually did.
 *   valid           → the value.
 */
function envSeconds(name: string, fallbackSecs: number, minSecs = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallbackSecs * 1000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minSecs) {
    throw new Error(
      `${name}=${JSON.stringify(process.env[name])} is not a usable number of seconds ` +
        `(need a finite value >= ${minSecs}). Leave it unset to use the ${fallbackSecs}s default. ` +
        "Refusing to run: this used to fall back silently, so a typo changed the cadence the " +
        "verifier actually ran at while the log still looked normal.",
    );
  }
  return parsed * 1000;
}

/** Floor the poll interval: a 0s interval would hammer /api/version for the whole timeout. */
const MIN_POLL_SECS = 0.01;

/**
 * Every resolved input, established before the banner prints or a socket opens.
 *
 * These were module-level `const`s computed at import. Resolving them inside main()
 * means a malformed invocation throws where `main().catch()` can report it, instead
 * of as an uncaught module-init error, and it is what lets each resolver below
 * throw a message specific to the input it owns.
 */
type Config = {
  readonly target: string;
  readonly prod: string;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly nullGraceMs: number;
};

/**
 * Absent → fall back to HEAD. Present-but-empty → stop.
 *
 * This is the distinction the old `positional[0]?.trim() || gitHeadOrEmpty()` could
 * not express, and it was a false PASS, not a cosmetic issue: on a CI runner whose
 * checkout is at the commit production is already serving — the normal case for a
 * post-deploy verification — an empty `$GITHUB_SHA` fell through to HEAD, matched
 * on the first poll, and the script reported ALL PROBES PASS in ~300ms having
 * verified nothing the caller asked about. The two cases now produce different
 * verdicts, so neither can be mistaken for the other in a CI log.
 *
 * DELIBERATE RESIDUAL, stated rather than left to be rediscovered: the absent
 * branch below still falls back to HEAD, and an UNQUOTED `$GITHUB_SHA` that is
 * unset expands to zero arguments rather than to "" — so that shell form still
 * reaches the HEAD fallback and can still pass while proving little. The argument
 * in the error text above applies to it too. It is kept because "omit the target,
 * verify HEAD" is a legitimate and documented local workflow, and because absent
 * is genuinely absent here — not a falsy value masquerading as one, which is the
 * class this file keeps regressing on. Callers in CI should QUOTE the variable, so
 * an unset value arrives as the empty string and gets the loud verdict.
 */
function resolveTarget(arg: ArgValue): string {
  if (arg.kind === "present" && !arg.value.trim()) {
    throw new Error(
      `the target commit argument was supplied but is empty (${JSON.stringify(arg.value)}). ` +
        "This is NOT the same as omitting it, and must not fall back to `git rev-parse HEAD`: " +
        "the caller asked to verify a specific commit and the shell handed over nothing — " +
        "typically `$GITHUB_SHA` unset, or `$(git rev-parse HEAD | head -c 8)` returning " +
        "empty. Falling back would silently verify the RUNNER's HEAD instead, which on a " +
        "post-deploy check is usually the very commit production already serves, so the run " +
        "would pass while proving nothing. Omit the argument entirely to intend the HEAD default.",
    );
  }

  const raw = arg.kind === "present" ? arg.value.trim() : gitHeadOrEmpty();
  if (!raw) {
    throw new Error(
      "no target commit: no SHA was given and `git rev-parse HEAD` could not resolve one. " +
        "Pass the commit explicitly, e.g. " +
        "`tsx scripts/verify-prod-deploy.ts $(git rev-parse HEAD)`. Refusing to poll: a " +
        "target that cannot be established can never be verified, and must not be " +
        "reported as deployed.",
    );
  }

  const target = raw.replace(/^origin\//, "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(target) || target.length < MIN_TARGET_LEN) {
    throw new Error(
      `target ${JSON.stringify(target)} is not a usable commit identifier ` +
        `(need at least ${MIN_TARGET_LEN} hex characters). /api/version reports a SHA and ` +
        "this script string-compares against it — it never resolves branches or tags, so a " +
        "non-hex or over-short target could only ever match by accident or not at all.",
    );
  }
  return target;
}

/** Absent → the production default. Present-but-empty → stop, rather than blame production. */
function resolveProd(arg: ArgValue): string {
  if (arg.kind === "absent") return DEFAULT_PROD;
  const prod = arg.value.trim();
  if (!prod || !/^https?:\/\/[^\s]+$/i.test(prod)) {
    throw new Error(
      `--prod ${JSON.stringify(arg.value)} is not an absolute http(s) URL. An unset ` +
        "workflow variable expands to the empty string, which would make every fetch fail " +
        "to parse and be misreported as production being unreachable.",
    );
  }
  // Strip trailing slashes: `https://vettrack.uk/` would build `//api/version`,
  // which most routers do not match — so a perfectly verifiable input gets
  // reported as a routing fault. That is invariant B, in the resolver of the file
  // that declares invariant B.
  return prod.replace(/\/+$/, "");
}

/** Absent → the default timeout. Present-but-unparseable → stop, rather than reach the loop as NaN. */
function resolveTimeoutMs(arg: ArgValue): number {
  if (arg.kind === "absent") return DEFAULT_TIMEOUT_SECS * 1000;
  const secs = Number(arg.value.trim());
  if (!Number.isFinite(secs) || secs <= 0) {
    throw new Error(
      "--timeout needs a positive number of seconds " +
        `(got ${JSON.stringify(arg.value)}). A blank or non-numeric value yields NaN/0, and ` +
        "the poll loop then exits before its first iteration and reports a timeout it never " +
        "actually waited out.",
    );
  }
  return secs * 1000;
}

function resolveConfig(argv: readonly string[]): Config {
  const args = parseArgs(argv);
  return {
    target: resolveTarget(args.target),
    prod: resolveProd(args.prod),
    timeoutMs: resolveTimeoutMs(args.timeout),
    pollMs: envSeconds("VT_VERIFY_POLL_SECS", 10, MIN_POLL_SECS),
    nullGraceMs: envSeconds("VT_VERIFY_NULL_GRACE_SECS", 60),
  };
}

/**
 * Prefix match on the SHORTER of the two strings.
 *
 * The target and the reported commit are abbreviated independently: git's
 * `--short` default and GitHub's commit UI both hand out 7 characters, while
 * /api/version reports the full SHA. Comparing a fixed `slice(0, 8)` of each meant
 * a 7-char target could never equal an 8-char slice, so a CORRECT deploy polled to
 * the full timeout and reported failure.
 *
 * The `n < MIN_TARGET_LEN` floor guards the REPORTED side, which no amount of
 * validation on the target covers: a production answering `gitCommit: "8a"` must
 * not match every target beginning "8a".
 *
 * PRECONDITION, stated because leaving it implicit is what broke it: BOTH sides
 * arrive already lower-cased — `cfg.target` by resolveTarget, `reported` by
 * classifyPoll. This is a case-sensitive `===`, so any future caller that skips
 * that normalisation reintroduces the false FAIL described under invariant B.
 */
function matchesTarget(cfg: Config, reported: string): boolean {
  const n = Math.min(cfg.target.length, reported.length);
  if (n < MIN_TARGET_LEN) return false;
  return reported.slice(0, n) === cfg.target.slice(0, n);
}

type VersionPayload = {
  gitCommit?: string | null;
  pilotMode?: { backend?: boolean; frontend?: boolean; mismatch?: boolean };
};

/** Longest body excerpt quoted in a verdict or a WARN. Enough to recognise HTML or an error page. */
const BODY_SNIPPET_MAX = 80;

/**
 * A short, single-line, printable excerpt of a body, for quoting in a verdict or a WARN.
 *
 * A diagnosis that says "unreadable" without saying WHAT it read is the same dead
 * end as reporting `{}`: the reader still cannot tell a proxy error page from an
 * SPA shell from a truncated response. Newlines are collapsed and non-printables
 * dropped so a stray HTML blob cannot wreck a CI log or smuggle terminal escapes.
 */
function bodySnippet(text: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "").trim();
  if (!flat) return "(empty body)";
  return flat.length > BODY_SNIPPET_MAX ? `${flat.slice(0, BODY_SNIPPET_MAX)}...` : flat;
}

/**
 * A body that could not be parsed is a DIFFERENT THING from one that parsed to
 * nothing useful — the same absent/empty/malformed split this file makes for argv
 * and for the cadence env vars, applied to the one input that never got it.
 *
 * `res.json().catch(() => ({}))` made "the response was not JSON" and "the response
 * was an empty JSON object" the identical value `{}`. Every caller downstream then
 * had to guess, and the poll classifier guessed "the build forgot its SHA".
 */
type JsonBody<T> =
  | { readonly kind: "parsed"; readonly value: T }
  | { readonly kind: "unparseable"; readonly snippet: string };

async function fetchJson<T>(
  cfg: Config,
  path: string,
): Promise<{ status: number; ct: string; body: JsonBody<T> }> {
  const res = await fetch(`${cfg.prod}${path}`, {
    headers: { Accept: "application/json" },
  });
  const ct = res.headers.get("content-type") ?? "";
  // Read as text and parse here, rather than `res.json()`, so the bytes that failed
  // to parse are still available to quote.
  //
  // NEITHER await below is guarded, so this function can reject in two ways that no
  // `JsonBody` value can describe: `fetch` failing to connect, and `res.text()`
  // failing mid-body. That is deliberate — they are transport failures, not body
  // shapes — but it makes the behaviour A PROPERTY OF EACH CALL SITE, not of this
  // function. An earlier version of this comment claimed "the caller classifies that
  // as unreachable, which is what it is", which was true of one caller and false of
  // the other: classifyPoll wraps its call and does classify it as unreachable, while
  // the /api/health call site did not wrap its call at all and exited 1 with a bare
  // stack trace and no verdict. Both are now guarded. Any THIRD caller must wrap too.
  const text = await res.text();
  try {
    return { status: res.status, ct, body: { kind: "parsed", value: JSON.parse(text) as T } };
  } catch {
    return { status: res.status, ct, body: { kind: "unparseable", snippet: bodySnippet(text) } };
  }
}

/**
 * What ONE poll established. Each failure mode is its own case.
 *
 * Classifying once, here, is what stops a routing fault from being reported as a
 * build-provenance fault. The gate is in two layers because the fault has two
 * layers: `non-json` covers the TRANSPORT shape (status + content-type), and
 * `unreadable-json` covers a response that claims JSON and then serves something
 * that is not a JSON object. Round 3 added only the first, which left the second
 * collapsing into `no-revision` — a 200 `application/json` carrying the SPA shell
 * was reported as "the build produced build-info.json without a commit SHA".
 *
 * The invariant that now actually holds: `no-revision` is produced only by a JSON
 * 200 whose body parsed to an OBJECT that named no commit. It is checked by the
 * "a JSON content-type over an unreadable body is a routing fault" cases in
 * tests/verify-prod-deploy.test.ts, which is what will catch the next restructure.
 */
type PollOutcome =
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "non-json"; readonly shape: string }
  | { readonly kind: "unreadable-json"; readonly detail: string }
  | { readonly kind: "revision"; readonly payload: VersionPayload; readonly commit: string }
  | { readonly kind: "no-revision"; readonly payload: VersionPayload };

async function classifyPoll(cfg: Config): Promise<PollOutcome> {
  let res: { status: number; ct: string; body: JsonBody<unknown> };
  try {
    res = await fetchJson<unknown>(cfg, "/api/version");
  } catch (err) {
    // Connection refused / socket hang-up is what a container restart looks like
    // mid-cutover. Transient by nature: never a verdict on its own.
    return { kind: "unreachable", message: (err as Error).message };
  }
  if (res.status !== 200 || !res.ct.includes("application/json")) {
    return {
      kind: "non-json",
      shape: `status=${res.status} content-type=${res.ct.split(";")[0] || "(none)"}`,
    };
  }
  if (res.body.kind === "unparseable") {
    return { kind: "unreadable-json", detail: `the body is not JSON at all: ${res.body.snippet}` };
  }
  const payload = res.body.value;
  // `JSON.parse("null")` SUCCEEDS, so a parse-only guard does not cover this: the
  // field read below would be `null.gitCommit`, a TypeError thrown outside the try
  // above, which escaped waitForDeploy and exited with a stack trace and no verdict.
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    const shape = Array.isArray(payload) ? "an array" : payload === null ? "null" : `a ${typeof payload}`;
    return {
      kind: "unreadable-json",
      detail: `the body parsed as JSON but is ${shape}, not an object: ${bodySnippet(JSON.stringify(payload))}`,
    };
  }
  const reported = (payload as VersionPayload).gitCommit;
  // Lowercased to match `resolveTarget`, which lowercases the target. Comparing a
  // normalised target against an as-received commit made an UPPERCASE SHA — what a
  // hand-copied ticket reference or a case-normalising CI variable hands over —
  // unable to match a byte-identical target, i.e. a FALSE FAIL on input that was
  // perfectly verifiable. See the header note on the second failure direction.
  const commit = typeof reported === "string" ? reported.trim().toLowerCase() : "";
  return commit
    ? { kind: "revision", payload: payload as VersionPayload, commit }
    : { kind: "no-revision", payload: payload as VersionPayload };
}

/** Everything the poll loop has learned so far. `diagnose` is a pure function of this. */
type Observations = {
  sawResponse: boolean;
  /** A JSON 200 whose body actually parsed to an object — NOT merely a JSON content-type. */
  sawJsonVersion: boolean;
  sawRevision: boolean;
  lastReported: string;
  lastShape: string;
  lastUnreadable: string;
  /**
   * Which transport fault was seen MOST RECENTLY — last-write-wins, deliberately.
   *
   * A cutover can show both (a `text/html` 200 from the SPA catch-all, then a
   * declared-JSON error page from an edge proxy). Both point at routing, so either
   * verdict is correct; what must not happen is the choice being emergent from
   * whichever flag happened to latch first. Pinned by the "reports the transport
   * fault seen MOST RECENTLY" case in tests/verify-prod-deploy.test.ts.
   */
  lastFault: "none" | "shape" | "unreadable";
};

/**
 * Map accumulated observations to the verdict, or to `null` for "keep waiting".
 *
 * Splitting this out is the fix for the second structural defect, and it is a
 * CORRECTNESS fix rather than a tuning one. The verdict used to be chosen by a
 * mid-loop `if` racing a second deadline: `nullDeadline = started + min(grace,
 * timeout)`, tested inside `while (now < deadline)`. Whenever the timeout was at or
 * below the grace window those two collapsed onto the same instant and the
 * conditions became mutually exclusive — so for every `--timeout <= 60` the
 * specific diagnoses could not fire AT ALL and the loop fell out to the generic
 * "did not match within Ns". That is every invocation in the redeploy runbook.
 *
 * Now the diagnosis is a pure function of what was observed, consulted at every
 * point the loop can conclude — including the moment the overall deadline expires.
 * A short timeout therefore gets the same verdict as a long one; only the amount of
 * waiting differs. There is no second deadline left to collide with the first.
 */
function diagnose(cfg: Config, obs: Observations, waitedMs: number): Error | null {
  // A server that never answered has made no claim about its build, and must not
  // be accused of having lost its SHA. This ordering is load-bearing.
  if (!obs.sawResponse) return null;
  const waited = Math.round(waitedMs / 1000);

  // Most specific first: a version endpoint that never answered as a readable JSON
  // object has not made a claim about its build at all.
  if (!obs.sawJsonVersion) {
    // A response that DECLARED JSON and then served something else is its own
    // fault, and gets its own verdict. Folding it into the shape verdict below
    // would report `content-type=application/json` under the headline "not
    // answering as JSON", which reads as a contradiction and tells the reader
    // nothing about the body that actually arrived.
    if (obs.lastFault === "unreadable") {
      return new Error(
        `/api/version declared content-type application/json but served a body that ` +
          `could not be read as a JSON object — ${obs.lastUnreadable}, for ${waited}s. ` +
          `This is NOT a missing build SHA and NOT a slow deploy: the response never named ` +
          `a commit because nothing in it was readable as a version payload. A declared-JSON ` +
          `body that is actually HTML is a proxy, a CDN error page, or the SPA catch-all ` +
          `answering in the version route's place. Check the API router mounting and that ` +
          `${cfg.prod} points at the app rather than a proxy or a static host.`,
      );
    }
    return new Error(
      `/api/version is not answering as JSON — last response ${obs.lastShape}, for ${waited}s. ` +
        `This is NOT a slow deploy and NOT a missing build SHA: the request is not ` +
        `reaching the version route at all (a 200 text/html here is the SPA catch-all ` +
        `swallowing an unmatched /api path). Check the API router mounting and that ` +
        `${cfg.prod} points at the app rather than a proxy or a static host.`,
    );
  }

  // Distinct from the timeout on purpose. "did not match within 600s" reads as a
  // slow deploy and sends the reader to look at build times; the actual fault is
  // that the build never recorded which commit it came from.
  if (!obs.sawRevision) {
    return new Error(
      `production cannot report its revision — /api/version returned no gitCommit for ` +
        `${waited}s. This is NOT a slow deploy: the ` +
        `running build produced build-info.json without a commit SHA, so no amount of ` +
        `polling can ever match ${cfg.target}. Check that scripts/write-build-sha.sh ran before ` +
        `\`railway up\` and that vt-build-sha.txt reached the build context ` +
        `(see scripts/build-sha.ts).`,
    );
  }
  return null;
}

async function waitForDeploy(cfg: Config): Promise<VersionPayload> {
  const started = Date.now();
  const deadline = started + cfg.timeoutMs;
  // Bounded by the overall deadline only through the loop itself — deliberately NOT
  // `min(grace, timeout)`, which is what made the two deadlines collide.
  const graceExpiry = started + cfg.nullGraceMs;
  const obs: Observations = {
    sawResponse: false,
    sawJsonVersion: false,
    sawRevision: false,
    lastReported: "(none)",
    lastShape: "(none)",
    lastUnreadable: "(none)",
    lastFault: "none",
  };

  while (Date.now() < deadline) {
    const outcome = await classifyPoll(cfg);

    switch (outcome.kind) {
      case "unreachable":
        console.log(`[poll] unreachable: ${outcome.message}`);
        break;
      case "non-json":
        obs.sawResponse = true;
        obs.lastShape = outcome.shape;
        obs.lastFault = "shape";
        console.log(`[poll] /api/version did not answer as JSON: ${outcome.shape}`);
        break;
      case "unreadable-json":
        // Deliberately does NOT set sawJsonVersion: a JSON content-type is not a
        // JSON payload, and treating it as one is precisely how this response
        // reached the build-provenance verdict.
        obs.sawResponse = true;
        obs.lastUnreadable = outcome.detail;
        obs.lastFault = "unreadable";
        console.log(`[poll] /api/version body is unreadable: ${outcome.detail}`);
        break;
      case "revision": {
        obs.sawResponse = true;
        obs.sawJsonVersion = true;
        obs.sawRevision = true;
        obs.lastReported = outcome.commit.slice(0, 8);
        console.log(
          `[poll] gitCommit=${obs.lastReported} target=${cfg.target.slice(0, 8)}`,
        );
        if (matchesTarget(cfg, outcome.commit)) return outcome.payload;
        break;
      }
      case "no-revision":
        obs.sawResponse = true;
        obs.sawJsonVersion = true;
        console.log(`[poll] gitCommit=(none) target=${cfg.target.slice(0, 8)}`);
        break;
    }

    // Conclude as soon as the grace window has told us all it can.
    if (Date.now() >= graceExpiry) {
      const verdict = diagnose(cfg, obs, Date.now() - started);
      if (verdict) throw verdict;
    }

    // Never sleep past a decision point. Without this clamp a 5s run still took a
    // full 10s poll interval to report — the loop slept blind, then noticed its
    // deadline had passed. This is the LATENCY half of the fix; `diagnose` at the
    // exit below is the CORRECTNESS half, and it holds even if this clamp is wrong.
    //
    // The delay can be NEGATIVE, and an earlier version of this comment claimed
    // otherwise ("both bounds are strictly in the future here ... by the loop
    // condition just above"). They are not: the loop condition was evaluated before
    // an awaited network poll, and a poll that outlasts the remaining budget leaves
    // `deadline` in the past — e.g. `--timeout 3` against a host that takes 4s to
    // answer. `graceExpiry` alone is safe, since it is only used while still ahead.
    //
    // The consequence is benign, which is why it survived: setTimeout clamps a
    // negative delay to 1ms (with a TimeoutNegativeWarning on stderr) and the loop
    // condition then immediately fails, so control reaches `diagnose` below exactly
    // as intended. Verified, not assumed. Recorded here rather than guarded because
    // a `Math.max(0, ...)` would only suppress the warning, and an untrue comment
    // about why a branch is unreachable is what let the last defect survive a
    // restructure.
    const nextDecision = Date.now() >= graceExpiry ? deadline : Math.min(deadline, graceExpiry);
    await new Promise((r) => setTimeout(r, Math.min(cfg.pollMs, nextDecision - Date.now())));
  }

  // The overall deadline is itself a conclusion point. Reaching it without asking
  // `diagnose` is exactly how a short timeout used to lose its specific verdict.
  const verdict = diagnose(cfg, obs, Date.now() - started);
  if (verdict) throw verdict;

  throw new Error(
    `Timeout: production gitCommit did not match ${cfg.target} within ${cfg.timeoutMs / 1000}s ` +
      `(last reported: ${obs.lastReported})`,
  );
}

async function probeApi(cfg: Config, path: string): Promise<boolean> {
  const res = await fetch(`${cfg.prod}${path}`, { headers: { Accept: "application/json" } });
  const ct = res.headers.get("content-type") ?? "";
  const ok = res.status === 401 && ct.includes("application/json");
  console.log(
    `${ok ? "PASS" : "FAIL"} ${path} status=${res.status} content-type=${ct.split(";")[0]}`,
  );
  return ok;
}

/**
 * An unmatched /api/* path must be a JSON 404 — never the SPA shell.
 *
 * A 200 text/html here means the API router chain did not match and the request
 * reached the SPA catch-all. That is silent: the client gets a success code and
 * an HTML body where it expected JSON.
 */
async function probeApiNotFound(cfg: Config, path: string): Promise<boolean> {
  const res = await fetch(`${cfg.prod}${path}`, { headers: { Accept: "application/json" } });
  const ct = res.headers.get("content-type") ?? "";
  const ok = res.status === 404 && ct.includes("application/json");
  console.log(
    `${ok ? "PASS" : "FAIL"} ${path} status=${res.status} content-type=${ct.split(";")[0]}` +
      (ok ? "" : " — unmatched /api paths must be JSON 404, not the SPA shell"),
  );
  return ok;
}

async function main(): Promise<void> {
  // First statement in the program's real work: nothing is printed and no socket
  // is opened until every input is known to be interpretable.
  const cfg = resolveConfig(process.argv.slice(2));

  console.log(`=== verify-prod-deploy ===`);
  console.log(`PROD=${cfg.prod} TARGET=${cfg.target} TIMEOUT=${cfg.timeoutMs / 1000}s`);

  const version = await waitForDeploy(cfg);

  let pass = true;
  const pilot = version.pilotMode;
  if (pilot?.backend !== false || pilot?.frontend !== false || pilot?.mismatch !== false) {
    console.log("FAIL pilotMode", pilot);
    pass = false;
  } else {
    console.log("PASS pilotMode", pilot);
  }

  // Probe the paths CLIENTS call, never the server's own mount strings. On
  // 2026-08-14 this list carried "/api/clinical/me/active" — the server's mount —
  // which returned a clean 401 JSON and passed for ~24h while the path both
  // clients actually call, "/api/clinical-check-in/me/active", was falling
  // through to the SPA catch-all as 200 text/html. A probe that asks the server
  // about itself cannot detect client/server drift; it must ask the question the
  // client asks.
  for (const path of [
    "/api/appointments",
    "/api/billing",
    "/api/tasks/dashboard",
    "/api/shift-handover/summary",
    "/api/clinical-check-in/me/active",
  ]) {
    if (!(await probeApi(cfg, path))) pass = false;
  }

  // Any unmatched /api/* path must be a JSON 404, never the SPA shell. This is
  // the generalized guard: without it, every future client/server path drift
  // reappears as a misleading 200 text/html instead of a debuggable error.
  if (!(await probeApiNotFound(cfg, "/api/__does_not_exist__"))) pass = false;

  // NON-FATAL BY CONSTRUCTION, not by convention. Everything from the fetch to the
  // last WARN is inside this try, and the catch only prints: no path through this
  // block can touch `pass`, the exit code, or the verdict below. Precisely: nothing
  // in here ASSIGNS `pass`, which is the one thing to check when editing this block
  // — `pass` is a `let` still in scope, so an edit that wrote to it would make this
  // paragraph false while everything still compiled, which is exactly how an untrue
  // comment about why a branch is safe has survived a restructure in this file
  // before. The try/catch guarantees only that a THROW cannot escape. That is a
  // STRUCTURAL claim, not belt-and-braces: `fetchJson` awaits `fetch()` and
  // `res.text()` with no try of its own, so without this guard either rejection
  // reaches `main().catch` and exits 1 with a bare stack trace and NO verdict —
  // after the target already matched and every probe already passed.
  //
  // WHY A GUARD AND NOT A THIRD `JsonBody` TAG. A "died mid-read" tag would be
  // symmetric with parsed/unparseable and would force both call sites to handle
  // it, but it cannot cover the connect-time rejection: when `fetch()` itself
  // rejects there is no response, so there is no `JsonBody` to carry a tag. Only
  // a guard around the whole block covers both — and it covers whatever the next
  // line added here can throw. A hint that can fail the build is not a hint.
  // Pinned by "dies mid-read", "cannot be reached at all" and "cannot mask a
  // failing probe" in tests/verify-prod-deploy.test.ts.
  try {
    const health = await fetchJson<unknown>(cfg, "/api/health");
    const body = health.body;
    // 503 is admitted DELIBERATELY, not by oversight. `server/routes/health.ts:173`
    // answers `allOk ? 200 : 503`, and `:163` sets `allOk = false` whenever
    // `checks.worker !== "ok"` — so a 503 carrying a JSON body from this endpoint is
    // the documented DEGRADED REPORT, i.e. exactly the shape a genuinely failing
    // worker produces. Gating on `status === 200` alone inverts this whole block:
    // the sole producer of the redeploy instruction (c3) stops firing on the one
    // production shape it was written for, and the transport branch prints "the
    // response never got as far as reporting one" over a body with `"worker":"fail"`
    // visible in its own snippet. Verified against the route, not inferred from the
    // status code.
    if ((health.status !== 200 && health.status !== 503) || !health.ct.includes("application/json")) {
      // (0) TRANSPORT. A 404 or 502 carrying a JSON body satisfies every shape
      // gate below and would reach the `checks` read with nothing there — the
      // wrong-component diagnosis. Gate transport first, as classifyPoll does.
      const snippet =
        body.kind === "unparseable" ? body.snippet : bodySnippet(JSON.stringify(body.value));
      console.log(
        `WARN /api/health did not answer as a JSON health report (status=${health.status} ` +
          `content-type=${health.ct.split(";")[0] || "(none)"}): ${snippet}. ` +
          "Not a worker fault — the response never got as far as reporting one. " +
          `Check the API router mounting and that ${cfg.prod} points at the app ` +
          "rather than a proxy or a static host.",
      );
    } else if (body.kind === "unparseable") {
      // (a) the bytes were not JSON at all.
      console.log(
        `WARN /api/health did not return readable JSON (status=${health.status} ` +
          `content-type=${health.ct.split(";")[0] || "(none)"}): ${body.snippet}. ` +
          "Not a worker fault — the response never got as far as reporting one.",
      );
    } else if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
      // (b) `JSON.parse("null")` succeeds, so a null body slips past the parse
      // guard; `?.checks` then yields undefined and reads as "the worker is down".
      // An optional chain must not convert "I could not read this" into a fault.
      const shape = Array.isArray(body.value)
        ? "an array"
        : body.value === null
          ? "null"
          : `a ${typeof body.value}`;
      console.log(
        `WARN /api/health did not return a readable JSON object (status=${health.status} ` +
          `content-type=${health.ct.split(";")[0] || "(none)"}): the body parsed as JSON but ` +
          `is ${shape}, not an object: ${bodySnippet(JSON.stringify(body.value))}. ` +
          "Not a worker fault — the response never got as far as reporting one.",
      );
    } else {
      // (c) Reaching here is necessary but NOT sufficient to speak about the
      // worker: "no worker status found" and "the worker reported a bad status"
      // are different observations, and only the second warrants a redeploy.
      const checks = (body.value as { checks?: unknown }).checks;
      console.log(`health status=${health.status} checks=${JSON.stringify(checks)}`);
      // Read and normalise ONCE. Normalised for the same reason the reported commit
      // is (invariant B): every normalisation one side gets, the other must get too.
      // `undefined` here means NO READING — absent, wrong type, or blank — and an
      // absent reading is not a bad one.
      const rawWorker = (checks as Record<string, unknown> | undefined)?.worker;
      const workerStatus =
        typeof rawWorker === "string" && rawWorker.trim() !== ""
          ? rawWorker.trim().toLowerCase()
          : undefined;
      if (typeof checks !== "object" || checks === null || Array.isArray(checks)) {
        // (c1) `checks?.worker` is undefined on a string, a number, an array and
        // on nothing at all, and `undefined !== "ok"` — so all of those read as down.
        const checksShape =
          checks === undefined
            ? "absent"
            : checks === null
              ? "null"
              : Array.isArray(checks)
                ? "an array"
                : `a ${typeof checks}`;
        console.log(
          `WARN /api/health returned no readable checks object (checks is ${checksShape}). ` +
            "Not a worker fault — the response never got as far as reporting one.",
        );
      } else if (workerStatus === undefined) {
        // (c2) ABSENT IS NOT "NOT OK". An endpoint that reports on the db and says
        // nothing about the worker has made no claim about it.
        // No cast: the guard above has already narrowed `checks` to a non-null,
        // non-array object, which is what `Object.keys` wants.
        const named = Object.keys(checks).join(", ") || "(none)";
        console.log(
          `WARN /api/health did not report on the worker (checks named: ${named}). ` +
            "Not a claim that the worker is down — an absent worker status is a different " +
            "statement from a bad one, and only a bad one warrants a redeploy.",
        );
      } else if (workerStatus !== "ok") {
        // (c3) The ONLY producer of the redeploy instruction: a worker status
        // actually read, and actually not "ok". Compared normalised — "OK" is ok.
        console.log("WARN worker check is not ok (redeploy Worker after #508 merge)");
      }
    }
  } catch (err) {
    // `.message`, not the error object: `console.error(err)` is what printed the
    // raw undici stack that made this look like a crash rather than a hint.
    console.log(
      `WARN /api/health could not be read (${(err as Error).message}). ` +
        "Not a worker fault — the request never completed, so nothing was reported.",
    );
  }

  if (!pass) process.exit(1);
  console.log("=== ALL PROBES PASS ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
