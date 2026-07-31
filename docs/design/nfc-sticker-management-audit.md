# NFC Sticker MANAGEMENT — E2E audit (Phase 3.5, lifecycle half)

> Audited 2026-07-30. Companion to `nfc-sticker-e2e-audit.md`, which covers the **fielding**
> chain (a sticker that exists resolves to the app). This document audits the **lifecycle**:
> can VetTrack itself encode → bind → verify → lock → replace a sticker, with no third-party
> encoder app, and does what it writes match the payload spec.
>
> Trigger: the claim "most of in-app sticker management already exists in code" needed
> evidence rather than assertion.

## Verdict

**Partly true when audited, true now.** The write path, admin gate, read path and the
`vt_equipment.nfc_tag_id` column all existed. Three things did not, and all three were
load-bearing: the payload was half the spec, the tag UID was thrown away, and there was no
lock path at all. All three are closed in this wave. What remains is device verification,
which needs hardware this session did not have.

## Scope decisions

- Owner decisions (2026-07-30): audit **and** close the gaps; hardware available is a
  **physical iPhone only** — no Android device, no NTAG215 stickers confirmed in hand.
- That constraint is why the iOS lock was mandatory rather than optional: before this wave
  the plugin implemented locking on Android only, so an iPhone-only operator had no path at all.

## What existed before this wave (verified first-hand)

| Capability | Location |
|---|---|
| NDEF write from the app | `src/pages/equipment-detail.tsx` → `nfc-platform.ts` |
| Admin gate + unsupported-device guard | `equipment-detail.tsx` (`showWriteNfc`) |
| Read (one-shot + continuous session) | `nfc-platform.ts` |
| Tag-UID decoder (unused on write) | `tagIdHexFromCapgoId`, `nfc-capgo-decode.ts:22` |
| Per-item tag column | `server/schema/equipment.ts:136`, `migrations/018_asset_radar_nfc.sql:33` |
| Persist endpoint accepting `nfcTagId` | `PATCH /api/equipment/:id` → `handlers/patch-equipment.ts` |

## Audit matrix

| # | Row | Result | Evidence |
|---|---|---|---|
| M1 | Write action is admin-only and hidden without NFC | **PASS** | guard test over `equipment-detail.tsx` |
| M2 | Sticker URL === the QR universal link | **PASS** | unit: host/path/origin parity with `generateQrUrl` |
| M3 | Payload = URI record + AAR record, byte-exact | **WAS FAIL → PASS** | wrote one record; now two, asserted byte-exact |
| M4 | Tag UID captured and bound to the equipment row | **WAS FAIL → PASS** | UID was discarded; `writeEquipmentStickerTag` now returns it and the call site binds it |
| M5 | Duplicate tag → clean conflict, no tenant disclosure | **WAS FAIL → PASS** | unique violation fell through to 500; now 409 `NFC_TAG_ALREADY_BOUND` |
| M6 | Replace/retire: a new sticker rebinds cleanly | **PASS** | rebind is the same bind call; locked tags are replaced, not rewritten |
| M7 | Bind lands in the audit log | **PASS** | existing `equipment_updated` row carries `changes.nfcTagId` — no new union member needed |
| M8 | Written sticker reads back to the same equipment | **PASS** (unit) | round-trip through the scanner's own decoder; device leg is M10 |
| M9 | Lock available from the app | **WAS IMPOSSIBLE → COMPILES, LOCK UNVERIFIED** | `NfcLockPlugin.swift` builds clean in Xcode (2026-07-30); the lock itself needs a real tag |
| M10 | iPhone pass: write → read back → background scan | **DEFERRED — blocked only on a tag** | Mac + iPhone now in hand; no NTAG215 |
| M11 | ADR-006 posture intact — tag is never custody authority | **PASS** | payload module is pure encoding; the write handler performs no custody mutation |

`tests/nfc-sticker-management.test.ts` (18) and `tests/ios-nfc-lock-plugin-wired.test.ts` (7)
carry M1–M8 and M11 plus the iOS wiring guard.

## Findings

### F1 — The payload was half the spec (fixed)
`writeNfcUrl` wrote a single URI record. The spec requires record 2, the AAR
(`android.com:pkg` → `uk.vettrack.app`), which is what sends a tap on a phone *without*
the app to the Play listing instead of a browser. A sticker encoded before this fix would
have been silently non-compliant in exactly the case the AAR exists for. The package name
now has one source of truth, `ANDROID_APP_PACKAGE` in `shared/constants.ts`, shared with
`assetlinks.json`.

### F2 — The tag UID was discarded (fixed)
The write path never read `event.tag.id`, so `nfc_tag_id` stayed null across the fleet.
Without it, no ongoing management is possible at all — you cannot verify a sticker, find
its item, replace it, or audit it. Binding now uses the existing PATCH endpoint; no new
route, type, or migration was needed.

