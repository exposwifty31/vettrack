#!/usr/bin/env bash
# Design System Alignment — verification gate (§28)
# Run from the vettrack-ship repo root, any time (before or after apply.sh):
#   bash design-system-updates/verify.sh
#
# This is the actual PROOF layer. apply.sh copies files; this script asserts
# what did and did not land, and exits non-zero the moment anything is
# missing or has drifted — so "nothing landed" is loud and impossible to
# mistake for success, instead of a silent no-op.
#
# It has two halves:
#   1) LANDED checks   — did each artifact from Phases 1-8 actually arrive
#                         at its real destination path.
#   2) DRIFT checks     — are the real-source facts this whole package was
#                         built on (query keys, skeleton shapes, gates) still
#                         true right now. If the app changed since Phase 1-8
#                         read it, some seed helpers may now be silently wrong
#                         — this catches that instead of hiding it.
set -uo pipefail
FAIL=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$1"; FAIL=1; }
check_file() { [ -f "$1" ] && pass "$2" || fail "$2 — missing: $1"; }
check_grep() { grep -qF -- "$2" "$1" 2>/dev/null && pass "$3" || fail "$3 — expected \"$2\" in $1"; }
check_not_grep() { grep -qF -- "$2" "$1" 2>/dev/null && fail "$3 — did NOT expect \"$2\" still in $1" || pass "$3"; }

echo "== 1) LANDED — did apply.sh's copies actually arrive =="
check_file "src/components/ui/role-badge.tsx"                    "RoleBadge landed"
check_file "src/components/equipment/confidence-indicator.tsx"   "ConfidenceIndicator landed"
check_file "src/components/ui/stat-tile.tsx"                      "StatTile landed"
check_file "src/components/ui/audit-log-row.tsx"                  "AuditLogRow landed"
check_file "src/components/general/chat-message.tsx"               "ChatMessage landed"
check_file "src/components/general/leaderboard.tsx"                 "Podium/RankedList landed"
check_file "src/components/equipment/room-readiness-card.tsx"     "RoomReadinessCard landed"
check_file "src/components/general/csv-import-history-row.tsx"      "CsvImportHistoryRow landed"
check_grep "src/index.css" "podium-gold"                          "aligned-tokens.css appended"
check_grep "src/core/entities/design-tokens.ts" "RoleKind"        "design-tokens.additions.ts appended"
check_file "public/fonts/heebo/Heebo-VariableFont_wght.ttf"      "Heebo font landed"
check_file "public/fonts/heebo/fonts.css"                          "Heebo fonts.css landed"
check_file "public/icons/icon-192.png"                             "icon-192.png landed"
check_file "public/icons/icon-512.png"                             "icon-512.png landed"
check_file "public/icons/icon-192-maskable.png"                  "icon-192-maskable.png landed"
check_file "public/icons/icon-512-maskable.png"                  "icon-512-maskable.png landed"
check_grep "src/index.css" "--shadow-modal"                     "elevation-tokens.css appended (--shadow-modal, Phase 10)"
check_grep "src/index.css" "--shadow-overlay"                   "elevation-tokens.css appended (--shadow-overlay, Phase 10)"
check_grep "tailwind.config.ts" "modal: 'var(--shadow-modal)'"  "Tailwind boxShadow.modal/.overlay wired"
check_grep "src/components/ui/dialog.tsx" "shadow-modal"        "Dialog → shadow-modal (Level 3)"
check_grep "src/components/ui/alert-dialog.tsx" "shadow-modal"  "AlertDialog → shadow-modal (Level 3)"
check_grep "src/components/ui/sheet.tsx" "shadow-modal"         "Sheet → shadow-modal (Level 3 — was weaker than Dialog at the same z-50 tier)"
check_grep "src/components/ui/help-tooltip.tsx" "shadow-surface" "HelpTooltip → shadow-surface (Level 2)"
check_grep "src/components/alerts-dropdown.tsx" "shadow-surface" "AlertsDropdown → shadow-surface (Level 2 — was as heavy as a modal)"
check_grep "src/components/pwa-install-prompt.tsx" "shadow-surface" "PwaInstallPrompt (both variants) → shadow-surface"
check_grep "src/components/sync-status-banner.tsx" "shadow-surface" "SyncStatusBanner → shadow-surface"
check_grep "src/components/shift-summary-sheet.tsx" "shadow-overlay" "ShiftSummarySheet → shadow-overlay (Level 4)"
check_grep "src/components/sync-queue-sheet.tsx" "shadow-overlay" "SyncQueueSheet → shadow-overlay (Level 4)"
check_grep "src/components/onboarding-walkthrough.tsx" "shadow-overlay" "OnboardingWalkthrough → shadow-overlay (Level 4)"
check_grep "src/components/equipment/EquipmentRoomSweepSheet.tsx" "shadow-overlay" "EquipmentRoomSweepSheet (z-[70]) → shadow-overlay"
check_grep "src/components/first-scan-celebration.tsx" "shadow-overlay" "FirstScanCelebration (z-[120]) → shadow-overlay"
check_grep "src/components/layout.tsx" "shadow-modal"           "Mobile nav drawer → shadow-modal"
check_grep "src/components/equipment/EquipmentTruthCard.tsx" "shadow-card-hover" "EquipmentTruthCard pinned variant → shadow-card-hover"
check_not_grep "src/components/ui/sheet.tsx" "p-6 shadow-lg"    "Sheet's old untokenized shadow-lg is gone"
check_not_grep "src/components/alerts-dropdown.tsx" "shadow-xl" "AlertsDropdown's old modal-weight shadow is gone"

