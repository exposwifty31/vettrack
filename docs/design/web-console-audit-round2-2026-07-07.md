# VetTrack Web Console — Round-2 Audit (deliverable + code alignment)

> 📌 **Historical snapshot (2026-07-07).** One finding has since landed: **P8 / M3 `--status-stale`** — the mock/code stale-color disagreement was **resolved 2026-07-08** by shipping the distinct purple `--status-stale` in `src/index.css` (light `279 68% 60%` / dark `279 70% 70%` + `-bg/-fg/-border`). The "stale=orange / owner decision" claims below (§1 P8, the §125 summary, and §8 item 4) describe the pre-fix state — read them as of the audit date, not current.

**Date:** 2026-07-07 · **Auditor coordinates cited as** Module · Persona · State · Locale · Width.
**Artifacts audited:** (a) `VetTrack Console.html` — integrated interactive console (React, working nav/personas/drawers), driven live in Present mode; (b) ten `templates/console-*/​*.dc.html` — per-module harness templates (Persona · State · Locale · **Width** toggles), driven live + read as source from the project export; (c) `vettrack-ship` codebase as oracle.
**Method notes:** the deliverable is split: the four states + width presets live in the ten templates; the drawers/navigation depth lives in the integrated console. Both were exercised. Harness quirk confirmed again: template segmented toggles intermittently swallow mouse clicks — keyboard Enter always registers; the integrated console responds to mouse normally.

---

## 1 · Per-module findings

Legend: Type {EDIT|TWEAK|ANNOTATION} · Priority {Blocker|High|Medium|Low} · Status {Applied|Proposed}.

### Shell (both artifacts)

| # | Type | Pri | Status | Finding + ready-to-apply proposal |
|---|------|-----|--------|-----------------------------------|
| C1 | TWEAK | Medium | Proposed | **Desktop guard fires at 600px, spec says 1024.** `VetTrack Console.html` `<style>`: `@media (max-width:600px){#vt-app{display:none!important}#vt-guard{display:flex}}`. Between 601–1023 the console squeezes instead of guarding (seen live @940: no guard). **Patch:** `max-width:600px` → `max-width:1023px`. |
| C6 | EDIT | Medium | Proposed | **Keyboard can't activate rows.** Template rows are `role="button" tabindex="0"` with `onClick` but no key handler — Enter/Space did nothing on the focused VT-204 row (Home template · Lead · Default · HE @1440); in `Console.html` only sidebar nav has `onKeyDown` (1 occurrence; table rows have none). Drawers are mouse-only → WCAG 2.1.1. **Patch:** shared handler `onKeyDown: e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); onClick(); } }` on every `role="button"` row (support.js template runtime + `console/ui.jsx` row factory). |
| C12 | TWEAK | Low | Proposed | Template harness mouse-click swallowing persists (S6): persona/state pills needed repeat clicks; row clicks never registered via mouse in Present. Keyboard path works. Debounce/hit-target fix in `support.js` toggle wiring. |

### Module 1 — Management Home

