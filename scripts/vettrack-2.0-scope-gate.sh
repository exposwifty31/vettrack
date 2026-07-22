#!/bin/bash
# VetTrack 2.0 deterministic scope gate — wired as a Claude Code Stop hook.
# Goal: "VetTrack 2.0 ships 100% scope" — re-checked at the end of every session.
# Exit 0: report only. Exit 2: BLOCKS the stop (roadmap integrity broken — a real regression).
set -u
cd "$(dirname "$0")/.." || exit 0
F=docs/vettrack-2.0-roadmap.md
if [ ! -f "$F" ]; then
  echo "[2.0-gate] BLOCKED: $F is missing — the 2.0 execution plan was deleted or moved." >&2
  exit 2
fi
total=$(grep -c '^- \[[ x]\] ' "$F")
done_count=$(grep -c '^- \[x\] ' "$F")
if [ "$total" -ne 19 ]; then
  echo "[2.0-gate] BLOCKED: scope tracker has $total items, expected 19 — tracker was edited structurally." >&2
  exit 2
fi
echo "[2.0-gate] VetTrack 2.0 scope: $done_count/19 shipped."
if [ "$done_count" -lt 19 ]; then
  echo "[2.0-gate] Open items:"
  grep '^- \[ \] ' "$F" | sed 's/^- \[ \] /[2.0-gate]   - /'
fi
exit 0
