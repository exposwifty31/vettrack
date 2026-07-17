# ADR-004: RFID Reader Selection & Israeli Regulatory Band

| Field | Value |
|-------|--------|
| **Date** | 2026-07-17 |
| **Status** | proposed |
| **Tags** | `#integrations` |
| **Deciders** | Dan (founder) |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

VetTrack already ships the *software* side of a UHF Gen2 (EPC C1G2 / ISO 18000-63) RFID pipeline: a custom HMAC-signed ingest at `POST /api/rfid/events` (`X-VetTrack-Clinic` + `X-VetTrack-Signature`, envelope `{batchId, controllerVersion, events:[{tagEpc, gatewayCode, readAt}]}`, capped at 200 events/batch and 120 events/min/clinic). Migration 172 (`vt_rfid_readers`) formalizes the reader as a first-class entity. This ADR decides **which physical readers a departmental pilot buys, and — critically — on which frequency band they must transmit in Israel.**

The driving research is `docs/architecture/VetTrack-RFID-מחקר-פריסה.md`. It recommends Zebra FX9600 / Impinj R700v2, but it **contradicts itself on the band**: §1 (TL;DR) and §11 (the CTO budget line item) say "ETSI", while §14 correctly documents that Israel's Ministry of Communications licenses civilian UHF RFID at **915–917 MHz** (up to 2 W since 2012) — a band that is *neither* ETSI (865–868 MHz) *nor* FCC (902–928 MHz). An ETSI-band SKU would be the wrong hardware and could not legally transmit in Israel. This ADR resolves that contradiction in favor of §14.

Hard constraints: single Israeli veterinary hospital scale (5–15 gates pilot, 20–40 full); clinical environment (wash-down, metal, fluids); the reader must be able to run our embedded HMAC-signing code (see ADR-005); regulatory import via a local type-approval holder.

## Decision

1. **Build the software, buy enterprise hardware.** VetTrack owns the ingest, resolver, and board software; the pilot runs on proven enterprise readers — **not** unbranded hardware, and **not** a managed RTLS platform.
2. **Pilot reader:** **Zebra FX9600 (4-port)** as the primary, with **Impinj R700v2** as an equal-or-superior alternative if the team prefers modern Linux/REST. The decisive selection criterion is "can run our embedded signing app," which both satisfy.
3. **Band (binding):** all readers ordered and configured for the Israeli **915–917 MHz** band. **Explicitly NOT ETSI (865–868) and NOT FCC (902–928)** — this overrides the research's §1/§11 "ETSI" label.
4. **Procurement path:** purchase through a **licensed Israeli reseller** that holds (or can obtain) Ministry of Communications type-approval, giving correct band configuration, import paperwork, and local warranty. Do not self-import as the responsible importer.
5. Buy **on-metal medical tags** (e.g. Xerafy) for ICU/surgery/high-metal zones.

## Options Considered

| Option | Complexity | Cost/unit | Runs our HMAC app? | Clinical fit | Verdict |
|--------|-----------|-----------|--------------------|--------------|---------|
| **Zebra FX9600** | Med (embedded SDK) | ~$1,213–1,274 | Yes (FX Embedded SDK) | IP53, PoE+, doorway portal | **Chosen (primary)** |
| **Impinj R700v2** | Med (CAP/Octane) | ~$1,195–1,399 | Yes (Customer App Partition) | Best sensitivity; buy v2 (v1 EOL 2026) | **Chosen (alt)** |
| ThingMagic Sargas/IZAR | Med | ~$1,084–1,689 | Yes (Mercury API) | Medical-focused; good for cabinets | Consider for shelf/pharmacy zones only |
| Chainway UR4/URA4 | Low | ~$500–700 (quote-only) | Yes (Android) | Weak support, unproven clinically | Expansion phase only, low-priority zones |
| Raspberry Pi / ESP32 + module | Low | $30–500 | Yes (full Linux) | No IP rating, no warranty | **Dev bench only — rejected for clinical use** |
| Managed RTLS platform | High | Very high | N/A | Built for large human hospitals | **Rejected — scale/cost mismatch** |

## Consequences

- **Positive:** correct band avoids illegal transmission and regulatory rejection; the Israeli-reseller path bundles type-approval + correct 915–917 MHz config + local warranty + a support contact; enterprise hardware carries the reliability/warranty a clinical (even advisory) surface needs; the server ingest stays vendor-neutral, so a future vendor swap is an embedded-app change, not a schema change.
- **Negative / harder:** longer procurement lead time via a reseller vs. direct US import; slightly higher unit cost than unbranded; embedded-app development requires vendor-SDK familiarity (addressed in ADR-005).
- **Revisit later:** at full-hospital scale (20–40 gates) re-price Impinj vs Zebra with the reseller; consider Chainway for low-priority zones only after the pilot proves the loop.

## Compliance

- [ ] **Verify the 915–917 MHz SKU/config with the Israeli reseller in writing before any PO** (do not order an "ETSI" or "FCC" variant).
- [ ] Correct the band statement in `VetTrack-RFID-מחקר-פריסה.md` §1 and §11 (ETSI → 915–917 MHz) so the manager-facing doc is internally consistent.
- [ ] No code change from this ADR (procurement + config decision); the ingest schema remains the vendor-neutral contract (see ADR-006).
- [ ] `npx tsc --noEmit` — n/a (no code)
