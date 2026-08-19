# ADR-011: Gap-check realtime events on a per-clinic sequence, not the global outbox id

| Field | Value |
|-------|--------|
| **Date** | 2026-08-19 |
| **Status** | accepted — implemented in migration 186 |
| **Tags** | `#realtime` `#tenancy` |

## Context

`vt_event_outbox.id` is a **global** `BIGSERIAL PRIMARY KEY` shared by every clinic
(`migrations/090_vt_event_outbox.sql:4`). That id does three different jobs today, and
the third one is unsound.

**Job 1 — durable ordering and resume.** The SSE frame carries `id: ${row.id}`
(`server/routes/realtime.ts:131`), the browser echoes it back as `Last-Event-ID`, and
`replayPublishedOutboxAfter` (`server/routes/realtime.ts:164`) replays rows after it.
This works and is a frozen surface. Nothing below changes it.

**Job 2 — tenant scoping.** Every read is clinic-filtered
(`server/routes/realtime.ts:184, 216, 270, 330`) and the publisher fans out per clinic:

```js
outboxEmitter.emit(`clinic:${row.clinicId}`, row);   // event-publisher.ts:113
```

So a connected client only ever observes **its own clinic's subset** of the global
sequence.

**Job 3 — gap detection. This is the defect.** The client asserts strict contiguity on
that same global id:

```ts
if (oid <= this.lastAppliedEventId) { /* duplicateDrop */ }   // src/lib/realtime.ts:703
if (oid !== this.lastAppliedEventId + 1) { /* gapResync   */ }  // src/lib/realtime.ts:707
```

A subset of a shared monotonic sequence is **not contiguous**. With two clinics writing,
clinic A observes ids `100, 103, 107` — and every one of those is read as a dropped
event. The consequence is not a missed update; `establishBaselineAfterFullRefresh()`
fires instead, so per event, per connected client, the app performs a `gapResync`
telemetry POST, a `forceResyncWardErCaches()` (snapshot refetch + container
invalidation), and an `outboxHead()` GET. The cursor it re-establishes is itself
clinic-scoped (`server/routes/realtime.ts:330`), so the next event repeats the whole
cycle. It does not converge.

**Why this has not been observed.** Production runs one active clinic, where the
subset *is* the whole sequence and contiguity holds by accident. The bug is latent
until a second clinic writes.

**Why this is being written now.** The defect is pre-existing and already applies to
equipment, Code Blue, waitlist and RFID events. It surfaced while reviewing
`b26e06d89` (`fix(realtime): route task lifecycle events through the outbox`), which
moves `TASK_*` and `AUTOMATION_TRIGGERED` — the highest-frequency domain events — from
the legacy in-memory `broadcast()` onto the outbox path. That commit is correct on its
own terms and closes a real replay gap, but it multiplies the blast radius of this one.
It should not reach a multi-clinic database before this ADR is implemented.

## Decision

Split job 3 off from jobs 1 and 2. **The global `id` keeps doing resume and ordering,
unchanged. A new per-clinic sequence does gap detection.**

### 1. Schema

Add to `vt_event_outbox`:

```sql
ALTER TABLE vt_event_outbox ADD COLUMN clinic_seq BIGINT;
CREATE UNIQUE INDEX uq_vt_event_outbox_clinic_seq ON vt_event_outbox (clinic_id, clinic_seq);
```

Backfill existing rows deterministically, ordered by the global id within each clinic:

```sql
UPDATE vt_event_outbox e SET clinic_seq = s.rn
FROM (SELECT id, row_number() OVER (PARTITION BY clinic_id ORDER BY id) AS rn
      FROM vt_event_outbox) s
WHERE e.id = s.id;
```

Assignment for new rows is a per-clinic counter row, taken under a row lock so
concurrent inserts for one clinic serialize while different clinics do not contend.