| # | Type | Pri | Status | Finding + proposal |
|---|------|-----|--------|--------------------|
| M1r | EDIT | **Blocker** | Proposed (exact patch below) | **RTL numeral garble persists on two surfaces.** The strings were rewritten but are rendered inside `dir="ltr"` `font-num` spans, which lays the whole Hebrew sentence out LTR: empty-state progress renders **"מתוך 4 הושלמו 0"** (= "of 4 completed 0") — Home template · Lead & Admin · Empty · HE @1440 (zoom); inventory rows render **"בתהליך 1" / "ממתינות 3"** though authored correctly as `L('1 in progress','1 בתהליך')` (Home · Default · HE zoom; same in Console.html Home). English renders fine ("0 of 4 complete" — Lead·Empty·EN). **Patch P1:** change `dir="ltr"` → `dir="auto"` on: (1) `<span style="font:600 12px var(--font-num);color:var(--on-ink-strong)" dir="ltr">{{ emptyProgressLabel }}</span>` — present in **6 templates** (management-home, people-roles, equipment-governance, inventory-procurement, integrations-webhooks, notifications); (2) the `{{ invRow1Val }}` / `{{ invRow2Val }}` spans (ConsoleManagementHome.dc.html); (3) the equivalent `dir:'ltr'` value spans in `console/modules.jsx` (Home card) — and audit EG `dir="ltr">{{ *.name }}` + Analytics `dir="ltr">{{ *.label }}`: keep `dir="ltr"` **only** on pure-Latin/numeric tokens. `dir="auto"` picks RTL for Hebrew strings and LTR for English — correct in both locales. |
| C7 | TWEAK | Low | Proposed | "12 פריטי מלאי נמוך" row dot uses **stale-purple**; low stock isn't stale custody. Use maintenance-amber (or an inventory token). `exDefs` sev:'stale' → 'maint' for that row (ConsoleManagementHome.dc.html). |
| C9 | TWEAK | Low | Proposed | Copy mismatch: Home says "3 readiness rules overdue / 3 כללי מוכנות באיחור"; Equipment Governance shows **1** overdue rule spanning **3 asset types** (EG · Admin · Default · HE). Change Home title to "כלל מוכנות באיחור · 3 סוגי נכסים" or make 3 rules overdue in EG data. |
| C11 | TWEAK | Low | Proposed | Empty-state step cards still render blank lavender icon tiles (Lead·Empty·HE/EN @1440) although `stepDefs` define icons (`icon:IC.box`…) — the tile renders before the `this.ic()` output lands. Fix the icon slot render (template `sc-if` placeholder) or drop tiles. (Was M5.) |

**Done well (Home):** internal data consistency held through the redesign (168+18=186=87% of 214); needs-attention triage rail with module-tagged meta; distinct **purple stale** now in donut+legend+rows; Hebrew initials (מא/רל/דכ/סא/ית) under HE, Latin under EN; role-change copy avoids the arrow in Hebrew ("ד. כהן לתפקיד טכנאי"); localized relative times everywhere.

### Module 2 — People & Roles

| # | Type | Pri | Status | Finding |
|---|------|-----|--------|---------|
| PR1 | — | — | **Pass** | Role vocabulary = exactly the 5 DB roles (מנהל/וטרינר/טכנאי בכיר/טכנאי/סטודנט) — matches `server/middleware/auth.ts:17` `UserRole`; alias roles (`lead_technician`, `vet_tech`, hierarchy `ROLE_HIERARCHY` auth.ts:43–51: 40/30/25/22/20/20/10) correctly **not** surfaced (PR-D3). User drawer: Admin = role select + Save/Deactivate + "צפייה ביומן" cross-link (PR · Admin · Default · HE); Lead = read-only (persona flip verified on EG drawer; PR drawer shares the pattern). |
| PR2 | TWEAK | Low | Proposed | סטודנט role chip is purple = same hue as status-stale; role colors shouldn't reuse a status token. Swap to a neutral/indigo tint. |

### Module 3 — Equipment Governance

| # | Type | Pri | Status | Finding |
|---|------|-----|--------|---------|
| EG1 | — | — | **Pass (S3 exemplar)** | Rule drawer pair verified live: **Admin** — editable selects (חלון בדיקה 24h, תקופת חסד 2h) + "שמירת שינויים"/"השהיה" (EG · Admin · Default · HE @1440); **Lead** — same drawer, selects → static text, footer Close-only, lock note "עריכת כללי מוכנות דורשת מנהל…" (EG · Lead · Default · HE). The sharpest persona test passes. |
| EG2 | ANNOTATION | Medium | Proposed | "Readiness rules" is a governed **net-new** entity (EG-D4 admits built over existing services, but no `vt_` table or audit kind exists for rules). Annotate: shipping this requires schema + closed-union audit kinds via the documented process — see C2. |

### Module 4 — Inventory & Procurement

