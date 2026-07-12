# R-CB-stabilize — Code Blue race fixes (SUB-SPEC + plan)

- **Covers:** CLICK-PATH-010 (R-CB-02) + CLICK-PATH-011 (R-CB-03) — the two frozen Code Blue race conditions that **gate medium-01** (`R-CBF-1`). **Moved out of `phase-2-3.plan.md`** into a dedicated SUB-SPEC because they touch the frozen Code Blue runtime (spec §2.4: net-new/multi-site *or subtle race* frozen work → its own spec-plan, not inline cards).
- **Tier (model routing):** **O +R** — Opus + a `code-reviewer` gate + the Code Blue Playwright drill on every card. See README → "Execution driver".
- **Frozen doctrine (every card):** server-confirmed end only · no new transport · no offline queueing · no optimistic local termination.

---

## R-CB-02 · Null keepalive must not optimistically clear a live session (CLICK-PATH-010)

- **File:** `src/hooks/useCodeBlueSession.ts:121`.
- **Defect:** a stale/racing `activeCodeBlueSessionId=null` keepalive immediately `clearCachedSession()` + `setQueryData(session:null)`, flipping a just-started session back to the launch form (an optimistic end in all but name).
- **GREEN:** on a null keepalive, **refetch to confirm before clearing** — mirror `useCodeBlueKeepaliveReconciliation`'s `RECONCILE_GRACE_MS` grace window; clear **only** if the confirming refetch also returns no active session.
- **RED:** `tests/code-blue-null-keepalive-grace.test.tsx` — a null keepalive within the grace window after a local start does **not** clear the session; a confirmed-null (grace elapsed + refetch returns null) does.
- **Guardrail:** server-confirmed end only; no new transport.

## R-CB-03 · Quick-log rollback must not erase teammates' entries (CLICK-PATH-011)

- **File:** `src/hooks/useCodeBlueSession.ts:192`.
- **Defect:** `logEntry` snapshots the whole session cache and restores it on failure, discarding teammates' entries that arrived during the request.
- **GREEN:** `cancelQueries` before the optimistic write; on error remove **only the optimistic entry** (by its client id), never the whole snapshot.
- **RED:** `tests/code-blue-logentry-rollback.test.tsx` — a failed log-entry removes only the optimistic entry; a teammate entry that arrived mid-request **survives** the rollback.
- **Guardrail:** frozen surface; no offline queueing.

---

## Definition of done

- Both cards RED→GREEN; **`npx tsc --noEmit` + `pnpm test` green**; the Code Blue Playwright drill passes.
- These are **prerequisites for `R-CBF-1` (medium-01)** — that feature is gated behind both being GREEN.
- Evidence logged in `docs/audit/PROOF_ALIGNMENT_LOG.md`.
