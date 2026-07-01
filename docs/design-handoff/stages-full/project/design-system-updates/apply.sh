#!/usr/bin/env bash
# Design System Alignment — apply script (§27-D3)
# Run from the vettrack-ship repo root:
#   bash /path/to/design-system-updates/apply.sh /path/to/design-system-updates
# Copies/appends every file to its real destination. Review the diff before
# committing — this does not run tests, typecheck, or the design-sync-cli.
set -euo pipefail
SRC="${1:?Usage: apply.sh <path-to-design-system-updates>}"

mkdir -p public/fonts/heebo public/icons \
  src/components/equipment src/components/general src/components/ui

# Tokens & entities — APPEND, never overwrite (both real files already have
# unrelated content above what we're adding).
cat "$SRC/tokens/aligned-tokens.css" >> src/index.css
cat "$SRC/entities/design-tokens.additions.ts" >> src/core/entities/design-tokens.ts

# New components
cp "$SRC/components/role-badge.tsx" src/components/ui/role-badge.tsx
cp "$SRC/components/confidence-indicator.tsx" src/components/equipment/confidence-indicator.tsx
cp "$SRC/components/stat-tile.tsx" src/components/ui/stat-tile.tsx
cp "$SRC/components/audit-log-row.tsx" src/components/ui/audit-log-row.tsx
cp "$SRC/components/chat-message.tsx" src/components/general/chat-message.tsx
cp "$SRC/components/leaderboard.tsx" src/components/general/leaderboard.tsx
cp "$SRC/components/room-readiness-card.tsx" src/components/equipment/room-readiness-card.tsx
cp "$SRC/components/csv-import-history-row.tsx" src/components/general/csv-import-history-row.tsx

# Fonts (self-hosted Heebo)
cp "$SRC/fonts/heebo/Heebo-VariableFont_wght.ttf" public/fonts/heebo/
cp "$SRC/fonts/heebo/fonts.css" public/fonts/heebo/fonts.css
cp "$SRC/fonts/heebo/OFL.txt" public/fonts/heebo/OFL.txt

# App icon (web/PWA sizes matching manifest.json exactly)
cp "$SRC/icons/icon-192.png" public/icons/icon-192.png
cp "$SRC/icons/icon-512.png" public/icons/icon-512.png
cp "$SRC/icons/icon-192-maskable.png" public/icons/icon-192-maskable.png
cp "$SRC/icons/icon-512-maskable.png" public/icons/icon-512-maskable.png

# ── Phase 10 (§29) — Elevation shadow ladder ──────────────────────────────
# Every edit below is an exact, already-verified literal-string replacement
# (not a regex guess) — see README §29 for the grep/read evidence behind
# each one. Safe to script (unlike the 4 manual steps below): no ambiguity,
# no risk of matching the wrong spot, nothing hand-authored to preserve.
_sed() { sed -i.bak -e "s#$1#$2#" "$3" && rm -f "$3.bak"; }

# Two new token rungs (append), then wire them into Tailwind's boxShadow.
cat "$SRC/tokens/elevation-tokens.css" >> src/index.css
_sed "surface: 'var(--shadow-surface)'," \
     "surface: 'var(--shadow-surface)', modal: 'var(--shadow-modal)', overlay: 'var(--shadow-overlay)'," \
     tailwind.config.ts

# Level 3 · sheets & modals — Dialog/AlertDialog/Sheet were 3 different
# shadow weights at the same z-50 tier; now all one token.
_sed "p-6 shadow-xl duration-200" "p-6 shadow-modal duration-200" src/components/ui/dialog.tsx
_sed "p-6 shadow-xl duration-200" "p-6 shadow-modal duration-200" src/components/ui/alert-dialog.tsx
_sed "bg-background p-6 shadow-lg transition ease-in-out" "bg-background p-6 shadow-modal transition ease-in-out" src/components/ui/sheet.tsx
_sed "bg-ivory-bg border-e border-ivory-border shadow-2xl overflow-y-auto" "bg-ivory-bg border-e border-ivory-border shadow-modal overflow-y-auto" src/components/layout.tsx

