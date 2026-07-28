# Autopilot Per-Org Policy Layer — design (gates `enforce`)

> VetTrack 2.0, Task 0.4. Design **only** — no code, no schema, no config in this deliverable.
> Designs how an explicit, revocable, audited **org-approved policy** sits ABOVE the shipped
> `off | shadow | enforce` enforcement envelope and unlocks `enforce` for **one Autopilot proposal
> kind, for one clinic, only when that org has explicitly approved it**. This is the gate that stops
> the Shift Autopilot propose→approve loop (Task 0.3 `action_proposal`, Task 1.1 shadow mode) from
> ever reaching one-tap / auto-execution without a deliberate human org decision.
>
> Implements owner decision #4 (`docs/vettrack-2.0-roadmap.md` § Binding constraints, 2026-07-16,
> binding): *"Autopilot = continuously-learning assistant, human approval by default. `enforce`
> unlocked per-policy, per-org, explicitly — never blanket."* Consumed by Task **2.5(a)** (the real
> `enforce` promotion). Envelope is **extended by layering; its semantics are unchanged** (frozen
> surface — `docs/vettrack-2.0-roadmap.md` § Frozen surfaces).

## RED checklist (this doc is not done until every item is `[x]`)

- [x] **1. Storage shape** — exactly how/where "org X approved policy for proposal-kind Z in clinic C"
  is stored; follows the `vt_server_config` key-embedding convention or justifies a deviation.
- [x] **2. Resolution order vs. per-clinic mode + TTL** — how "is `enforce` actually allowed now for
  (clinicId, proposalKind)" combines with the existing per-family mode resolution; precondition vs.
  ceiling-clamp stated precisely.
- [x] **3. Who approves** — required role/permission; per-clinic vs. per-org; multi-clinic org behavior.
- [x] **4. Revocation** — how a policy is revoked and what happens to in-flight vs. future proposals.
- [x] **5. Audit trail** — what is logged on approve/revoke; named new `AuditActionType` members.
- [x] **6. Failure default = `shadow`** — stated explicitly, with the reconciliation of *why* this
  differs in direction from the existing evaluators' fail-open-to-`off`.
- [x] **7. Admin/console UX concept** — what the policy-approval trust surface shows and how revoke works.
- [x] **8. Explicit statement** — `off` still short-circuits (no queries issue when a kind's policy is
  absent/off) and a resolver throw degrades to the safe default (CI-16/CI-20 pattern, by name).

---

## 0. What this layer is (and is not)

The shipped envelope (`server/lib/authority/enforcement/clinical-invariant.config.ts` is the reference
implementation) resolves a per-clinic mode for an enforcement family:

```
per-clinic vt_server_config (`cop.<family>_enforce.<clinicId>`)
  → env default (`COP_<FAMILY>_ENFORCE_V1`)
  → "off"
```

with a 10s in-process TTL cache (own `Map` per family), typo-defensive collapse to `"off"`, and a
resolver-throw that degrades to `"off"`.

The policy layer is a **second, independent switch layered strictly on top** of that resolver for the
Autopilot proposal-mode family. It does exactly one thing: **it can veto an `enforce` outcome down to
`shadow`.** It can never promote `off`→anything, never promote `shadow`→`enforce`, and never change
what `off`/`shadow`/`enforce` mean for the underlying proposal kind. Requiring *both* switches — the
operational rollout mode set to `enforce` **and** an explicit org policy approval — to be on before a
single action auto-executes is the defense-in-depth this task exists to design.

> **Non-negotiable:** this is additive. The base mode resolver for a proposal kind is byte-for-byte the
> clinical-invariant pattern, reused unchanged. The policy layer wraps it; it does not edit it.

---

## 1. Storage shape

**Decision: reuse `vt_server_config`, embedding both `proposalKind` and `clinicId` into the key
string** — the same convention the shipped envelope uses (`server/lib/server-config.ts`:
`getServerConfigValue(_clinicId, key)` — the first argument is unused; the key string carries all
scoping). `vt_server_config` has no clinic column at the schema level; clinic (and here, also
proposal-kind) isolation is achieved entirely in the key.

