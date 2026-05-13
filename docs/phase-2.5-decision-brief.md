# Phase 2.5 — Product Decision Brief

**Scope:** Clinical Check-in & Active Authority Infrastructure.
**Status:** Decision-needed brief. Not implementation.
**Audience:** Product owner + senior engineering. Approve / counter each recommendation before Phase 2.5 PRs are scoped.
**Cross-refs:** `docs/authority-model.md §3` (Tech eligibility), `§4` (Vet check-in), `§4.8` (six-layer separation), `docs/operational-modes.md §2.4` (Code Blue manager), `docs/architecture-review.md §1.8–§1.9` (missing-phase blocker), `§4.18–§4.21` (new risks).

---

## How to read this brief

Each of the 10 decisions below has:

- **Recommended decision** (one line; what to approve).
- **Alternatives considered** (concrete options that were on the table).
- **Risks** (what can go wrong with the recommendation).
- **Final V1 recommendation** (the locked answer; this is what Phase 2.5 builds).

The brief ends with an **Implementation prompt** that can be handed to engineering once the decisions are approved.

The brief covers V1 only — the founder's clinic, single tenancy in practice. Multi-clinic extensibility is preserved at the boundary level (decision-helpers, `clinicPolicy`) but not exercised.

---

## Decision 1 — Technician check-in UX

### Recommended decision

**Login-time modal during eligibility window + force-modal on first clinical mutation.** One tap to confirm presence. No kiosk hardware. No badge integration.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Login-time modal in eligibility window | Frictionless; aligns with existing login flow | Modal fatigue if shown outside eligible window |
| B. Persistent "please check in" banner only | Non-blocking; lowest friction | Easy to ignore; user discovers 403s at mutation time |
| C. Force-modal on first clinical mutation only | Fails closed cleanly | First-action latency; surprising to user |
| D. Auto-check-in on first authenticated request | Zero friction | Defeats binding-event purpose (`AM §3.2.2` rejects this) |
| E. Badge / NFC kiosk | Industry-standard for shift attendance | Hardware integration out of V1 scope; capital cost |
| F. Manual check-in via Settings | Explicit; no surprise | Poor discoverability; user education burden |

Best blend: A + C (login-time modal as happy path; force-modal as fail-closed safety net). B (banner) is layered on top of A as the "dismissed-the-modal" state.

### Risks

- **Modal fatigue.** If a Tech logs in early (e.g., 2 hours before shift) and gets prompted, they'll dismiss. Mitigation: only show modal within 30 minutes of EZShift start.
- **Dismissed-modal user hits a 403.** Mitigation: banner replaces dismissed modal; first clinical-action attempt re-triggers modal.
- **Multiple eligible shifts overlap** (a Tech is scheduled for two consecutive blocks). Mitigation: collapse contiguous blocks into a single session; check-in covers the merged window.
- **Wrong identity.** EZShift name → VetTrack user match (PDN-A1) is fragile; if the wrong user gets a modal for someone else's shift, they could mistakenly confirm. Mitigation: show user name + shift name + clinic on the modal; rely on the existing identity-matching investment.

### Final V1 recommendation

- Modal triggered automatically on login **when** the user has an EZShift-eligible row within `[now - 0min, now + 30min]` AND is not already checked in.
- Modal content: shift name, scheduled window, department, role label, and a single "Confirm shift start" button. Secondary "Check in later" button.
- After confirmation: header shows "On shift: [role] · [department] · ends [time]" with a check-out button.
- After "Check in later": persistent banner appears with "Check in to use clinical features."
- On first clinical-mutation attempt without check-in: modal force-triggers, blocking the action until confirmed or cancelled.
- **No kiosk, no badge hardware, no shared-device flow in V1.**
- Mobile UX: same modal, full-screen.

---

## Decision 2 — Senior Technician check-in behaviour

### Recommended decision

**Identical to Technician.** The check-in subsystem treats Tech and Senior Tech the same. The EZShift label determines the effective `shiftRole` per `AM §3.5`; check-in confirms presence regardless of the user's underlying `clinicalRole`.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Identical to Technician | Simplest; preserves shiftRole-override semantics | Senior Tech downgraded-to-Tech on a covering shift may not realise their authority is reduced |
| B. Senior Tech-specific UX (e.g., "operating as Tech" badge if downgraded) | User awareness; clinical safety | Modest engineering; risk of conflating UX with auth |
| C. Senior Tech-specific check-in flow | None defensible | Duplicate code paths; violates the override rule documented in `AM §2 rule 2` |