# Level 2 · active panels — dismiss-on-outside-click surfaces with no
# scrim; were borrowing modal-strength shadows (or nothing tokenized at all).
_sed "rounded-xl shadow-lg px-3 py-2\.5" "rounded-xl shadow-surface px-3 py-2.5" src/components/ui/help-tooltip.tsx
_sed "bg-card shadow-xl overflow-hidden" "bg-card shadow-surface overflow-hidden" src/components/alerts-dropdown.tsx
_sed "bg-background/95 shadow-xl backdrop-blur-md p-4 flex items-start gap-3" "bg-background/95 shadow-surface backdrop-blur-md p-4 flex items-start gap-3" src/components/pwa-install-prompt.tsx
_sed "bg-background/95 shadow-2xl backdrop-blur-md p-4" "bg-background/95 shadow-surface backdrop-blur-md p-4" src/components/pwa-install-prompt.tsx
_sed "px-4 py-3 shadow-lg sm:mx-auto" "px-4 py-3 shadow-surface sm:mx-auto" src/components/sync-status-banner.tsx

# Level 4 · emergency / system-critical overlays — the z-65/66/70/120 tier
# (above ordinary sheets & modals). EquipmentRoomSweepSheet self-promotes to
# z-[70] but was inheriting Sheet's base shadow with no boost at all.
_sed "rounded-t-2xl shadow-2xl max-h-\[88vh\]" "rounded-t-2xl shadow-overlay max-h-[88vh]" src/components/shift-summary-sheet.tsx
_sed "rounded-t-2xl shadow-2xl max-h-\[80vh\]" "rounded-t-2xl shadow-overlay max-h-[80vh]" src/components/sync-queue-sheet.tsx
_sed "rounded-2xl shadow-2xl border border-border overflow-hidden" "rounded-2xl shadow-overlay border border-border overflow-hidden" src/components/onboarding-walkthrough.tsx
_sed "rounded-t-2xl max-h-\[80vh\] overflow-y-auto z-\[70\]" "rounded-t-2xl max-h-[80vh] overflow-y-auto z-[70] shadow-overlay" src/components/equipment/EquipmentRoomSweepSheet.tsx
_sed "text-center shadow-2xl" "text-center shadow-overlay" src/components/first-scan-celebration.tsx

# Level 1 · cards — two spots were passing a conflicting shadow-sm/shadow-md
# INTO the Card component, silently overriding its own shadow-card (Tailwind-
# merge keeps the last conflicting utility). The "pinned" variant wants MORE
# weight than resting, not less — shadow-card-hover, not just removed.
_sed "border-primary/20 bg-card shadow-sm" "border-primary/20 bg-card" src/components/equipment/EquipmentTruthCard.tsx
_sed "border-primary/25 bg-card shadow-md ring-1 ring-primary/10" "border-primary/25 bg-card shadow-card-hover ring-1 ring-primary/10" src/components/equipment/EquipmentTruthCard.tsx

echo "Phase 10 (elevation ladder) applied — 15 shadow-class edits + 1 token append + 1 Tailwind wire-up."

# ── Phase 11 (§30) — Richer surface / neutral system ──────────────────────
# Tokens + Tailwind wiring only this phase — see README §30-D3 for why the
# brand-color half of this review is deliberately NOT included here.
cat "$SRC/tokens/surface-tokens.css" >> src/index.css
_sed "surface:  \"rgb(var(--ivory-surface) / <alpha-value>)\"," \
     "surface:  \"rgb(var(--ivory-surface) / <alpha-value>)\", panel: \"rgb(var(--ivory-panel) / <alpha-value>)\", hover: \"rgb(var(--ivory-hover) / <alpha-value>)\", active: \"rgb(var(--ivory-active) / <alpha-value>)\"," \
     tailwind.config.ts

echo "Phase 11 (surface ramp) applied — --ivory-bg shifted warm + 3 new steps (panel/hover/active), Tailwind ivory.* wired. Component-level adoption NOT done this phase — see README §30."

# ── Phase 12 (§31) — Richer action green, indigo stays brand ─────────────
# Confirmed with the user: keep --primary/--brand indigo (matches the logo);
# only the real forest-green --action family + --status-ok change. Pure
# token append (same unlayered-:root-beats-@layer-base cascade trick as
# Phase 11's --ivory-bg override) — no sed needed, nothing else to patch:
# every real consumer (.vt-scan-fab, .vt-action-green, StatusBadge via
# Tailwind's status.ok) already reads var(--action)/var(--status-ok), never
# a hardcoded hex.
cat "$SRC/tokens/brand-action-tokens.css" >> src/index.css

echo "Phase 12 (action/status-ok green) applied — indigo brand unchanged, --action richened, --status-ok differentiated. Theme-variant overrides (clinical/dark) NOT touched — see README §31-D3."