Two distinct keys per (clinic, proposal-kind), never conflated:

| Concern | Key convention | Value domain | Owner |
|---|---|---|---|
| **Base mode** (rollout knob — existing envelope) | `cop.autopilot_proposal_enforce.<proposalKind>.<clinicId>` | `off` \| `shadow` \| `enforce` (else → `off`) | operator / ops rollout |
| **Org policy gate** (this design) | `autopilot.policy_enforce.<proposalKind>.<clinicId>` | exactly `approved` → approved; **anything else (incl. `revoked`, missing row, typo) → not approved** | clinic admin (org decision) |

- The **policy value is deliberately a single flat token**, not a JSON blob. The hot resolution path
  only needs the boolean "approved right now?", and typo-defense is trivial: only the exact string
  `approved` counts — any other value, including a malformed one, resolves to *not approved* and thus
  clamps to the safe default. This mirrors the mode resolver's "anything that isn't exactly
  `off`/`shadow`/`enforce` collapses to `off`" rule, pointed at the safe direction.
- The **authoritative who/when/why of every approve and revoke lives in the append-only audit log**
  (§5), not in the mutable config cell. The config row is only *current state*; its `updatedAt` gives
  a cheap "changed at" for the console, but the trustworthy history is the audit trail (append-only —
  `vt_audit_logs`, per repo doctrine).
- **Revocation writes `revoked` (it does not delete the row)** — see §4. `revoked` and a missing row
  both resolve to *not approved*; keeping the row makes the last transition legible to the console
  without a join to the audit log.

**Why not a dedicated `vt_autopilot_policies` table (documented deviation-not-taken):** a table would
give richer cross-org querying (e.g. "list every clinic where kind Z is enforced"). We decline it for
Task 0.4 because (a) consistency with the shipped envelope lets the policy layer reuse the exact
TTL/cache/typo-defense machinery with zero new storage surface and zero migration; (b) the data is
genuinely config-shaped — a small bounded set of per-(clinic, kind) toggles; and (c) the queryable
history a compliance view would want already exists, append-only, in the audit log. If a future console
needs to enumerate policy state across many orgs cheaply, promoting to a table is a clean, isolated
follow-up (it would read the same audit history to backfill). Task 2.5(a) may make that call; Task 0.4
does not need it.

---

## 2. Resolution order vs. per-clinic mode + TTL

The policy layer is a **ceiling clamp evaluated after the base mode resolver, whose only power is to
hold an `enforce` result down to `shadow`.** It is *not* a precondition that runs before the mode
resolver, and it is *not* a replacement for it. Precise algorithm for "effective mode for
(clinicId, proposalKind) right now":

```
effectiveMode(clinicId, proposalKind):
    base = resolveProposalMode(clinicId, proposalKind)   # existing envelope, unchanged
                                                         #   off | shadow | enforce
    if base != "enforce":
        return base            # off short-circuits; shadow passes through.
                               # The policy gate is NOT consulted — no policy query issues. (§8)

    # base wants enforce — the org policy is the only thing that can permit it.
    approved = resolveEnforcePolicy(clinicId, proposalKind)   # own resolver, own TTL cache (below)
    return approved ? "enforce" : "shadow"                    # clamp to the safe default (§6)
```

Consequences that make this the architectural core:

- **The policy gate can only ever *hold down*.** A policy row existing does not by itself enable
  `enforce`; the base mode must *also* be `enforce`. Two independent switches, both required. An
  accidental policy approval on a clinic still in `shadow` changes nothing.
- **`off` never reaches the policy layer** — it returns before `resolveEnforcePolicy` is called, so an
  `off` clinic issues zero policy queries, preserving the short-circuit contract (§8).
- **`shadow` never reaches the policy layer either** — shadow already never executes, so gating it is
  meaningless; leaving it untouched keeps the shadow path free of an extra config read.

