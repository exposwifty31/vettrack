#!/usr/bin/env bash
# VetTrack native ship checklist — simulator capture pass (iPhone + iPad)
set -uo pipefail
export PATH="$HOME/Library/Python/3.9/bin:$PATH"

IPHONE_UDID=9821AC5F-F618-4608-8CF5-7DB435BC874C
IPAD_UDID=DA8D1142-E500-43D7-84C8-8678BD1B3542
QA="${QA_DIR:-/Users/dan/vettrack/docs/mobile/qa-screenshots}"
mkdir -p "$QA"
LOG="$QA/batch-7-results.tsv"
echo -e "device\torient\troute\tfile" > "$LOG"

portrait() {
  osascript -e 'tell application "Simulator" to activate' -e 'delay 0.4' -e 'tell application "System Events" to key code 123 using command down' >/dev/null 2>&1 || true
  sleep 1.5
}

landscape() {
  osascript -e 'tell application "Simulator" to activate' -e 'delay 0.4' -e 'tell application "System Events" to key code 124 using command down' >/dev/null 2>&1 || true
  sleep 2
}

shot() {
  local device=$1 orient=$2 route=$3 udid=$4
  local safe
  safe=$(echo "$route" | tr '/?<' '-' | tr -cd '[:alnum:]._-')
  local file="${device}-${orient}-${safe}.png"
  xcrun simctl io "$udid" screenshot "$QA/$file" >/dev/null
  echo -e "${device}\t${orient}\t${route}\t${file}" >> "$LOG"
}

tap_tab_iphone() { idb ui tap --udid "$IPHONE_UDID" "$1" "$2"; sleep 2; }
tap_tab_ipad() { idb ui tap --udid "$IPAD_UDID" "$1" "$2"; sleep 2; }
open_menu_iphone() { tap_tab_iphone 361 835; sleep 2; }
open_menu_ipad() { tap_tab_ipad 656 1145; sleep 2; }
menu_item_iphone() { open_menu_iphone; idb ui tap --udid "$IPHONE_UDID" 200 "$1"; sleep 2; }
menu_item_ipad() { open_menu_ipad; idb ui tap --udid "$IPAD_UDID" 200 "$1"; sleep 2; }
go_home_iphone() { tap_tab_iphone 80 835; sleep 2; }
go_home_ipad() { tap_tab_ipad 164 1145; sleep 2; }

pgrep -f "idb_companion.*$IPHONE_UDID" >/dev/null || idb_companion --udid "$IPHONE_UDID" &
pgrep -f "idb_companion.*$IPAD_UDID" >/dev/null || idb_companion --udid "$IPAD_UDID" &
sleep 3

echo "== iPhone portrait =="
xcrun simctl launch "$IPHONE_UDID" uk.vettrack.app >/dev/null; sleep 8
portrait

capture_menu_iphone() {
  local key=$1 y=$2
  menu_item_iphone "$y"
  shot iphone p "/$key" "$IPHONE_UDID"
  go_home_iphone
}

capture_menu_iphone alerts 480
capture_menu_iphone analytics 580
capture_menu_iphone dashboard 630
capture_menu_iphone inventory 530
capture_menu_iphone procurement 780
capture_menu_iphone admin 830
capture_menu_iphone help 880
capture_menu_iphone settings 930
capture_menu_iphone audit-log 980
capture_menu_iphone whats-new 1030
capture_menu_iphone crash-cart 330
capture_menu_iphone print 680
capture_menu_iphone inventory-items 730
capture_menu_iphone admin-shifts 880
capture_menu_iphone code-blue-history 1030

tap_tab_iphone 121 835; shot iphone p /equipment "$IPHONE_UDID"
tap_tab_iphone 201 835; shot iphone p equipment-scan "$IPHONE_UDID"
go_home_iphone; menu_item_iphone 230; shot iphone p equipment-board "$IPHONE_UDID"
go_home_iphone; menu_item_iphone 280; shot iphone p equipment-tasks "$IPHONE_UDID"
go_home_iphone; menu_item_iphone 380; shot iphone p rooms "$IPHONE_UDID"
go_home_iphone; menu_item_iphone 430; shot iphone p my-equipment "$IPHONE_UDID"
tap_tab_iphone 281 835; shot iphone p code-blue "$IPHONE_UDID"
tap_tab_iphone 360 760; shot iphone p shift-chat "$IPHONE_UDID"

echo "== iPhone landscape =="
go_home_iphone; landscape
tap_tab_iphone 281 835; shot iphone l code-blue "$IPHONE_UDID"
go_home_iphone; landscape; tap_tab_iphone 121 835; shot iphone l equipment "$IPHONE_UDID"
go_home_iphone; landscape; tap_tab_iphone 80 835; shot iphone l home "$IPHONE_UDID"
go_home_iphone; landscape; tap_tab_iphone 360 760; shot iphone l shift-chat "$IPHONE_UDID"
portrait

echo "== iPad landscape =="
xcrun simctl launch "$IPAD_UDID" uk.vettrack.app >/dev/null; sleep 8
landscape
go_home_ipad; shot ipad l home "$IPAD_UDID"
tap_tab_ipad 246 1145; shot ipad l equipment "$IPAD_UDID"
menu_item_ipad 480; shot ipad l alerts "$IPAD_UDID"
menu_item_ipad 530; shot ipad l inventory "$IPAD_UDID"
menu_item_ipad 580; shot ipad l analytics "$IPAD_UDID"
menu_item_ipad 630; shot ipad l dashboard "$IPAD_UDID"
menu_item_ipad 330; shot ipad l crash-cart "$IPAD_UDID"
menu_item_ipad 830; shot ipad l admin "$IPAD_UDID"
menu_item_ipad 930; shot ipad l settings "$IPAD_UDID"
menu_item_ipad 880; shot ipad l help "$IPAD_UDID"
menu_item_ipad 380; shot ipad l rooms "$IPAD_UDID"
tap_tab_ipad 574 1145; shot ipad l code-blue "$IPAD_UDID"
tap_tab_ipad 760 1050; shot ipad l shift-chat "$IPAD_UDID"
portrait
menu_item_ipad 1030; shot ipad p whats-new "$IPAD_UDID"

echo "DONE — log at $LOG"
wc -l "$LOG"