# ── Phase 13 (§32) — Finish Phase 10 + Phase 11: the deferred call-sites ──
# §32-D1: the ~40 flagged Card shadow-sm overrides (Phase 10's §29-D3), plus
# 2 more shadow-ladder misses this same grep turned up (never in Phase 10's
# original list — a popover and a hand-rolled modal). §32-D2: adopt the
# Phase 11 ivory-hover/ivory-active tokens at the real hack they replace.

# §32-D1a — standard Card override: shadow-sm passed into Card, downgrading
# its own shadow-card (same bug class as EquipmentTruthCard in Phase 10).
# One sed per file fixes every occurrence in that file (sed runs per-line).
for f in src/pages/my-equipment.tsx src/pages/equipment-detail.tsx \
         src/pages/analytics.tsx src/pages/new-equipment.tsx \
         src/pages/admin.tsx src/pages/admin-shifts.tsx \
         src/pages/appointments.tsx src/pages/management-dashboard.tsx \
         src/pages/alerts.tsx; do
  _sed "bg-card border-border/60 shadow-sm" "bg-card border-border/60" "$f"
done

# §32-D1b — same bug, but the card also had a hover:shadow-md that should
# point at shadow-card-hover instead of a second untokenized default.
_sed "bg-card border-border/60 shadow-sm hover:shadow-md" \
     "bg-card border-border/60 hover:shadow-card-hover" src/pages/rooms-list.tsx
_sed "bg-card border-border/60 shadow-sm transition-all hover:shadow-md" \
     "bg-card border-border/60 transition-all hover:shadow-card-hover" src/pages/equipment-list.tsx

# §32-D1c — same bug, different border opacity (/80 not /60).
_sed "overflow-hidden border-border/80 shadow-sm" "overflow-hidden border-border/80" src/pages/inventory-page.tsx

# §32-D1d — hand-rolled "bg-card ... shadow-sm" divs (not the <Card>
# component itself, so not literally the override bug, but the same
# generic-Tailwind-default-instead-of-the-token pattern).
_sed "bg-card p-4 shadow-sm" "bg-card p-4 shadow-card" src/pages/shift-leaderboard.tsx
_sed "rounded-2xl p-6 shadow-sm text-center" "rounded-2xl p-6 shadow-card text-center" src/pages/signup.tsx
_sed "rounded-2xl p-6 shadow-sm text-center" "rounded-2xl p-6 shadow-card text-center" src/pages/signin.tsx
_sed "rounded-2xl shadow-sm overflow-hidden" "rounded-2xl shadow-card overflow-hidden" src/pages/help.tsx

# §32-D1e — 2 more Phase-10-era misses this grep pass turned up: a popover
# at modal-strength shadow-xl (should be shadow-surface, Level 2, same as
# HelpTooltip/Select/AlertsDropdown), and a hand-rolled z-50 modal that was
# never routed through the ladder at all (should be shadow-modal, Level 3,
# same tier as Dialog/AlertDialog/Sheet).
_sed "text-popover-foreground shadow-xl" "text-popover-foreground shadow-surface" src/pages/appointments.tsx
_sed "bg-card rounded-2xl shadow-2xl border border-border overflow-hidden animate-fade-in" \
     "bg-card rounded-2xl shadow-modal border border-border overflow-hidden animate-fade-in" src/pages/room-radar.tsx

# §32-D2 — Phase 11's ivory-hover/ivory-active adopted where the real code
# was hacking a hover/active tint out of --ivory-border (no dedicated token
# existed yet). Fixes all 5 identical occurrences in layout.tsx in one pass.
_sed "hover:bg-ivory-border/40 active:bg-ivory-border/60" "hover:bg-ivory-hover active:bg-ivory-active" src/components/layout.tsx
_sed "text-ivory-text3 hover:text-ivory-text2" "text-ivory-text3 hover:text-ivory-text2 hover:bg-ivory-hover" src/components/layout/IconSidebar.tsx

echo "Phase 13 (finish Phase 10 + 11 call-sites) applied — Card overrides + 2 missed shadow-ladder spots + ivory-hover/active adoption in nav."

# ── Phase 14 (§33) — Unify layout.tsx, type scale, chips, card variants ──

