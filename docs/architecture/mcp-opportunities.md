# VetTrack — MCP Opportunities Assessment

Model Context Protocol (MCP) enables LLM-powered tools to access resources and APIs in a structured way. This document evaluates where MCP could deliver measurable value in VetTrack's architecture.

---

## Current state

VetTrack does not currently expose or consume any MCP servers. AI integrations exist only via standard HTTPS API calls (future Anthropic SDK usage).

---

## High-value opportunities

### 1. VetTrack Equipment MCP server (HIGH value)

Expose VetTrack's equipment, scan, and alert data to Claude-based workflows for:
- Operational dashboards queried in natural language ("show me all critical equipment overdue in Ward 3")
- Auto-generating shift handover summaries
- Clinic champion support workflows

**Implementation sketch:**
```typescript
// MCP server exposing read-only resources
resources:
  - equipment/list        → GET /api/equipment?clinicId=...
  - equipment/{id}        → GET /api/equipment/:id
  - alerts/active         → GET /api/alerts?status=active
  - hospitalizations      → GET /api/hospitalizations?status=active
  - shifts/current        → GET /api/shifts/current
```

**Security requirements:**
- Clinic-scoped: every resource must pass `clinicId` from the session
- Read-only MCP surface (no mutations via MCP)
- Auth via Clerk JWT (same as existing API)

**Effort:** Medium. Requires an MCP server package + thin adapter over existing Express routes.

---

### 2. Medication formulary MCP resource (MEDIUM value)

Expose the formulary for AI-assisted dose checking and clinical decision support:
- "What is the formulary dose for meloxicam in a 4.2kg cat?"
- Cross-check against active prescriptions

**Security requirements:**
- No PHI in formulary resources (formulary is non-patient data)
- Rate-limited

---

### 3. Claude Code integration for VetTrack engineering (LOW value, HIGH ease)

A local MCP server for Claude Code sessions working in this repo:
- Auto-load route inventory, schema docs, and i18n keys
- Expose `docs/audit/routes.md`, `docs/audit/db.md` as MCP resources

**Effort:** Low. Can be a simple file-serving MCP over the docs/audit directory.

---

## Low-value / deferred

| Opportunity | Why deferred |
|-------------|-------------|
| Real-time SSE via MCP | SSE is already a frozen contract; MCP would be a parallel transport (violates doctrine) |
| Push notification MCP | Push is fire-and-forget; no structured resource |
| Code Blue MCP mutations | Emergency mutations must never go through an AI intermediary |
| Calendar / scheduling MCP | Not a current product surface |

---

## Recommendation

**Short term:** none — do not add MCP until a concrete use case (e.g. AI-powered shift handover) is validated with users.

**When to revisit:** when natural-language querying of equipment/patient data is a user need. The existing REST API provides a clean foundation; a thin MCP adapter over it would be low-risk.

**Never:** expose Code Blue, realtime, or emergency mutation paths via MCP. These require direct HTTP with full auth and are too safety-critical for an AI intermediary.
