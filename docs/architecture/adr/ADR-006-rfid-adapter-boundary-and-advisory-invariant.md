# ADR-006: RFID Reader-Side Adapter Boundary & Advisory-Only Invariant

| Field | Value |
|-------|--------|
| **Date** | 2026-07-17 |
| **Status** | proposed |
| **Tags** | `#integrations` `#clinical-safety` |
| **Deciders** | Dan (founder) |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

Two forces converge here.

**(1) Anti-lock-in.** The research (`VetTrack-RFID-מחקר-פריסה.md` §3) recommends an `IReaderAdapter` abstraction (`ZebraAdapter`, `ImpinjAdapter`, `ThingMagicAdapter`) so a vendor swap doesn't rewrite the system. The Impinj R700**v1** end-of-life in 2026 is live proof that vendor churn is real. The open question is **where the abstraction line sits** — in the VetTrack server, or reader-side.

**(2) Clinical safety.** The current resolver has a bug (M1.0 in the RFID work plan): RFID can **override** a human-confirmed room. The research's failure-mode #8 names exactly this — "treating advisory data as authoritative" — and calls VetTrack's never-override design a genuine architectural strength worth preserving.

Reading §3 and §4 together resolves (1): both the per-vendor translation *and* the HMAC signing happen **before** an event reaches us — in the embedded app or central middleware (ADR-005). The VetTrack server ingest (`POST /api/rfid/events`) already accepts a *normalized* `{tagEpc, gatewayCode, readAt}` event and does not care what produced it. So the server is already vendor-neutral; the adapter is not a server concern.

## Decision

1. **The per-vendor adapter is reader-side code.** Each vendor's adapter (translating LLRP / vendor-JSON → VetTrack's normalized event) lives in the embedded app or central middleware, not in the server. **Do not build server-side vendor adapters.**
2. **The server ingest schema is the vendor-neutral contract.** `{batchId, controllerVersion, events:[{tagEpc, gatewayCode, readAt}]}` + HMAC is the single boundary every vendor normalizes to. Keep it stable and documented as the contract.
3. **Concrete per-vendor adapters are hardware-track artifacts, deferred.** A `ZebraAdapter` cannot be written or tested without a Zebra reader, so it belongs to the post-resubmit hardware pilot — not the pre-resubmit software. No speculative multi-vendor code now (YAGNI).
4. **Advisory-only invariant (binding, pre-resubmit software):** RFID is supporting evidence only. It **never** overrides a human-confirmed room. Canonical precedence: active checkout/scan > human `roomId` > RFID last-seen > free-text > unknown. Low-confidence or conflicting reads raise `rfid_location_conflict` / `ambiguous_rfid_location` for a human to resolve — the system never guesses. **Fix M1.0 (the override bug) as the pre-resubmit software change, with a test asserting RFID cannot override a human room.**

## Options Considered

### Option A — Reader-side adapter + vendor-neutral server ingest (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low server-side (already neutral) |
| Lock-in protection | Strong (swap = embedded-app change) |
| Testability | Adapter needs hardware → correctly deferred |

**Pros:** server stays clean and vendor-agnostic; matches where HMAC already runs; adapter work lands exactly when hardware exists.
**Cons:** none material — this reflects the existing boundary.

### Option B — Server-side `IReaderAdapter` layer built now
**Pros:** all vendor logic in one familiar codebase.
**Cons:** speculative (no hardware, one vendor); pushes raw-protocol handling into the server; duplicates the neutral boundary that already exists. **Rejected — YAGNI + wrong layer.**

### Option C — Raw LLRP straight to the server
**Pros:** thinnest reader.
**Cons:** server must speak every vendor's raw protocol and compute HMAC for them; breaks the neutral contract. **Rejected.**

## Consequences

- **Positive:** the server remains vendor-agnostic and the abstraction line already exists at the ingest; adapter effort is deferred to when it's testable; the advisory-only invariant — the product's core safety thesis and a real differentiator — is locked and enforced by a test.
- **Negative / harder:** each new vendor requires new reader-side adapter code (accepted — it's the cheapest place for it, and it can't be avoided without hardware).
- **Revisit later:** if a central middleware appears (ADR-005 triggers), the shared reader-adapter layer is hosted there; the server contract does not change.

## Compliance

- [ ] **M1.0 fix ships pre-resubmit** with a test asserting RFID never overrides a human-confirmed room, and that low-confidence/conflicting reads raise `rfid_location_conflict` / `ambiguous_rfid_location`.
- [ ] The ingest envelope is documented as the vendor-neutral contract (no per-vendor fields leak into it).
- [ ] `pnpm architecture:gates` (if touching `server/` resolver structure)
- [ ] `npx tsc --noEmit`
- [ ] No server-side vendor adapter is introduced (guard against Option B creeping in).