echo ""
echo "== 2) MANUAL STEPS — the 4 things apply.sh deliberately does NOT do =="
check_grep "src/hooks/use-auth.tsx" "export const AuthContext"     "AuthContext exported (§22-D2)"
check_not_grep "index.html" "family=Heebo"                         "Heebo removed from Google Fonts link"
check_grep "index.html" "fonts/heebo/fonts.css"                    "self-hosted Heebo link added"
check_grep "locales/en.json" "\"locationConfidence\""              "locationConfidence key added (en)"
check_grep "locales/he.json" "\"locationConfidence\""              "locationConfidence key added (he)"
[ -d "ios/App/App/Assets.xcassets/AppIcon.icon" ] \
  && pass "iOS Icon Composer bundle in place" \
  || fail "iOS Icon Composer bundle NOT at ios/App/App/Assets.xcassets/AppIcon.icon"

echo ""
echo "== 3) DRIFT — are the real-source facts this package assumed still true =="
check_grep "src/components/equipment/EquipmentTruthCard.tsx" '["equipment-truth", equipmentId]' \
  "EquipmentTruthCard query key unchanged"
check_grep "src/components/ui/skeleton-cards.tsx" "minHeight: 60" \
  "AuditRowSkeleton shape unchanged (AuditLogRow pixel-match still valid)"
check_grep "src/components/equipment/OperationalMetricsDashboard.tsx" '["/api/operational-metrics/summary", rangeDays]' \
  "OperationalMetricsDashboard query key unchanged"
check_grep "src/components/equipment/WaitlistPanel.tsx" "snapshotProp === undefined" \
  "WaitlistPanel's prop-skips-fetch gate unchanged"
check_not_grep "src/components/alerts-dropdown.tsx" "useQuery" \
  "AlertsDropdown still has no internal query (still pure props)"
check_grep "src/components/first-scan-celebration.tsx" "z-[120]" \
  "FirstScanCelebration still at undocumented z-[120] (§29-D3 finding, not auto-fixed)"
check_grep "src/index.css" "--primary: 234 85% 63%" \
  "Real --primary is still indigo, not forest green (§30-D3 premise still holds)"

echo ""
echo "== Phase 11 (§30) — surface ramp =="
check_grep "src/index.css" "--ivory-panel" "surface-tokens.css appended (--ivory-panel)"
check_grep "src/index.css" "--ivory-hover" "surface-tokens.css appended (--ivory-hover)"
check_grep "src/index.css" "--ivory-active" "surface-tokens.css appended (--ivory-active)"
check_grep "tailwind.config.ts" "panel: \"rgb(var(--ivory-panel)" "Tailwind ivory.panel/.hover/.active wired"

echo ""
echo "== Phase 12 (§31) — action/status-ok green =="
check_grep "src/index.css" "--action: #2f6f5e;" "brand-action-tokens.css appended (--action richened to emerald forest)"
check_grep "src/index.css" "--status-ok: 142 72% 42%;" "status-ok differentiated (brighter, hue held) from the new --action"
check_grep "src/index.css" "--primary: 234 85% 63%" "indigo --primary confirmed UNCHANGED (user chose to keep brand = indigo)"