**TTL and cache (mirrors the shipped envelope exactly):** `resolveEnforcePolicy` gets its **own**
`Map<string, CacheEntry>` and a **10-second** in-process TTL — the same rollback-window contract as
every enforcement family (a flip becomes visible within one TTL window). It does **not** share cache
state with the base mode resolver or any other family (Phase 5 plan §19.16 — independent cache map per
family; no cross-family coupling). Cache key = the full policy key string
(`autopilot.policy_enforce.<proposalKind>.<clinicId>`), so per-(clinic, kind) entries never collide.

Net: an org approval or revocation, or a base-mode flip, all take effect within ≤10s. Both switches are
re-resolved at *decision time* (the moment an execution is attempted), never cached at proposal-staging
time — this is what makes revocation forward-effective (§4).

---

## 3. Who approves

**Required role: `admin` (role weight 40) only.** Rationale against the repo's role hierarchy
(`admin=40 · vet=30 · senior_technician=25 · lead_technician=22 · vet_tech=20 · technician=20 ·
student=10`): unlocking auto-execution is the single most consequential, hardest-to-reverse operational
capability a clinic can grant — it lets software act without a per-action human tap. `senior_technician`
carries clinical authority in the evaluator families, but *authorizing the machine to act on the whole
floor* is an org-governance decision, not a clinical-shift one. It belongs at the top of the hierarchy.
The permission check is `req.authUser` role read from `vt_users.role` (per CLAUDE.md — role is always
DB-sourced, never from JWT claims).

**Approval is per-clinic, always.** The policy key embeds `clinicId`; there is no key shape that
approves more than one clinic. A multi-clinic org therefore approves **once per clinic** — approving
`enforce` for Clinic A must never silently enable it for Clinic B. Blast radius is one physical floor
with its own staff and its own risk posture; that is exactly the granularity an irreversible-capability
grant should have. A future console convenience ("apply to all my clinics") is acceptable *only* if it
writes **N independent policy rows and emits N independent audit entries** — one deliberate org decision
per clinic. There is never a single row that covers multiple clinics.

---

## 4. Revocation

**Mechanism:** an admin revoke sets `autopilot.policy_enforce.<proposalKind>.<clinicId>` to `revoked`
(via the existing `setServerConfigValue` upsert path). `revoked` resolves to *not approved*, so within
one TTL window (≤10s) `effectiveMode` clamps that kind's `enforce` back to `shadow`. Writing `revoked`
rather than deleting the row keeps the last transition legible to the console (§7); the authoritative
history is the audit trail (§5).

**Effect on proposals — stated explicitly, not left implicit:**

- **Revocation is forward-effective on the execution *decision*, re-resolved per attempt.** Both
  switches are read at the moment an execution is attempted, not when the proposal was staged.
- **An `action_proposal` already executed before revocation stays executed.** It was a legitimately
  authorized action at the time it ran. Revocation does **not** roll it back — undoing a completed
  operational action (e.g. a restock PO already placed, a handover already published) is itself an
  operational action that must go back through the propose→approve loop, never an automatic side effect
  of a config flip. (This mirrors how a base-mode `enforce`→`off` flip works today: it changes future
  behavior, it does not un-happen past mutations.)
- **An `action_proposal` staged under `enforce` but not yet executed** re-resolves at its next execution
  attempt, finds *not approved*, and clamps to `shadow` — meaning it now requires a human approve/edit/
  reject tap again, exactly as it did before the org ever approved. Nothing auto-executes after
  revocation.

So the guarantee is precise: **after revocation, no new action of that kind auto-executes for that
clinic; already-completed actions are untouched.**

---

## 5. Audit trail

The lifecycle events are rare, deliberate, org-level decisions — they belong in the closed
`AuditActionType` union in `server/lib/audit.ts` (add to the union; never infer). This design needs
**two new members** (named here per the task brief — not added to the file by this doc):

