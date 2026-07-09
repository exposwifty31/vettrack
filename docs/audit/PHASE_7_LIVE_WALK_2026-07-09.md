# Phase 7 Live Walk — vettrack.uk Management Console Audit

**Date:** 2026-07-09 · **Auditor:** Claude (browser automation, read-only) · **Session:** Dan Erez, role `admin`, clinic `org_3CPrzrlCdGh1yNNIrmRILv3qZob`
**Scope:** the 11 Phase 7 desktop-console modules, live on production. This walk serves as the desktop-web row of the FLOW_INVENTORY live-walk protocol (stamped `⏳ pending` since Phase 0; the file itself lives on the `claude/phase-0-baseline` branch, not main).

## Preconditions

All three passed: viewport 1710×929 (≥1024, WebOnlyGuard not triggered); authenticated admin (`/api/users/me` → `role: "admin"`); domain `vettrack.uk`; `<html dir="rtl" lang="he">`.

## Safety posture

No writes performed. Governance drawer opened and cancelled (never saved); People role drawer opened and closed via Escape (no role touched); no Code Blue surface touched; CSV export is client-side (no server mutation).

## Module verdicts

| # | Module | Verdict | Evidence (screenshot ID) |
|---|--------|---------|--------------------------|
| 1 | `/dashboard` Management Home | ✅ pass | KPI cards (62 תקלות / 0 בשימוש / 62 זמין) + 62-item critical-alert list; all API 200; 0 console errors. Alert sub-labels ("Never scanned", "Not seen in 24+ hours") are English on the Hebrew UI → issue M1. (ss_7940ljlm7) |
| 2 | `/ops/health` | ✅ pass | Read-only chip; 4 cards render real values — Outbox 0, publish lag "—", failed events 0, permanent failures 0 (no perpetual skeletons; "—" used for absent lag). DLQ = honest empty state. `outbox-health` + `outbox/dlq` → 200. Observe-only: no action buttons. (ss_3744hm50a) |
| 3 | `/admin/integrations` | ✅ pass | 4 adapters (Generic PMS + 3 stubs); Configured=לא; credential **names only** (`base_url, api_key`); read-only chip. Hardened check: `/api/integrations/configs` → `{"configs":[]}` — no secret material exists server-side to leak. (ss_0997xpv2a) |
| 4 | `/admin/webhooks` | ✅ pass (empty) | Read-only chip; honest empty state; `/api/admin/webhooks` → 200. No events in this clinic, so the 5-column contract and no-payload rule are unverifiable with live data — expected empty, not a bug. (ss_6442q2vo9) |
| 5 | `/admin/notifications` | ✅ pass | 1 push delivery; recipient masked `web.push.apple.com …AjfM`. **Masking is server-side** — API returns only `maskedTarget`, never the raw endpoint/token. No templates tab. Status renders raw English "active" → issue M1. (ss_09549n3nz) |
| 6 | `/admin/rfid-readers` | ✅ pass (empty) | Read-only chip; honest empty state ("פעימות וכיסוי קוראים"); API 200. No gateways observed in this clinic — column contract unverifiable, expected. (ss_2483nk1pl) |
| 7 | `/admin/governance` | ✅ pass | Stale window "24 שעות" + "משתמש בברירת מחדל"; per-type minimums honestly empty. Edit drawer: opens, number input pre-fills 24, Save (שמירה) rendered disabled, cancelled without saving. Enable-on-change transition not exercised (automation safety layer blocked typing into the production drawer) → gap U2. Drawer also auto-closed once during DOM inspection → issue L2. (ss_2250bf2hh, drawer ss_6683w5aiw) |
| 8 | `/admin/people` | ✅ pass | Roster: 2 users, both אדמין/פעיל. Row click opens עריכת חבר צוות drawer: role Select pre-selected אדמין, שמירת שינויים disabled, ביטול present; closed via Escape, roster unchanged. 5-role enumeration in the Select not captured (dropdown interaction blocked by automation safety layer) → gap U1. (ss_11179q3ct, drawer ss_8005zd4zd) |
| 9 | `/admin/audit-log` | ✅ pass | Read-only chip; Time·Action·Actor·Target; 50 rows/page. Pager verified end-to-end: Next → `audit-logs?page=2` (200) → page 3 (last, `hasMore:false` — probed via API) → **Next `disabled=true`, Previous enabled**. Labels are human-readable, not raw enums — but mixed English/Hebrew → issue M1. (ss_118356s2w, page 3 ss_889754m7u) |
| 10 | `/admin/inventory` | ✅ pass | Read-only chip; 3 tabs. **Lazy loading confirmed**: initial load fetches only `/api/procurement`; `restock/sessions` and `inventory-items/low-stock` fetched only on tab click (all 200). Restock = 5 real completed sessions; PO + Low stock = honest empty states ("Short" column unverifiable — no low-stock rows, expected). Arrow-key tab navigation works (roving focus + selection, RTL-aware, `aria-selected` toggles). Status badge "completed" in English → issue M1. GIF: `vettrack_inventory_tab_switching.gif`. (ss_6814ftg9o, ss_5262z6zf4) |
| 11 | `/analytics` | ✅ pass | New cards all present: מוכנות ציוד (0% ready, backlog 0, avg dwell "—"), תפוסה (כעת) with "בשימוש"/"בשימוש חוץ" — **no "Utilization" wording**, משימות בזמן (30 ימים) shows **"—" not 0%** with vs-prior-30d framing (no delta arrow — correct, no prior data), per-room table (לא משויך 60 / Internal Medicine 1 / ICU 1). CSV export verified: blob captured — title row, 6 KPI rows (absent KPI exports empty, not "0%"), blank line, per-room section; Hebrew + English room names intact; CRLF; BOM prepended in code. No "="-prefixed name exists live, so injection neutralization verified at code level: `src/lib/csv-export.ts` `escapeCell` prefixes `'` to `^[=+\-@\t\r]` then RFC-4180-quotes — the live CSV byte-structure matches this exact `toCsv` output. GIF: `vettrack_analytics_csv_export.gif`. (ss_67488t2f4) |

