# Native Migration Roadmap (Phase 10 close-out · serves I.2)

> **Purpose.** The North-Star destination is **three distinct apps** — a website (management console), a TV/big-screen app (the Command Center board), and a **full-native mobile/tablet app that is NOT a wrapped PWA** (program-plan I.2). This repo (`exposwifty31/vettrack`) is the production monolith (React web + Express + Capacitor shell). The native mobile implementation lives in the sibling repo **[`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop)** (Expo/React-Native app + `@vettrack/contracts` at `packages/contracts`, per `docs/MAINTENANCE_MODE.md`). This roadmap records **what the per-role-UX program deliberately made portable**, and a staged path (with cost/risk) for the downstream repo to consume it — not a greenfield rewrite.
>
> **Porting rule (from MAINTENANCE_MODE):** copy reference code from this repo into `literate-dollop`; do **not** delete the production Capacitor paths here until a future kill-switch decision. `@vettrack/contracts` is *consumed* here via a `github:` path dependency — authored there, parity-tested here.

## Why this program lowered the native cost

The expensive part of going native is **re-deriving product logic that's tangled into web UI**. This program de-tangled it up front. The following are already framework-free or cleanly seam-ed, so the RN app consumes them as spec rather than reverse-engineering screens:

| Portable asset | Where (this repo) | Why it ports cleanly |
|---|---|---|
| **Role→experience model** | `src/lib/roles/experience-model.ts` | Pure TS, **no React/DOM/wouter imports** (I.2 / IV.2-A). `archetype`, `homeSurface`, closed `Capability` union, `can()`, `filterAdminNav`/`filterCustodyNav`, `isCustodyOnly`, `deriveHeroState`. The RN app derives its per-role UX from the same contract. |
| **Capability contracts** | closed `Capability` string-union + `CAPABILITIES_BY_ARCHETYPE` | Bounded enum — the single source for "what a role can do." No scattered `role ===` checks to re-audit. |
| **Typed API surface** | `src/lib/api.ts` + `src/types/**` | Every server call is a typed function; the shapes move to `@vettrack/contracts` and both apps import them. |
| **Board runtime** | `src/features/command-board/**` (`CommandBoardScreen` single-owner) | Realtime transport (SSE cursor/replay), keepalive, gossip, snapshot dispatch already extracted from the page into one screen. The TV target is "this shell minus final packaging." |
| **Offline/emergency doctrine** | `src/lib/offline-emergency-block.ts`, `sync-engine.ts`, offline-first invariants | The rules (Code Blue never queues offline; bounded telemetry; server-confirmed session end) are documented + tested, so the RN app re-implements against a spec, not a guess. |
| **i18n contract** | `locales/{en,he}.json` + typed `t` + parity check | he-default + RTL is a data contract; the RN app reuses the locale files and the parity discipline. |

## Staged path (downstream: `literate-dollop`)

Each stage is independently valuable; stop at any point with a shippable result. Cost is rough engineer-weeks for the downstream agent, risk is the dominant unknown.

**Stage N0 — Contracts sync (cost: S · risk: low).** Author/refresh `@vettrack/contracts` from this repo's `experience-model.ts` + `src/types/**` + the bounded telemetry/audit unions. This repo already parity-tests the installed package, so drift is caught. *Gate:* parity tests green both sides.

**Stage N1 — Auth + shell parity (cost: M · risk: med).** RN app adopts Clerk-native auth + the dev-bypass role model; render the five archetypes' home surfaces from the experience model (not by porting screens). *Risk:* Clerk RN SDK vs web session semantics; the server stays the boundary (role from `vt_users.role`, never JWT claims) so the contract is stable. *Gate:* each archetype's home + nav matches the web contract (the same per-role sweep this program ran).

**Stage N2 — Custody core (cost: M · risk: low).** Scan → checkout/checkin equipment + inventory dispense/restock — the highest-value, most-contained flow (and the entire student scope). Consumes the typed equipment/inventory API + offline sync-engine rules. *Gate:* custody round-trip offline-then-sync.

**Stage N3 — Emergency + realtime (cost: L · risk: high).** Code Blue + SSE. This is the load-bearing, doctrine-heavy surface (no offline queueing, server-confirmed end, no polling recovery, bounded telemetry). Port the doctrine, not the transport verbatim. *Gate:* the Phase-9 realtime/PWA drill equivalents on device.

**Stage N4 — Board as TV target (cost: M · risk: med).** Package `/board` (already a standalone `BoardShell` kiosk with wake-lock + self-heal + display-token pairing) as the big-screen app. Phase 10 made `/board` the single canonical board, so there is one surface to package. *Gate:* pairing → live snapshot → revocation kick on a real display.

**Stage N5 — Console stays web (no native).** The management console is deliberately web-only (desktop-dense, `WebOnlyGuard`). Native "management" is out of scope; the RN app links to the web console.

## Risks & guardrails

- **Don't deepen PWA-in-shell coupling** (I.2 decision rule): when two implementations are equally valid, pick the one that moves toward three distinct apps.
- **Capacitor stays production** here until an explicit kill-switch — the RN app ships in parallel, not as a cutover, until App Review + field validation clear it.
- **Frozen surfaces** (SSE/outbox cursor, BroadcastChannel envelope, `__VT_BUILD_TAG__`, authority `off|shadow|enforce` + Strategy A, closed `AuditActionType`, bounded telemetry, `clinicId` on every query) are contracts the RN app must honor, not reinvent.
- **Patient-facing domains stay removed** (migrations 142–143, `docs/scope-change-2026.md`) until an owner-gated follow-on — do not re-introduce them in the native app.

## Source research

Phase R topic 5 + `docs/design/platform-strategy-research.md` (R.2/R.3) validated the "distinct native surfaces, not a wrapper" bar as the real App-Review-4.2 mitigation and iPad-as-distinct-composition (Apple HIG split views). This roadmap operationalizes that research against the real downstream consumer.