# §33-D1 — finish §32-D4: the one nav-item list layout.tsx left on the
# generic shadcn tokens is now unified onto the same ivory-brand family as
# its 5 siblings (and picks up the Phase 11/13 ivory-hover/active tokens
# directly, rather than ever going through the old ivory-border hack).
_sed "bg-primary/8 text-primary font-semibold ps-4 pe-3" "bg-ivory-greenBg text-ivory-green font-semibold ps-4 pe-3" src/components/layout.tsx
_sed "text-foreground hover:bg-muted/70 active:bg-muted ps-3 hover:ps-4 pe-3" "text-ivory-text hover:bg-ivory-hover active:bg-ivory-active ps-3 hover:ps-4 pe-3" src/components/layout.tsx

# §33-D2 — Typography scale + rhythm. Bumps the 5 named tokens exactly as
# specified (page/section/card-title/body/metadata), PLUS overrides
# Tailwind's own text-2xl/lg/base/sm/xs so the change actually reaches real
# components (most of the app uses plain Tailwind text-* utilities, not the
# --text-* custom properties — see README §33-D2 for why both were needed).
_sed "--text-xs:   0.75rem;     /\* 12px — captions, helper text \*/" \
     "--text-xs:   0.8125rem;   /* 13px — captions, helper text (was 12px, §33) */" src/index.css
_sed "--text-sm:   0.875rem;    /\* 14px — secondary body, labels \*/" \
     "--text-sm:   0.9375rem;   /* 15px — secondary body, labels (was 14px, §33) */" src/index.css
_sed "--text-base: 1rem;        /\* 16px — body default \*/" \
     "--text-base: 1.0625rem;   /* 17px — body default (was 16px, §33) */" src/index.css
_sed "--text-lg:   1.125rem;    /\* 18px — emphasized body, card titles \*/" \
     "--text-lg:   1.25rem;     /* 20px — emphasized body, card titles (was 18px, §33) */" src/index.css
_sed "--text-2xl:  1.75rem;     /\* 28px — page titles \*/" \
     "--text-2xl:  2rem;        /* 32px — page titles (was 28px, §33) */" src/index.css
_sed "--leading-normal: 1.55;   /\* body prose \*/" "--leading-normal: 1.5;    /* body prose (was 1.55, §33) */" src/index.css
_sed ".vt-title      { font-size: var(--text-xl);   line-height: var(--leading-snug); font-weight: 600; letter-spacing: -0.01em; }" \
     ".vt-title      { font-size: var(--text-xl);   line-height: var(--leading-snug); font-weight: 600; letter-spacing: -0.02em; }" src/index.css
_sed "@apply text-2xl md:text-3xl font-bold tracking-tight text-foreground;" \
     "@apply text-2xl md:text-3xl font-bold tracking-tight text-foreground; letter-spacing: -0.02em;" src/index.css
_sed "@apply text-xl md:text-2xl font-semibold tracking-tight text-foreground;" \
     "@apply text-xl md:text-2xl font-semibold tracking-tight text-foreground; letter-spacing: -0.02em;" src/index.css
_sed "@apply text-lg font-semibold tracking-tight text-foreground;" \
     "@apply text-lg font-semibold tracking-tight text-foreground; letter-spacing: -0.02em;" src/index.css
_sed "@apply leading-relaxed;" "line-height: 1.5;" src/index.css
_sed "fontFamily: {" \
     "fontSize: { xs: ['0.8125rem', '1.125rem'], sm: ['0.9375rem', '1.375rem'], base: ['1.0625rem', '1.625rem'], lg: ['1.25rem', '1.875rem'], '2xl': ['2rem', '2.5rem'] }, fontFamily: {" \
     tailwind.config.ts

# §33-D3 — Status chips: pill, tint-only, no border, font-medium, h-7 (28px).
# StatusBadge is a full replacement (structural: rounded-[4px]→rounded-full,
# drops the inline border, adds explicit height — not a safe sed diff).
cp "$SRC/components/status-badge.tsx" src/components/ui/status-badge.tsx
# Badge's 4 status-semantic variants lose their border too, for the same
# reason; its default/secondary/destructive/outline variants are generic UI
# badges (not "status chips") and are deliberately untouched.
_sed "ok: \"border-\[var(--status-ok-border)\] bg-\[var(--status-ok-bg)\] text-\[var(--status-ok-fg)\]\"," \
     "ok: \"border-transparent bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]\"," src/components/ui/badge.tsx
_sed "issue: \"border-\[var(--status-issue-border)\] bg-\[var(--status-issue-bg)\] text-\[var(--status-issue-fg)\]\"," \
     "issue: \"border-transparent bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]\"," src/components/ui/badge.tsx
