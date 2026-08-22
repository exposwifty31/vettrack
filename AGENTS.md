# AGENTS.md

> Read by OpenAI Codex, GitHub Copilot Workspace, Aider, Cline, Roo Code, and similar tools.
> Mirrors CLAUDE.md — keep both files in sync when you update either.

---

## Start Here

Read these files before writing any code:

1. `CLAUDE.md` — full project context, stack, auth modes, architecture, frozen surfaces
2. `PLAN.md` — what is currently in scope and what is out of scope
3. `TASKS.md` — your specific task and acceptance criteria
4. `docs/CONVENTIONS.md` — naming, patterns, error handling, i18n rules
5. `DEFINITION_OF_DONE.md` — completion checklist
6. Every file you plan to modify

If any of these are missing or incomplete, say so before proceeding.

---

## Operating Rules

### Always do
- Filter every DB query by `clinicId` — multi-tenancy is a non-negotiable invariant
- Follow the patterns documented in `docs/CONVENTIONS.md`
- Search for existing utilities before creating new ones
- Write tests alongside implementation — not after
- State what you changed, what you did not change, and why
- List follow-up items you noticed but did not act on (add to `TASKS.md` Backlog)
- Run `npx tsc --noEmit` and `pnpm test` before declaring a task done

### Never do
- Modify code outside the scope of the current task
- Add dependencies without noting them in your response
- Leave TODO placeholders in delivered code
- Add comments explaining what the code does instead of why
- Use `any` or unsafe type casts without an inline explanation
- Catch errors silently
- Touch realtime, Code Blue, or PWA code without reading the "Frozen architecture surfaces" section in `CLAUDE.md` first
- Add emergency endpoints to any SW cache path
- Rename `vt_appointments`, `/api/appointments`, or `appointmentsPage.*` i18n keys
- Commit or push to `main` directly
- Run database migrations without explicit human instruction

### Stop and ask when
- The task requires an unexpected schema or database change
- A security-sensitive file is in scope (auth, payments, PII)
- You are uncertain which of two existing patterns to follow
- Tests fail and you do not understand why after one attempt
- The task as written requires changing significantly more code than described

---

## Gates that will fail your branch

Four gates are enforced in CI and are the ones agents most often trip. `CLAUDE.md` carries the
full detail; this is the operational minimum.

```bash
# One command, six steps — run this first; it subsumes the two below it.
pnpm architecture:gates   # tsc (frontend) + tsc (tsconfig.server-check.json) + depcruise
                          #   + madge cycles + tenant lint + claim verification
pnpm tenant:lint:enforce  # already run by architecture:gates; standalone for a faster loop
pnpm verify:claims        # already run by architecture:gates; standalone for a faster loop

# NOT part of architecture:gates — a separate CI job, and separately runnable.
pnpm test:integration:ops # equipment operational-state + waitlist; CI runs the suites BY NAME
```

**Tenant lint is baseline-relative by COUNT, not by identity.** It groups findings by
`file::table` and fails a key only when the live count **exceeds** the count recorded in
`.tenant-lint-known-violations.json` (~200 frozen, hand-reviewed findings). A red build means you
added an unscoped `.from(<tenantTable>)` — it names the `file:line:column`. **Do not regenerate the
baseline to make it green**; that is identical to having no gate. Waive a genuine false positive in
place with `// tenant-lint:scoped <reason>`. Note the edge: because the baseline counts rather than
identifies, a *different* unscoped query replacing a known one at the same key keeps the count equal
and passes — the gate catches new sites and net increases, not substitutions.

**Claim verification means documentation is checked, not trusted.** A path, line range, or "MERGED"
claim in a governed document must resolve, or CI fails. When it does, fix the document, or register
the claim in `docs/claims-registry.json` / `docs/attestations.json` with a reason. There is no
fourth option and no silent skip.

**DB-integration tests are excluded from `pnpm test` by default** and CI runs selected suites by
name — a green `pnpm test` locally does not mean the DB suites ran.

---

## Output Format

After every task:

```
## Changes
- `path/to/file.ext` — [one sentence describing the change]
- `path/to/test.ext` — [test added/modified]

## Verification
Run: [exact commands to verify]

## Deviations from plan
[None, or: what changed and why]

## Follow-up items (not acted on)
- [item — added to TASKS.md Backlog]
```

---

## Commit Message Format

```
type(scope): short description in imperative mood

- Why this change was needed
- What approach was taken and why
- Refs TASK-NNN if applicable

Types: feat | fix | refactor | test | docs | chore | perf
```

---

## Decision Priority

When conventions conflict:

1. Security
2. Multi-tenancy invariant (clinicId filter)
3. Existing codebase conventions
4. Correctness
5. Performance
6. Elegance

---

## Cursor Cloud specific instructions

### Cloud agent starter skill
Use `docs/cloud-agent-starter-skill.md` as the default quickstart runbook for environment setup, auth/login modes, and test workflows by code area.

### Cursor project rules (IDE agents)
Persistent guidance for Cursor lives under `.cursor/rules/*.mdc` and root `.cursorrules`. See `docs/engineering-rules-rollout.md`.

**Codex PR reviews:** Address every **chatgpt-codex-connector** inline comment before merge.

For detailed setup, prerequisites, environment variables, commands, and gotchas, see **[CLAUDE.md](CLAUDE.md)**.
