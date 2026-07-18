# RFID Controller — vendor-agnostic core (fork-agent build plan)

**Status:** ready to build **after R-M1 completes** · parallel with R-BDF-1 · isolated worktree
**Deciders:** Dan (founder) · **Refs:** ADR-004/005/006 (`docs/architecture/adr/`), [[release-build-program]]
**Refined:** remote review pass 2026-07-17 — all contract facts re-verified against the repo; corrections folded in.

## Context

ADR-005 established that no UHF reader computes VetTrack's HMAC signature out of the box — the "middleware" is **our** code that signs and POSTs to the ingest. ADR-006 placed the per-vendor adapter reader-side and made the server ingest the vendor-neutral contract. This package is the **vendor-agnostic core** of that middleware.

Why build it (owner decision #1, 2026-07-17: software ships pre-resubmit; hardware pilot is a separate track):
- De-risks the hardest correctness (HMAC, envelope, aggregation, rate-limit compliance, error handling) **before any reader is bought**.
- Makes the R-M1 e2e loop **real** — this package *produces* the signed batches M1.5 currently hand-signs.
- Reduces the eventual hardware pilot to "write one thin vendor adapter + deploy."

## The contract this package targets (verified against the live ingest)

- **Endpoint:** `POST /api/rfid/events`, **raw JSON body** — `express.raw({ type: () => true, limit: "512kb" })` at `server/index.ts:256,260`; non-Buffer body → 400 (`rfid.ts:51`).
- **Headers (canonical two-`t`):** `X-VetTrack-Clinic` + `X-VetTrack-Signature: sha256=<hmacHex>` — but the server currently *reads* the one-`t` spelling; see the prerequisite bug.
- **Signature:** `HMAC-SHA256(rawBodyBytes, perClinicSecret)`, lowercase hex, `sha256=` prefix, timing-safe. Oracles to reuse: `server/integrations/webhooks/verify-signature.ts`, `scripts/rfid/sign-batch.ts`.
- **Secret:** per-clinic `webhook_secret` (`getCredentials(clinicId,"rfid")`), provisioned by R-M1's M1.1c endpoint (returned once, never logged).
- **Body:** `{ batchId(1–64), controllerVersion?(≤32), events:[{ tagEpc(1–128), gatewayCode(1–64), readAt }](1–200) }` — `RfidBatchSchema` in `server/routes/rfid.ts:18`. **`readAt` is strict `z.string().datetime()` (RFC-3339 / `Z` UTC) → emit `.toISOString()`, never `Date.toString()`, or 400 `INVALID_SCHEMA`.** The schema is **non-`.strict()`** → unknown fields are **silently stripped** (this is why a wrong directional Module 3 would falsely pass — see Module 3).
- **Directional fields** (`direction`/`fromGateway`/`toGateway`) **do NOT exist on main today** — R-M1's M1.2 adds them. Build Module 3 against the *actual* post-R-M1 schema.
- **Limits:** ≤200 events/batch (`.max(200)`); 120 req/min/clinic (`rfidEventLimiter`, `rate-limiters.ts:83`). Aggregate to **movement events, never raw reads**.
- **The server already owns most logic** (`server/lib/rfid-ingest.ts`): `coalesceLatestPerTag`, stale rejection (`readAt <= lastRfidSeenAt`), room-change/direction derivation, idempotency. **The controller is NOT the authority on room-change — the server re-derives it.** The controller's only ingest-facing obligations: don't send raw reads, stay under the limits, emit valid ISO timestamps, sign the exact bytes.
- **Responses:** 202 `{ok:true, ...RfidIngestResult}`; 400 `MISSING_CLINIC`/`INVALID_BODY`/`INVALID_SCHEMA`; 401 `RFID_NOT_CONFIGURED`/`INVALID_SIGNATURE`; 403 `RFID_INGEST_DISABLED`.

## ⚠ Prerequisite server bug (fix first — companion change; confirmed in 2 files + masked by a test)

- Route reads **one-`t`** `x-vetrack-clinic`/`x-vetrack-signature` (`rfid.ts:38,63`); limiter reads **one-`t`** (`rate-limiters.ts:90`) → its per-clinic key segment is always empty → **the limiter silently degrades to per-IP** (all clinics behind one IP share the 120/min bucket).
- Signer/brand/error text use **two-`t`** `X-VetTrack-*` → Node lowercases to `x-vettrack-*` ≠ `x-vetrack-*` → a spec-following client gets **400 MISSING_CLINIC**; the shipped `sign-batch.ts` curl is broken end-to-end.
- `tests/rfid-webhook-signature.test.ts:122-123` uses the one-`t` spelling → green while entrenching the bug.
- **Fix:** route + limiter → canonical two-`t` `x-vettrack-*`; update that test; controller emits two-`t`; controller e2e locks the spelling. **Do NOT** ship the controller emitting one-`t` to "work today" — that propagates the bug onto a new vendor-facing surface.

## Package (match `packages/contracts` house style + 3 necessary divergences)

`packages/rfid-controller/` → `@vettrack/rfid-controller`. Match contracts: `private:true`, `type:module`, `exports["."]` → **source** `./src/index.ts` (no dist/build), a `typecheck` script, `"@vettrack/rfid-controller":"workspace:*"` in root `package.json`, a `rfid-controller:typecheck` root script, copy the tsconfig (ES2020/ESNext/bundler/strict/isolatedModules/noEmit). Divergences:
- **Tests aren't auto-covered.** Root vitest `include` (`vite.config.ts:138`) is `tests/**`+`src/**`, NOT `packages/**`, and contracts sets no test precedent. Add a **package-local vitest config** + a root `test:rfid-controller` script (keep it out of the excluded-groups matrix) + CI wiring.
- **Bin via tsx shebang** (`#!/usr/bin/env tsx`, mirror `scripts/rfid/sign-batch.ts:1`) since exports are source `.ts` (no dist). Declare the `bin` explicitly.
- **No runtime deps** — HTTP via global `fetch` (Node 18+, `.nvmrc`); devDep vitest only.

## Modules (TDD, RED→GREEN each)

**Module 0 — shared contract (NEW, build FIRST, highest leverage).** The batch schema + header-name constants + `sha256=<hex>` format are triplicated (route inline schema, `RfidBatchInput` in ingest, `sign-batch.ts`) — the header bug is proof this drift already happened. Extract a canonical `RfidBatchSchema` + `RFID_HEADERS` constants + signature helper into a shared source. **Preferred:** `packages/contracts` (the frontend already consumes `@vettrack/contracts` source-`.ts`). **Caveat:** server-side source-`.ts` resolution is unverified (`tsconfig.server.json` may lack `moduleResolution: bundler`) — **confirm the server can import the shared schema before making the *route* depend on it.** If it can't: keep the canonical schema in the controller and add a **contract-parity test** that imports the route's `RfidBatchSchema` and asserts equivalence, so drift fails CI.

1. **`ReaderAdapter` seam** — `reads(): AsyncIterable<{tagEpc,gatewayCode,readAt}>`. Ship `SyntheticAdapter` + `File`/`StdinAdapter` ONLY. Real `Zebra`/`Impinj` adapters DEFERRED (hardware track).
2. **Debounce/dedup (right-sized)** — collapse repeat reads so the controller never sends raw reads; NOT the room-change authority (the server coalesces). RED: a burst → 1 logical presence.
3. **Direction inference (CONDITIONAL on M1.2)** — meaningful only once R-M1's M1.2 adds `direction`/`fromGateway`/`toGateway` to `RfidBatchSchema`. Build against the **actual post-R-M1 schema**; if M1.2 didn't land the fields (or shaped them differently), descope/adjust — the non-`.strict()` schema silently strips unknown fields, so a mismatched Module 3 sends data that never arrives and **e2e would falsely pass**. Keep only **time/sequence-based** ambiguity here; antenna-geometry loiter/tailgate is hardware-track.
4. **Movement aggregation** — one movement event per crossing; ≤200/batch, ≤120/min (windowed flush / token bucket). RED: 1000 reads of a crossing ⇒ ≤1 event; a flood is coalesced (logged), never silently dropped.
5. **Envelope builder** — `{batchId, controllerVersion, events[]}`; **`readAt` via `.toISOString()`**; deterministic `batchId` (server idempotent dedup); body ≤512kb. RED: validates against Module 0's canonical schema.
6. **Signer** — `createHmac("sha256",secret).update(rawBodyBytes).digest("hex")` + `sha256=`. **Serialize once, sign THAT buffer, POST THAT SAME buffer** — any re-serialization between sign and send breaks the HMAC. RED: byte-for-byte verifies against the real `verifyVetTrackWebhookSignature`.
7. **Secret source + hot-swap (REFRAMED).** The server has **no** current-or-previous grace verifier today (`getCredentials` reads one blob; verify checks one secret). Ship "secret source + hot-swap on rotation" only. The current-or-previous grace behavior + its e2e assertion are valid **only if** R-M1's M1.1c actually lands a server-side grace verifier — verify against the post-R-M1 server; if absent, drop the grace assertion (or file it as a separate server feature).
8. **HTTP sender + error classifier** — POST raw body + headers. Classify: **4xx validation (`MISSING_CLINIC`/`INVALID_BODY`/`INVALID_SCHEMA`/`INVALID_SIGNATURE`/`RFID_NOT_CONFIGURED`) → DROP + surface, never retry** (retrying a bad signature forever is a footgun); **403 `RFID_INGEST_DISABLED` → stop/surface**; **429 → rate-limit backoff**; **5xx/network → bounded FIFO buffer (cap + oldest-drop w/ logged counter), flush in order**. Idempotent `batchId` dedupes retries server-side. RED: one test per branch.
9. **Config** — `apiOrigin`, `clinicId`, secret source, aggregation windows, caps, buffer cap — all parameterized (site-survey values are config, not code).
10. **CLI (`bin`)** — tsx-shebang entry; `--adapter synthetic|file|stdin`, `--config <file>`; **no secret on argv** (env/file only).

## Deferred (hardware track — explicitly OUT of the core)

Real vendor adapters (Zebra FX Embedded SDK / Impinj CAP), embedded packaging (`.deb`/CAP), on-reader deployment, field-calibrated windows, and anything needing **antenna geometry / RSSI / clock-drift / reader-health** — keep these out of the vendor-agnostic core (ADR-004/006).

## Advisory-only (ADR-006)

The controller emits movement **evidence** only — never custody/authority. The server resolver owns precedence (human room > RFID). Ambiguity is flagged/dropped, never guessed. The controller has no custody concept.

## Coordination & sequencing

- **Build after R-M1 completes** — Modules 3 & 7 target contracts (directional schema, rotation-grace) that R-M1's M1.2/M1.1c are adding **now**. Build against the **actual post-R-M1 server**, not this plan's assumptions, and adjust 3 & 7 to what actually landed.
- **Isolated worktree/branch** — the controller is a NEW package (won't touch R-BDF-1's board files) but a separate worktree avoids commit interleaving with the parallel R-BDF-1 work.
- **Land the header-bug fix first** so the e2e can authenticate.

## Verification

- **Unit (zero-dep tier):** Modules 0–9 RED→GREEN (vitest); the signer verified against the *real* `verifyVetTrackWebhookSignature`; the envelope validated against Module 0's canonical schema (+ the contract-parity test if the route can't share it).
- **e2e (DB-integration-class — NOT zero-dep):** needs `DATABASE_URL` + migrations. Seed: `rfid.ingest_enabled.<clinic>`=`"true"` (else 403), a per-clinic `webhook_secret` (else 401), and `equipment.rfidTagEpc` + `rooms.gatewayCode` (else every event is unknownTag/unknownGateway — **still 202, so "assert 202" is a weak oracle**). Run the controller (SyntheticAdapter) against the real mounted ingest and **assert on `RfidIngestResult` counts** (accepted / room-changes), plus rate-limit compliance, the Module-8 classifier branches, and — only if M1.1c landed grace — rotation-grace. Belongs with the **excluded DB suites**, not `pnpm test`.
- **Gates:** `pnpm --filter @vettrack/rfid-controller typecheck` + package tests green · no `console.log` (use a logger) · no secret in any log line.
