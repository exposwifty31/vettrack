// Workflow-tool script (.claude/workflows convention): the runner wraps this
// whole body in an async entry function and injects `args`, `agent`,
// `parallel`, `pipeline`, `log`, `phase` as globals — top-level `await`,
// top-level `return`, and bare `args` reads are the format, not accidents.
// Do NOT wrap the body in a function: the runner already does, and an inner
// wrapper would hide the script's returns from it.
/* global args, agent, parallel, pipeline, log, phase */
export const meta = {
  name: 'react-skills-audit',
  description: 'Audit RN-migration work (completed / in-progress / planned) for five-React-skills compliance; verify violations adversarially',
  whenToUse: 'Re-run at any migration checkpoint, after a batch of slice PRs, or on owner request (/audit of skills compliance)',
  phases: [
    { title: 'Collect', detail: '3 read-only scouts: merged PRs, open work, planned work' },
    { title: 'Judge', detail: 'per-item compliance table' },
    { title: 'Verify', detail: 'adversarial re-check of every violation + spot-check of compliant items' },
  ],
}

// ── The standing rule this workflow enforces (owner directive 2026-08-07) ──
// The five React skills (global library ~/.claude/skills/) are MANDATORY on
// every applicable task until the RN migration is complete:
//   1. react-native-best-practices  — perf: FPS/TTI/re-renders/animations
//   2. react-native-architecture    — Expo, navigation, native modules, offline sync
//   3. react-native-design          — styling, navigation, Reanimated
//   4. upgrading-react-native       — version upgrades only
//   5. argent-react-native-app-workflow — sim/emulator dev+debug loops
// Applicability: UI/screen/component work → 1+2+3 · infra/fetch-only → 1+2 ·
// upgrades → 4 · sim/emulator debugging → 5. Evidence of compliance = a
// "Skills compliance" section in the PR body (skills loaded + what changed,
// or a reasoned no-change per skill), and/or Skill-tool invocations in the
// session transcript.
//
// args (all optional):
//   { rnRepo?: string, planPaths?: string[], mergedPrLimit?: number,
//     transcripts?: string[] }  // absolute JSONL paths of session transcripts to scan

const RN_REPO = (args && args.rnRepo) || '/Users/dan/VetTrack-RN-Migration'
const PLAN_PATHS = (args && args.planPaths) || [`${RN_REPO}/docs/G3-PLAN.md`, `${RN_REPO}/DESIGN-LANGUAGE.md`, `${RN_REPO}/README.md`]
const PR_LIMIT = (args && args.mergedPrLimit) || 12
const TRANSCRIPTS = (args && args.transcripts) || []

const RULE = `THE STANDING RULE (owner, 2026-08-07): five React skills mandatory on every applicable task until migration complete:
react-native-best-practices (perf), react-native-architecture (arch/offline/nav), react-native-design (styling/Reanimated), upgrading-react-native (upgrades only), argent-react-native-app-workflow (sim/emulator debugging only).
Applicability map: UI/screen/component → best-practices+architecture+design; infra/fetch/lib-only → best-practices+architecture; upgrade → upgrading-react-native; sim/emulator debug loop → argent-react-native-app-workflow; non-React work (server, docs, CI) → N/A.
Valid compliance evidence: a "Skills compliance" section in the PR body naming the loaded skills with what-changed-or-reasoned-no-change, OR documented Skill-tool invocations for the task.`

const ITEMS_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['scope', 'id', 'title', 'reactApplicable', 'applicableSkills', 'evidence'],
        properties: {
          scope: { enum: ['completed', 'in-progress', 'planned'] },
          id: { type: 'string', description: 'PR number, branch, plan-slice id, or doc anchor' },
          title: { type: 'string' },
          reactApplicable: { type: 'boolean' },
          applicableSkills: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string', description: 'What was actually found: compliance section text, skill invocations, or their absence — with file/PR references' },
        },
      },
    },
  },
}