> **Correction, made during implementation.** This section originally said the assignment
> would live in `insertRealtimeDomainEvent` (`server/lib/realtime-outbox.ts`), "the single
> choke point for all 16 emit sites". **It is not the single choke point.** `server/lib/
> audit.ts:398` inserts into `vt_event_outbox` directly for every `logAudit()` call, so an
> application-level assignment would have left every `audit_log` event unsequenced — and
> since a missing `clinicSeq` makes the client skip the contiguity check, the failure would
> have been silent rather than loud. The assignment is therefore a **BEFORE INSERT
> trigger** (`vt_event_outbox_assign_clinic_seq`, migration 186), which covers both paths
> and any third one added later, and puts the invariant in the database rather than in a
> convention every future caller has to remember. The unique index is the backstop.

```sql
INSERT INTO vt_event_outbox_seq AS s (clinic_id, next_seq)
VALUES (NEW.clinic_id, 1)
ON CONFLICT (clinic_id) DO UPDATE SET next_seq = s.next_seq + 1
RETURNING s.next_seq INTO NEW.clinic_seq;
```

**Rejected alternative:** `SELECT COALESCE(MAX(clinic_seq),0)+1 … WHERE clinic_id = $1`
inline in the insert. It needs no new table, but two concurrent inserts for one clinic
read the same max; the unique index then makes one fail, which buys a retry loop on the
emergency path. Not worth saving one table.

### 2. Envelope

`outboxRowToSse` (`server/routes/realtime.ts:131`) adds `clinicSeq: row.clinic_seq`.
The `id:` line and the `id` / `outboxId` fields are **unchanged**.

### 3. Client

`EventIngestor` tracks `lastAppliedClinicSeq` **alongside** `lastAppliedEventId`:

- contiguity (`!== last + 1` → `gapResync`) moves to `clinicSeq`;
- duplicate suppression (`<= last`) moves to `clinicSeq`;
- `id` continues to drive `Last-Event-ID`, replay, prune detection and
  `reset_state:last_event_pruned`;
- **when `clinicSeq` is absent, apply the event and skip the contiguity check.** This
  is the rolling-deploy and pre-backfill path: an old server, or a replayed row from
  before the migration, must not be read as a gap.

### 4. Not in scope

`Last-Event-ID` semantics, the replay endpoint, outbox pruning, `RESET_STATE`, the
BroadcastChannel envelope, and the emergency cache denylist are all untouched. This is
strictly additive to the frozen realtime surface — which is why it is an ADR rather
than a doctrine change.

## Consequences

**Positive.** Gap detection becomes true for the multi-clinic deployment the product is
built for, and it stays real: a genuinely dropped event is still caught, which the
cheaper fix below gives up. `b26e06d89` becomes safe to deploy. Equipment, Code Blue,
waitlist and RFID events are fixed by the same change.

**Negative.** One migration, one new table, one write-lock per event per clinic
(negligible at clinic event volume), and a client that must carry the absent-`clinicSeq`
fallback until both sides have shipped.

**Operational.** The `realtime_gap_resync` counter will fall sharply on any multi-clinic
environment. That is the fix landing, not instrumentation breaking — say so in the
release note, or the drop will be misread.

**Migration ordering.** Server first, client second. A client that reads `clinicSeq`
before the server emits it takes the absent-field fallback and behaves exactly as it
does today. The reverse order is also safe: an old client ignores the new field.

**Rejected alternative — relax the check to `oid > last`.** One line, no migration, and
it does stop the false-gap storm. It also permanently discards the ability to detect a
genuinely dropped event, which is the entire reason the check exists. Rejected: it
trades a correctness property for the cost of one migration.

**Do nothing.** Not viable. The defect is already live for equipment and Code Blue on
any second clinic, and it degrades exactly when the product succeeds commercially.

## Compliance

- [x] `pnpm architecture:gates` — exit 0
- [x] `npx tsc --noEmit` — all three tsconfigs exit 0
- [x] Schema migration + `pnpm db:migrate` — `migrations/186_vt_event_outbox_clinic_seq.sql`, applied on the full 1–185 chain against a throwaway database, and re-applied verbatim to prove idempotency
- [x] Backfill verified: rows inserted with the trigger disabled, migration re-run, `clinic_seq IS NULL` count 0, sequences contiguous from 1, and the counter re-seeded so the next insert continued rather than colliding
- [x] Two clinics interleaving writes → contiguous per-clinic sequences: `tests/migrations/event-outbox-clinic-seq.test.ts` (DB) and zero `gapResync`: `tests/realtime-per-clinic-sequence.test.ts` (client)
- [x] A genuinely skipped `clinicSeq` still fires `gapResync` — asserted in the client test
- [x] An event with no `clinicSeq` is applied without a gap (rolling-deploy path) — asserted in the client test
- [x] `tests/phase-9-deterministic-drills.test.ts` counter contracts still hold — full suite green
- [x] **Three defects found in review, each reproduced before fixing** (round 1 on PR #197):
  - The trigger returned early on an explicit `clinic_seq` without advancing the counter.
    Reproduced on a live DB: after a restore row at `500`, the next automatic insert got
    **3**, which a client that had applied 500 drops as a duplicate — silent event loss.
    Counter now moves to `GREATEST(next_seq, NEW.clinic_seq)`; same probe returns 501.
  - `handleResetState` (the `reset_state:last_event_pruned` and peer-prune path) cleared
    only `lastAppliedEventId`, leaving the sequence cursor pre-reset — so the first event
    after a reset failed contiguity and was dropped into gap recovery instead of applied.
    `establishBaselineAfterFullRefresh` (gap recovery) was already correct; only this path
    was not. Regression test asserts the event is APPLIED, not the gapResync count —
    `gapRecoveryInFlight` suppresses a second telemetry post, so a count-based assertion
    passed with the bug present.
  - An applied unsequenced (pre-186) event left the cursor stale by one, so the next
    sequenced event reported a gap that never happened. The cursor is now invalidated.
- [x] `/outbox-head` no longer casts BIGINT cursors to `::int` — that overflowed at
  2,147,483,647 and turned the recovery endpoint into a 500 exactly when a clinic had run
  long enough to need it. Selected as text, range-checked against `Number.MAX_SAFE_INTEGER`.
- [x] **The server→client seam is now covered — `tests/realtime-sse-envelope-clinic-seq.test.ts`.**
  `outboxRowToSse` (`server/routes/realtime.ts:131`) is the only place `clinicSeq` enters the
  frame the browser receives, and nothing asserted it. That gap was worse than an ordinary
  uncovered function because **its failure is silent by design**: §3 above requires the client
  to apply an event and skip the contiguity check when `clinicSeq` is absent, so dropping the
  field does not error, resync, or report a gap — it quietly disables gap detection while every
  other test stays green. Demonstrated, not asserted: with `clinicSeq` removed from the envelope,
  the new suite fails 3 of 4, and `tests/realtime-per-clinic-sequence.test.ts` +
  `tests/phase-9-deterministic-drills.test.ts` both stay green at **20/20**. The function is now
  exported for that test; the export is additive and no call site changed.
- [ ] **Playwright `tests/phase-9-drills.spec.ts` — still NOT RUN, and running it would not have
  closed this item.** The earlier version of this line implied the drills were the missing
  verification. They are not: drill 1, the only realtime-gap drill, POSTs
  `api.realtime.telemetry({gapResync: true})` and asserts the counter moves. Its own header says
  so — *"The full SSE outbox-pause harness is server-side infrastructure"* — and it would pass
  identically before this ADR, after it, and with `EventIngestor` deleted. What is genuinely
  still unverified is the **live transport**: no test drives a real `EventSource` against a real
  publisher and asserts a browser observes contiguous `clinicSeq` across interleaved clinics.
  Closing it means writing that drill, not running the existing ones. Left open deliberately and
  described precisely, so the next reader does not close it with a green tick that proves nothing.
- [x] i18n parity — not applicable, no user-facing copy (`pnpm i18n:check` green regardless)
