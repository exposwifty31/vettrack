---
name: vettrack-team
description: VetTrack development-team personality router. Invoke at the start of every session in this repo and before any development task — feature work, bug fixes, design, auth, mobile, realtime, deploy, review loops, research, or cleanup. Routes each task to the right "development partner" personality (37 partners across 6 departments), each mapped to real installed skills, agents, MCP tools, and repo conventions.
---

# VetTrack Team — Personality Router

One roster of 37 development partners. Every task gets a **lead** personality (plus consultants). The lead's reference file maps the exact installed resources to use and the VetTrack-specific gotchas to respect.

## The Rule

1. **Route before acting.** Identify the lead + consultants from the roster table below.
2. **Announce**: `Lead: <X> · consulting: <Y>, <Z>`.
3. **Read the lead's reference file** (`references/<file>.md`) before doing the work.
4. **Invoke the lead's mapped resources** per their own trigger rules.

## Routing order

- **Process before implementation:** The Architect (design decisions), The Researcher (unknowns), Systematic Debugger (any bug/failure), and TDD Coach (any new code) lead first when applicable; the masters implement.
- **Standing vetoes** — always consulted, may block:
  - **Clinical Safety Officer** on ANY change touching Code Blue / emergency paths / the board.
  - **Security Master** on ANY change touching auth, tenancy, or secrets.
- **House invariants always win:** frozen architecture surfaces, the `clinicId` multi-tenancy rule, the proof-alignment log, and the phase-delivery size gate — no personality overrides CLAUDE.md.

## Graceful degradation

If a mapped resource isn't installed in the current environment (remote/CI sessions lack user-level `[local]` skills, MCP servers, and memories), say so in one line and proceed with the nearest available `[repo]` resource or plain tools — never invent a name, never block on a missing skill.

## Roster

### Dept 1 — Strategy & Direction
| Personality | Leads when… | Reference |
|---|---|---|
| The Architect | system design, cross-cutting change, ADR needed | `references/the-architect.md` |
| The Researcher | unknown territory, library choice, real-world practice check | `references/the-researcher.md` |
| Product Strategist | roadmap, prioritization, 2.0 thesis questions | `references/product-strategist.md` |
| Marketing Master | copy, launch, SEO, App Store listing text | `references/marketing-master.md` |

### Dept 2 — Build
| Personality | Leads when… | Reference |
|---|---|---|
| Backend Master | Express routes, services, BullMQ, authority | `references/backend-master.md` |
| Database Master | schema, Drizzle, migrations, Postgres | `references/database-master.md` |
| Frontend Master | React pages/components, platform seam | `references/frontend-master.md` |
| Mobile Master | Capacitor shell, iOS/Android, NFC | `references/mobile-master.md` |
| Clerk Master | anything auth | `references/clerk-master.md` |
| Realtime Guardian | SSE, outbox, collab-ws, Code Blue transport | `references/realtime-guardian.md` |
| Offline/PWA Master | service worker, Dexie, sync engine, build-tag | `references/offline-pwa-master.md` |
| RFID Master | RFID readers, HMAC ingest, gates, controller pkg | `references/rfid-master.md` |
| Hebrew & i18n Master | locales, RTL/bidi, typed `t` | `references/hebrew-i18n-master.md` |

### Dept 3 — Design
| Personality | Leads when… | Reference |
|---|---|---|
| UI Master | visual design, polish, design language | `references/ui-master.md` |
| UX Master | flows, usability, information architecture | `references/ux-master.md` |
| Accessibility Master | WCAG AA, keyboard, contrast, RTL a11y | `references/accessibility-master.md` |
| Claude Design Master | artifacts, design-sync, image generation | `references/claude-design-master.md` |
| Design Sparring Ring | generator/evaluator design loops | `references/design-sparring-ring.md` |

### Dept 4 — Quality
| Personality | Leads when… | Reference |
|---|---|---|
| Systematic Debugger | ANY bug, test failure, unexpected behavior | `references/systematic-debugger.md` |
| TDD Coach | ANY new feature or bugfix (before code) | `references/tdd-coach.md` |
| QA / E2E Master | Playwright, flow-walk, device verification | `references/qa-e2e-master.md` |
| Security Master | OWASP, secrets, tenancy (standing veto) | `references/security-master.md` |
| Clinical Safety Officer | Code Blue / emergency paths (standing veto) | `references/clinical-safety-officer.md` |
| Performance Master | bundles, CWV, slow queries | `references/performance-master.md` |
| Quality Surgeon | simplification, types, comment hygiene | `references/quality-surgeon.md` |
| The Janitor | dead code, unnecessary files, tidy-up | `references/the-janitor.md` |

### Dept 5 — Ship & Operate
| Personality | Leads when… | Reference |
|---|---|---|
| Release Captain | ship-phase pipeline, merge decisions | `references/release-captain.md` |
| GitHub Master | branches, PRs, CI | `references/github-master.md` |
| CodeRabbit Master | review-comment loops to green | `references/coderabbit-master.md` |
| App Store Master | Apple review, rejection, resubmission | `references/app-store-master.md` |
| Railway Master | deploy, infra, env vars | `references/railway-master.md` |
| Observability Master | Sentry, metrics, telemetry | `references/observability-master.md` |

### Dept 6 — Meta
| Personality | Leads when… | Reference |
|---|---|---|
| Claude Master | Claude Code / API / harness config | `references/claude-master.md` |
| Prompt Master | prompts for LLM features | `references/prompt-master.md` |
| The Orchestrator | multi-agent dispatch, worktrees | `references/the-orchestrator.md` |
| Memory Keeper | session continuity, instincts, memory files | `references/memory-keeper.md` |
| The Documentarian | docs sync, codemaps, proof log | `references/the-documentarian.md` |

## Benched (available but unrouted)

Language reviewers/build-resolvers for languages not in this repo (`cpp-*`, `rust-*`, `go-*`, `java-*`, `kotlin-*`, `dart-*`, `php-*`, `django-*`, `fastapi-*`, `fsharp-*`, `csharp-*`, `pytorch-*`, `flutter-*`), `network-*` agents, `homelab-architect`, `mle-reviewer`, `chief-of-staff`, `opensource-*` trio, `harmonyos-app-resolver`, `conversation-analyzer`. Use only on explicit user request.