echo ""
echo "== Phase 13 (§32) — deferred Phase 10/11 call-sites =="
check_not_grep "src/pages/analytics.tsx" "bg-card border-border/60 shadow-sm" "analytics.tsx — all 7 Card overrides fixed"
check_not_grep "src/pages/admin.tsx" "bg-card border-border/60 shadow-sm" "admin.tsx — all 6 Card overrides fixed"
check_not_grep "src/pages/appointments.tsx" "bg-card border-border/60 shadow-sm" "appointments.tsx — all 7 Card overrides fixed"
check_not_grep "src/pages/admin-shifts.tsx" "bg-card border-border/60 shadow-sm" "admin-shifts.tsx — all 3 Card overrides fixed"
check_not_grep "src/pages/new-equipment.tsx" "bg-card border-border/60 shadow-sm" "new-equipment.tsx — all 3 Card overrides fixed"
check_not_grep "src/pages/management-dashboard.tsx" "bg-card border-border/60 shadow-sm" "management-dashboard.tsx — all 3 Card overrides fixed"
check_not_grep "src/pages/equipment-detail.tsx" "bg-card border-border/60 shadow-sm" "equipment-detail.tsx — all 3 Card overrides fixed"
check_not_grep "src/pages/my-equipment.tsx" "bg-card border-border/60 shadow-sm" "my-equipment.tsx Card override fixed"
check_not_grep "src/pages/alerts.tsx" "bg-card border-border/60 shadow-sm" "alerts.tsx Card override fixed"
check_not_grep "src/pages/inventory-page.tsx" "border-border/80 shadow-sm" "inventory-page.tsx Card override fixed"
check_grep "src/pages/rooms-list.tsx" "hover:shadow-card-hover" "rooms-list.tsx card hover retargeted to shadow-card-hover"
check_grep "src/pages/equipment-list.tsx" "hover:shadow-card-hover" "equipment-list.tsx card hover retargeted to shadow-card-hover"
check_grep "src/pages/shift-leaderboard.tsx" "shadow-card" "shift-leaderboard.tsx ad hoc card tokenized"
check_grep "src/pages/appointments.tsx" "text-popover-foreground shadow-surface" "appointments.tsx tooltip retargeted to shadow-surface (Level 2)"
check_grep "src/pages/room-radar.tsx" "shadow-modal" "room-radar.tsx NFC reset modal retargeted to shadow-modal (Level 3)"
check_grep "src/components/layout.tsx" "hover:bg-ivory-hover active:bg-ivory-active" "layout.tsx nav rows adopt ivory-hover/active (was hacking --ivory-border)"
check_grep "src/components/layout/IconSidebar.tsx" "hover:bg-ivory-hover" "IconSidebar.tsx icon hover adopts ivory-hover"

echo ""
echo "== Phase 14 (§33) — layout unify, type scale, chips, card variants =="
check_grep "src/components/layout.tsx" "bg-ivory-greenBg text-ivory-green font-semibold ps-4 pe-3" "layout.tsx 6th nav list unified onto ivory-brand (was bg-primary/8, §32-D4 finished)"
check_not_grep "src/components/layout.tsx" "hover:bg-muted/70 active:bg-muted" "layout.tsx no nav row left on the generic shadcn hover/active hack"
check_grep "src/index.css" "--text-2xl:  2rem;" "page title bumped 28px -> 32px"
check_grep "src/index.css" "--text-lg:   1.25rem;" "section/card title token bumped 18px -> 20px"
check_grep "src/index.css" "--text-base: 1.0625rem;" "body token bumped 16px -> 17px"
check_grep "src/index.css" "--text-sm:   0.9375rem;" "secondary body token bumped 14px -> 15px"
check_grep "src/index.css" "--text-xs:   0.8125rem;" "metadata token bumped 12px -> 13px"
check_grep "src/index.css" "--leading-normal: 1.5;" "body line-height set to 1.5"
check_grep "src/index.css" "letter-spacing: -0.02em;" "heading letter-spacing applied (h1/h2/h3)"
check_grep "tailwind.config.ts" "fontSize: {" "Tailwind's own text-2xl/lg/base/sm/xs overridden (reaches real components, not just --text-* tokens)"
check_grep "src/components/ui/status-badge.tsx" "rounded-full px-2.5 h-7" "StatusBadge is now a 28px pill"
check_not_grep "src/components/ui/status-badge.tsx" "border: \`1px solid" "StatusBadge's border is gone"
check_grep "src/components/ui/badge.tsx" "ok: \"border-transparent" "Badge's status variants dropped their border"
check_grep "src/components/ui/card.tsx" "defaultVariants: { variant: \"primary\" }" "Card has 3 variants, primary (no shadow) is default"
check_grep "src/components/ui/card.tsx" "interactive: \"border border-border bg-card shadow-card hover:shadow-card-hover" "Card's interactive variant carries the shadow + hover lift"
check_grep "src/pages/rooms-list.tsx" "variant=\"interactive\"" "rooms-list.tsx's real clickable card opts into variant=interactive"

