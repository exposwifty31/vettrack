# Offline fallback: planning NFC work without hardware

Use this guide when `scripts/check-nfc.sh` fails, no reader is attached, or drivers/udev
permissions are unavailable. No emulation is bundled with this skill — the fallback is
planning-only: prepare everything so a human can execute the write once a reader
(PN532 breakout, ACR122U, or another libnfc-compatible adapter) is reconnected.

## 1. Document the missing-hardware state

- Record which reader/device was expected (e.g., `pn532_uart:/dev/ttyACM0`, ACR122U on USB)
  and what failed: tools missing from PATH, no device node, permission denied, or no tag.
- Set expectations for when the physical reader can be reconnected, and note that all
  steps below produce artifacts only — nothing touches a tag.

## 2. Plan the tag contents

- Identify the tag technology and capacity from the user (or prior `nfc-taginfo` dumps):
  NTAG21x / Ultralight, MIFARE Classic 1K/4K, Type 2/4 NDEF, etc.
- Sketch the desired record set: NDEF record types (URI, Text, MIME), payload values,
  and which blocks/sectors they occupy. Confirm the payload fits the usable capacity
  (after lock bytes, capability container, and TLV overhead).
- For MIFARE Classic, list the sectors involved and which key (A/B) grants write access;
  never assume default keys on deployed tags.

## 3. Build and preview the payload artifacts

- Generate the final NDEF/TLV blob with `ndef-tool` (libndef) or an equivalent helper from
  a template, so record size and CRC stay intact — write it to `payload.ndef`,
  `payload.ul`, or `payload.mfd` as appropriate.
- Preview every artifact before handoff: `ndef-tool dump payload.ndef` where available,
  otherwise `xxd payload.ul | head` so the exact bytes are visible in the plan.
- If a pre-write dump of the target tag exists, diff the planned payload against it and
  call out exactly which blocks change.

## 4. Hand off the manual steps

Provide the operator a numbered runbook containing:

1. `scripts/check-nfc.sh` — verify the stack once the reader is attached.
2. `nfc-list` — enumerate readers; pick the connection string and set `LIBNFC_DEVICE`
   if more than one is present.
3. The exact read command to capture a fresh pre-write dump (`nfc-ndefcat`,
   `nfc-mfultralight r 0 64 dump.ul`, or `nfc-mfclassic r a dump.mfd`).
4. The exact write command with the prepared payload file — gated on the user's
   `CONFIRM NFC WRITE` (and `CONFIRM NFC FORMAT` for erase/format flows) per SKILL.md.
5. The verification read that must match the payload file before declaring success.

Redact tag UIDs in the handoff document per the UID-privacy rule unless the operator
explicitly needs them for pairing or debugging.
