# ADR-005: RFID HMAC-Signing Middleware Placement

| Field | Value |
|-------|--------|
| **Date** | 2026-07-17 |
| **Status** | proposed |
| **Tags** | `#integrations` |
| **Deciders** | Dan (founder) |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

The single most consequential finding of the RFID research (`VetTrack-RFID-מחקר-פריסה.md` §4) is a software-boundary fact: **no UHF reader on the market can compute VetTrack's `X-VetTrack-Signature` (HMAC-SHA256 over the raw body) and send our exact envelope out of the box.** Every reader's built-in webhook engine tops out at NONE/Basic/TLS auth — none does custom HMAC. Therefore the signing *must* run in our own code. The question is **where that code physically runs**: on the reader itself, or on a separate central box.

Constraints: pilot scale is ≤3–5 readers, single vendor (ADR-004); the ingest enforces 200 events/batch and 120 events/min/clinic; the frozen architecture forbids any new realtime channel and forbids the reader talking to a client — the reader only ever POSTs to the server ingest.

## Decision

1. **Pilot: run the HMAC-signing as an embedded application on the reader** (Zebra FX Series Embedded SDK, or Impinj Customer Application Partition). The reader reads tags via its internal API, applies the direction/debounce logic, builds our batch envelope, computes the HMAC with the per-clinic secret, and POSTs over HTTPS. No separate middleware box for the pilot.
2. **Mandatory aggregation:** the embedded app emits **one movement event per crossing** (entered/exited), never raw per-read events. This is what keeps a busy gate under the 120/min·200/batch limit. Sending raw reads would break the limiter immediately.
3. **Move to a central middleware** (which may be the dev-bench Raspberry Pi promoted to a small server) **only when** any of these trigger conditions is met: **more than 3–5 readers**, **more than one vendor** in play, or **a need for central buffering/retry or key-rotation** across readers. At that point the central box hosts the unified reader-adapter layer (see ADR-006).

## Options Considered

### Option A — Embedded app on the reader (chosen for pilot)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Med — vendor embedded SDK, but single artifact |
| Failure points | Fewest — no extra box, no extra network hop |
| Key rotation | Per-reader (fine at ≤3–5 readers) |
| Time-to-prove | Fastest |

**Pros:** looks like "reader sends directly" from outside but is genuinely our middleware; no separate hardware; fewest moving parts for a proof-of-concept.
**Cons:** HMAC secret + rotation must be managed on each reader; embedded-SDK learning curve.

### Option B — Central middleware box (chosen for scale, not pilot)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Higher — extra service to run/monitor |
| Failure points | More — extra box + hop |
| Key rotation | Centralized (better at many readers) |
| Multi-vendor | Natural home for the reader-adapter layer |

**Pros:** one place for keys, buffering, retry, monitoring; the right home for multi-vendor normalization.
**Cons:** more infrastructure and failure surface than a single-gate pilot needs.

### Option C — Reader's native webhook (rejected)
No built-in HMAC (NONE/Basic/TLS only). Cannot produce `X-VetTrack-Signature`. **Rejected — cannot satisfy the ingest contract.**

## Consequences

- **Positive:** the pilot has the fewest failure points and the fastest path to a working signed loop; aggregation keeps us safely inside the existing rate limits at any scale; the trigger conditions make the "when to add a central box" decision explicit rather than ad hoc.
- **Negative / harder:** managing the per-clinic HMAC secret and its rotation on the reader itself is more manual at pilot scale; this is deliberately accepted as cheaper than standing up a central service for one gate.
- **Revisit later:** the first time a second vendor or a 4th+ reader appears, promote signing to the central middleware and fold in ADR-006's adapter layer.

## Compliance

- [ ] Embedded app verified to emit aggregated movement events (not raw reads) — measured against the 120/min·200/batch ceiling before pilot go-live.
- [ ] HMAC secret sourced per-clinic; rotation procedure documented for the reader-hosted case.
- [ ] No VetTrack server change from this ADR (the ingest already accepts the signed envelope).
- [ ] `npx tsc --noEmit` — n/a (no server/client code)