| New `AuditActionType` member | Emitted when | Captures |
|---|---|---|
| `autopilot_policy_approved` | An admin approves `enforce` for a (clinic, proposal-kind) | `clinicId`, `proposalKind`, `approvedBy` (acting admin `vt_users.id`), timestamp, prior state (`off`/`revoked`/absent) — the authoritative record that this org unlocked this capability |
| `autopilot_policy_revoked` | An admin revokes an approved policy | `clinicId`, `proposalKind`, `revokedBy`, timestamp, prior state (`approved`) — the authoritative record that the capability was withdrawn |

`logAudit()` is fire-and-forget (never `await`ed inside a mutation transaction — CLAUDE.md). Both writes
follow the append-only `vt_audit_logs` doctrine.

**Deliberately *not* audit kinds (kept as bounded metric counters instead, to avoid audit-log volume —
mirroring how `clinical_invariant_fail_open` is a metric, not an audit row):**

- `autopilot_policy_enforce_clamped_to_shadow` — a proposal wanted `enforce` but no org policy was
  approved, so it was held to `shadow`. Bounded counter, no labels. Lets a dashboard show "how often is
  enforce being blocked purely for lack of an org decision" without one audit row per proposal.
- `autopilot_policy_resolver_failure` — the policy resolver threw and the layer defaulted to `shadow`
  (§6). Bounded counter; separates transient failures from genuine not-approved, exactly as the
  clinical-invariant family separates `fail_open` from `allow`.

Both counters route through the existing closed `incrementMetric()` union (`server/lib/metrics.ts`) —
no high-cardinality labels, per the telemetry doctrine.

---

## 6. Failure default = `shadow`

**On any policy-resolver failure — throw, timeout, unreadable value, or a missing policy row on the
`enforce` path — the effective mode defaults to `shadow`. The layer never silently promotes to
`enforce`.** (Missing row / non-`approved` value is the *normal* not-approved case and also lands on
`shadow`; a throw is caught and lands on the same `shadow` — one safe target for both.)

**Why this is `shadow` here, when the existing authority evaluators fail open to `off`:** both systems
obey the *same* underlying principle — **fail toward the least-harmful, least-irreversible state** — but
their default states sit at opposite ends of the risk axis, so "least harmful" points in opposite
directions:

- The clinical-invariant / Code-Blue evaluators exist to *possibly deny* a clinical mutation. Their
  worst failure mode is **accidentally BLOCKING clinical care**. The least-harmful degraded state is
  therefore "don't block" → `off` / fault-open-to-allow (see
  `server/lib/authority/code-blue-log-drug-shock.ts` `FAULT_OPEN_INTERNAL`, and
  `clinical-invariant.metrics.ts` `failOpenTotal` — a transient failure reading the mode must never
  accidentally deny care).
- The Autopilot policy layer exists to *possibly permit auto-execution*. Its worst failure mode is
  **accidentally AUTO-EXECUTING an unreviewed action**. The least-harmful degraded state is therefore
  "require a human" → `shadow`.

The two conclusions look opposite (`off` vs `shadow`) but are the *same* rule: when in doubt, fall to
the state that does the least irreversible thing. For a system whose job is to *maybe block*, that means
don't block; for a system whose job is to *maybe act*, that means don't act. A resolver hiccup must
never authorize execution any more than it may deny care.

---

## 7. Admin / console UX concept

This is the design-review section for this doc (mirroring the case-spine allowlist's design-review
section) and it is a **trust surface**, per owner principle #4 — *"AI exists to learn each hospital's
operations, not to replace human judgment."* Clarity here is load-bearing, not cosmetic. The screen is
admin-only, console-only (management surface — `WebOnlyGuard` + admin role), Hebrew-default / RTL-first,
he+en through the typed `i18n` accessor, no hardcoded strings.

**Autopilot Policy screen — what it shows (per clinic the admin manages):**

1. **A row per proposal kind** (Task 1.1's set: handover, coordinator-reassign-when-off-roster,
   restock-PO-on-burn, crash-cart-drift-pull-back). Each row shows the **current effective state in
   plain language** — `Off` / `Shadow (learning)` / `Enforce (live)` — computed from *both* switches, so
   the admin sees the real outcome, not just the flag they touched. A kind whose org policy is approved
   but whose base mode is still `shadow` reads clearly as "Shadow — approved, awaiting rollout," never
   as "Enforce."
