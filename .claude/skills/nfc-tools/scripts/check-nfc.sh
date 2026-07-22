#!/usr/bin/env sh
# Sanity-check the libnfc/nfc-utils CLI stack before any NFC workflow.
# Verifies nfc-list, nfc-poll, and nfc-taginfo are on PATH and that
# `nfc-list --help` responds. Safe to run with no tag or reader present.
# Exit codes: 0 = stack ready, 1 = one or more tools missing, 2 = nfc-list unresponsive.

set -u

missing=0
for tool in nfc-list nfc-poll nfc-taginfo; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'ok      %s -> %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'MISSING %s (install libnfc/nfc-utils, e.g. apt install libnfc-bin libnfc-examples)\n' "$tool"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo 'check-nfc: CLI tools missing — see references/fallback.md for offline planning.'
  exit 1
fi

# nfc-list exits non-zero on --help in some builds; only require that it responds.
if nfc-list --help >/dev/null 2>&1 || nfc-list -h >/dev/null 2>&1; then
  echo 'check-nfc: nfc-list responds. Stack ready; reader enumeration is the next step (nfc-list).'
else
  echo 'check-nfc: nfc-list did not respond to --help/-h — check the libnfc install and udev permissions.'
  exit 2
fi