A is the right architectural choice. B is a UX overlay that can ship within the same modal as Decision 1 at near-zero extra cost.

### Risks

- **Senior Tech is unaware of role downgrade.** A Senior Tech scheduled as Tech for a shift has Tech-level authority; if they don't realise, they may attempt Senior-Tech-only actions and hit 403s. Mitigation: modal explicitly shows "Effective role for this shift: Technician" (resolved from EZShift label) when it differs from the user's `clinicalRole`.

### Final V1 recommendation

- Same flow as Decision 1.
- Modal display includes an "Effective role for this shift" line when `effectiveRole !== clinicalRole`. Plain copy: "Note: You are operating as a Technician during this shift."
- No second modal, no separate page.

---

## Decision 3 — Vet check-in UX

### Recommended decision

**Login-time modal with operational-role picker.** Picker filtered to the user's `allowedOperationalRoles`. Senior Vet surfaced first when allowed. Most-recent operational role pre-selected.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Login-time modal picker | Aligns with Tech flow; predictable | Modal-on-login UX must be careful with timing |
| B. Dedicated `/check-in` page | Richer UI possible; bookmarkable | Extra navigation step; lower completion rate |
| C. Inline picker in user-menu dropdown | Always accessible | Low discoverability; users may not realise they need to act |
| D. Default-to-most-recent role (pre-selection, single confirmation) | Lowest friction | Risk of accidental wrong-role check-in (Senior Vet confused for ER/ICU Vet) |
| E. Force role selection on every check-in (no pre-fill) | Explicit intent | High friction for the common case |

A with D as a UX optimization. Pre-select most-recent role, but **require explicit confirmation** (button click) — pre-selection does not auto-confirm.

### Risks

- **Wrong operational role selected.** A Vet selects Senior Vet by accident when they intended ER/ICU Vet. Mitigation: pre-select most-recent role; UI highlights the selected option clearly; check-out + re-check-in is the recovery path.
- **`allowedOperationalRoles` empty.** Vet sees an empty picker and cannot proceed. Mitigation: surface "Contact admin — no operational roles configured" message; tie to Decision 7 (seed strategy).
- **Mid-shift operational-role swap** (PDN-V9). Out of V1 scope. Workaround: check out, check in again. Document explicitly.
- **On-call Vet selection** (PDN-V5). On-call is technically an operational role but confers no authority alone. Either (a) hide on-call from the V1 picker, or (b) show it greyed out with explanation. **Recommend (a) — hide on-call from V1 picker** to avoid confusion. On-call workflow is Phase 4 product work.

### Final V1 recommendation

- Modal triggered automatically on login when the Vet has non-empty `allowedOperationalRoles` AND is not already checked in.
- Picker shows allowed roles **except `on_call_vet`** (hidden in V1; PDN-V5 deferred).
- Senior Vet listed first if present in allowed roles; visually distinguished.
- Most-recent operational role from this user's prior check-in is pre-selected; user clicks "Check in as [role]" to confirm.
- After confirmation: header shows "On shift: [operational role] · ends [until check-out]" with a check-out button.
- After "Check in later": persistent banner; force-modal on first clinical mutation (same pattern as Tech).
- Mid-shift role swap: V1 = check out, check in again. UI surfaces this as the recovery action; no dedicated swap button in V1.

---

## Decision 4 — Check-out rules with in-flight responsibilities (PDN-V8)

### Recommended decision

**Hybrid by responsibility severity.** Block check-out for Code Blue manager. Warn + allow for in-progress tasks. Allow silently for shift-handover drafts.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Block check-out for any in-flight responsibility | Safest | Creates deadlock if no handoff target exists |
| B. Force-handoff modal at check-out | User retains control | Complex UX; PDN-V11 (auto-assign) still required for fallback |
| C. Auto-orphan; let downstream UI flag "needs reassignment" | Simplest | Active Code Blue with off-shift manager = clinical risk |
| D. Auto-reassign to Senior Vet / Senior Tech | Best clinical hand-off in theory | Requires reassignment infrastructure that's Phase 4 work |
| **E. Hybrid by severity (recommended)** | Pragmatic; minimal blast radius | Three different behaviours to test |

Hybrid (E) buys time on PDN-V11 (manager auto-assignment) while still protecting Code Blue sessions — the highest-stakes case.

### Risks

