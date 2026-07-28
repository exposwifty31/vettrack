# Pilot QA — evidence bundle

Evidence artifacts for the pre-pilot QA harness (`docs/audit/pre-pilot-qa-harness.md`).
Screenshots and device captures are **owner-produced** on the real iPhone (Mode B) and the
dev-bypass simulator (Mode A). This directory holds the artifacts; the pass/fail verdicts and
command output live in `docs/audit/PROOF_ALIGNMENT_LOG.md`.

## Naming

One file per harness row, named by row ID (lower-case), e.g.:

```
J-3.png    # QR scan → correct equipment detail, once
J-4.png    # NFC tap → in-app Take/Return confirm dialog (no silent toggle)
J-5.png    # Take a returned unit off-shift → custody in-use, custodian = vet
J-8.png    # Board shows held/returned + custodianName (never a full email)
U-2.png    # /handoff header/back clear of the Dynamic Island (verify-still-fixed)
U-3.png    # Equipment detail Tools sheet on native — no Print QR button
F-4.png    # First authed /api/* from capacitor://localhost returns 200 (Clerk native JWT)
```

Multi-shot rows may use a suffix: `J-3-a.png`, `J-3-b.png`.

## What each capture must show

- **Mode + device** in the frame or the filename context (real iPhone portrait vs sim).
- The **`vet` account** signed in (not admin) for every Layer-2/3 row.
- For custody rows (J-5/J-6/J-8): the on-screen state **plus** the corroborating
  `GET /api/equipment/:id` custody/custodian value noted in the PROOF entry.

## Not captured here

- Layer-1 automated results → `docs/audit/PROOF_ALIGNMENT_LOG.md` (command output, verbatim).
- Owner-only checks with no CI proxy: F-4 (Clerk native JWT), F-5 (push absence), F-7
  (`needs_client_trust`) — capture a device screenshot each and record the owner verdict in the
  PROOF entry.

## Go / No-Go

The owner records the final GO/NO-GO decision and this bundle's path in the PROOF log per
`pre-pilot-qa-harness.md` §7.
