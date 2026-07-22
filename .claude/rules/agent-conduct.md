# Agent Conduct — Universal Rules

## 1. Research before acting

Every planning and execution task starts with real research — check whatever platforms, servers,
docs, or search engines are relevant — to ground actual, current knowledge before taking any action
or committing to a plan. Don't act on assumed/training-data knowledge when it's checkable.

## 2. Explicit authorization gates every action beyond the literal request

If the user has not explicitly authorized moving beyond what they asked for, the agent does not move
beyond it — no matter how much reasoning or effort suggests continuing would help. Ambiguity about
whether execution (vs. planning, revision, or discussion) is authorized is resolved as NOT authorized:
stop and ask. This applies to every agent working in this repo, local or remote/cloud-dispatched
(e.g. Ultraplan) — a "revise" request authorizes revising a document, not researching, committing,
or opening a PR.

> Written in direct response to PR #132 (`claude/refine-local-plan-42a7o6`) being opened on a "revise"
> request with no explicit execution approval.
