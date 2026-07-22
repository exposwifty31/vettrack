#!/bin/bash
# VetTrack 2.0 deterministic scope gate — wired as a Claude Code Stop hook.
# Goal: "VetTrack 2.0 ships 100% scope" — re-checked at the end of every session.
# Exit 0: report only. Exit 2: BLOCKS the stop (roadmap integrity broken — a real regression).
#
# Fails CLOSED: any error reading/parsing the roadmap blocks the stop rather than
# silently passing — a gate that can't verify anything must not report success.
set -u

# Canonical set of the 19 tracker task IDs. Comparing against this exact set (not
# just a count) catches a duplicated or substituted ID even when the total stays 19.
CANONICAL_IDS="0.1 0.2 0.3 0.4 0.5 0.6 0.7 1.1 1.2 1.3 1.4 2.1 2.2 2.3 2.4 2.5 3.1 3.2 3.3"

if ! cd "$(dirname "$0")/.."; then
  echo "[2.0-gate] BLOCKED: could not cd to repo root — cannot verify scope, refusing to report success." >&2
  exit 2
fi

F=docs/vettrack-2.0-roadmap.md
if [ ! -f "$F" ]; then
  echo "[2.0-gate] BLOCKED: $F is missing — the 2.0 execution plan was deleted or moved." >&2
  exit 2
fi
if [ ! -r "$F" ]; then
  echo "[2.0-gate] BLOCKED: $F is not readable — cannot verify scope, refusing to report success." >&2
  exit 2
fi

actual_ids=$(grep -oE '^- \[[ x]\] [0-9]+\.[0-9]+' "$F" | grep -oE '[0-9]+\.[0-9]+')
if [ -z "$actual_ids" ]; then
  echo "[2.0-gate] BLOCKED: found zero tracker items in $F — parsing failed or the tracker was deleted." >&2
  exit 2
fi

total=$(echo "$actual_ids" | wc -l | tr -d ' ')
duplicates=$(echo "$actual_ids" | sort | uniq -d)
if [ -n "$duplicates" ]; then
  echo "[2.0-gate] BLOCKED: duplicate task ID(s) in the tracker: $(echo "$duplicates" | tr '\n' ' ')" >&2
  exit 2
fi

missing=""
for id in $CANONICAL_IDS; do
  if ! echo "$actual_ids" | grep -qx "$id"; then
    missing="$missing $id"
  fi
done
extra=""
for id in $actual_ids; do
  case " $CANONICAL_IDS " in
    *" $id "*) ;;
    *) extra="$extra $id" ;;
  esac
done

if [ -n "$missing" ] || [ -n "$extra" ]; then
  echo "[2.0-gate] BLOCKED: tracker ID set doesn't match the canonical 19 — tracker was edited structurally." >&2
  [ -n "$missing" ] && echo "[2.0-gate]   missing:$missing" >&2
  [ -n "$extra" ] && echo "[2.0-gate]   unexpected:$extra" >&2
  exit 2
fi

if [ "$total" -ne 19 ]; then
  echo "[2.0-gate] BLOCKED: scope tracker has $total items, expected 19 — tracker was edited structurally." >&2
  exit 2
fi

done_count=$(grep -c '^- \[x\] ' "$F")
echo "[2.0-gate] VetTrack 2.0 scope: $done_count/19 shipped."
if [ "$done_count" -lt 19 ]; then
  echo "[2.0-gate] Open items:"
  grep '^- \[ \] ' "$F" | sed 's/^- \[ \] /[2.0-gate]   - /'
fi
exit 0
