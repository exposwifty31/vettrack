-- 186: per-clinic sequence for realtime gap detection (ADR-011).
--
-- WHY THIS EXISTS
-- `vt_event_outbox.id` is a GLOBAL BIGSERIAL shared by every clinic (090:4), but the
-- publisher fans out per clinic (`outboxEmitter.emit('clinic:' || clinic_id, …)` in
-- server/lib/event-publisher.ts) and every read is clinic-filtered. A connected client
-- therefore observes only a SUBSET of that sequence, while src/lib/realtime.ts asserted
-- strict contiguity on it (`oid !== lastAppliedEventId + 1`). A subset of a shared
-- monotonic sequence is not contiguous, so with two clinics writing, EVERY event read as
-- a dropped one: gapResync telemetry + a full cache resync + an outbox-head refetch, per
-- event, per connected client — and the cursor that recovery re-establishes is itself
-- clinic-scoped, so it never converged. Latent only because production runs one active
-- clinic, where the subset is the whole sequence and contiguity holds by accident.
--
-- `id` KEEPS its other two jobs unchanged: SSE `id:` / Last-Event-ID resume, and replay
-- ordering. Only the contiguity check moves to `clinic_seq`. That is what makes this
-- additive to the frozen realtime surface rather than a change to it.
--
-- WHY A TRIGGER RATHER THAN APPLICATION CODE
-- There are TWO insert paths into this table — `insertRealtimeDomainEvent`
-- (server/lib/realtime-outbox.ts, 16 call sites) and a direct insert for audit rows at
-- server/lib/audit.ts:398. ADR-011 as written put the assignment in the first one, which
-- would have silently left every `audit_log` event without a sequence. Assigning in a
-- BEFORE INSERT trigger covers both paths, and any third that appears later, and makes
-- the invariant hold at the database rather than by convention. The unique index below is
-- the backstop.
--
-- Idempotent per this repo's migration convention (see docs/migrations.md): these files
-- are hand-authored, forward-only, and applied in numeric order by server/migrate.ts at
-- startup, so every statement must tolerate a re-run.

ALTER TABLE vt_event_outbox ADD COLUMN IF NOT EXISTS clinic_seq BIGINT;

-- Per-clinic counter. Row-level locking on UPDATE serialises inserts within one clinic
-- while leaving different clinics uncontended.
CREATE TABLE IF NOT EXISTS vt_event_outbox_seq (
  clinic_id TEXT PRIMARY KEY REFERENCES vt_clinics(id) ON DELETE CASCADE,
  next_seq  BIGINT NOT NULL DEFAULT 0
);

-- Backfill existing rows ordered by the global id within each clinic, so the sequence a
-- client derives from history matches the order it already observed.
UPDATE vt_event_outbox e
SET clinic_seq = s.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY clinic_id ORDER BY id) AS rn
  FROM vt_event_outbox
) s
WHERE e.id = s.id
  AND e.clinic_seq IS NULL;

-- Seed each counter from what the backfill produced, so the first new event continues the
-- sequence instead of colliding with it. GREATEST keeps a re-run from moving it backwards.
INSERT INTO vt_event_outbox_seq (clinic_id, next_seq)
SELECT clinic_id, MAX(clinic_seq)
FROM vt_event_outbox
WHERE clinic_seq IS NOT NULL
GROUP BY clinic_id
ON CONFLICT (clinic_id) DO UPDATE
  SET next_seq = GREATEST(vt_event_outbox_seq.next_seq, EXCLUDED.next_seq);

CREATE OR REPLACE FUNCTION vt_event_outbox_assign_clinic_seq() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- An explicit value wins (backfill, restore, or a test fixture asserting a sequence) —
  -- but it must also PUSH THE COUNTER FORWARD. Returning early without doing so let an
  -- explicit clinic_seq exceed next_seq, so the following automatic insert got a LOWER
  -- sequence; the client then read it as `cseq <= lastAppliedClinicSeq` and dropped it as a
  -- duplicate. A silently discarded domain event is the worst failure this table can have.
  IF NEW.clinic_seq IS NOT NULL THEN
    INSERT INTO vt_event_outbox_seq AS s (clinic_id, next_seq)
    VALUES (NEW.clinic_id, NEW.clinic_seq)
    ON CONFLICT (clinic_id) DO UPDATE
      SET next_seq = GREATEST(s.next_seq, EXCLUDED.next_seq);
    RETURN NEW;
  END IF;

  INSERT INTO vt_event_outbox_seq AS s (clinic_id, next_seq)
  VALUES (NEW.clinic_id, 1)
  ON CONFLICT (clinic_id) DO UPDATE SET next_seq = s.next_seq + 1
  RETURNING s.next_seq INTO NEW.clinic_seq;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vt_event_outbox_clinic_seq ON vt_event_outbox;
CREATE TRIGGER trg_vt_event_outbox_clinic_seq
  BEFORE INSERT ON vt_event_outbox
  FOR EACH ROW EXECUTE FUNCTION vt_event_outbox_assign_clinic_seq();

-- The backstop: two rows can never share a sequence within one clinic, whatever path
-- inserted them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vt_event_outbox_clinic_seq
  ON vt_event_outbox (clinic_id, clinic_seq);