_sed "maintenance: \"border-\[var(--status-maint-border)\] bg-\[var(--status-maint-bg)\] text-\[var(--status-maint-fg)\]\"," \
     "maintenance: \"border-transparent bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)]\"," src/components/ui/badge.tsx
_sed "sterilized: \"border-primary/30 bg-primary/10 text-primary\"," \
     "sterilized: \"border-transparent bg-primary/10 text-primary\"," src/components/ui/badge.tsx

# §33-D4 — Card architecture: 3 variants (primary/interactive/critical),
# defaultVariants = primary (no shadow) per the review's own framing. Full
# replacement (adding cva + a variant prop to Card's type signature isn't a
# safe sed diff either). See card.tsx's own header comment for the
# blast-radius note this default carries — every bare <Card> app-wide.
cp "$SRC/components/card.tsx" src/components/ui/card.tsx
# One known-interactive real card gets the explicit variant so it keeps its
# shadow + hover lift now that "primary" (no shadow) is the default.
_sed "<Card className=\"bg-card border-border/60 hover:shadow-card-hover motion-safe:active:scale-\[0.98\] transition-all cursor-pointer h-full\">" \
     "<Card variant=\"interactive\" className=\"motion-safe:active:scale-[0.98] transition-all cursor-pointer h-full\">" src/pages/rooms-list.tsx

echo "Phase 14 (layout unify + type scale + chips + card variants) applied — see README §33 for the two blast-radius calls this phase makes explicitly (type scale reaching real Tailwind classes, Card's shadow-less default)."

# ── Phase 15 (§34) — Criticality system (normal / attention / critical) ──
# card.tsx (already cp'd above, in Phase 14) now ALSO carries a criticality
# axis independent of variant — re-run here is a no-op duplicate copy of the
# same current source file, kept so this phase's diff is self-contained.
cp "$SRC/components/card.tsx" src/components/ui/card.tsx
# AlertCard: "instead of a standard alert box" — was a full 4-side border
# box; now a left accent rail, same tokens, same 3 tones.
cp "$SRC/components/alert-card.tsx" src/components/alerts/AlertCard.tsx
# ErrorCard was the other real "standard alert box" (full border on all 4
# sides via a className override) — now adopts the new Card criticality
# system directly instead of hand-rolling a similar-but-different treatment.
_sed "<Card className=\"border-destructive bg-destructive/5\">" \
     "<Card criticality=\"critical\" className=\"bg-destructive/5\">" src/components/ui/error-card.tsx

echo "Phase 15 (criticality system) applied — Card gets a criticality prop, AlertCard drops its border-box for a rail, ErrorCard adopts criticality=critical."

# ── Phase 16 (§35) — Elevation audit, tabular-nums, chip revision, maintenance criticality ──
# §35-D1 elevation audit: verification only, no code changes. Dialog/
# AlertDialog -> shadow-modal, Select/HelpTooltip/AlertsDropdown ->
# shadow-surface, Sheet + mobile drawer -> shadow-modal, custom high-z
# sheets/OnboardingWalkthrough/FirstScanCelebration -> shadow-overlay — all
# already landed in Phase 10, re-checked against this phase's proposed
# 0-4 relabeling and found consistent (see README §35-D1). No "command
# palette" component exists in this app (grepped — only unrelated "Command
# Center"/"Command board" page names) — N/A, not a gap.

# §35-D2 — tabular-nums: real gap, one real fix. analytics.tsx's 4 stat
# numbers (utilization/financial-metric figures) had neither font-num nor
# tabular-nums; inventory-page.tsx already had tabular-nums in 5 spots,
# code-blue.tsx / ShiftProgressHero.tsx / EquipmentTriageList.tsx already
# use font-num (which already bakes in font-variant-numeric: tabular-nums
# via its own CSS class — no new CSS needed, just wider adoption).
_sed "text-2xl font-bold text-foreground\">" "text-2xl font-bold text-foreground font-num\">" src/pages/analytics.tsx

# §35-D3 — status chip revision: subtle border back (clinical/fluorescent
# lighting washes out a border-less tint chip), font-semibold not medium.
cp "$SRC/components/status-badge.tsx" src/components/ui/status-badge.tsx

# §35-D4 — Card criticality="maintenance" (blue-green rail, reuses the
# real --action/--action-soft tokens — see card.tsx's own header comment
# for the naming-collision flag against StatusKind's existing "maintenance").
cp "$SRC/components/card.tsx" src/components/ui/card.tsx

echo "Phase 16 (elevation audit + tabular-nums + chip border + maintenance criticality) applied."

