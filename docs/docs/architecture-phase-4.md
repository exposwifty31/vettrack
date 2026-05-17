# Phase 4 Architecture Snapshot

> **Historical snapshot.** This document captures the Phase 4 architecture at the time it was written. Post-Phase-9 the realtime, Code Blue, and PWA surfaces have additional guarantees (SSE keepalive + reconcile, build-tag SW versioning, emergency endpoint cache bypass, offline emergency-mutation blocking) and the enforcement framework is wired with the `off | shadow | enforce` envelope. See `README.md` and `CLAUDE.md` for the current architecture.

## Core systems
- Task Engine
- Notification Engine
- Automation Engine
- Intelligence Layer
- Realtime Layer
- Reliability Layer

## Guarantees
- Idempotent side-effects
- At-least-once delivery (queue)
- No duplicate user notifications
- Deterministic recommendations
- Tenant isolation (clinicId)

## Failure handling
- Circuit breakers (push, redis, queue)
- DLQ for final failures
- Retry with backoff

## Limits
- Intelligence MAX_SCAN = 100
- SSE max clients per clinic
- Rate limits per user/clinic

## Metrics
- tasks / automation / notifications / queue / intelligence / realtime

## Known tradeoffs
- In-memory metrics (not persisted)
- SSE instead of WebSockets
- Redis optional fallback paths