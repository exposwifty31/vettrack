#!/usr/bin/env node
/**
 * PreToolUse(Write|Edit|MultiEdit) gate: refuse a source edit when the skills that
 * govern that path were never invoked this session.
 *
 * Why this exists, concretely: the standing RN-migration mandate has been in force for
 * weeks and session audits found the skills "near-universally skipped, invoked only under
 * direct owner pressure". While DRAFTING the plan that this hook belongs to, four skills
 * were named as governing and one had actually been loaded. A rule that depends on the
 * agent remembering is not a rule.
 *
 * Ground truth is the session transcript, not a marker file: a marker can go stale, survive
 * a session, or be written by something that then failed. The transcript cannot lie about
 * whether the Skill tool ran. Measured at 28ms against a 105MB transcript, so the cost is
 * not worth a cache.
 *
 * Exit 2 blocks the call and shows stderr to the agent (same contract as
 * agent-mistake-guard.js). An internal error exits 0 — a broken guard must never wedge the
 * session — but "I could not read the transcript" is NOT an internal error, it is an
 * unverifiable claim, and it blocks. That distinction is the whole point: a gate that
 * silently passes when it cannot check is the failure mode this repo has hit 14 times.
 */
const fs = require("fs");
const path = require("path");

const CONFIG = ".claude/skills-required.json";

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // not our shape; never wedge
  }
  try {
    const problems = check(payload);
    if (problems) {
      console.error(problems);
      process.exit(2);
    }
  } catch (e) {
    // Guard bug -> stay out of the way. Deliberately NOT the same branch as
    // "transcript unreadable", which is handled inside check() and blocks.
    process.exit(0);
  }
  process.exit(0);
});

function check(payload) {
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) return null; // Write/Edit always carry one; anything else isn't ours

  const cwd = payload?.cwd || process.cwd();
  const cfgPath = path.join(cwd, CONFIG);
  if (!fs.existsSync(cfgPath)) return null; // repo opts in by adding the file

  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  if (rel.startsWith("..")) return null; // outside the repo

  if ((cfg.exempt || []).some((g) => match(g, rel))) return null;

  const required = new Map(); // skill -> why
  for (const r of cfg.rules || []) {
    if ((r.globs || []).some((g) => match(g, rel))) {
      for (const s of r.skills || []) required.set(s, r.why || "");
    }
  }
  const always = cfg.always;
  if (always && (always.globs || []).some((g) => match(g, rel))) {
    for (const s of always.skills || []) required.set(s, always.why || "");
  }
  if (!required.size) return null;

  const tp = payload?.transcript_path;
  if (!tp || !fs.existsSync(tp)) {
    return (
      "[skills-required] BLOCKED — cannot verify skills for " + rel + "\n\n" +
      "No readable transcript_path, so which skills loaded is UNKNOWN. This blocks rather\n" +
      "than passes: a check that waves things through when it cannot check is not a check.\n" +
      "Required here: " + [...required.keys()].join(", ")
    );
  }

  const loaded = invokedSkills(tp);
  const missing = [...required.keys()].filter((s) => !loaded.has(s));
  if (!missing.length) return null;

  return (
    "[skills-required] BLOCKED — " + rel + "\n\n" +
    missing.map((s) => "  MISSING  " + s + "\n           " + required.get(s)).join("\n") +
    "\n\nInvoke the skill(s) above with the Skill tool, then retry this edit.\n" +
    (loaded.size ? "Loaded this session: " + [...loaded].sort().join(", ") : "No skills loaded this session.") +
    "\n\nMapping: " + CONFIG + " (edit that file, not this message, if it is wrong)."
  );
}

/**
 * Skill names invoked this session.
 *
 * A subagent is handed the PARENT session's transcript_path, so its own Skill calls are
 * invisible there — which made this gate UNSATISFIABLE from inside a subagent: no number of
 * Skill invocations could ever clear it. Two dispatched agents proved that by running this
 * hook by hand against both transcripts (parent -> exit 2, own -> exit 0) and correctly
 * reported it instead of routing the write through Bash to evade the gate.
 *
 * So: union the parent transcript with every subagent transcript under this session's
 * subagents/ tree. LIMITATION, stated rather than hidden: that makes the check
 * SESSION-scoped, not AGENT-scoped — concurrent subagent A can satisfy the requirement for
 * subagent B. It reliably catches "nobody loaded this skill anywhere", which is the failure
 * that actually happens; it cannot attribute per agent. An unsatisfiable gate is worse than
 * a coarse one, because it trains people to disable it.
 */
function invokedSkills(transcriptPath) {
  const out = new Set();
  const re = /"name"\s*:\s*"Skill"\s*,\s*"input"\s*:\s*\{[^}]*?"skill"\s*:\s*"([^"]+)"/g;
  const scan = (file) => {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) out.add(m[1]);
  };

  scan(transcriptPath);

  // <session>.jsonl sits beside <session>/subagents/**/agent-*.jsonl
  const sessionDir = transcriptPath.replace(/\.jsonl$/, "");
  const subagents = path.join(sessionDir, "subagents");
  const stack = [subagents];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/^agent-.*\.jsonl$/.test(e.name)) scan(full);
    }
  }
  return out;
}

/** Minimal glob: ** spans separators, * does not, everything else literal. */
function match(glob, rel) {
  const rx =
    "^" +
    glob
      .split("")
      .reduce((acc, ch, i, a) => {
        if (ch === "*" && a[i - 1] === "*") return acc; // consumed by the ** branch
        if (ch === "*") return acc + (a[i + 1] === "*" ? ".*" : "[^/]*");
        return acc + (/[.+?^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch);
      }, "") +
    "$";
  return new RegExp(rx).test(rel);
}
