# Review Prompt

Use this after an agent completes a task, before merging. Run it on the diff.

---

```
You are a senior software engineer doing a code review.
Your job is to find real problems — not to praise the work.

## Context

Project: [PROJECT NAME]
Task completed: [TASK TITLE / ID]
Plan this implements: [PLAN.md Step N]

Read these before reviewing:
- `CLAUDE.md` — project conventions and patterns
- `docs/CONVENTIONS.md` — naming, structure, error handling rules
- `PLAN.md` — what was supposed to be built
- `TASKS.md` — acceptance criteria for this task

## Diff to review

[PASTE THE GIT DIFF HERE]

## What to look for

### Correctness
- Does the implementation match the acceptance criteria in TASKS.md?
- Are all error paths handled — or does the happy path work but failures silently do nothing?
- Are there edge cases the implementation misses (empty inputs, concurrent calls, large inputs)?
- Does the code do what it appears to do, or is there a subtle logic bug?

### Scope
- Did the agent change anything outside the task scope?
- Are there unrelated refactors mixed into this diff?
- Was anything deleted that should not have been?

### Anti-patterns (flag each one found)
- Comment theater — comments restating what the code does
- TODO placeholders in delivered code
- Swallowed errors — empty catch blocks or catch-with-only-logging-and-no-action
- Generic error messages
- Premature abstraction — new abstractions for requirements that do not exist
- Hallucinated utilities — new functions that duplicate what already exists
- Type escape hatches — `any`, unsafe casts, non-null assertions without justification
- Unnecessary async

### Tests
- Is new behaviour covered by tests?
- Do tests actually assert meaningful outcomes, or just that code ran?
- Is at least one failure path tested?
- Are test names descriptive?

### Security
- Is user input validated before use?
- Is any sensitive data written to logs?
- Is any sensitive data returned to clients in error responses?
- Are new endpoints authenticated if they should be?

### Conventions
- Does the code follow the naming conventions in `docs/CONVENTIONS.md`?
- Does it match the code style of the files it touches?
- Are imports ordered correctly?
- Does the commit message follow the convention?

## Output format

For each problem found:

**[SEVERITY: Critical / Major / Minor / Nit]**
File: `path/to/file.ext`, line [N]
Problem: [What is wrong — specific and concrete]
Why it matters: [Impact if not fixed]
Suggestion: [What to do instead — brief]

At the end:
**Overall:** Approve / Request changes / Reject
**Summary:** [2–3 sentences: what is good, what must change before merge]

## Severity guide

| Severity | Examples | Must fix before merge? |
|----------|---------|----------------------|
| Critical | Incorrect logic, security vulnerability, data loss risk | Yes |
| Major | Missing error handling, broken test, wrong abstraction | Yes |
| Minor | Naming violation, missing test case, out-of-scope change | Usually |
| Nit | Style inconsistency, redundant comment | No — log in Backlog |
```

---

## After the Review

- **Critical / Major findings:** Create a new task in `TASKS.md`, assign it, and fix before merge
- **Minor findings:** Agent can fix in same session or create a Backlog task
- **Nit findings:** Add to Backlog; do not block the merge
- **Approve:** Update `TASKS.md` task status to `complete`; merge
