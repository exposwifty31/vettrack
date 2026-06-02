# PR5 — RFID gap analysis (evidence contracts)

**Status:** Analysis only — no new tables in this PR.

## Existing schema

| Table / column | Location | Role |
|----------------|----------|------|
| `vt_equipment.rfid_tag_epc` | `server/schema/equipment.ts` | Tag binding per clinic |
| `vt_equipment_rfid_reads` | `server/schema/equipment.ts` | Passive read events |

## Ingest path

- Raw body mount: `server/index.ts` → `/api/rfid` with `express.raw`
- Handler: `server/routes/rfid.ts` → `ingestRfidBatch` (`server/lib/rfid-ingest.ts`)
- HMAC: `verifyVetTrackWebhookSignature` + clinic header `X-VetTrack-Clinic`

## Truth / board consumption

- Evidence graph loads `recentRfidReads` (`server/domain/equipment/evidence/graph.loader.ts`)
- Location resolver uses latest RFID as **passive** evidence (`resolver/location.ts`) — does not mutate custody
- Command board types include optional `rfid` block on unit rows (`shared/equipment-board.ts`)

## Gaps (before PR6–7 implementation)

1. **Idempotency contract** for batch replay — document `batchId` + event dedupe in ingest (verify in `rfid-ingest.ts`).
2. **Outbox allowlist** — only passive event types (see master plan Part L.3).
3. **No custody mutation** — ingest must not set `checkedOut*` or custody transitions (verified: ingest updates `lastSeen` / room observation only).

## Approval gate

New tables or columns require explicit sign-off before migration (PR5 rule).