- **Block-checkout creates clinical-flow lock.** A Vet is the assigned Code Blue manager. They try to leave. They cannot until the session ends or another Vet takes over. Mitigation: surface clear instructions ("End the session or have another Vet take manager role via the Code Blue page") and ensure the manager-reassignment UI exists in Phase 4 PR 4.6.
- **Warn-and-allow for in-progress tasks leaves orphan assignments.** Phase 3B escalation engine catches these after 10 minutes, but the window matters. Mitigation: surface the task list in the warning modal; user may complete or hand off before confirming check-out.
- **Cannot enforce check-out cleanly on session timeout.** A user closes the browser without checking out. The session stays open. Phase 2.5 needs a fallback: check-out auto-fires at EZShift block end (Techs) or at session-token expiry (Vets).
- **What about Tech check-out blocking?** A Tech assigned a task is no different from a Vet for the warn-and-allow rule. Block-checkout only applies to Code Blue manager assignment (a Tech can't be one), so Techs see only the warning path.

### Final V1 recommendation

- **Code Blue manager** assigned to the user → **BLOCK** check-out. Error modal: "You are the assigned Code Blue manager for session [id]. End the session or reassign manager before checking out." (Reassignment UI is Phase 4 PR 4.6.)
- **In-progress tasks** assigned to the user → **WARN + ALLOW**. Confirmation modal lists tasks; user confirms or cancels. On confirm, tasks remain assigned (orphan state); escalation engine (Phase 3B/3C) catches them after 10 minutes.
- **Open shift-handover draft** authored by the user → **ALLOW silently**. Drafts can be resumed by anyone with handoff permissions per `task-product-model.md`.
- **Auto-check-out fallbacks**:
  - Tech sessions auto-close at EZShift block end (with audit).
  - Vet sessions auto-close at session-token expiry (with audit); session-token TTL is independent of operational-role choice.
- **Audit**: every check-out logs whether blocked, warned-and-allowed, or silent. Warned-and-allowed audit entry includes the count of orphaned tasks.

---

## Decision 5 — ER Mode dead-lock escape hatch (PDN-V10)

### Recommended decision

**`systemRole = Admin` may unconditionally disable ER Mode** as an escape hatch. Audit-logged with mandatory reason. Push notification fan-out to all active users. Admin **cannot enable** ER Mode (asymmetric).

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| **A. Admin disable (asymmetric)** | Simple; uses existing role; auditable | Admin may not be physically present; might be off-hours |
| B. Auto-disable after no-Senior-Vet for N minutes | No manual intervention needed | Automated state change during clinical stress = surprise |
| C. Any checked-in Vet can disable when no Senior Vet | Clinical authority broadens correctly | Erodes the "Senior Vet only" enable rule; undermines policy |
| D. Out-of-band manual call to support / ops | Clear chain of custody | Clinic cannot operate self-sufficiently |
| E. Preset emergency override password | Always available | Custodial chain disaster; passwords get shared |
| F. Senior Tech may disable (operational-lead analogue) | Senior Tech is more likely to be on shift than Admin | Crosses clinical/system boundary; Senior Tech is not authorised for ER Mode in any other context |

Option A is the cleanest. Admin already exists; it's already orthogonal to clinical authority; disable-only preserves the "Senior Vet only enable" rule.

### Risks

- **Admin not available.** A clinic with no Admin user logged in cannot disable ER Mode. Mitigation: SMS / phone-tree to the Admin user; this is operational, not technical. For founder's clinic V1, Admin is reachable.
- **Admin misuse.** Admin disables ER Mode to "let clinicians get back to their normal screens" without clinical justification. Mitigation: mandatory `reason` text field; push fan-out makes the disable visible to all users immediately; on next Senior Vet login a banner persists for the audit trail.
- **Audit-trail confusion.** ER Mode enable shows Senior Vet; disable shows Admin. The audit log should clearly mark the asymmetry. Mitigation: `actionType: "er_mode.admin_escape_disable"` is distinct from `actionType: "er_mode.disable"`.

### Final V1 recommendation

- Add a new authority path: any `systemRole = Admin` user (regardless of clinical check-in status) may call the ER Mode disable endpoint with a mandatory `escapeHatchReason: string`.
- **Disable-only.** Admin cannot enable ER Mode under this path; enable still requires checked-in Senior Vet.
- On admin escape-hatch disable:
  - Audit entry with `actionType: "er_mode.admin_escape_disable"`, `escapeHatchReason`, actor, timestamp.
  - Push notification fan-out to every currently authenticated user in the clinic with copy: "Admin disabled ER Mode. Reason: [text]".
  - Persistent banner shown to the next checked-in Senior Vet until acknowledged.
- No auto-disable. No password-based override. No Senior-Tech path.

---

## Decision 6 — `clinicPolicy` V1 storage (PDN-V16)

### Recommended decision

**JSON column on `vt_clinics` with default-merge in the resolver.** Defaults defined in `shared/clinic-policy-v1.ts`. No new tables. No new endpoints in V1.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| **A. `vt_clinics.policy JSONB` with default-merge** | One read per request; minimal schema sprawl | JSON schema enforcement is application-level |
| B. Separate `vt_clinic_policies` table (row per policy key) | Cleanest audit story for policy changes | Extra join; complexity unjustified for V1 |
| C. Hard-coded constant in `shared/` | Smallest blast radius; no DB at all | Doesn't ship the helper-with-clinic-policy plumbing the architecture requires |
| D. Env var per policy | Deployment-time only | Cannot differ per clinic; rejected |

A is the right shape. The V1 policy data is tiny — three flags — and a JSON column keeps the surface area minimal while preserving the helper-with-clinicPolicy contract.

V1 policy fields (founder's clinic):

```
{
  "codeBlue": { "allowAllActiveShiftVets": true },
  "erMode": { "seniorVetOnly": true, "adminEscapeHatchForDisable": true },
  "erIntake": { "primary": "receiving_vet", "alsoAllowed": ["senior_vet", "er_icu_vet"] },
  "medicationTask": { "anyVetOperationalRoleExceptOnCall": true }
}
```

### Risks

- **JSON typo silently breaks gates.** A misspelled key in the JSON makes the resolver fall back to defaults. Mitigation: defaults are intentionally V1-correct; misspelled key → same behaviour. Phase 5 admin UI introduces JSON schema validation.
- **Default-merge precedence.** If the JSON column is partially populated, missing keys fall back to defaults. This is by design; document explicitly.
- **No audit on policy change in V1.** Editing the JSON column directly via SQL bypasses audit. Mitigation: V1 disallows runtime edits (only seeded once during Phase 2.5 rollout); Phase 5+ adds the admin UI with audit.

### Final V1 recommendation

- Add `vt_clinics.policy JSONB DEFAULT '{}'` column.
- Define defaults in `shared/clinic-policy-v1.ts` as a frozen object.
- Resolver computes `effectivePolicy = deepMerge(DEFAULTS, clinic.policy)` per request.
- Helpers (`canManageCodeBlue` etc.) accept the merged policy as a parameter.
- **No edit endpoint in V1.** Seed the founder's clinic via SQL during Phase 2.5 rollout. Phase 5+ adds `PATCH /api/clinics/:id/policy` with audit.
- TypeScript type for the policy object exported from `shared/`.

---

## Decision 7 — `allowedOperationalRoles` seed strategy (PDN-V2, PDN-V3)

### Recommended decision

**One-time manual seed migration for the founder's clinic + `['er_icu_vet']` default for newly-created Vet users.** Storage: `vt_users.allowed_operational_roles TEXT[]`.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Empty default for all (fail-closed) | Safest from a privilege standpoint | All existing Vets locked out on rollout; requires admin UI before rollout |
| B. All five operational roles for everyone | No one locked out | Every Vet can declare themselves Senior Vet; defeats the gate |
| C. Single-role default `[er_icu_vet]` | Conservative middle ground; one explicit operational role | Users with no historical role assignment land on ER/ICU; may not match all clinics |
| D. Backfill from existing user metadata | Personalised | Heuristic; brittle; risk of wrong assignment |
| **E. Manual one-time SQL seed + C default for new users (recommended)** | Founder-clinic accurate; safe default for future | Requires per-user mapping at seed time |

E is correct for the founder's clinic: the existing Vet roster is small and known. C is the right default for new users post-rollout.

Storage: column on `vt_users.allowed_operational_roles TEXT[]` (Postgres array). Simpler than a separate table; aligns with `clinicalRole` proximity. Future migration to a row-per-role table is non-breaking.

### Risks

- **Seed migration error.** Wrong roles assigned during rollout. Mitigation: review with clinic admin before running; backup `vt_users` before migration; rollback is restoring the column from backup.
- **New Vet user with no admin attention.** Lands on `[er_icu_vet]` default; may need Senior Vet but admin hasn't updated. Mitigation: post-rollout, admin reviews new Vet users weekly. Phase 5 admin UI streamlines this.
- **Storage shape locks the future.** If Phase 5+ needs richer per-role config (e.g., role + scope + expiry), a TEXT[] column doesn't scale. Mitigation: Phase 5 can migrate to a separate table when the time comes; the migration is additive and revertable.

### Final V1 recommendation

- Add `vt_users.allowed_operational_roles TEXT[] NOT NULL DEFAULT '{er_icu_vet}'` column (Postgres array; default single-element).
- Per-user seed migration runs during Phase 2.5 rollout for the founder's clinic. Mapping is provided by the clinic admin via spreadsheet or direct input:
  - Vets with Senior-Vet privileges: `['senior_vet', 'er_icu_vet', 'hospitalization_vet', 'receiving_vet']`.
  - Vets with primary ER/ICU duty: `['er_icu_vet']` or `['er_icu_vet', 'receiving_vet']` etc.
  - On-call-only Vets: `['on_call_vet']` (note: this confers no authority; PDN-V5 deferred).
- Validation at check-in: backend rejects any `operationalRole` not in the user's `allowed_operational_roles`. 403 with structured reason.
- No admin UI for editing in V1. Phase 5 ships `PATCH /api/users/:id/allowed-operational-roles` with audit.

---

## Decision 8 — Audit requirements (PDN-V4 broadened)

### Recommended decision

**Audit every check-in, every check-out, every Code Blue manager change, and every ER Mode admin escape-hatch disable.** Reuse `vt_audit_logs`. Distinct `actionType` strings per event. JSON metadata column carries event-specific fields.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Audit all session events (recommended) | Operationally critical events all recorded; supports incident reconstruction | Volume increases (modest — once per shift per user) |
| B. Audit only check-out; infer check-in from check-out's `startedAt` | Half the volume | Cannot detect check-in that never produces a check-out (browser close) |
| C. No new audit for check-in/check-out; rely on `vt_audit_logs` for clinical action only | Smallest delta | "Who was Senior Vet at 03:14" cannot be answered |
| D. Sample audit (every Nth check-in) | Volume control | Useless for compliance/clinical-review purposes |

A is the right answer. Check-in events are central to the new authority model; sampling or omitting is not viable.

### Risks

- **Audit volume.** Two events per user per shift, plus exceptional events. For the founder's clinic (~30 staff), that's <60 audit entries per day. Negligible.
- **Audit index coverage.** `vt_audit_logs` has Phase 5 indexes pending; Phase 2.5 adds `actionType` values that should be covered. Mitigation: include the new `actionType` values in the Phase 5 index work.
- **Audit on auto-check-out.** When a Tech session expires at EZShift block end, audit must record this. Mitigation: scheduler-triggered audit entries with `actionType: "clinical_shift_session.auto_check_out"`.

### Final V1 recommendation

New `actionType` values in `vt_audit_logs`:

| `actionType` | Triggered by | Metadata |
|---|---|---|
| `clinical_shift_session.check_in` | check-in endpoint | `{ kind: "vet"\|"tech", operationalRole?, startedAt, clinicId }` |
| `clinical_shift_session.check_out` | check-out endpoint (user-initiated) | `{ kind, endedAt, durationMs, hadInFlightTasks: bool, hadCodeBlueManagerRole: bool }` |
| `clinical_shift_session.auto_check_out` | scheduler (block end / token expiry) | `{ kind, endedAt, trigger: "ezshift_block_end"\|"token_expiry" }` |
| `clinical_shift_session.check_out_blocked` | check-out attempt blocked | `{ reason: "code_blue_manager", sessionId }` |
| `er_mode.admin_escape_disable` | admin disable endpoint | `{ previousState: "enforced", newState: "disabled", escapeHatchReason }` |
| `code_blue.manager_assigned` | manager assignment | `{ sessionId, userId, operationalRole }` |
| `code_blue.manager_reassigned` | manager reassignment (Phase 4) | `{ sessionId, previousUserId, newUserId, reason }` |

Helper for log construction lives in `server/lib/audit.ts` (existing module). No new infrastructure required.

---

## Decision 9 — Rollout strategy / feature flag

### Recommended decision

**Per-clinic feature flag — `vt_clinics.phase_2_5_enabled BOOLEAN DEFAULT FALSE`.** Default-off everywhere. Manually flipped for the founder's clinic after seed migration and validation. New endpoints return 404 when flag is off.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| **A. Per-clinic feature flag** | Clean rollback; multi-clinic ready | Adds one column + one if-check on every authority resolution |
| B. Per-environment flag (staging, production) | Simpler | Cannot toggle independently across clinics; not multi-clinic ready |
| C. Big-bang rollout (no flag) | Smallest delta | No rollback path; entire fleet either has Phase 2.5 or doesn't |
| D. Gradual ramp (% of users) | Fine-grained | Inappropriate for clinical-authority infrastructure; can't half-deploy auth |
| E. Code-level dev flag (env var) | Fast iteration | Deployment-time only; can't toggle per clinic |

A is the right shape: per-clinic toggle allows the founder's clinic to enable Phase 2.5 first while leaving other (future) clinics on legacy until ready.

### Risks

- **Flag-off behaviour must remain correct.** Existing endpoints continue to work via `requireEffectiveRole` (legacy). Phase 2.5 endpoints (`/api/shift-sessions/*`) return 404 (not 401, not 500). Mitigation: explicit test asserting 404 when flag is off.
- **Flag-on mid-shift transition.** If the flag is flipped while users are mid-session, what happens? Mitigation: flipping flag mid-shift transitions all users to "no active check-in" → they hit force-modal on next clinical mutation. Acceptable for V1 if flipping is done at a low-traffic time.
- **Flag-off rollback after enabling.** If Phase 2.5 is enabled, then a problem is detected and flag is flipped off, in-flight check-in sessions are orphaned but harmless (legacy gates resume). Audit trail captures the transition.
- **Decision-helper behaviour under flag-off.** Helpers (`canManageCodeBlue` etc.) should still exist and return the legacy-correct answer when flag is off. Mitigation: helpers default to the same boolean the legacy `requireEffectiveRole` would compute; flag flip only affects whether check-in state is consulted.

### Final V1 recommendation

- Add `vt_clinics.phase_2_5_enabled BOOLEAN NOT NULL DEFAULT FALSE`.
- Resolver checks the flag per request: if FALSE, fall back to legacy `requireEffectiveRole` path; if TRUE, consult check-in + new authority model.
- New endpoints (`/api/shift-sessions/*`) return 404 when flag is off (not 401).
- Decision-helpers exist in both paths; when flag-off they return the legacy answer; when flag-on they consume `(userAuthority, clinicPolicy)`.
- Rollout sequence for founder's clinic:
  1. Deploy Phase 2.5 code with flag=false everywhere.
  2. Run seed migration for `allowed_operational_roles`.
  3. Run seed migration for `vt_clinics.policy`.
  4. Smoke-test in staging with flag=true.
  5. Flip flag to true in production during a low-traffic window (e.g., 02:00 local).
  6. Monitor for 1 week.
  7. Phase 4 PRs (operational-role gates) deploy with hard dependency on flag=true.

---

## Decision 10 — Minimum viable Phase 2.5 implementation

### Recommended decision

**Seven-element MVP**, all gated behind the per-clinic feature flag. Defers PDN-V5, V6, V7, V9, V11, V12 and all admin UIs. Estimated scope: 2–3 weeks engineering across BE + FE + migrations + tests.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| A. Vet-only check-in (defer Tech) | Smaller scope | Doesn't unblock Phase 2C Tech migrations; mismatched authority model in production |
| B. Tech-only check-in (defer Vet) | Smaller scope | Doesn't unblock Phase 4 ER/Code Blue work |
| C. Full check-in + admin UI + clinic-policy editor | Most complete | Ships Phase 5 work prematurely; long timeline |
| **D. Seven-element MVP (recommended)** | Unblocks Phase 4; bounded scope; defers UI to Phase 5 | Some PDNs remain open; manual seed required |
| E. Skip check-in; ship decision-helpers only | Minimal | Doesn't address the underlying schedule-only authority gap |

D is the focused answer. The MVP unblocks Phase 4 without prematurely shipping Phase 5 admin tooling.

### MVP scope

1. **Schema** (3 columns, 1 table):
   - `vt_users.allowed_operational_roles TEXT[] NOT NULL DEFAULT '{er_icu_vet}'`.
   - `vt_clinics.policy JSONB NOT NULL DEFAULT '{}'`.
   - `vt_clinics.phase_2_5_enabled BOOLEAN NOT NULL DEFAULT FALSE`.
   - `vt_clinical_shift_sessions` table: `id, clinicId, userId, kind ('vet'|'tech'), operationalRole NULLABLE, startedAt, endedAt NULLABLE, idempotencyKey UNIQUE, metadata JSONB`. Unique constraint on `(clinicId, userId)` where `endedAt IS NULL` to prevent double check-in.
2. **Resolver extension** (one module):
   - `server/lib/authority/resolver.ts` (or sibling) — extends `resolveAuthority(req)` to consult check-in when flag is on.
   - Returns `{ systemRole, clinicalRole, activeShiftRole, operationalRole, checkedIn, clinicPolicy }`.
3. **Endpoints** (three handlers):
   - `POST /api/shift-sessions/check-in` — payload: `{ kind, operationalRole? }`. Returns session.
   - `POST /api/shift-sessions/check-out` — applies Decision 4 rules. Returns session or 409 with reason.
   - `GET /api/shift-sessions/me` — returns current active session for caller's clinic.
4. **FE flow** (three new components):
   - Check-in modal (Tech variant + Vet variant).
   - Persistent banner for dismissed-modal state.
   - Header indicator + check-out button.
5. **Decision helpers** (thin pass-throughs, four functions):
   - `server/lib/authority/policy-helpers.ts` exports `canManageCodeBlue`, `canToggleErMode`, `canCreateErIntake`, `canCreateMedicationTask`.
   - V1 implementation reads `clinicPolicy` and returns layer-5 answer when policy permits.
   - Phase 4 PRs wire these into endpoint handlers.
6. **Audit** (Decision 8) — `actionType` values added; metadata columns populated.
7. **Seed migration** for founder's clinic:
   - One-time SQL migration seeding `vt_users.allowed_operational_roles` from a manually-prepared mapping.
   - One-time SQL seed of `vt_clinics.policy` to the founder's V1 policy JSON.
   - Flag flip from `FALSE` to `TRUE` in a separate post-deploy migration step.

### Out of MVP (deferred)

- Admin UI for `allowed_operational_roles` editing (Phase 5).
- Admin UI for `clinicPolicy` editing (Phase 5).
- Mid-shift operational-role swap (PDN-V9; Phase 4+).
- On-call Vet → full-authority transition (PDN-V5; Phase 4+).
- Senior Vet operational override of "❌ default" capabilities (PDN-V6; Phase 4+).
- Multi-clinic check-in (PDN-V7; future).
- Code Blue manager auto-assignment (PDN-V11; Phase 4 PR 4.6).
- Senior Vet authority over in-flight Code Blue (PDN-V12; Phase 4).
- Force-handoff modal at check-out (only the block / warn / allow split is in V1).
- Kiosk / badge hardware integration.
- Clock-in / attendance device integration.
- RECOVER cockpit.

### Risks

- **Scope creep.** "Just one more PDN" temptation. Mitigation: this brief locks the V1 list; PDNs not listed in MVP are explicitly deferred; engineering PR template includes "Phase 2.5 MVP scope only — does this PR exceed?" checklist.
- **Founder's clinic rollout friction.** Tech check-in is operationally new; some Techs will resist. Mitigation: pre-rollout communication; bundled with a short training video; ops support during rollout week.
- **Decision-helpers ship as pass-throughs but get inlined later.** Engineering forgets the boundary and inlines V1 policy directly in Phase 4 endpoint code. Mitigation: PR-template checklist (§4.19 of architecture review).
- **Seed migration error.** Wrong roles for a Vet → 403 on Phase 2.5 endpoints. Mitigation: backup; admin review; revertable.

### Final V1 recommendation

Ship the seven-element MVP as five PRs:

1. **PR 2.5.1** — Schema + migrations + flag column (BE, no behaviour change with flag=false).
2. **PR 2.5.2** — Resolver extension + decision-helpers as pass-throughs (BE, no behaviour change with flag=false).
3. **PR 2.5.3** — Check-in / check-out endpoints + audit (BE, returns 404 with flag=false).
4. **PR 2.5.4** — FE check-in modal + banner + header indicator (FE, gated on `phase_2_5_enabled`).
5. **PR 2.5.5** — Seed migration for founder's clinic + flag flip (data only).

Phase 4 begins only after PRs 2.5.1–2.5.5 have shipped, the flag is on, and one week of observation has passed.

---

## Implementation Prompt (for use after approval)

Paste the following prompt into a new engineering task once Decisions 1–10 are approved. The prompt is self-contained and references only finalised decisions in this brief.

---

> **Phase 2.5 — Clinical Check-in & Active Authority Infrastructure — Implementation**
>
> **Source of truth:** `docs/phase-2.5-decision-brief.md`. All ten decisions are approved as written. Do not deviate.
>
> **Out of scope:**
>
> - Any PDN listed under "Out of MVP" in Decision 10.
> - Admin UIs for `allowed_operational_roles` or `clinicPolicy`.
> - Mid-shift operational-role swap, on-call Vet transition, multi-clinic check-in.
> - Kiosk / badge / clock-in / attendance hardware.
> - RECOVER cockpit.
> - Any policy editor, rule engine, or workflow DSL.
> - Renaming or moving existing routes, files, or tables.
>
> **PR sequence (do NOT collapse):**
>
> 1. **PR 2.5.1 — Schema.**
>    Add columns: `vt_users.allowed_operational_roles TEXT[] NOT NULL DEFAULT '{er_icu_vet}'`; `vt_clinics.policy JSONB NOT NULL DEFAULT '{}'`; `vt_clinics.phase_2_5_enabled BOOLEAN NOT NULL DEFAULT FALSE`. Add table `vt_clinical_shift_sessions` with columns per Decision 10 §1. Add the unique `(clinicId, userId)` constraint where `endedAt IS NULL`. Migration is additive; no data change. Test: flag-off behaviour identical to current.
>
> 2. **PR 2.5.2 — Resolver + decision helpers.**
>    Extend `resolveAuthority(req)` to consult `vt_clinical_shift_sessions` when `vt_clinics.phase_2_5_enabled = true`. When flag is off, return identical legacy resolver output. Add `server/lib/authority/policy-helpers.ts` exporting `canManageCodeBlue`, `canToggleErMode`, `canCreateErIntake`, `canCreateMedicationTask`. Each helper consumes `(userAuthority, clinicPolicy)` and returns a boolean per Decision 6. V1 implementation merges defaults from `shared/clinic-policy-v1.ts`. Tests: helpers return correct V1 answers; resolver flag-off equivalence.
>
> 3. **PR 2.5.3 — Check-in / check-out endpoints.**
>    Add `POST /api/shift-sessions/check-in`, `POST /api/shift-sessions/check-out`, `GET /api/shift-sessions/me`. Implement Decision 4 (block / warn / silent by responsibility severity). Audit per Decision 8. Endpoints return 404 when flag is off. Tests: every audit event fires; check-out blocked for Code Blue manager; concurrent check-in rejected by unique constraint.
>
> 4. **PR 2.5.4 — FE check-in flow.**
>    Implement modal per Decisions 1 (Tech), 2 (Senior Tech same as Tech with effective-role line), 3 (Vet picker with Senior Vet first, default-to-most-recent, on-call hidden). Persistent banner for dismissed-modal state. Header indicator with check-out button. All gated on `phase_2_5_enabled` (FE reads from `/api/users/me` payload). Tests: Playwright smoke through happy path; modal force-trigger on first clinical mutation; check-out warning UX.
>
> 5. **PR 2.5.5 — Seed + flag flip.**
>    SQL migration script seeding `vt_users.allowed_operational_roles` for founder's-clinic Vets per a manually-prepared mapping (see Decision 7). SQL seed of `vt_clinics.policy` to the founder's V1 policy JSON (see Decision 6). A separate post-deploy migration step flips `vt_clinics.phase_2_5_enabled` to `TRUE` for the founder's clinic only. Tests: smoke run in staging; rollback validated by flipping flag back to `FALSE`.
>
> **Per-PR checklist:**
>
> - Phase 2.5 MVP scope only — does this PR exceed? If yes, split.
> - Does this PR route clinic-variable gates through a named decision helper (or none are present)? — `AM §4.8`, `architecture-review.md §4.19`.
> - Does this PR emit audit per Decision 8?
> - Does this PR respect the per-clinic feature flag (Decision 9)?
> - Schema-only PRs: is the migration revertable?
> - FE PRs: is the new UX dismissable without leaving the user in a stuck state?
>
> **Done-when:**
>
> - All five PRs landed in the listed order.
> - `vt_clinics.phase_2_5_enabled = TRUE` for the founder's clinic in production.
> - Audit log shows check-in / check-out events for staff over a 7-day observation window.
> - No 5xx errors on `/api/shift-sessions/*` for that window.
> - Phase 4 ER/Code Blue hardening PRs may then begin.
>
> **Do not start Phase 4 work until the above done-when criteria are met.**

---

## Approval status

| # | Decision | Status |
|---|---|---|
| 1 | Tech check-in UX | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 2 | Senior Tech check-in behaviour | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 3 | Vet check-in UX | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 4 | Check-out rules with in-flight responsibilities | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 5 | ER Mode dead-lock escape hatch | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 6 | `clinicPolicy` V1 storage | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 7 | `allowedOperationalRoles` seed strategy | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 8 | Audit requirements | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 9 | Rollout strategy / feature flag | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
| 10 | Minimum viable Phase 2.5 implementation | ☐ Approved · ☐ Counter-proposed · ☐ Pending |
