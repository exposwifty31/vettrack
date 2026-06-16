# VetTrack — Native ship audit workflow (Human + Agent)

**Purpose:** Split release gate into two roles with explicit handoffs.

**Tennis mode (default):** [native-ship-master-prompt.md](./native-ship-master-prompt.md) — you send one **Rally** per finding; agent fixes that scope only; you re-verify; repeat until archive rallies.

**Master prompt:** [native-ship-master-prompt.md](./native-ship-master-prompt.md)  
**Audits import file:** [vettrack-native-ship-audit.json](./vettrack-native-ship-audit.json)  
**Operator manual:** [native-mobile-implementation-manual.md](./native-mobile-implementation-manual.md)

---

## Role split

| Phase | Owner | What happens |
|-------|-------|----------------|
| **0 — Preflight** | Agent | `verify-resubmission.sh`, `tsc`, `validate:prod` — only when Dan asks |
| **1 — Tennis** | **Human → Agent → Human** | Dan audits one cell in Safari/Chrome, sends a prompt with the finding; agent fixes that scope only; Dan re-verifies on device; repeat |
| **2 — Commit** | Agent | When Dan says commit |
| **3 — Railway** | Agent | When Dan says deploy |
| **4 — Rebuild** | Agent | `build-native-shell.sh` + sim smoke when Dan says rebuild |
| **5 — Archive** | Agent (+ Dan in Xcode) | When Dan says archive / submit |

**Phase 1 is the whole audit loop** — no bulk handoff. Dan's prompt carries route, device, evidence, and expected PASS. Agent does not fix other checklist rows in the same turn.

Full wording: [native-ship-master-prompt.md](./native-ship-master-prompt.md) § Phase 1.

---

## Phase 1 — Tennis (human audit + agent fix per message)

### Tools

| Surface | Tool |
|---------|------|
| Capacitor Simulator (submit gate) | Safari → Develop → Simulator → VetTrack |
| Physical device | Safari → Develop → *[iPhone]* → VetTrack |
| Supplementary | Chrome DevTools on `vettrack.uk` — not a substitute for bundled shell |

### Human setup (once)

```bash
cd /Users/dan/vettrack
./scripts/build-native-shell.sh
./scripts/install-ios-sim.sh --skip-build
```

Sign in `reviewer@vettrack.uk`. Confirm `location.origin` === `capacitor://localhost`.

### Each rally

1. **Human** picks one checklist cell; checks four layers (functional, clinical UX, polish, WCAG via Audits import `vettrack-native-ship-audit.json`).
2. **Human** sends a prompt describing that one finding (or PASS, or re-verify result).
3. **Agent** fixes only that scope → `tsc` → updates checklist Notes → tells human how to re-test.
4. **Human** re-audits on device → next prompt.

Tier burn-down: 1 → 2 → 3 → 4 → 5. iPhone landscape = portrait-letterbox only.

When all blocking cells are PASS, Dan says **rebuild** / **commit** / **archive** (Phases 2–5 in [native-ship-master-prompt.md](./native-ship-master-prompt.md)).

---

## DevTools quick reference

**Safari (simulator):** Console — no uncaught errors. Network — API 2xx from `vettrack.uk`. Audits — import `vettrack-native-ship-audit.json`. Elements — `#clerk-auth-form-root` `dir="ltr"` on sign-in.

**Chrome (`vettrack.uk`):** supplementary only; submit gate is bundled shell.

---

## Related docs

| Doc | Use |
|-----|-----|
| [native-ship-master-prompt.md](./native-ship-master-prompt.md) | Full session prompt (Phase 1 tennis + Phases 2–5) |
| [native-ship-checklist.md](./native-ship-checklist.md) | Matrix to fill |
| [nfc-ship-checklist.md](./nfc-ship-checklist.md) | Physical device NFC rows |
| [RESUBMISSION_RUNBOOK.md](../../RESUBMISSION_RUNBOOK.md) | Clerk + pre-archive curls |

**Last aligned:** 2026-06-16 · tennis Phase 1.