echo ""
echo "== Phase 15 (§34) — criticality system =="
check_grep "src/components/ui/card.tsx" "criticality: {" "Card has an independent criticality axis (normal/attention/critical)"
check_grep "src/components/ui/card.tsx" "attention: \"border-s-4 border-s-\[hsl(var(--status-maintenance))\]" "Card criticality=attention uses the real --status-maintenance token"
check_grep "src/components/alerts/AlertCard.tsx" "border-s-4" "AlertCard uses a rail, not a 4-side border box"
check_not_grep "src/components/alerts/AlertCard.tsx" "rounded-sm border\"" "AlertCard's old full-border box is gone"
check_grep "src/components/ui/error-card.tsx" "criticality=\"critical\"" "ErrorCard adopts the new Card criticality system"

echo ""
echo "== Phase 16 (§35) — elevation audit, tabular-nums, chips, maintenance =="
check_grep "src/pages/analytics.tsx" "text-2xl font-bold text-foreground font-num" "analytics.tsx stat numbers get tabular numerals (was missing entirely)"
check_grep "src/components/ui/status-badge.tsx" "font-semibold" "StatusBadge back to font-semibold (was font-medium)"
check_grep "src/components/ui/status-badge.tsx" "border: \`1px solid" "StatusBadge's subtle border is back (clinical-lighting revision)"
check_grep "src/components/ui/card.tsx" "maintenance: \"border-s-4 border-s-\[var(--action)\]" "Card criticality=maintenance added (blue-green rail)"

echo ""
echo "== Phase 17 (§36) — navigation motion timing =="
check_grep "src/components/ui/sheet.tsx" "duration-220 data-\[state=open\]:duration-220" "Sheet open+close both 220ms (was 500/300, asymmetric)"
check_grep "src/components/ui/dialog.tsx" "shadow-modal duration-180" "Dialog duration 180ms (was 200ms)"
check_grep "src/components/ui/alert-dialog.tsx" "shadow-modal duration-180" "AlertDialog duration 180ms (was 200ms)"
check_grep "tailwind.config.ts" "page-enter 0.24s" "page-enter duration 240ms (was 220ms)"
check_grep "src/components/layout.tsx" "duration-260 ease-out will-change-transform" "Mobile nav drawer duration 260ms (was 220ms)"

echo ""
echo "== Phase 18 (§37) — numeric typography round 2 =="
check_grep "src/pages/management-dashboard.tsx" "text-emerald-700 dark:text-emerald-300 leading-none font-num" "management-dashboard.tsx equipment counts get tabular numerals"

echo ""
echo "== Phase 19 (§38) — §34-D3 resolved: CsvImportDialog =="
check_grep "src/components/csv-import-dialog.tsx" "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]" "CsvImportDialog summary chips use real status tokens"
check_not_grep "src/components/csv-import-dialog.tsx" "bg-emerald-50" "CsvImportDialog's hardcoded emerald is gone"
check_not_grep "src/components/csv-import-dialog.tsx" "bg-red-50" "CsvImportDialog's hardcoded red is gone"
check_grep "src/components/csv-import-dialog.tsx" "border-s-4 border-s-\[var(--status-ok-border)\]" "CsvImportDialog's done banner is a rail, not a 4-side box"

echo ""
echo "== Phase 20 (§39) — dark-mode status tokens + partial §38-D3 =="
check_grep "src/index.css" "--status-ok-bg: rgba(16, 185, 129, 0.12);" "dark-mode status-ok/issue/maintenance bg/fg/border tokens added"
check_not_grep "src/pages/rooms-list.tsx" "bg-emerald-50" "rooms-list.tsx fully retokenized (emerald gone)"
check_not_grep "src/pages/rooms-list.tsx" "bg-red-50" "rooms-list.tsx fully retokenized (red gone)"
check_not_grep "src/pages/home.tsx" "bg-red-50" "home.tsx fully retokenized (red-50 gone)"
check_not_grep "src/pages/home.tsx" "bg-amber-100" "home.tsx fully retokenized (amber-100 gone)"
check_grep "src/pages/management-dashboard.tsx" "bg-[var(--status-ok-bg)]" "management-dashboard.tsx's ok/issue boxes retokenized"
check_grep "src/pages/inventory-page.tsx" "bg-emerald-500" "inventory-page.tsx NOT retokenized yet (§39-D3, honest — still hardcoded)"
check_grep "src/pages/equipment-detail.tsx" "text-red-600" "equipment-detail.tsx NOT retokenized yet (§39-D3, honest — still hardcoded)"

