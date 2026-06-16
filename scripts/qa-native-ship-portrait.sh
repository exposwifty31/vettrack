#!/usr/bin/env bash
# Portrait-only menu route captures — requires idb frame width < height
set -uo pipefail
export PATH="$HOME/Library/Python/3.9/bin:$PATH"

IPHONE_UDID=9821AC5F-F618-4608-8CF5-7DB435BC874C
IPAD_UDID=DA8D1142-E500-43D7-84C8-8678BD1B3542
QA=/Users/dan/vettrack/docs/mobile/qa-screenshots
mkdir -p "$QA"
LOG="$QA/batch-8-portrait.tsv"
echo -e "device\troute\tfile\tframe" > "$LOG"

force_portrait() {
  local udid=$1
  osascript -e 'tell application "Simulator" to activate' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    local w h
    read w h < <(idb ui describe-all --udid "$udid" 2>/dev/null | python3 -c "import sys,json;f=json.load(sys.stdin)[0]['frame'];print(int(f['width']),int(f['height']))" 2>/dev/null || echo "874 402")
    [ "$w" -lt "$h" ] && echo "portrait ${w}x${h}" && return 0
    osascript -e 'tell application "System Events" to tell process "Simulator" to click menu item "Rotate Left" of menu 1 of menu bar item "Device" of menu bar 1' 2>/dev/null || \
      osascript -e 'tell application "System Events" to key code 123 using command down' 2>/dev/null || true
    sleep 1.5
  done
  read w h < <(idb ui describe-all --udid "$udid" 2>/dev/null | python3 -c "import sys,json;f=json.load(sys.stdin)[0]['frame'];print(int(f['width']),int(f['height']))")
  echo "frame ${w}x${h}"
}

shot() {
  local device=$1 route=$2 udid=$3 file=$4
  xcrun simctl io "$udid" screenshot "$QA/$file" >/dev/null
  local frame
  frame=$(idb ui describe-all --udid "$udid" 2>/dev/null | python3 -c "import sys,json;f=json.load(sys.stdin)[0]['frame'];print(int(f['width']),int(f['height']))" 2>/dev/null || echo "?")
  echo -e "${device}\t${route}\t${file}\t${frame}" >> "$LOG"
}

pgrep -f "idb_companion.*$IPHONE_UDID" >/dev/null || idb_companion --udid "$IPHONE_UDID" &
pgrep -f "idb_companion.*$IPAD_UDID" >/dev/null || idb_companion --udid "$IPAD_UDID" &
sleep 3

echo "== iPhone portrait menu routes =="
osascript -e 'tell application "Simulator" to activate' -e 'delay 0.5' -e 'tell application "System Events" to tell process "Simulator" to try
  click menu item "iPhone 17 Pro" of menu 1 of menu item "Open Simulator" of menu 1 of menu bar item "File" of menu bar 1
end try' 2>/dev/null
sleep 2
xcrun simctl install "$IPHONE_UDID" /Users/dan/vettrack/build/ios-sim/Build/Products/Debug-iphonesimulator/App.app 2>/dev/null || true
xcrun simctl launch "$IPHONE_UDID" uk.vettrack.app >/dev/null; sleep 10
force_portrait "$IPHONE_UDID"

menu_go() {
  local route=$1 y=$2 file=$3
  idb ui tap --udid "$IPHONE_UDID" 80 835; sleep 1.5
  idb ui tap --udid "$IPHONE_UDID" 361 835; sleep 2
  idb ui tap --udid "$IPHONE_UDID" 200 "$y"; sleep 2.5
  shot iphone "$route" "$IPHONE_UDID" "$file"
}

# Y coords calibrated from iphone-p-menu-open-v2.png (portrait)
menu_go alerts 465 iphone-p-alerts-b8.png
menu_go analytics 565 iphone-p-analytics-b8.png
menu_go dashboard 615 iphone-p-dashboard-b8.png
menu_go inventory 515 iphone-p-inventory-b8.png
menu_go procurement 765 iphone-p-procurement-b8.png
menu_go admin 815 iphone-p-admin-b8.png
menu_go help 865 iphone-p-help-b8.png
menu_go settings 915 iphone-p-settings-b8.png
menu_go audit-log 965 iphone-p-audit-log-b8.png
menu_go whats-new 1015 iphone-p-whats-new-b8.png
menu_go crash-cart 315 iphone-p-crash-cart-b8.png
menu_go print 665 iphone-p-print-b8.png
menu_go inventory-items 715 iphone-p-inventory-items-b8.png
menu_go admin-shifts 865 iphone-p-admin-shifts-b8.png

idb ui tap --udid "$IPHONE_UDID" 80 835; sleep 2
idb ui tap --udid "$IPHONE_UDID" 121 835; sleep 2
shot iphone /equipment "$IPHONE_UDID" iphone-p-equipment-b8.png

echo "== iPad portrait whats-new =="
osascript -e 'tell application "Simulator" to activate' -e 'delay 0.5' -e 'tell application "System Events" to tell process "Simulator" to try
  click menu item "iPad (A16)" of menu 1 of menu item "Open Simulator" of menu 1 of menu bar item "File" of menu bar 1
end try' 2>/dev/null
sleep 2
xcrun simctl launch "$IPAD_UDID" uk.vettrack.app >/dev/null; sleep 8
force_portrait "$IPAD_UDID"
idb ui tap --udid "$IPAD_UDID" 656 1145; sleep 2
idb ui tap --udid "$IPAD_UDID" 200 1000; sleep 2.5
shot ipad /whats-new "$IPAD_UDID" ipad-p-whats-new-v1.0.1.png

echo "DONE $LOG"
cat "$LOG"