# ── Phase 17 (§36) — Navigation motion timing ─────────────────────────────
# Real durations audited against the proposed spec (sheet 220ms, drawer
# 260ms, modal 180ms, page 240ms). Only touches TIMING (duration-N), never
# easing or the animate-in/out mechanism itself.
_sed "data-\[state=closed\]:duration-300 data-\[state=open\]:duration-500" \
     "data-[state=closed]:duration-220 data-[state=open]:duration-220" src/components/ui/sheet.tsx
_sed "shadow-modal duration-200" "shadow-modal duration-180" src/components/ui/dialog.tsx
_sed "shadow-modal duration-200" "shadow-modal duration-180" src/components/ui/alert-dialog.tsx
_sed "\"page-enter\": \"page-enter 0.22s ease-out both\"," "\"page-enter\": \"page-enter 0.24s ease-out both\"," tailwind.config.ts
_sed "transition-transform duration-220 ease-out will-change-transform" \
     "transition-transform duration-260 ease-out will-change-transform" src/components/layout.tsx

echo "Phase 17 (navigation motion timing) applied — sheet/modal/page/drawer durations aligned to spec. Operational/clinical motion (scan pulse, sterilization settle, critical breathing pulse) NOT built this phase — see README §36-D2."

# ── Phase 18 (§37) — Numeric typography, round 2 (broader grep) ──────────
# Found 3 more real numeric displays with neither font-num nor tabular-nums
# (equipment status counts, a room health-ring percentage). Currency
# (procurement.tsx) and several other %/duration spots were grepped but not
# fixed this pass — see README §37-D1 for the full found-vs-fixed list.
_sed "text-2xl font-bold text-emerald-700 dark:text-emerald-300 leading-none" \
     "text-2xl font-bold text-emerald-700 dark:text-emerald-300 leading-none font-num" src/pages/management-dashboard.tsx
_sed "text-2xl font-bold text-amber-700 dark:text-amber-300 leading-none" \
     "text-2xl font-bold text-amber-700 dark:text-amber-300 leading-none font-num" src/pages/management-dashboard.tsx
_sed "text-2xl font-bold text-red-700 dark:text-red-300 leading-none" \
     "text-2xl font-bold text-red-700 dark:text-red-300 leading-none font-num" src/pages/management-dashboard.tsx

echo "Phase 18 (numeric typography round 2) applied — 3 more real gaps fixed. See README §37-D1 for what was found but not fixed."

# ── Phase 19 (§38) — Resolve §34-D3: the alert-surface audit ─────────────
# CsvImportDialog was the clearest, most concrete of the 3 named surfaces —
# full read confirmed 2 real issues (hardcoded emerald/red instead of real
# status tokens; a full-border success banner). Full replacement: too many
# distinct spots for a safe sed diff.
cp "$SRC/components/csv-import-dialog.tsx" src/components/csv-import-dialog.tsx

echo "Phase 19 (CsvImportDialog retokenized + rail) applied. Form-validation messages audited, already fine (plain text, no box). Inline warning banner tokens exist but usage not located this phase. A MUCH larger hardcoded-color pattern was found across ~15 other files — NOT fixed, see README §38-D3."

# ── Phase 20 (§39) — §38-D3 (partial) + §38-D4 (resolved) ────────────────
# §39-D1: dark-mode overrides for the status bg/fg/border tokens — a real
# prerequisite (see status-dark-mode-tokens.css header) for retokenizing
# any call-site that currently hand-rolls its own dark: variant.
cat "$SRC/tokens/status-dark-mode-tokens.css" >> src/index.css

# §39-D2 — 3 of the ~13 flagged files, done completely (not a sample —
# every occurrence in each of these 3 files is fixed). The other ~10 are
# NOT touched this phase — see README §39-D3 for the full list + the exact
# recipe to finish them.
_sed "text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-300" \
     "text-[var(--status-ok-fg)] bg-[var(--status-ok-bg)] border border-[var(--status-ok-border)]" src/pages/rooms-list.tsx
_sed "text-red-700 bg-red-50 border border-red-200 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300" \
     "text-[var(--status-issue-fg)] bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)]" src/pages/rooms-list.tsx
_sed "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800" \
     "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] border-[var(--status-issue-border)]" src/pages/rooms-list.tsx
_sed "text-red-600 bg-red-50 dark:bg-red-950/50 border border-red-100 dark:border-red-800" \
     "text-[var(--status-issue-fg)] bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)]" src/pages/rooms-list.tsx