**Pass** — restock stepper drawer (מיקום→ספירה→בדיקה) with +/− counters and crash-cart items (מזרק/ערכת עירוי/גזה/אדרנלין/טובוס — real `vt_containers`/`vt_items` world) as Admin; identical drawer as Lead loses steppers + gains lock note "ספירה ושליחת חידוש דורשות מנהל…", footer Close-only; list loses "חידוש חדש" (IP · Admin/Lead · Default · HE @1440). Badges bind to state (M4 fixed). No findings beyond C6/M1r sweep.

### Module 5 — Integrations & Webhooks

| # | Type | Pri | Status | Finding |
|---|------|-----|--------|---------|
| C3 | EDIT | **High** | Proposed | **Second named vendor "MedVet Labs"** (hooks.medvet.io/results, "תוצאות מעבדה") violates IW-D4/brief ("Provet is the only named vendor") — IW · Lead & Admin · Default · HE @1440. **Patch:** rename card to a generic stub ("מעבדה · חיבור גנרי (stub)") or drop it. Code note: no lab integration exists server-side. |
| IW1 | — | — | **Pass (secrets)** | Masked last-4 everywhere ("•••• 3f9c" + מוסתר lock chip); credential drawer is **write-only**: stored key shown masked with "רק 4 התווים האחרונים", new-key paste field is empty, caption "כתיבה בלבד… המפתח הקודם לעולם אינו מוצג מחדש", footer "החלפת מפתח" (IW · Admin · Default · HE). Webhook secrets `whsec_•••• e81b` masked; per-endpoint החלפה admin-only; Lead sees "צפייה בתצורה" only. Non-negotiable #4 pass. |
| IW2 | ANNOTATION | Medium | Proposed | Vendor-name alignment: codebase has **no Provet adapter** — real registry = `generic-pms`, stubs `Chameleon/Priza/SmartFlow`, flag-gated `vendor-x` (`server/integrations/index.ts`, `adapters/vendor-stubs.ts:21-56`). Provet is brief-sanctioned fiction; annotate so implementers bind cards to the adapter registry, not a hardcoded vendor. Also: outbound webhook delivery (endpoints + delivery log) models a subsystem that doesn't exist yet — code webhooks are **inbound** (`server/integrations/webhooks/inbound.router.ts`). Annotate as future surface. |

### Module 6 — Notifications

| # | Type | Pri | Status | Finding |
|---|------|-----|--------|---------|
| C5 | EDIT | Medium | Proposed | §NT-D3 claims "retry is a mutation → admin-only", but the delivery log has **no retry control at all** and failed rows aren't clickable (NT · Admin · Default · HE, יומן מסירה tab). **Patch:** add per-failed-row "שליחה חוזרת" (admin persona only) or amend the §NT footer claim. |
| NT1 | — | — | **Pass** | Channel creds masked (•••• 3f21 / •••• 9b2a + מוסתר); recipients PII-masked ("+972 ••• ••• 4821", "device •••• a91c") per NT-D4; WhatsApp degraded state matches Home's "נכשל ×4"; הגדרה/שליחת בדיקה admin-side. Row hover tint visible (M6 evidence). |

### Module 7 — RFID Readers

**Pass** — fleet table with status-counts strip (5 מקוונים · 1 מוגבלים · 1 לא מקוונים), heartbeats in Hebrew relative time, firmware mono; degraded=amber, offline=red (RF-D2, matches Home's ICU-Dock offline · 12 ד'); device drawer: pairing, 288 לכידות היום, 99.8% זמינות · 30 ימים, admin footer הפעלה מחדש/שינוי שם/ביטול שיוך (RF · Admin · Default · HE @1440). No new findings beyond C6.

### Module 8 — Ops Health (frozen surface)

