## Summary

<!-- What changed and why (1–3 sentences). -->

## ADR (architecture)

<!-- Required when any [ADR trigger](docs/architecture/adr/TRIGGERS.md) applies. -->

- [ ] **No ADR trigger** applies to this PR (bugfix, copy, tests-only, docs without architecture change, etc.)
- [ ] **ADR linked** (required if any trigger applies): `ADR-___` — `docs/architecture/adr/___-___.md` (or legacy `docs/architecture/adr-*.md`)  
      Status: proposed | accepted

Triggers include: new domain boundaries, cross-domain DB access, new/changed BullMQ queues or job payloads, realtime/outbox SSE types, offline sync semantics, tenancy model, repository convention breaks, new integration vendors, pilot route surface, breaking `shared/` contracts.  
Full list: [docs/architecture/adr/TRIGGERS.md](docs/architecture/adr/TRIGGERS.md)

## Testing

- [ ] `pnpm architecture:gates` (if `server/` or `src/` changed)
- [ ] `npx tsc --noEmit`
- [ ] `pnpm test` (or note why not run)

## Checklist

- [ ] No unintended behavior change (or ADR documents intentional change)
- [ ] Tenant scope preserved (`clinicId` on tenant data paths) if touching `server/`
- [ ] Locales `en` + `he` parity if user-facing copy added