_sed "bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300" \
     "bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)] text-[var(--status-issue-fg)]" src/pages/rooms-list.tsx
_sed "bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" \
     "bg-[var(--status-ok-bg)] border border-[var(--status-ok-border)] text-[var(--status-ok-fg)]" src/pages/rooms-list.tsx

_sed "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30" \
     "border-[var(--status-issue-border)] bg-[var(--status-issue-bg)]" src/pages/home.tsx
_sed "activeCodeBlueId || criticalCount > 0 ? \"bg-red-500\" : \"bg-amber-500\"" \
     "activeCodeBlueId || criticalCount > 0 ? \"bg-[hsl(var(--status-issue))]\" : \"bg-[hsl(var(--status-maintenance))]\"" src/pages/home.tsx
_sed "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" \
     "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]" src/pages/home.tsx
_sed "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" \
     "bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)]" src/pages/home.tsx

_sed "border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-3 min-h-\[72px\]" \
     "border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] p-3 min-h-[72px]" src/pages/management-dashboard.tsx
_sed "border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 min-h-\[72px\]" \
     "border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-3 min-h-[72px]" src/pages/management-dashboard.tsx

echo "Phase 20 applied — dark-mode status tokens added; rooms-list.tsx + home.tsx fully retokenized; management-dashboard.tsx's 2 emerald/red boxes retokenized. ~10 files from the §38-D3 list remain — see README §39-D3."

# ── Phase 21 (§40) — 15-item visual-polish review ─────────────────────────
# Source: external design review, 15 numbered items (section headers,
# accent rails, metadata rows, card rhythm, stat cards, soft surface
# separation, tables, status dots, empty states, search inputs, context
# chips, ambient backgrounds, staff cards, room cards, clinical timeline).
# Several were already substantially shipped by Phases 10/14/15 (accent
# rails = criticality system, soft surfaces = shadow-less Card) — verified
# against real source and extended, not rebuilt. Full per-item reasoning
# in README §40. NOTE per user: the medication/dispense flow is not
# reflected here at all (frozen scope, §20-D3, unchanged) — see §40-D0,
# real source still shows it extensively wired up, flagged rather than
# silently trusted.

# New, standalone components (items 1 section headers, 3 metadata rows,
# 11 context chips, 13 staff cards, 15 clinical timeline).
cp "$SRC/components/section-header.tsx" src/components/ui/section-header.tsx
cp "$SRC/components/entity-meta-row.tsx" src/components/ui/entity-meta-row.tsx
cp "$SRC/components/context-chip.tsx" src/components/ui/context-chip.tsx
cp "$SRC/components/equipment-timeline.tsx" src/components/ui/equipment-timeline.tsx
cp "$SRC/components/staff-card.tsx" src/components/general/staff-card.tsx

# Revised existing components (2 rails, 4 card rhythm, 5 stat cards,
# 6 soft surfaces, 7 tables, 8 status dots, 14 room cards, 15 timeline).
cp "$SRC/components/card.tsx" src/components/ui/card.tsx
cp "$SRC/components/stat-tile.tsx" src/components/ui/stat-tile.tsx
cp "$SRC/components/status-badge.tsx" src/components/ui/status-badge.tsx
cp "$SRC/components/badge.tsx" src/components/ui/badge.tsx
cp "$SRC/components/room-readiness-card.tsx" src/components/equipment/room-readiness-card.tsx
cp "$SRC/components/audit-log-row.tsx" src/components/ui/audit-log-row.tsx
cp "$SRC/components/equipment-detail-activity-tab.tsx" src/components/equipment/EquipmentDetailActivityTab.tsx
cp "$SRC/components/equipment-detail-status-strip.tsx" src/components/equipment/EquipmentDetailStatusStrip.tsx

# One new token (item 6, inset highlight). Every other item reconciles onto
# Tailwind's own existing spacing/color scale rather than new tokens —
# see README §40-D4/§40-D5 for why.
cat "$SRC/tokens/phase21-card-tokens.css" >> src/index.css

# §40-D9 — Empty states (item 9): the real, shared EmptyState was ALSO
# carrying a bare shadow-sm on its dashed card (the same Card-shadow-
# override bug Phase 10/13 fixed elsewhere, missed here — a dashed "soft
# surface" card shouldn't fight an unwanted default shadow), and its action
# button's top margin (pt-1, 4px) fell well short of the review's 24px ask.
_sed "max-w-full min-w-0 border border-dashed border-border/70 bg-muted/5 shadow-sm" \
     "max-w-full min-w-0 border border-dashed border-border/70 bg-muted/5" src/components/ui/empty-state.tsx