### F3 — Duplicate bind returned 500 (fixed)
The unique index made a duplicate UID throw, and the handler's catch-all turned an expected
user-facing conflict into `INTERNAL_ERROR`. Now 409 `NFC_TAG_ALREADY_BOUND`.

### F4 — `nfc_tag_id` is globally unique, not clinic-scoped (accepted, documented)
`migrations/018_asset_radar_nfc.sql:33` adds `UNIQUE (nfc_tag_id)` with no `clinicId`, so a
tag bound in clinic A blocks clinic B and a naive error message would disclose cross-tenant
existence. **Not changed**: NTAG UIDs are globally unique in practice, so real collisions
are the pathological case, and rewriting a UNIQUE constraint on a live clinical table is out
of proportion to the risk. Mitigated instead by making the 409 message name nothing about
the owning row. Revisit if a tag is ever deliberately moved between clinics.

### F5 — The iOS NFC entitlement was missing `NDEF` (fixed)
`App.entitlements` declared only `TAG`, but the plugin's default path opens
`NFCNDEFReaderSession`, which Apple gates on the `NDEF` format. In-app NFC read **and**
write on iOS were therefore likely non-functional — and no device evidence exists either
way. `NDEF` added alongside `TAG`. **This is the single highest-value thing to check first
on the device session**: if in-app scanning silently never worked on iPhone, that changes
what "already exists in code" meant.

### F6 — `DynamicTypePlugin.swift` is dead Swift (reported, not fixed)
`ios/App/App/DynamicTypePlugin.swift` has **zero references in `project.pbxproj`** — it was
never added to Compile Sources, exactly as its own header comment warned, so its JS bridge
resolves null and the app silently uses the in-app text-size setting. Left alone
deliberately: wiring it would switch on OS-driven Dynamic Type scaling, a behavior change
outside this audit. `tests/ios-nfc-lock-plugin-wired.test.ts` exists so the NFC plugin
cannot repeat it.

### F7 — Web NFC writes are unverified
The Chrome-Android path writes the AAR as an external record type. That branch has not been
exercised — no Android hardware. It fails loudly rather than writing a partial sticker.

## Governance

- **ADR:** not required. Checked `docs/architecture/adr/TRIGGERS.md` row by row — no domain
  boundary, queue, outbox type, `PendingSyncType`, tenancy resolution, repository convention,
  integration vendor, pilot-mode route, or `shared/` contract break is involved.
- **Security Master (tenancy veto):** F4 above; no query lost its `clinicId` filter — the
  bind reuses the existing tenant-scoped PATCH transaction.
- **Clinical Safety Officer:** not an emergency path. ADR-006 posture checked as M11 — the
  sticker remains identification only; docked ≠ returned and the server state machine stay
  canonical.
- **Frozen surfaces:** untouched. No realtime, Code Blue, PWA cache, or `appointmentsPage.*`
  change; `scripts/build-native-shell.sh` not modified.

## Device session — status 2026-07-30

Closed with a Mac and iPhone in hand:

- **Row 7 (both `/.well-known/` endpoints)** — live and correct, headers included. See the fielding
  spec's status note.
- **Swift compiles.** `NfcLockPlugin.swift` builds clean for `Any iOS Device (arm64)`. It was
  written without a compiler in a Linux container, so this was a genuine unknown.
- One self-inflicted failure on the way: the plugin's first pbxproj wiring reused an object id
  already held by VetTrackControl's `Info.plist`, which surfaced as
  "Multiple commands produce App.app/Info.plist" before any Swift compiled. Fixed, and now guarded
  by a duplicate-id check in `tests/ios-nfc-lock-plugin-wired.test.ts`.

Still open, in order:

1. **F5 first** — does the in-app NFC sheet open on the iPhone now that `NDEF` is in the entitlement?
   Answerable without a tag: the session either starts or it does not.
2. Code signing on device — the only thing that can prove the App ID carries the NFC and
   Associated Domains capabilities.
3. Universal Link from a pasted `https://vettrack.uk/equipment/<id>?nfcAction=toggle` — no sticker
   needed; a sticker is only a carrier for that URL.
4. **Blocked on one missing item, an NTAG215 tag** — M9 (real lock + refused re-write), M10
   (write → read back → `nfc_tag_id` populated), and background scan. NTAG215 is the only
   *hardware* blocker; F5 and code signing above are separate, still-open release gates.
5. Android rows and the Web NFC branch stay deferred to the tester fleet.

Screenshots per the house format (Screenshot → Expected → Actual → Pass/Fail) into
`docs/audit/PROOF_ALIGNMENT_LOG.md`.
