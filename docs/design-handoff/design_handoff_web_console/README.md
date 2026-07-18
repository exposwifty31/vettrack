# Handoff → Claude Code: VetTrack Web Management Console

> **Read this whole brief before writing any code, and open `DESIGN_SYNC_FLAGS.md`
> (next to this file) — it is part of the handoff.** When you've read both, reply
> with a short acknowledgement of the drift list in §4 *in your own words* so we
> know you're building against the live codebase, not against the mock's values.

---

## 1 · What you're building

The **VetTrack Web Management Console** — a **desktop‑only** (`≥ 1024px`),
**Hebrew‑RTL‑first** admin surface for a veterinary equipment‑tracking product.
Ten modules, two personas, four states each:

- **Modules:** Management Home · People & Roles · Equipment Governance · Inventory & Procurement · Integrations & Webhooks · Notifications · RFID Readers · Ops Health · Analytics & Reports · Audit.
- **Personas:** `admin` (full) and `lead` (read‑only view‑mode — no mutation CTAs, drawers downgrade to static summaries with a lock note, never greyed‑out controls).
- **States:** default · empty/first‑run · loading · error.
- **Locales:** Hebrew (RTL, primary/default) and English (LTR).

## 2 · What the design files ARE (and are NOT)

The files in this project are **design references built in HTML** — prototypes of
the intended look and behavior. They are **something to work *with*, not to work
*through***. Your job is to **recreate them in the live `vettrack-ship` codebase**
using its real React components, design tokens, i18n, icon set, and data — **not**
to port the HTML/DC markup or lift the mock's literal values.

Fidelity: **hi‑fi** (final layout, type, spacing, interactions). Recreate the UI
faithfully, but always through the codebase's existing primitives.

Two artifact shapes are provided in this design project:
- `VetTrack Console.html` + `console/{data.js,ui.jsx,modules.jsx,modules2.jsx}` — one integrated, navigable React prototype (working nav, personas, drawers). **This is the best single reference for flows and drawer depth.**
- `templates/console-*/*.dc.html` — ten per‑module harnesses with Persona · State · Locale · Width toggles. **Best for seeing each module's four states and the 1024/1440/1920 reflow.**

## 3 · The plan (reminder)

Build the console against the live app. Non‑negotiables that the mock encodes and
you must honor:
1. **RTL‑Hebrew‑first** — logical properties only (`margin/padding/inset-inline`, `border-inline`); sidebar/drawer anchor to inline‑start/‑end and flip with `dir`; directional chevrons mirror, functional glyphs (status dots, lock, search) do not; numerals stay LTR/tabular.
2. **i18n‑keyed copy** — every string keyed, he + en; **no Hebrew literals in `.ts/.tsx`** (see flag A4: add the `console.*` namespace + a keyed relative‑time formatter to both locale files).
3. **`≥ 1024px` desktop‑only** — guard below the floor.
4. **Personas** — lead is read‑only *everywhere*, verified inside drawers.
5. **Frozen surfaces read‑only** — Ops Health / Recent Activity / Audit observe telemetry; no requeue/drain/purge/transport/Code‑Blue controls; DLQ replay lives in the ops runbook. Persistent read‑only chip.
6. **Secrets** — masked last‑4, write‑only rotate ("previous key never redisplayed"), masked audit diffs, masked PII recipients.
7. **Real entities only** — equipment / rooms / crash cart / inventory / RFID / users. No ER/patient/med surfaces.
8. **≤ 7 Home tiles.**

*If you want the full original plan again, ask — the owner is happy to resend it.*

## 4 · ⚠️ Drift: where the mock ≠ the live codebase (acknowledge this)

**The single most important instruction:** some values in the mock do **not**
reflect the actual design tokens / schema in `vettrack-ship`. Where they differ,
**the codebase is the source of truth — bind to it, do not hardcode the mock's
value.** This holds **until `/design-sync` has synced the real design into the
codebase**; only then do the mock and code agree and you can trust the mock's
tokens directly. Full detail is in `DESIGN_SYNC_FLAGS.md`; the headline drifts:

- **`--status-stale` color (OPEN owner decision, flag A3).** Mock uses **purple** `#AF52DE` for stale custody; code's `--status-stale` is **orange** (aliases maintenance). **Do not hardcode purple.** Bind to whatever `--status-stale` ships; if the purple decision lands, it arrives as a real token via sync.
- **Icons (flag A5).** The mock's icons are injected as SVG strings and render blank in the DC preview — a preview‑runtime limitation. Use the codebase's icon components (lucide‑react / existing set). Don't reproduce the innerHTML approach.
- **Audit action kinds (flag B4).** Kinds now map to the real closed `AuditActionType` union (`server/lib/audit.ts`); the create/update/delete/auth chips are a display grouping over real kinds. **Target/entity ids in the rows are illustrative** — key real rows off real entities.
- **"Readiness rules" (flag B1).** Governed **net‑new** entity — no `vt_` table, no audit kind exists yet. Needs schema + closed‑union audit kinds before it can ship; don't assume it's already modeled.
- **Integrations / vendors (flag B2).** No Provet adapter in code — real registry is `generic-pms` with stubs (Chameleon/Priza/SmartFlow) + flag‑gated `vendor-x`. Bind cards to the **adapter registry**, not a vendor name. Outbound webhook **delivery** has no server counterpart (code webhooks are inbound‑only) — treat as future surface.
- **DLQ / job ids (flag B3).** Illustrative — bind to real BullMQ job names (`server/app/start-schedulers.ts`).
- **`DM Mono` (flag A1)** isn't uploaded yet; **Tailwind `--tw-*` bundle noise (flag A2)** is a re‑sync build change. Neither blocks console UI work.

Aligned and safe to follow directly: the 5 DB roles, the entity model, and the
status token triplets (ok/issue/maint/steril/unknown) — all byte‑match code
**except** stale (A3).

## 5 · Files to reference (in this design project)

- `VetTrack Console.html`, `console/data.js`, `console/ui.jsx`, `console/modules.jsx`, `console/modules2.jsx`
- `templates/console-management-home/…` and the nine sibling `templates/console-*/…` per‑module harnesses
- `colors_and_type.css` (token + type system), `fonts/fonts.css` (Heebo variable font, self‑hosted)
- Oracle for truth: the `vettrack-ship` codebase (`src/index.css`, `server/lib/audit.ts`, `server/middleware/auth.ts`, `server/integrations/**`).

---

**Start by:** reading this brief + `DESIGN_SYNC_FLAGS.md`, opening `VetTrack Console.html`
and the per‑module harnesses, then confirming (in your words) the §4 drift list and
that you'll build against the live tokens/schema. Then implement module‑by‑module in
the live app, honoring the §3 non‑negotiables.