## Cross-cutting

- **Console/network:** zero uncaught console errors and zero 4xx/5xx across all 11 modules (every `/api/*` call 200).
- **Read-only chips:** present on all 7 observe-only admin modules; correctly absent on the two write surfaces (Governance, People). Dashboard and Analytics carry no chip — their only affordances (refresh/report/export) are read-only, acceptable.
- **RTL:** correct throughout — headers right-aligned, tables flow RTL, mixed LTR/RTL strings ("צבר Outbox", masked endpoint, `dd/MM/yyyy, HH:mm:ss` dates) render unbroken.
- **Load times:** every module interactive in ~1–3 s; no perpetual skeletons anywhere.
- **Non-admin (lead) view:** not testable — the clinic has only 2 users, both admin; the dev-role switcher is proven inert in Clerk builds. The "pending server enablement" lead state remains unverified live.

## Prioritized issues

**M1 · Medium · i18n — mixed-language dynamic labels on the Hebrew UI.** Recurring across 5 surfaces: audit-log action labels are mostly English ("Equipment location unknown", "Shift chat broadcast ack", "Account self deleted") interleaved with Hebrew ones (פתיחת החייאה נדחתה, סטטוס שונה, תיקייה נוצרה); status badges "active" (notifications) and "completed" (restock); dashboard alert sub-labels "Never scanned"/"Not seen in 24+ hours"; and the PWA install banner is entirely English ("Install VetTrack / Add to your home screen for faster access — works offline too. / Install / Not now"). Repro: open any listed page in the default locale. Real gap (inconsistent localization of enum→label maps), not an empty-state artifact. Note the source-side Hebrew ban means these need locale keys, not inline strings.

**M2 · Medium · layout — top-nav horizontal overflow occludes management nav items under the search box** (found post-walk from an owner screenshot, reproduced live at 1152px viewport). The header `<nav>` is `overflow-x-auto` with `scrollWidth 1559` vs `clientWidth 892`; the search input overlaps the strip instead of reserving space, so nav items scroll *underneath* it — measured on `/analytics`: active link rect 244–343 vs search rect 154–494 → `activeOccludedBySearch: true`. The active management tab can be fully invisible, with no affordance beyond the transient macOS overlay scrollbar; the active item is also not auto-scrolled into view on load. Visible (edge clipping) even at 1710px; flagrant at ≤~1400px — all widths WebOnlyGuard considers valid desktop (≥1024). Affects discoverability of exactly the Phase 7 modules (the management links sit at the overflow end in RTL). BiDi note: the "ייצוא CSV" button checked in the same pass is correct (dir rtl, leading icon on the visual right, standard bidi label order) — not a bug.

**L2 · Low · Governance edit drawer closed spontaneously** once while automation inspected the DOM (likely focus/blur-triggered dismiss). Repro uncertain — possibly an automation artifact; worth a manual check that the drawer doesn't dismiss on window blur, which would lose an admin's in-progress edit.

**L3 · Low · UX observation — readiness vs availability semantics.** Analytics shows 0% מוכן כעת while the dashboard shows 62 זמין. Consistent by design (evidence-based readiness with all 62 items "Never scanned" vs status-based availability), but an admin seeing both may read it as a contradiction. Consider a tooltip linking readiness to the governance stale-window.

**Expected empty states (not bugs):** webhooks event log, RFID readers, purchase orders, low stock, integration configs, DLQ table — all render honest "אין כאן עדיין כלום" states backed by 200-status empty API responses.

**Unverified (flagged, not failed):**
- U1: the People role Select's 5-option list (drawer verified; option enumeration blocked by the automation safety layer).
- U2: Governance Save enabling after value change (disabled-at-prefill verified; typing blocked by the same layer).
- U3: lead-role "pending server enablement" state (no non-admin account available).
- U4: webhook/RFID/low-stock column contracts against real rows (no data).

## FLOW_INVENTORY reconciliation

Nothing the merged code claims for Phase 7 was found missing or broken in the live UI. All 11 routes are reachable from the sidebar management section as registered; the CSV export behaves exactly as `src/lib/csv-export.ts` (Phase 7e) specifies; masking, lazy tabs, pager, and KPI-dash conventions all deliver as documented. This walk covers the **desktop-web** platform only; the mobile/board/native rows of the live-walk protocol remain pending.

## Verdict

**11/11 modules pass. Overall confidence: high** for rendering, console/network cleanliness, PII/secret hygiene, read-only posture, and the interactive flows exercised (pager, tabs, CSV, both drawers); moderate for the four unverified items above.

**Single highest-leverage fix:** M2 — stop the search box from overlapping the nav strip (reserve layout space, collapse the nav into an overflow menu below ~1650px, and scroll the active item into view). M1 (routing the audit-log action-label map and status-badge enums through the typed `t.*` accessor) is the runner-up polish fix, but M2 hides the console's own navigation at common desktop widths, which directly undermines the Phase 7 deliverable.

## Artifacts

- GIFs (browser Downloads): `vettrack_inventory_tab_switching.gif` (9 frames), `vettrack_analytics_csv_export.gif` (2 frames).
- Screenshot IDs are inline per module (session-scoped).
- Captured CSV payload and `/api/admin/notifications` masked response embedded above.