_sed "{action && <div className=\"pt-1\">{action}</div>}" \
     "{action && <div className=\"pt-6\">{action}</div>}" src/components/ui/empty-state.tsx

# §40-D10 — Search inputs (item 10): the equipment list's real search
# field(s) only — NOT the shared Input component broadly, which would reach
# every form app-wide, a much bigger, unrequested change. Height 44->48px,
# radius 12px -> 14px (arbitrary value, Tailwind has no exact 14px step),
# focus ring 2px/ring-ring -> 4px/primary-tinted, per the review's spec.
# `className="ps-10"` matches BOTH the equipment-search and folder-search
# Inputs in this file (grepped — both are icon-padded search fields with
# the same className) — intentionally treated identically, not a guess.
# Icon's vertical offset recentered for the new 48px height; it was top-3
# (already ~2px off-true-center at the OLD 44px height too, a pre-existing
# imperfection this incidentally corrects, not something newly introduced).
_sed "absolute start-3.5 top-3 h-4 w-4 text-muted-foreground" \
     "absolute start-3.5 top-4 h-4 w-4 text-muted-foreground" src/pages/equipment-list.tsx
_sed "className=\"ps-10\"" \
     "className=\"ps-10 h-12 rounded-[14px] focus-visible:ring-4 focus-visible:ring-primary/10 focus-visible:ring-offset-0\"" src/pages/equipment-list.tsx

# §40-D3 — Top metadata row (item 3): wired into equipment-detail.tsx's
# title block using EntityMetaRow + three confirmed-real Equipment fields —
# equipment.location / .model / .serialNumber are all read verbatim already
# in equipment-list.tsx's own search predicate, confirmed real without
# guessing at the type file. Both edits keep everything on the ORIGINAL
# single line on purpose (JSX/import statements don't need their own line —
# a portable, POSIX-sed-safe way to "insert" without literal multi-line
# replacement text); a formatter pass can re-wrap it, nothing depends on
# the exact line shape.
_sed "import { Bdi } from \"@/components/ui/bdi\";" \
     "import { Bdi } from \"@/components/ui/bdi\"; import { EntityMetaRow } from \"@/components/ui/entity-meta-row\";" src/pages/equipment-detail.tsx
_sed "<h1 className=\"vt-page-title leading-tight\"><Bdi>{equipmentDisplayName}</Bdi></h1>" \
     "<EntityMetaRow segments={[equipment.location, equipment.model, equipment.serialNumber ? (\"Asset #\" + equipment.serialNumber) : null]} className=\"mb-1\" /><h1 className=\"vt-page-title leading-tight\"><Bdi>{equipmentDisplayName}</Bdi></h1>" src/pages/equipment-detail.tsx

# §40-D7 — Tables (item 7): the shared AuditLogRow component (above) gets
# hover/selected states, but audit-log.tsx the PAGE does NOT actually import
# it — it has its own local, same-named `AuditLogRow` function (confirmed
# by reading the page directly; flagged, not unified, see README §40-D7).
# Its hover state already existed (hover:bg-muted/50, a generic shadcn
# tint) — retargeted onto the real Phase 11 ivory-hover token the review
# explicitly asks tables to use.
_sed "hover:bg-muted/50 transition-colors" \
     "hover:bg-[rgb(var(--ivory-hover))] transition-colors" src/pages/audit-log.tsx

echo "Phase 21 (15-item visual polish review) applied — see README §40 for the full per-item breakdown, including what was already shipped, what's genuinely new, and what's flagged rather than guessed."

cat <<'EOF'

Copied. Still manual (can't be scripted safely — see README for exact detail):
  1. index.html — remove "Heebo:wght@400;500;600;700;" from the Google Fonts
     <link> and add <link rel="stylesheet" href="/fonts/heebo/fonts.css">.
  2. src/hooks/use-auth.tsx — export the AuthContext const (§22-D2), needed
     for preview/mock-app-providers.tsx to work.
  3. ios/App/App/Assets.xcassets/ — drop in icons/source/ as AppIcon.icon
     (Xcode 16+ reads Icon Composer bundles natively; don't flatten it).
  4. locales/en.json + he.json — add ONE new key, "locationConfidence":
     { "high": "...", "medium": "...", "low": "...", "unknown": "..." }.
     t.roles.* already has every key RoleBadge needs — nothing to add there.
EOF