| # | Type | Pri | Status | Finding |
|---|------|-----|--------|---------|
| OH1 | — | — | **Pass (frozen)** | Observed-only verified: metrics are bounded aggregates (42 events/min, 180ms p95, 0.6% errors — no PII/IP/UA/raw timestamps); DLQ card is counts + attempts with footer **"לקריאה בלבד. הרצה מחדש מתבצעת ב-runbook התפעולי, לא בקונסולה."**; zero requeue/drain/purge/transport/Code-Blue controls for either persona; display-heartbeat tiles annotated as Phase-9 future console; CSS chart carries the recharts caption in-page (OH · Admin · Default · HE @1440). Matches CLAUDE.md frozen-surfaces doctrine. |
| C4 | TWEAK | Medium | Proposed | §OH-D2 claims a **persistent READ-ONLY chip + banner** — present in the template, but the integrated console's Ops Health page header has neither (OH · Admin · Default · HE). **Patch:** add the קריאה בלבד chip beside the page title in `console/modules2.jsx` Ops view. |
| C8 | ANNOTATION | Low | Proposed | DLQ item ids (`notification.whatsapp_send`, `webhook.inventory_low`) are illustrative — real queue/job names differ (BullMQ workers in `server/app/start-schedulers.ts`). Annotate "ids illustrative; bind to real job names". |

### Module 9 — Analytics & Reports

**Pass** — KPI strip with deltas, readiness trend, outcome mix reusing the **fixed 4-way palette incl. purple stale** (AN-D2 verified live), per-room utilization, shift leaderboard, saved reports; d7/d30/d90 presets; Export = read (both personas), תזמון דוח admin-only; recharts caption present (AN · Admin · Default · HE @1440; wide layout fine at 1920 via the 1180px rail). Only carry: M1r sweep for `dir="ltr">{{ *.label }}` and the M3 token decision (below).

### Module 10 — Audit

| # | Type | Pri | Status | Finding |
|---|------|-----|--------|---------|
| C2 | EDIT | **High** | Proposed | **Invented audit-action vocabulary.** Rows show `role.updated`, `webhook.secret_rotated`, `restock.session_opened`, `rule.created`, `auth.signed_in`, `assetType.deleted`, `reader.status_changed` (AU · Admin · Default · HE/EN @1440/1024/1920) — **none exists** in the closed `AuditActionType` union (`server/lib/audit.ts:5`); §AU-D2's "no new audit kinds invented" is refuted. **Patch (mapping):** role.updated → `user_role_changed`; auth.signed_in → `user_login`; webhook.secret_rotated → `integration_credentials_stored` (or `integration_config_updated`); restock.session_opened → the restock/PO kinds (`purchase_order_created` family); reader.status_changed → `equipment_rfid_observed_room_changed`; assetType.deleted → `equipment_deleted` (or annotate asset-type CRUD as needing new kinds); rule.created → no real kind — display existing kinds only, or note EG-rules will add kinds via the closed-union process. Keep the category chips (create/update/delete/auth) as a **display grouping** over real kinds. |
| AU1 | — | — | **Pass** | Append-only footer ("רשומות אינן נערכות או נמחקות"), read-only both personas, entry drawer shows masked-both-sides secret diff (`whsec_•̶•̶•̶•̶ → whsec_••••`) + "רשומה זו אינה ניתנת לשינוי", export = read action (AU · Admin · Default · HE). Timestamps keyed/localized (M2). |

---

## 2 · Design ↔ code alignment

