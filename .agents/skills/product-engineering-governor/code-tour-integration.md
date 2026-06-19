# Code Tour Integration

Use after **PHASE 1 — Repository Intelligence** when onboarding maintainers or presenting governance findings.

**REQUIRED SUB-SKILL:** `code-tour` (`.claude/skills/ecc/code-tour/SKILL.md`)

## When to create a tour

| Audience | Persona | File |
| --- | --- | --- |
| New engineer ramp-up | `new-joiner` | `.tours/governance-new-joiner-delivery.tour` |
| Architecture review | `architect` | `.tours/governance-architect-delivery.tour` |
| CI/CD friction walkthrough | `bug-fixer` | `.tours/governance-cicd-friction.tour` |

## Tour anchors

Pull anchors from `ARCHITECTURE_MAP.md` critical paths only:

1. App entry (`server/index.ts`, `src/main.tsx`)
2. Route registration (`server/app/routes.ts`, `src/app/routes.tsx`)
3. Auth boundary (`server/middleware/auth.ts`)
4. Primary CI workflow (`.github/workflows/`)
5. Deployment / release path (if present)

Verify every file path and line number before writing the `.tour` file.

## Narrative arc

1. Orientation — what ships value
2. Critical path — request → auth → domain → persistence
3. Delivery path — PR → CI → deploy
4. Governance gotcha — branch protection, frozen surfaces, tenancy
5. Next step — link to `PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md` P0 items

Do not modify source code when creating tours.
