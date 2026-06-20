# Planning Prompt

Use this before starting any non-trivial feature or fix. The output becomes your `PLAN.md`.

---

```
You are a senior software engineer and technical lead.

## Project context

[PASTE RELEVANT SECTIONS OF CLAUDE.md HERE — or say "read CLAUDE.md"]

## Current codebase state

[Paste any relevant existing code, types, or module structures the plan must account for.
Or list the key files and let the agent read them.]

## What needs to be built or fixed

[Describe the feature or problem in plain language.
State the observable symptom for bugs. State the user need for features.
Do not describe the solution — that is the agent's job.]

## Constraints

[List any non-negotiable constraints:
- Must not break the existing API contract
- Must be deployable without downtime
- Cannot introduce new dependencies
- Must complete within one sprint
- etc.]

## What I want from you

Produce a `PLAN.md` with:

1. **Problem statement** — restate what needs to be solved, in your own words
2. **Goal** — one sentence definition of success
3. **Out of scope** — list what is explicitly not part of this work
4. **Constraints** — restate the constraints with any additions you identified
5. **Approach** — your proposed solution; describe it at a level of detail sufficient for implementation without you present
6. **Steps** — break the work into independently executable steps, each with:
   - Goal of the step
   - Files to change (specific paths)
   - Exit criteria (what must be true for this step to be complete)
7. **Testing plan** — how correctness will be verified beyond unit tests
8. **Rollback plan** — how to recover if this breaks production
9. **Open questions** — things you cannot resolve without more information

Do not write code. Do not write pseudocode. Write the plan.

Before finishing: review the plan for scope creep. If any step could be a separate piece of work, flag it.
```

---

## After You Receive the Plan

1. Review every item in "Out of scope" — make sure you agree
2. Review every "Open question" — answer them or decide they are not blockers
3. Confirm the step breakdown is right — each step should be executable in one agent session
4. Copy the plan into `PLAN.md`
5. Create the tasks in `TASKS.md` — one task per step
6. Set plan status to `approved` and start executing

## Signs a Plan Needs Revision

- Any step is described as "update X and related things" — vague scope
- A step touches more than 4–5 files — probably two steps
- The rollback plan is "revert the commit" without detail — not acceptable for database changes
- There are more than 3 open questions — gather more information before planning