| Drift | Mock coordinate | Source of truth |
|-------|-----------------|-----------------|
| **`--status-stale` value.** Mock uses purple `rgb(175 82 222)` (#AF52DE) + triplet bg/fg/border (all 10 templates `:root`; Console.html `:root`) | Home donut/legend; Analytics outcome mix | `src/index.css:94` `--status-stale: 35 100% 50%; /* sys-orange — stale custody */` (aliases maintenance!), triplet `:181-183`, dark ramp `:277,293-295`; `tailwind.config.ts:49` alias exists. **A distinct stale token does NOT exist in code — it must be ADDED** (proposal P8 below) or the design reverted. Owner decision. |
| Status tokens otherwise **match exactly** (ok/issue/maint/steril/unknown bg-fg-border values byte-equal) | all templates `:root` | `src/index.css:169-186` ✓ |
| Audit action kinds invented (C2) | AU module rows | `server/lib/audit.ts:5` closed union |
| Second vendor "MedVet Labs" (C3); "Provet" itself absent from code | IW module | `server/integrations/adapters/vendor-stubs.ts:21-56` (Chameleon/Priza/SmartFlow), `index.ts` registry |
| Outbound webhook delivery UI has no server counterpart (inbound-only) | IW Webhooks tab | `server/integrations/webhooks/inbound.router.ts` |
| Roles ✓ aligned | PR module | `server/middleware/auth.ts:17,43-51` |
| Entities ✓ aligned (equipment/rooms/crash cart/inventory/RFID/users; no ER/patient/med anywhere) | all modules | migrations 142–143 scope removal |
| i18n: mock uses inline `L(en,he)` pairs (parity by construction); **no `console.*` keys exist yet** in `locales/he.json`/`en.json` (3,475 keys scanned; no generic relative-time key either) | all copy | Build annotation: add a `console.*` namespace + keyed relative-time formatter to BOTH locale files at implementation time; no Hebrew literals in `.ts/.tsx`. |
| Frozen surfaces ✓ respected (see OH1) | OH, Home ops tile, AU | CLAUDE.md "Frozen architecture surfaces" |
| DM Mono: templates self-load via Google Fonts `<link>` (renders true in Present); synced bundle falls back to IBM Plex Mono | all templates `<helmet>` | `.design-sync/NOTES.md` §Fonts — resolution recorded (see §6) |

## 3 · Change log (edits applied)

| Target | Finding# | Before → after | Re-verified |
|--------|----------|----------------|-------------|
| `.design-sync/NOTES.md` (repo) — "Known design-system-check flags" item 1 | DM Mono repo-side item | Appended dated sub-bullet: fallback **accepted & recorded**; no DM Mono file exists in repo or project (`fonts/` = Heebo only) so the upload path is moot; console deliverables self-load DM Mono via Google Fonts | Re-read file; docs-only change, no build impact; `tsc` untouched |
| Design project files | — | **No edits applied.** Entered Edit mode on ConsoleManagementHome.dc.html to apply P1 (dir="auto" tweak); the editor is element-scoped (requires canvas selection of state-dependent nodes inside `sc-` templates) — not safely scriptable for attribute-level changes. **Discarded with zero changes**; P1 shipped as an exact patch instead. | Toolbar returned to non-edit state; template unchanged (re-screenshot) |

## 4 · Regression verification (prior findings)

| # | Verdict | Evidence |
|---|---------|----------|
| S1 1024 clipping | **Fixed** | Console.html fluid at exactly **1024×677** — sidebar labels intact, audit table fits, no overflow (AU · Admin · EN @1024). Templates: WIDTH presets 1024/1440/1920 added (`[data-frame][data-w]`); 1024 preset verified live — 2-col reflow, no clip (Home · Lead · Empty · HE @1024 preset). Residual: C1 guard threshold. |
| S2 1920 max-width | **Fixed** | Content rail caps ≈1180px centered at 1920 (AU · Admin · EN @1920; `[data-bento]{max-width:1180px}`). Annotation stands: tokenize the literal for the real build. |
| S3 drawers | **Fixed** | Exemplar pair live: EG rule drawer Admin-edit vs Lead-read-only (see EG1); plus People, Inventory stepper, Integrations rotate, RFID device, Audit diff drawers all opened live. Caveat: keyboard activation missing (C6); template-side drawers unopenable by mouse in this environment (C12/S6). |
| S4 Lead × Empty | **Fixed** | Reachable (keyboard); dedicated lead variant: "ההגדרה בתהליך"/"Setup in progress", cards show "ממתין למנהל/Awaiting an admin", **zero mutation CTAs** (Home template · Lead · Empty · HE + EN @1440). |
| S5 clinic context | **Fixed** | Sidebar clinic card: Admin "וטרינרית רמת-גן · החלפת מרפאה" (switcher), Lead "· המרפאה שלך" (no switch) — both artifacts, HE+EN. |
| S6 toggle reliability | **Partial** | Keyboard 100%; mouse still intermittently swallowed on template pills/rows (multiple repros); Console.html mouse fine. |
| S7 stage URL | **Fixed** | `app.vettrack.io/console` (all templates). |
| M1 bidi numerals | **Partial → Blocker remains** | Relative times + most composites fixed; empty-progress + inventory values still garbled by `dir="ltr"` wrappers — renders "מתוך 4 הושלמו 0" (Home · Empty · HE zoom). Patch P1 supplied. |
| M2 relative time | **Fixed** (design level) | "לפני 2 ד' / לפני שעה / לפני דקה / אתמול" across Home, EG docks, PR, NT, RFID, IW (HE @1440); EN mirrors. No real i18n key yet → build annotation. |
| M3 stale color | **Fixed in design / drift in code** | Purple stale in donut, legend, rows, Analytics mix (HE+EN). Code still defines stale=orange → P8 owner decision. |
| M4 badges bind to state | **Fixed** | Empty & Error: sidebar renders without 12/2 badges (Home template · Lead · Empty · HE; Lead · Error · EN). |
| M5 icon tiles | **Not-fixed** | Step-card tiles still blank lavender (Lead · Empty · HE/EN) though icons are defined in `stepDefs` → C11. |
| M6 hover | **Fixed** | `style-hover` treatments in all 10 templates (8–16 each; rows `background:var(--accent)`, buttons, nav) + live row tint seen (NT log · Admin · HE). |
| M7 skeleton geometry | **Partial (unverified)** | Loading state exists (`.skd` shimmer, reduced-motion guard ✓); card-geometry match not re-verified this round. |
| M8 RTL arrow | **Fixed** | Hebrew activity copy uses "לתפקיד" (no glyph); EN keeps "→" (Home · Default · HE/EN). |
| M9 initials | **Fixed** | Hebrew initials under HE, Latin under EN (Home team + activity). |
| M10 contrast | **Pass (source-verified)** | Small captions use `--muted-foreground: rgba(60,60,67,0.6)` ≈ 4.6:1 on white — AA for the sizes used; keep an axe pass on the built product. |
| M11 view-all routing | **Fixed** | Nav + needs-attention meta labels map to the 9 real module pages (all navigable in Console.html). |

## 5 · Compliance scorecard

| Rule | Verdict | Coordinate |
|------|---------|-----------|
| RTL-Hebrew-first | ⚠️ | Layout/mirroring/scrollbars/chevrons/steppers excellent (all modules HE); **M1r garble on empty-progress + inventory values** (Home · Empty/Default · HE) |
| i18n-keyed copy | ✅* | No hardcoded-English residue found live (M2 fixed); *build annotation: `console.*` keys + relative-time formatter must be added to both locale files |
| Frozen surfaces read-only | ✅ | OH counts-only + runbook note (OH · both personas); no Code-Blue/transport/requeue controls anywhere; C4 chip nit |
| Secrets masked / write-only | ✅ | IW creds last-4 + write-only rotate drawer (IW · Admin · HE); webhook `whsec_••••`; NT PII masks; AU diff masked both sides |
| ≥1024 desktop-only | ⚠️ | 1024 itself clean (fluid + presets); guard triggers at 600px not 1024 (C1, @940 live) |
| Existing DS tokens | ⚠️ | Status triplets byte-match `src/index.css` **except** invented purple `--status-stale` (P8 decision) |
| ≤7 Home tiles | ✅ | 7 tiles (Home · Default · HE/EN @1440) |
| Real entities only | ⚠️ | Clean everywhere except invented audit kinds (C2) + "MedVet Labs" vendor (C3) |
| Personas — lead read-only | ✅ | Verified inside drawers: EG rule, IP stepper, IW creds, PR user; list CTAs stripped; zero lead-visible mutations found live |

## 6 · Repo-side items

**DM Mono — RESOLVED (recorded).** No DM Mono file exists in the repo or the design project (`fonts/` = Heebo only), so the sidebar-upload path is moot. IBM Plex Mono fallback (slashed-zero) accepted for synced component previews; console deliverables self-load DM Mono via Google Fonts and render true in Present. Recorded in `.design-sync/NOTES.md` (change log §3). No token change.

**Tailwind `--tw-*` bundle — PROPOSAL (EDIT-tier, re-sync-time build change; not implemented).**
Goal: stop shipping the whole app's compiled Tailwind CSS as the DS bundle. Concrete plan:
1. Add npm script `"ds:css": "tailwindcss -c tailwind.config.ts -i src/index.css -o .design-sync/compiled.css --content 'src/components/**/*.{ts,tsx}','src/design-system-entry.ts','.design-sync/previews/**/*.tsx','.design-sync/preview-provider.tsx'"` — content-scoped so only utilities used by the 111 synced components are emitted; app-page utilities drop out.
2. Update NOTES.md re-sync checklist step 1 to run `pnpm ds:css` instead of copying `dist/public/assets/index-*.css`.
3. Expectation-setting: `--tw-*` vars cannot reach zero while components use ring/shadow/transform utilities (Tailwind emits them per-use); the win is scoping + major shrinkage, not elimination.
4. Safety: run the existing render-verification pass (103/110 clean baseline) after the first scoped build; any missing dynamic class shows up there. No app build/gates touched (`architecture:gates`, `tsc` unaffected — this file is consumed only by design-sync).
5. Timing: only at the next sanctioned `/design-sync` re-sync (it overwrites the live project's `_ds_bundle.css`/`styles.css`), i.e., after the design-project owner signs off. **Not applied now for exactly that reason.**

## 7 · Done well — preserve as inherited pattern

The persona system is now real depth, not chrome: the same drawer downgrades honestly for Lead (static fields, Close-only, lock note) across four different drawer types. Secrets discipline is exemplary end-to-end — masked last-4, write-only rotate with "never displayed again" copy, masked audit diffs, masked PII recipients. Frozen-surface literacy is built into the UI itself (DLQ card that tells you replay lives in the runbook; recharts captions inside the CSS charts; append-only footer on Audit). Cross-module data coherence (ICU-Dock offline 12m, WhatsApp ×4, low-stock 12, RS-1042 crash cart) makes the console feel like one system. The clinic card's persona nuance (switcher for admin, scope-label for lead) is exactly the multi-clinic shell pattern to keep. Width presets + fluid integrated console demonstrate the 1024 floor properly, and prefers-reduced-motion is handled.

## 8 · Verdict

**Needs-work — narrowly, and materially closer to Go than round 1.** Eight of ten prior findings verified Fixed with live coordinates. Gating items for Go:

1. **M1r (Blocker):** `dir="ltr"` wrappers garble Hebrew numeral strings on the empty-state progress (6 templates) and Home inventory values — the default locale renders inverted meaning. Patch P1 is a one-attribute change per span, supplied above.
2. **C2 (High):** Audit vocabulary must map to the real closed `AuditActionType` union — the §AU-D2 claim is currently false.
3. **C3 (High):** Remove/genericize "MedVet Labs" (Provet-only rule).
4. **P8 — ✅ RESOLVED 2026-07-08 (this audit snapshot predates the fix):** purple-stale was adopted and shipped in the pre-Phase-7 cleanup. `src/index.css` now carries a distinct purple `--status-stale` (light `279 68% 60%` / dark `279 70% 70%` + `-bg/-fg/-border`), ending the mock/code disagreement. *(Original open item, kept for the record: pick purple-stale or revert to the shipped orange — the mock and code disagreed at audit time.)*

With those four landed (plus the C1 guard threshold and C6 keyboard activation as fast follows), this is a Go.
