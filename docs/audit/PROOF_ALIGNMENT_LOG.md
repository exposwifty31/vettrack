# Proof Alignment Log

Append-only log of implementation claims backed by verified evidence. Purpose: prevent reporting work as "done" based on a summary or assumption — every entry records what was actually checked in this session, not what should be true.

## Rules

- One entry per completed task, added **before** reporting the task as done to the user.
- Evidence must be things actually observed this session: `Read`/`grep` output pointing at real `file:line`, actual test run output, actual command output. Do not restate a commit message, PR description, or prior summary as evidence.
- If a claim can't be verified, say so (`PARTIAL` / `NOT FOUND`) rather than omitting the entry or rounding up to `VERIFIED`.
- Entries are never edited or deleted retroactively — if a later check contradicts an earlier one, add a new entry that supersedes it and note the discrepancy.

## Entry format

```
## YYYY-MM-DD — <task/commit summary> (<commit-hash-if-committed>)

**Claim:** <one line: what was implemented or fixed>

**Evidence:**
- `path/to/file.ts:42` — <what was confirmed by Reading/grepping this line>
- Test: `pnpm test -- tests/foo.test.ts` → <actual pass/fail output>
- Command: `<command run>` → `<relevant output excerpt>`

**Verdict:** VERIFIED | PARTIAL | NOT FOUND
```

---

<!-- Entries start below this line. -->

## 2026-07-01 — Establish proof alignment log convention (uncommitted)

**Claim:** Added a Working Convention bullet to CLAUDE.md requiring evidence-backed verification before reporting tasks done, and created this log file to hold entries.

**Evidence:**
- `CLAUDE.md:64` — `git diff CLAUDE.md` shows exactly one line added: "Before reporting a task done, verify claims against real evidence... record it in docs/audit/PROOF_ALIGNMENT_LOG.md"; no other lines in the file changed.
- `docs/audit/PROOF_ALIGNMENT_LOG.md` — file exists (created this session), confirmed via `git status --porcelain` showing `?? docs/audit/PROOF_ALIGNMENT_LOG.md`.
- Command: `git status --porcelain` → `M CLAUDE.md` / `?? docs/audit/PROOF_ALIGNMENT_LOG.md` (only these two paths touched, matching the plan's stated scope).

**Verdict:** VERIFIED