const TABLE_SCHEMA = {
  type: 'object',
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['scope', 'id', 'title', 'verdict', 'applicableSkills', 'reason'],
        properties: {
          scope: { enum: ['completed', 'in-progress', 'planned'] },
          id: { type: 'string' },
          title: { type: 'string' },
          verdict: { enum: ['compliant', 'partial', 'violation', 'na'] },
          applicableSkills: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['upheld', 'correctedVerdict', 'reason'],
  properties: {
    upheld: { type: 'boolean' },
    correctedVerdict: { enum: ['compliant', 'partial', 'violation', 'na'] },
    reason: { type: 'string' },
  },
}

// ── Phase 1: Collect (3 parallel read-only scouts) ──
const transcriptNote = TRANSCRIPTS.length
  ? `Also scan these session transcripts for Skill-tool invocations (python one-liner over JSONL, match tool_use blocks with name "Skill"): ${TRANSCRIPTS.join(', ')}.`
  : 'No session transcripts provided — rely on PR bodies and repo evidence only.'

const scouts = await parallel([
  () => agent(
    `${RULE}\n\nRead-only scout — COMPLETED work. In ${RN_REPO}: list the last ${PR_LIMIT} MERGED PRs (gh pr list --state merged --limit ${PR_LIMIT} --json number,title,body,files). For each: decide if it was React-applicable (touched src/**/*.tsx|ts UI/hook/lib code vs docs/CI only), which skills applied per the map, and what compliance evidence exists (does the body contain a "Skills compliance" section? quote it or note its absence). ${transcriptNote} Return every PR as an item; use scope "completed".`,
    { label: 'scout:completed', phase: 'Collect', schema: ITEMS_SCHEMA },
  ),
  () => agent(
    `${RULE}\n\nRead-only scout — IN-PROGRESS work. In ${RN_REPO}: list OPEN PRs (gh pr list --state open --json number,title,body,files), un-PR'd branches ahead of main (git branch -r --no-merged origin/main), and live worktrees (git worktree list). For each: React-applicability, applicable skills, and compliance evidence (PR body "Skills compliance" section present? quote or note absence). Use scope "in-progress".`,
    { label: 'scout:in-progress', phase: 'Collect', schema: ITEMS_SCHEMA },
  ),
  () => agent(
    `${RULE}\n\nRead-only scout — PLANNED work. Read these plan docs: ${PLAN_PATHS.join(', ')}. Extract every planned-but-unstarted task/slice. For each: React-applicability + applicable skills. Evidence question for planned work: does the plan itself MANDATE the skills for that task (e.g. a quality-bar clause requiring Skill-tool loading + a "Skills compliance" PR section)? Quote the mandating clause or note its absence. Use scope "planned".`,
    { label: 'scout:planned', phase: 'Collect', schema: ITEMS_SCHEMA },
  ),
])

const collected = scouts.filter(Boolean).flatMap((s) => s.items)
log(`collected ${collected.length} work items across 3 scopes`)
if (collected.length === 0) return { error: 'scouts returned zero items — check repo path/args', table: [] }

// ── Phase 2: Judge — one compliance table over ALL items (needs the full set: dedup + cross-scope consistency) ──
const judged = await agent(
  `${RULE}\n\nYou are the compliance judge. Here are all collected work items (JSON): ${JSON.stringify(collected)}\n\nProduce the compliance table. Verdict rules: "na" = not React-applicable; "compliant" = applicable AND evidence shows the applicable skills were loaded+applied (or plan mandates them, for planned scope); "partial" = some but not all applicable skills evidenced, or evidence is indirect; "violation" = applicable work with no compliance evidence. Deduplicate overlapping items (same PR appearing as branch+PR = one row, prefer the PR id). Be strict: absence of a "Skills compliance" section on applicable completed/in-progress work is a violation, not a partial.`,
  { label: 'judge', phase: 'Judge', schema: TABLE_SCHEMA },
)

// ── Phase 3: Verify — adversarially re-check every violation/partial + spot-check compliants ──
const toVerify = judged.rows.filter((r) => r.verdict === 'violation' || r.verdict === 'partial')
const compliantSpot = judged.rows.filter((r) => r.verdict === 'compliant').slice(0, 3)
log(`verifying ${toVerify.length} flagged rows + ${compliantSpot.length} compliant spot-checks`)

const verifications = await parallel(
  [...toVerify, ...compliantSpot].map((row) => () =>
    agent(
      `${RULE}\n\nAdversarial verifier. Claimed verdict for this item: ${JSON.stringify(row)}\n\nTry to REFUTE the verdict against ground truth in ${RN_REPO}: read the actual PR body (gh pr view <n> --json body), the actual plan text, the actual files. A "Skills compliance" section that exists but is boilerplate (no per-skill reasoning) does NOT upgrade a violation to compliant. If the verdict is wrong, give the corrected one. Return upheld/correctedVerdict/reason with concrete quotes.`,
      { label: `verify:${row.id}`, phase: 'Verify', schema: VERDICT_SCHEMA },
    ).then((v) => ({ row, v })),
  ),
)

const finalRows = judged.rows.map((row) => {
  const checked = verifications.filter(Boolean).find((x) => x.row.id === row.id && x.row.scope === row.scope)
  if (checked && !checked.v.upheld) return { ...row, verdict: checked.v.correctedVerdict, reason: `${checked.v.reason} (corrected by verifier)` }
  return row
})

const violations = finalRows.filter((r) => r.verdict === 'violation')
const partials = finalRows.filter((r) => r.verdict === 'partial')
log(`final: ${violations.length} violations, ${partials.length} partial, ${finalRows.filter((r) => r.verdict === 'compliant').length} compliant, ${finalRows.filter((r) => r.verdict === 'na').length} n/a`)

return {
  rule: 'Five React skills mandatory on every applicable task until migration complete (owner 2026-08-07)',
  table: finalRows,
  violations,
  partials,
  remediation: violations.length + partials.length === 0
    ? 'Fully compliant — no action needed.'
    : 'For each violation: load the applicable skills now, re-verify the shipped code against them, and add/backfill the "Skills compliance" section (PR comment for merged PRs). For planned-scope violations: add the mandate clause to the plan doc.',
}