echo ""
echo "== Phase 21 (§40) — 15-item visual polish review =="
check_file "src/components/ui/section-header.tsx"       "SectionHeader landed (item 1)"
check_file "src/components/ui/entity-meta-row.tsx"       "EntityMetaRow landed (item 3)"
check_file "src/components/ui/context-chip.tsx"          "ContextChip landed (item 11)"
check_file "src/components/ui/equipment-timeline.tsx"    "Timeline/TimelineRow landed (item 15)"
check_file "src/components/general/staff-card.tsx"       "StaffCard landed (item 13)"
check_grep "src/index.css" "--card-inset-highlight" "phase21-card-tokens.css appended (item 6)"
check_grep "src/components/ui/card.tsx" "shadow-[var(--card-inset-highlight)]" "Card primary variant carries the inset highlight (item 6)"
check_grep "src/components/ui/card.tsx" "p-4 pt-0 space-y-5" "CardContent's 20px internal rhythm (item 4)"
check_grep "src/components/ui/card.tsx" "pt-4 px-4 pb-3" "CardHeader's 12px bottom rhythm (item 4)"
check_grep "src/components/ui/stat-tile.tsx" "min-h-[120px]" "StatTile min-height (item 5)"
check_grep "src/components/ui/stat-tile.tsx" "text-3xl font-bold" "StatTile value reconciled onto the real 35px token (item 5)"
check_grep "src/components/ui/status-badge.tsx" "h-2 w-2 rounded-full flex-shrink-0" "StatusBadge dot bumped 6px -> 8px (item 8)"
check_grep "src/components/ui/badge.tsx" "dot?: boolean" "Badge gets an opt-in dot prop (item 8)"
check_not_grep "src/components/equipment/room-readiness-card.tsx" "conic-gradient" "RoomReadinessCard ring replaced by a bar (item 14)"
check_grep "src/components/equipment/room-readiness-card.tsx" "staffCount" "RoomReadinessCard gets an optional staff count (item 14)"
check_grep "src/components/ui/audit-log-row.tsx" "ivory-hover" "AuditLogRow hover uses the real ivory-hover token (item 7)"
check_grep "src/components/ui/audit-log-row.tsx" "AuditLogHeaderRow" "AuditLogRow gets a header-row companion (item 7)"
check_grep "src/components/equipment/EquipmentDetailActivityTab.tsx" "Timeline, TimelineRow" "EquipmentDetailActivityTab uses the new Timeline primitive (item 15)"
check_not_grep "src/components/equipment/EquipmentDetailActivityTab.tsx" "shadow-sm" "EquipmentDetailActivityTab's Card-shadow-override bug is gone too"
check_not_grep "src/components/equipment/EquipmentDetailStatusStrip.tsx" "text-emerald-600" "EquipmentDetailStatusStrip's hardcoded STATUS_CONFIG retokenized (item 2 bonus find)"
check_grep "src/components/equipment/EquipmentDetailStatusStrip.tsx" "border-s-4 border-s-[hsl(var(--status-maintenance))]" "EquipmentDetailStatusStrip's recovery callout is a rail, not a 4-side box (item 2)"
check_not_grep "src/components/ui/empty-state.tsx" "bg-muted/5 shadow-sm" "EmptyState's shadow-into-Card bug fixed (item 9)"
check_grep "src/components/ui/empty-state.tsx" "pt-6" "EmptyState's action spacing bumped 4px -> 24px (item 9)"
check_grep "src/pages/equipment-list.tsx" "rounded-[14px]" "Search input radius/height/focus-ring upgraded (item 10)"
check_grep "src/pages/equipment-detail.tsx" "EntityMetaRow" "Equipment Detail page wired to the new metadata row (item 3)"
check_grep "src/pages/audit-log.tsx" "ivory-hover" "audit-log.tsx's own (unshared) row hover uses ivory-hover (item 7)"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED — this package is actually applied and still accurate."
  exit 0
else
  echo "FAILED — see ✗ lines above. Re-run apply.sh, do the manual steps, or (for"
  echo "section 3) re-verify the affected seed helper against the real source"
  echo "before trusting it."
  exit 1
fi
