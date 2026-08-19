---
name: external-pms-integrations
description: Guides isolation of external veterinary PIMS vendors behind adapters, canonical contracts, and validated mapping into Drizzle tables with per-clinic sync controls and auditability. Use when adding or debugging lab/patient/medication sync (e.g. IDEXX, Covetrus), mapping external IDs to internal UUIDs, webhooks, integration jobs, or changes under server/integrations/.
---

# External PMS & integrations (VetTrack)

## Quick start

1. Read `server/integrations/index.ts`, `contracts/canonical.v1.ts`, and the active adapter under `server/integrations/adapters/`.
2. Confirm **no vendor-specific types or API URLs** leak into `server/services/` or `src/` core flows—only adapter + mapper layers.
3. Every persisted row must include **`clinicId`** and respect `vt_integration_configs` flags (`enabled`, sync toggles).
4. Validate types compile: `pnpm exec tsc --noEmit -p tsconfig.server-check.json`, then confirm no adapter imports a client alias: `grep -rn "from ['\"]@/" server/integrations`.

## Workflows

### A — New inbound sync (e.g. lab results)

- Define **vendor payload → canonical** in a mapper next to the adapter (see `mappers/vendor-x-to-canonical.ts`).
- Parse with **Zod** (or equivalent) at the boundary; reject or quarantine before `insert`/`update`.
- Map canonical shapes to **`server/db.ts`** columns explicitly—no blind spread of `metadataRaw` into PHI columns.
- Log sync and conflicts via existing integration repositories; use `logAudit()` for credential use and destructive merges.

### B — External ID ↔ internal UUID

- Store stable **external IDs** in integration-specific or canonical metadata; resolve through **clinic-scoped** queries only.
- On collision or mismatch, route through `integrationSyncConflicts` / conflict engine patterns—do not overwrite clinical facts silently.

### C — Security & ops

- Webhooks: signature verification (`server/integrations/webhooks/`); IP allowlists where applicable.
- Credentials: `credential-manager` + encrypted config—never keys in source.
- Vendor docs live outside the repo—link them in PR description, not in committed secrets.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm exec tsc --noEmit -p tsconfig.server-check.json` | Typecheck the server integration surface |

## Deep reference

- Schema source of truth: `server/db.ts` (`vt_integration_*`, patients, appointments, billing).
- Canonical examples: `server/integrations/contracts/`.
