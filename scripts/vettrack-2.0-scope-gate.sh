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

# ONE strict parser is the source of truth for both the ID set and the done/total
# counts — deriving them from two independently-scoped greps (as an earlier version
# of this script did) let them silently drift apart. The pattern requires: "- [ ] "
# or "- [x] ", then a bare N.N task ID, then a REQUIRED space before the description
# — anchored so "1.1foo" (no space after the ID) is rejected outright rather than
# silently parsed as "1.1", and a checklist line elsewhere in the doc that doesn't
# match this exact shape (an "auxiliary" checkbox) is excluded from both counts.
records=$(grep -nE '^- \[[ x]\] [0-9]+\.[0-9]+ ' "$F")
if [ -z "$records" ]; then
  echo "[2.0-gate] BLOCKED: found zero valid tracker records in $F — parsing failed or the tracker was deleted." >&2
  exit 2
fi

# Catch malformed near-misses: any checkbox line whose ID token doesn't parse
# cleanly under the strict pattern above (e.g. "1.1foo", "1", "1.1.1") but still
# looks like it was meant to be a tracker row. Silently dropping these would let a
# corrupted ID vanish from the count instead of blocking.
all_checkbox_lines=$(grep -c '^- \[[ x]\] ' "$F")
valid_lines=$(echo "$records" | wc -l | tr -d ' ')
if [ "$all_checkbox_lines" -ne "$valid_lines" ]; then
  echo "[2.0-gate] BLOCKED: found $all_checkbox_lines checkbox line(s) but only $valid_lines parsed as valid N.N tracker records — a malformed or auxiliary checkbox line exists." >&2
  grep -nE '^- \[[ x]\] ' "$F" | grep -vE '^[0-9]+:- \[[ x]\] [0-9]+\.[0-9]+ ' | sed 's/^/[2.0-gate]   /' >&2
  exit 2
fi

actual_ids=$(echo "$records" | grep -oE '[0-9]+\.[0-9]+' )
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

# done_count/open-items come from the SAME validated $records set, not a fresh grep
# over the whole file — the earlier version's separate `grep -c '^- \[x\] '` would
# have silently counted any auxiliary checkbox line elsewhere in the doc too.
done_count=$(echo "$records" | grep -cE '^[0-9]+:- \[x\] ')
echo "[2.0-gate] VetTrack 2.0 scope: $done_count/19 shipped."
if [ "$done_count" -lt 19 ]; then
  echo "[2.0-gate] Open items:"
  echo "$records" | grep -E '^[0-9]+:- \[ \] ' | sed -E 's/^[0-9]+:- \[ \] /[2.0-gate]   - /'
fi
exit 0
