# Design‑sync flags — VetTrack Web Console

Everything here is **out of scope for a design‑project edit** and must be resolved
in the `vettrack-ship` repo and brought back through `/design-sync`. Two lists:
**(A) open gaps** the sync must close, and **(B) code annotations** that were
identified during the round‑2 audit but were intentionally *not* baked into the
mock (they are architecture/schema decisions, not pixels).

The console deliverables were reviewed live; the audit's gating pixel/copy fixes
(M1r bidi numerals, C2 audit kinds → real union, C3 second vendor, C1 desktop
guard, C4 read‑only chip, C6 keyboard rows, C7/C9 copy, C11 empty tiles) are
**applied in the design project**. This file is only the residue that lives in code.

---

## A · Open gaps to close at `/design-sync`

### A1 — `DM Mono` has no `@font-face` (design‑system check, item 1)
- `--font-num` points at `'DM Mono'`; no font file exists in repo (`fonts/` = Heebo only) or project.
- **Action:** upload / self‑host a DM Mono TTF (or WOFF2) and add its `@font-face` to the font closure. **Do not** repoint the token to another family — the fallback mono stack renders until the file lands.
- Status: the console templates self‑load DM Mono via Google Fonts `<link>` and render true in Present; the synced bundle falls back to IBM Plex Mono. Recorded previously in `.design-sync/NOTES.md`.

### A2 — Tailwind `--tw-*` bundle noise (design‑system check, items 2 & 3)
- `_ds_bundle.css` line 1 is compiled Tailwind base: `*,:before,:after{--tw-translate-x:0; … }`. This produces the "206 custom properties under component selectors" + "231 unclassifiable tokens" the checker reports. They are Tailwind runtime vars, **not** design tokens.
- **Action (re‑sync build change, EDIT‑tier):** stop shipping the whole app's compiled Tailwind as the DS bundle. Add a content‑scoped build:
  ```jsonc
  // package.json
  "ds:css": "tailwindcss -c tailwind.config.ts -i src/index.css -o .design-sync/compiled.css --content 'src/components/**/*.{ts,tsx}','src/design-system-entry.ts','.design-sync/previews/**/*.tsx','.design-sync/preview-provider.tsx'"
  ```
  Update the NOTES.md re‑sync checklist to run `pnpm ds:css` instead of copying `dist/public/assets/index-*.css`. `--tw-*` can't reach zero while components use ring/shadow/transform utilities — the win is scoping + shrinkage, not elimination. Run the render‑verification pass after the first scoped build. No app build/gates touched.

### A3 — `--status-stale` token drift (audit P8 — OWNER DECISION, still open)
- Mock uses **purple** `rgb(175 82 222)` (#AF52DE) for stale custody, in donut + legend + rows + Analytics outcome mix + drawers, across all 10 templates and `VetTrack Console.html`.
- Code (`src/index.css:94`) defines `--status-stale: 35 100% 50%` = **sys‑orange**, aliasing maintenance. **A distinct stale token does not exist in code.**
- **Decision required, then sync one way:**
  - *Keep purple* → add to `src/index.css` light + dark: `--status-stale: 282 68% 60%`, `--status-stale-bg: rgb(175 82 222 / 0.12)`, `--status-stale-fg: #7d3ec9`, `--status-stale-border: rgb(175 82 222 / 0.28)`, plus the dark ramp; add the Tailwind alias.
  - *Revert* → change the mock back to orange and drop the purple triplet.
- Until decided, the mock and code **disagree** — see the Claude Code brief: bind to whatever ships, never hardcode purple.

### A4 — `console.*` i18n namespace + keyed relative‑time formatter
- All console copy in the mock is inline `L(en, he)` pairs (parity by construction). **No `console.*` keys exist** in `locales/he.json` / `en.json` (3,475 keys scanned), and there is no generic keyed relative‑time formatter.
- **Action at implementation:** add a `console.*` namespace + a keyed relative‑time formatter to **both** locale files. No Hebrew literals in `.ts/.tsx`.

### A5 — Icon rendering is a mock‑runtime artifact, not a code gap
- The DC templates inject SVG strings via an `innerHTML="{{ … }}"` attribute. The design‑component runtime (`support.js`) does not map that to React's `dangerouslySetInnerHTML`, so those icon slots render blank in the DC preview (nav, card headers, empty‑state tiles). This is a **preview‑environment limitation**, not something to reproduce in the app.
- **Action:** in the real app, render icons with the existing icon components (lucide‑react or the codebase's set). Do **not** copy the mock's innerHTML icon approach. (In the design project the empty‑state setup tiles were switched to numbered badges so they read cleanly regardless.)

---

## B · Code annotations identified but NOT applied to the mock

These were flagged in the audit as `ANNOTATION`‑tier — they describe schema /
architecture reality that the pixels can't encode. Carry them into the repo work.

### B1 (audit EG2) — "Readiness rules" is a governed net‑new entity
- The Equipment Governance module surfaces "readiness rules," but **no `vt_` table and no closed‑union audit kind exist** for rules (built over existing services only).
- **Flag:** shipping rules requires a schema migration + new closed‑union `AuditActionType` members via the documented closed‑union process. The mock's `rule.created` audit row was remapped to a real existing kind (`room_bulk_verified`) precisely because no rule kind exists yet.

### B2 (audit IW2) — Vendor / integration alignment
- Codebase has **no Provet adapter**. Real registry = `generic-pms`; stubs `Chameleon / Priza / SmartFlow`; flag‑gated `vendor-x` (`server/integrations/index.ts`, `adapters/vendor-stubs.ts:21‑56`). "Provet" is brief‑sanctioned fiction; the second lab vendor was genericized to a stub.
- **Flag:** bind integration cards to the **adapter registry**, not a hardcoded vendor name.
- Outbound webhook **delivery** (endpoints + delivery log) models a subsystem that **doesn't exist** — code webhooks are **inbound** (`server/integrations/webhooks/inbound.router.ts`). Treat the outbound UI as a future surface.

### B3 (audit C8) — DLQ / job ids are illustrative
- Ops Health DLQ ids (`notification.whatsapp_send`, `webhook.inventory_low`) are placeholders. Real queue/job names differ (BullMQ workers in `server/app/start-schedulers.ts`).
- **Flag:** bind to real job names.

### B4 (audit C2) — Audit targets are illustrative
- Action **kinds** in the mock now match the real closed `AuditActionType` union (`server/lib/audit.ts:5`); the category chips (create/update/delete/auth) are a **display grouping** over real kinds. But the **target/entity ids** in rows (`user:dan.cohen`, `purchaseOrder:PO-2207`, etc.) are illustrative — key real rows off real entities.

### B5 — Frozen surfaces & secrets doctrine (preserve, don't regress)
- Ops Health / Recent Activity / Audit observe **frozen telemetry** only — no requeue/drain/purge/transport/Code‑Blue controls; DLQ replay lives in the ops runbook. A persistent read‑only chip is now in both artifacts. Keep the CLAUDE.md frozen‑surfaces doctrine.
- Secrets are masked last‑4 + write‑only rotate ("previous key never redisplayed"), masked audit diffs, masked PII recipients. Preserve end‑to‑end.

### B6 — Entities/roles that ARE aligned (leave as‑is)
- Roles = exactly the 5 DB roles (`server/middleware/auth.ts:17`); alias/hierarchy roles correctly not surfaced. Entities (equipment / rooms / crash cart / inventory / RFID / users) match; no ER/patient/med surfaces. Status token triplets (ok/issue/maint/steril/unknown) are byte‑equal to `src/index.css` — **except** stale (see A3).