2. **Evidence before approval.** For a kind currently in `shadow`, the row surfaces the Task 0.5
   backtest signal (precision / recall for that proposal kind) so the admin approves on data, not blind.
   Approving `enforce` for a kind with no shadow history should be visibly discouraged.
3. **Approval is a deliberate ceremony, not a toggle.** The approve action opens a confirmation that
   states, in plain language, exactly what is being unlocked: *"VetTrack will be able to execute
   &lt;this kind&gt; without a human tap, in &lt;this clinic&gt;. Your org is accountable for these
   actions. You can revoke this at any time."* — explicit confirm required. This is the "explicit org
   approval" the owner decision demands, made felt.
4. **Enforce-vs-shadow visual language** is shared with Task 1.1's approval-queue design so the admin
   reads the same distinction in both places. `aria-live` announces state changes; `prefers-reduced-
   motion` / `prefers-contrast` honored (Liquid Glass track — glass belongs only on floating controls,
   never here as content chrome; AA contrast).
5. **Provenance line** per row: "Approved by &lt;name&gt; · &lt;when&gt;" or "Revoked by &lt;name&gt; ·
   &lt;when&gt;", sourced from the audit trail (§5), so the current state is always attributable.
6. **Revoke is one clear action with an honest promise:** *"Future proposals of this kind return to
   human approval within seconds. Nothing already done is undone."* — matching the §4 semantics exactly,
   so the UI never over-claims a rollback it doesn't perform.

---

## 8. Required explicit statements (CI-16 / CI-20 pattern, by name)

- **`off` still short-circuits.** When a proposal kind's base mode resolves to `off` (its policy absent
  or irrelevant), `effectiveMode` returns before the policy layer is consulted — **no policy-gate query
  issues, no clinical-validation-equivalent work happens.** This is the same short-circuit the frozen
  envelope guarantees: "`off` — the evaluator path is short-circuited; no clinical-validation queries
  issue" (CLAUDE.md § Authority + enforcement). The policy layer does not change what `off` means and
  does not add work to the `off` path.
- **A resolver throw degrades to the safe default.** Any throw inside `resolveEnforcePolicy` (or the
  base mode resolver) is caught and degrades to the safe default — here **`shadow`** (§6), never
  `enforce`. This is the **CI-16 / CI-20 wiring-layer Strategy A safety net** applied to this layer by
  name: a transient failure reading the mode/policy must never accidentally authorize execution, exactly
  as, in the underlying evaluators, it must never accidentally block care. The base mode resolver's own
  throw-degrades-to-`off` behavior (`clinical-invariant.config.ts` — the `getServerConfigValue` throw is
  swallowed to "no override") is preserved unchanged; the policy layer adds its own catch that lands on
  `shadow`, and the two compose so the *effective* outcome of any failure is at most `shadow`.

---

## Consumption note (for Task 2.5(a))

Task 2.5(a) is the only place that turns this design into code. Its enforce-promotion must:

1. Reuse the shipped envelope's base mode resolver for the Autopilot proposal-mode family unchanged
   (own file, own 10s TTL cache map, typo-defense, throw-degrades-to-`off`) — do not edit any existing
   enforcement family.
2. Add `resolveEnforcePolicy(clinicId, proposalKind)` reading
   `autopilot.policy_enforce.<proposalKind>.<clinicId>` from `vt_server_config`, own 10s TTL cache map,
   `approved`-only truthiness, **throw-degrades-to-not-approved (→ `shadow` clamp)**.
3. Compose them exactly as §2's `effectiveMode` — the policy gate consulted only on the `enforce` branch,
   able only to clamp down to `shadow`.
4. Add the two `AuditActionType` members (§5) and the two bounded metric counters; wire the admin-only
   approve/revoke route (admin role from `vt_users.role`).
5. Gate the console screen (§7) behind `WebOnlyGuard` + admin; all copy through i18n (he+en parity).

Any field/state the console renders must already appear in this design, or it doesn't ship.
