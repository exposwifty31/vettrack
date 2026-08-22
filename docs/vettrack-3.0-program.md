# VetTrack 3.0 — Program Plan

> **Status:** Program plan, revision 4. Sits alongside `docs/vettrack-2.0-roadmap.md`, which remains
> the authority for the 2.0 tracker. **This document does not open until §4's entry gate clears** —
> 3.0 is not in flight, and nothing here re-sequences 2.0's remaining 12 tasks.
>
> **Revision 2** reclassified the moat from Cornered Resource to compounding Switching Costs (§3),
> made the thesis conditional on capture compliance (§2), locked a numeric G1 (§9), named M0 (§8),
> and split the research budget (§6).
>
> **Revision 3 closes three blockers.** (1) G1 as written measured *dispense-but-uninvoiced* —
> ordinary hospital billing leakage — while the thesis claims *administered-but-never-ordered*.
> It could pass without proving the category. **G1 is split into a thesis clause and a commercial
> clause** (§9). (2) The ≥70% compliance criterion had **no instrument** capable of running for two
> clinic-months; the automated proxy is now named and its **dependency on B1 is written into the
> gate** (§7 R1, §9). (3) The inverse-delta needs **two** streams, and G0 only guaranteed one — the
> Israeli lab clinic may run Priza, which has no API. **Both-streams-live is now a G1 precondition**
> and the lab/market split is stated as an operational consequence (§5).
>
> Also closed: the Helmer contradiction in §3, the missing land-grab work item (B5), the
> lab-number-is-not-the-market-moat conflation (§3, §5), bundled-billing gaming of the commercial
> clause (§9), the unnamed G3 producer (§9), and which corpus layer is the switching-cost asset (R6).
>
> **Revision 4 is a consistency pass, not a new theory.** Four fixes, no reopened decisions.
> (1) §9's "B1 shipped" precondition contradicted §5's manual-extract default — as written, G1
> could never run on the lab path, the only path where anyone can stand in the room. Precondition 2
> now reads **B1 feed *or* a labelled manual extract**. (2) The 70% compliance bar was computed as
> captures ÷ inbound orders — a ratio **structurally blind to unordered care**, which is M1's entire
> subject, and which can exceed 100%. **The calibrated formula is now written out** (§7 R1), with a
> selection-bias rule. (3) **"Care event" is now an allowlist** — RFID last-seen is telemetry, not
> care, and without the allowlist the 10% was gameable. (4) **B2 is split** into a measurement slice
> that runs *before* G1 and a product slice that opens *after* it; previously B2 was both the meter
> and the thing the meter unlocked.
>
> Two facts corrected against the codebase: "59 API route mounts" → **59 route files** under
> `server/routes/` (the mount count is 58 by `app.use(` in `server/app/routes.ts`); "~200 known
> violations" → **203 findings across 138 `file::table` keys**.

---

## 1. Context

VetTrack ships. It is live on the App Store, carries 189 migrations and 59 route files under
`server/routes/`, outbox+SSE realtime, offline Dexie, RFID ingest, Code Blue, and a four-platform
seam. What it does not have is a **defensible reason to exist that survives contact with a
well-resourced competitor**.

A 7 Powers audit (Helmer) run against the codebase and the program docs found **no fully-formed
Power**. Switching Costs are accumulating accidentally (per-clinic enforcement policy, append-only
audit) rather than by design. Network Effects are architecturally foreclosed (`clinicId` on every
query, no cross-tenant primitive, no RLS).

Three empirical findings reframed the problem:

1. **The incumbents have no operational data model.** The complete public API surface of ezyVet
   (IDEXX) and Provet Cloud (Nordhealth) was enumerated. Across both: **zero** endpoints for
   equipment, asset, custody, shift, roster, room, kennel, crash-cart, or device. ezyVet's
   "inventory" is a billable product catalog; "staff" is a contact type. Their data model is
   patient/client/billing-shaped and *typed in afterwards*.

2. **VetTrack has no inbound clinical intent.** A repo-wide search for `clinical order`,
   `treatment sheet`, `order intent`, `physician order` returns **zero results**. Without an
   inbound order path VetTrack is an asset registry with excellent realtime — not an operational
   shell. This is the single largest gap between what VetTrack claims and what it is.

3. **A second, sharper strategy already exists in-house.** `exposwifty31/aethel-orchestrator`
   (spec-phase, zero code, pushed once 2026-07-26) contains the positioning VetTrack lacks: a named
   category (System of Execution), a named persona, an anchor PMS chosen on a stated criterion,
   falsifiable phase gates, RLS as the tenancy floor, and an honest moat scorecard.
   **VetTrack has the engine; Aethel has the steering.**

VetTrack 3.0 is the program that merges them and builds a moat that is real rather than asserted.

---

## 2. The thesis — and the condition it depends on

> **VetTrack is the only system in the hospital whose record is written by the physical world at
> the moment of the act — not typed in afterwards.**

**Category: System of Execution, witnessed.**

- PIMS = System of **Record** (client accounts, patient history, billing)
- Ambient AI scribes = System of **Engagement** (transcription into SOAP notes)
- VetTrack = System of **Execution**, *witnessed*: `vt_scan_logs`, `vt_dispense_events`,
  `vt_equipment_rfid_reads`, `vt_damage_events`, `vt_audit_logs` are written when the physical act
  happens, by the person doing it, from the floor.

Aethel's own REQ-003 states the ceiling of every PMS-fed system: *"It cannot see care that was
administered but never ordered or recorded in the PIMS... a query returns only rows that exist."*

### ⚠️ The thesis is conditional on capture compliance

**"Witnessed" assumes the physical stream is complete. Nothing in this program has established
that it is.**

R2 measures *administered-but-not-ordered*. It cannot see *administered-but-not-witnessed* — care
delivered without a scan, dispense event, or RFID read. If staff bypass the scan step for speed —
which this program *assumes* is common, from general knowledge of barcode systems in human
hospitals and **without a source in hand** (§13) — then the witnessed stream is a **sample, not a
record**, and the inverse-delta is partly a function of scan compliance rather than of care
delivery. The assumption is what R1 exists to measure; it is not evidence and may not be cited as
any.

**Binding condition.** R1 must report a measured capture-compliance rate alongside every finding,
and R2 must report the delta **and** the compliance rate together. If compliance is below the
threshold registered in §9:

- The category claim narrows from *"the record"* to *"the highest-fidelity available sample"*.
- R2's number is a **floor**, not a measurement, and every downstream use of it (pricing, pitch,
  ROI Ledger) must carry that label.
- Raising compliance becomes a Track B item ahead of everything except B1.

This is the cheapest place in the program to be wrong, and the most expensive place to be wrong
silently.

---

## 3. The organizing question — and what actually answers it

> **What stops a competitor with unlimited capital and the fastest execution on earth from
> building exactly this, faster and cheaper?**

Against an unlimited-resource fast executor, **six of the seven Powers collapse**: Scale is
outspent; Network Effects are subsidized into existence; Counter-Positioning does not apply to an
entrant with no legacy business; Switching Costs are *paid on the customer's behalf*; Branding they
have more of; Process Power they hire.

### The honest answer: nothing stops entry. Something stops capture.

**Revision 2 correction.** Revision 1 claimed the inverse-delta corpus was a **time-locked Cornered
Resource**. That was wrong, and the error matters. A competitor can install their own physical
capture in *different* clinics and accumulate an *equivalent* corpus in parallel. Nothing about the
corpus is exclusive at the market level.

The mechanism that actually holds is narrower and different in kind:

> **The corpus is not a market-wide barrier. It is a per-account switching cost that compounds with
> tenure.** A clinic three years into VetTrack holds a deeper operational record than the same
> clinic would three months into a competitor — and leaving forfeits it, because the record is not
> portable. The time-lock is the *consequence* of that non-portability, not the argument for it.

**This is Switching Costs, not Cornered Resource.** The reclassification has a real strategic
consequence:

- The barrier protects **accounts already held**. It does **not** prevent a competitor from winning
  new ones.
- Therefore **3.0 is a land-grab race, not a fortress**. Speed to install and time-to-first-value
  outrank feature depth. A clinic captured this year is worth more than a better product next year.
- The market-level constraint that helps is weak but real: the number of clinics willing to accept
  physical capture hardware is finite and grows slowly. First-mover matters *because* the pipeline
  is narrow, not because the corpus is exclusive.

### Resolving the Helmer contradiction (new in revision 3)

The paragraph above this one states that an unlimited-resource attacker **pays switching costs on
the customer's behalf**. The paragraph below it then names switching costs as the moat. Left
standing, that is a contradiction.

**The resolution:** money buys a *parallel install*. It cannot buy *three years of physical acts
that were never recorded anywhere else*. But this only holds under a condition that the program
must design for:

> **An unused log is a weak lock. History binds only if something depends on it.**

If the clinic's billing reconciliation, insurance claims, variance reporting, and controlled-
substance register all run off VetTrack's accumulated record, then leaving costs those functions —
and a competitor cannot pay that cost because they cannot supply the history the functions consume.
If the record merely accumulates in a table, leaving costs nothing and a switching bonus buys the
account.

**Design consequence, binding on B2 / 3.1 / 3.2:** the corpus must be **load-bearing in a live
workflow, not archived**. Any design where the history is a report rather than an input has built
the weak form of the lock.

### The lab number is not the market moat (new in revision 3)

R2 run in Israel produces a **sales instrument** — the number that makes the pitch and the pricing
defensible. It is not itself the moat.

**Switching costs start per install, and start at zero for every new account.** A UK Provet clinic
signed next year inherits nothing from the Israeli corpus; its own lock begins accruing on its own
install date. The Israeli corpus proves the claim to a prospect. It does not defend the prospect's
account.

### Asset register (initial — R5 maintains it)

| Asset | Power type | Survives an unlimited-resource attacker? |
|---|---|---|
| **Per-clinic longitudinal corpus** | **Switching Costs** (compounding with tenure) | ✅ For accounts held. ❌ For accounts not yet held. |
| **Chain-of-custody admissibility** | Cornered Resource (regulatory standing) | ✅ Time-locked — requires precedent, which requires elapsed cases. Years out. |
| **Physical installation** (RFID gates, tagged assets) | Switching Costs | 🟡 Permission-locked per building, weeks per site — **linear, does not compound across sites** |
| **PMS partner certification** | Cornered Resource (weak) | 🟡 Same queue for everyone; **administered by a party that may compete with you** |
| **Counter-Positioning vs. PIMS** | Counter-Positioning (candidate) | 🟡 See below — re-test at G3 |
| **Israeli clinic access** | — | 🔧 **The instrument, not the moat.** Input to row 1. |
| **Hebrew / RTL** | — | ❌ **Not a barrier. Translators are hireable.** |

### Counter-Positioning, restored on the correct test

Revision 1 dismissed CP because the incumbents are not responding. **That is the wrong test.**
Helmer asks whether *responding would damage them*, not whether they are responding — a small
player can hold CP against an incumbent that has not noticed it yet.

The candidate argument: a PIMS that adds witnessed physical capture is publicly conceding that its
record — the thing it sells — has always been typed in afterwards and is therefore incomplete.

**Caveat that keeps this honest:** the damage is **positional, not P&L**. Classic CP (Vanguard's
fee income, Blockbuster's late fees) involves a revenue stream that copying destroys. This one
involves a claim that copying undermines. That is a **weaker form** and should be scored as such.
Re-test at G3 once the corpus makes the concession concrete.

**The consequence that shapes the whole program:** the corpus only begins accruing **once real
usage begins**. The moat clock cannot start before the entry gate. The owner's gate and the moat
are the same thing.

---

## 4. Entry gate (owner-set, binding)

**VetTrack 3.0 does not open until all three are true:**

1. **2.0 complete — 18/18.** Owner decision: finish the tracker as written.
   `scripts/vettrack-2.0-scope-gate.sh` remains the authority; `CANONICAL_IDS` unchanged.
2. **Both store submissions in review** (Apple resubmission + first-time Google Play).
3. **The app is in real use** at ≥1 clinic, generating a live fact-stream.

### Bounded-rework rule (replaces revision 1's open-ended "budget for rework")

Finishing 18/18 first means four moat-bearing 2.0 tasks — **1.4** (consumable capture), **2.4**
(ROI Ledger), **3.1** (Immutable Ledger), **3.2** (controlled substance) — get built before real
usage data exists. Task 0.5's backtest is explicitly a **synthetic harness** ("never cite for real
thresholds"). Unbounded rework on these would push G0 out, which pushes the moat clock out.

**Rule:** for these four tasks only, ship the **minimum that satisfies the tracker box**, and
explicitly defer every **threshold-dependent** component into 3.0 — precision thresholds, price
points, retention policy, statutory report formats. Record each deferral in the task's plan file.

This converts unbounded rework into bounded deferral. **Decision rule:** if R2's findings would
require reworking more than ~30% of any of the four, that task is re-planned in 3.0 rather than
patched.

---

## 5. Market shape

**Israel is the laboratory. International is the market.**

- **Laboratory (Israel):** deep field research runs where it is physically possible to stand in the
  room — floor ethnography, time-and-motion, capture-compliance measurement, and the live
  fact-stream.
- **Market (international):** built to sell through **Provet Cloud** as anchor PMS, selected on
  webhook support rather than brand (Aethel ADR-0008).
- **Priza** moves from anchor to a parallel **BD track**. Zero public API footprint — no docs, no
  SDK, no code — making it purely a vendor relationship. That is what makes it a Cornered Resource
  if it lands, and why it cannot block engineering.
- **Hebrew/RTL** stays because it is the lab's language, **not** because it is a moat.

### ⚠️ The lab may not be able to run the measurement (new in revision 3)

**The inverse-delta is undefined with one stream.** It requires VetTrack captures **and** PMS order
or invoice lines from the same clinic over the same period. G0 guarantees only the first.

**The problem:** the Israeli lab clinic most likely runs **Priza**, which has **no public API** —
no docs, no SDK, no code. There is no automated way to obtain the second stream there. Stated
plainly: **the lab and the market may be different buildings**, and the building where you can
stand in the room may be the building where you cannot compute the number.

**Resolution options, in order of preference:**

1. **Manual PMS extract at the lab clinic.** For two clinic-months, export order and invoice lines
   by hand or by clinic-side report. Tedious, entirely feasible, needs no API, and is the only
   option that keeps measurement and physical access in the same building. **This is the default —
   plan for it rather than discovering it late.**
2. **An Israeli clinic on an API-bearing PMS.** Whether any exist in the target segment is
   unverified; add it to R3's backlog.
3. **Run R2 at a Provet clinic abroad.** Gives clean automated data, loses the physical access that
   R1's compliance measurement depends on — which would break the pairing §2 requires.
4. **A Priza adapter.** BD-blocked; cannot be scheduled.

**Consequence for the gate:** both streams live at the measurement clinics is now an explicit G1
precondition (§9). Where the second stream is a manual extract, that must be labelled in every
citation of the resulting number.

### ⚠️ Single-vendor concentration risk (new in revision 2)

The entire market thesis runs through one anchor. Revision 1 flagged the IDEXX conflict for ezyVet
and missed the equivalent for **Nordhealth**: Provet Cloud already ships a **native Digital
Whiteboard module** (Aethel's own landscape doc, `[established]`). Nordhealth is therefore already
in the adjacent space, not merely capable of entering it.

**R3 must verify, before B1 is considered designed:** partner-programme terms, API contract
stability guarantees, advance-notice or non-compete provisions on competing features, and
termination terms. A market thesis resting on a single vendor that competes in the same category
is a concentration risk that must be priced, not assumed away.

**Contingency:** Aethel ADR-0008's Digitail branch is entirely unverified. Verify it as a real
fallback, not a footnote.

---

## 6. Track structure

Four tracks. **Research is the majority by design** — a moat found by research is real; a moat
asserted without it is synthetic.

| Track | Share | Content |
|---|---|---|
| **R-moat** — moat-building research | **40%** | R1, R2, R5, R6 — findings no competitor holds |
| **R-entry** — cost-of-entry research | **15%** | R3, R4 — necessary, but **fails the Musk test by design** |
| **B — Build** | 35% | Only what R proves load-bearing |
| **P — Positioning** | 5% | Category, persona, pricing — derived from R2 |
| **M0 — Aethel port** | 5% | One-time meta-work, see §8 |

**Why the split matters.** Revision 1 reported a single "55% research" figure that mixed
moat-building with cost-of-entry work. R3 and R4 fail the Musk test *by this document's own
labelling* — they are entry cost and pitch defence. Reporting them inside the moat-research number
makes the moat investment look larger than it is. **The moat-building share is 40%.**

---

## 7. Track R — Research

### R-moat (40%)

#### R1 · Floor ethnography — *what actually happens between order and act*

Structured observation plus time-and-motion measurement in Israeli clinics. Trace the path from
"the vet ordered X" to "X happened": where intent fragments, what carries it (paper, whiteboard,
verbal, WhatsApp), where it is lost, what it costs.

**Mandatory second output — capture compliance.** For every observed care event, record whether it
produced a row in the physical stream. Report the rate. Document every bypass and its reason
(speed, gloves, station distance, device unavailable, emergency). This is the input to §2's binding
condition and it is not optional.
**Output:** intent-fragmentation map with measured latencies **+ a capture-compliance rate with
enumerated bypass modes.**
**Musk test:** ✅ requires invitation into the room.

##### ⚠️ The compliance instrument, named (new in revision 3)

Revision 2 required ≥70% compliance sustained across **two clinic-months** and named no instrument
capable of producing it. Nobody observes every care act for sixty days. Human observation cannot
supply that criterion, and a criterion with no instrument is not a criterion.

**Two layers, with different jobs:**

| Layer | Method | Timescale | Job |
|---|---|---|---|
| **Calibration** | R1 direct observation | Days | Establishes the true relationship between *acts that happened* and *rows that appeared*, including the bypass modes an automated proxy is blind to |
| **Ongoing proxy** | Orders-vs-captures, from B1's inbound feed **or** the §5 manual extract | Months | The only denominator available at clinic-month scale |

#### ⚠️ The raw proxy is structurally blind to the thesis — use the calibrated rate (revision 4)

The raw proxy is `captures ÷ inbound orders`. **Care with no order is invisible to that
denominator** — and unordered care is M1's entire subject. The raw ratio can therefore exceed 100%
and read as a pass while true compliance is failing.

**Worked example (illustrative, not clinic data):** 100 orders, 70 of them captured, plus 40
captured acts that were never ordered.
Raw proxy = 110 ÷ 100 = **110%** → reads as a pass.
If 80 unordered acts actually occurred and only 40 were captured, true compliance is
110 ÷ 180 = **61%** → G1a should fail.

**The calibrated formula. G1a's 70% bar is computed on this, never on the raw ratio:**

```text
r        = R1's observed ratio of unordered to ordered care acts   (in-room, days)
captures = all physical-stream care rows in the period             (allowlist per §7 R2 / M1)
orders   = inbound PMS orders in the period                        (B1 feed or §5 extract)

compliance_calibrated  =  captures ÷ ( orders × (1 + r) )
```

Against the worked example: r = 80/100 = 0.8 → 110 ÷ (100 × 1.8) = **61%**. The formula reproduces
the true rate; the raw proxy does not.

**Selection-bias rule (required).** R1 must report capture compliance **separately** for ordered
and unordered acts — call them `c_ord` and `c_unord`. If they differ, M1 computed from captured rows
is biased, because each group is captured at a different rate.

**Reconstruct both populations before taking the share.** Scaling the observed ratio by
`c_ord ÷ c_unord` does *not* correct it — that rescales the numerator without renormalising the
denominator, and it is wrong for almost every combination of the two rates:

```text
N_ord   = captured care events that matched an order
N_unord = captured care events that matched no order

M1 = (N_unord / c_unord) ÷ ( (N_unord / c_unord) + (N_ord / c_ord) )
```

*Worked check.* 100 ordered acts at `c_ord` 0.70 → 70 captured; 80 unordered acts at `c_unord` 0.50
→ 40 captured. True M1 = 80/180 = **0.444**. Raw from captures = 40/110 = 0.364. The rejected ratio
rule gives 0.364 × 1.4 = **0.509** — further from the truth than the uncorrected figure. The
estimator above gives (40/0.5) ÷ (40/0.5 + 70/0.7) = 80/180 = **0.444**.

**Undefined inputs fail the gate; they never default.** If `c_ord` or `c_unord` is zero, missing, or
was not measured separately, or if either reconstructed population is zero, **M1 is undefined and
G1a cannot pass.** A blended compliance
number is not sufficient evidence for a claim about the unordered population.

**Dependency, corrected (revision 4).** Revision 3 wrote "G1 cannot run before B1 exists," which
contradicted §5's manual-extract default and would have made G1 unrunnable on the lab path — the
only path where R1's in-room calibration is possible. **The requirement is the comparison side, not
B1 specifically:** B1's feed *or* a labelled manual extract for the same period. B1 remains
required for the Provet path and for G2.

#### R2 · The witnessed-evidence census — **the headline instrument**

**⚠️ Revision 3 correction — two metrics, not one.** Revision 2 described R2 as
*administered-but-never-ordered* and then set G1's threshold on *dispense-but-uninvoiced*. Those
are different claims with different denominators and different missing sides. A 15%
charge-capture gap is **ordinary in hospitals** — the gate could have passed on billing leakage
while the witnessed-execution thesis remained unproven. That is the same class of error revision 1
made in mislabelling the corpus a Cornered Resource: a measure that looks rigorous and answers the
wrong question.

R2 therefore produces **two separately registered metrics**, and they may never substitute for one
another.

##### M1 — the thesis metric: *the PMS is blind to real care*

| | |
|---|---|
| **Numerator** | Physical-stream care events with **no corresponding PMS order**, after the settling window |
| **Denominator** | All physical-stream care events in the period |
| **Missing side** | The **order** — i.e. the PMS never knew the care was going to happen, and still does not know it did |
| **Proves** | The category claim. The PMS is structurally blind to care that occurred. |

**⚠️ "Care event" is an allowlist, not a row count (revision 4).** A dispense, a scan, and three
RFID reads of the same infusion pump passing a gate are **not** five care events. RFID last-seen is
**telemetry, not care**. Without an explicit allowlist the 10% threshold is gameable by counting
whichever stream is noisiest.

| Source | Counts as an M1 care event? | Role |
|---|---|---|
| `vt_dispense_events` | ✅ Yes | A consumable was administered — a care act |
| `vt_scan_logs` — consumable / case-tag scans | ✅ Yes | A care act was witnessed at the point of act |
| `vt_scan_logs` — equipment checkout / return | ❌ No | Custody movement, not care delivery |
| `vt_equipment_rfid_reads` | ❌ No | Telemetry. **Evidence** supporting a care event, never a row of its own |
| `vt_damage_events` | ❌ No | Asset condition, not care |

RFID and custody rows remain first-class **evidence** — they corroborate location, timing, and
custodian for an allowlisted care event. They are never counted as care events themselves, in either
the numerator or the denominator. Any change to this allowlist is a change to the gate and requires
re-registering the threshold under the anti-HARKing rule (§9).

##### ⚠️ Canonical event identity and cross-system matching — registered before R2, not during it

The allowlist says which rows are eligible. It does **not** say when two eligible rows are the same
act, nor what "corresponds to a PMS order" means. Without both, M1 and M2 move with row duplication
and with whoever did the matching — and a threshold that moves is not a threshold.

**(a) One act, one row — deduplication inside VetTrack.** A single administration can produce a
`vt_dispense_events` row *and* a consumable scan in `vt_scan_logs`. They are one care event.

- **Precedence:** `vt_dispense_events` is canonical. A scan describing the same act is collapsed
  into it and survives as evidence (timing, actor, location), never as a second denominator row.
- **Identity key shape:** `clinicId` + case/patient reference + item identity + actor + an
  event-time proximity window. The window's exact value is registered with the settling window
  (§9 precondition 4).

**(b) M1 — when does a care event *correspond to* a PMS order?** A care event counts as *ordered*
only on a deterministic match: same `clinicId`, same case/patient reference, same item identity, and
the order exists within the settling window of the event. Anything else is *unordered*. **Fuzzy,
manual, or judgement-based matching is not admissible** — it is the mechanism by which a
disappointing M1 becomes an encouraging one.

**(c) M2 — when does a dispense *correspond to* an invoice line?** Same `clinicId`, same case
reference, same item identity, and quantity reconciled within the billing period. A dispense that
matches no such line after the settling window is uninvoiced.

**(d) Unmatchable rows are reported, never dropped.** Rows that cannot be resolved under (a)–(c)
are counted and reported as a separate `unmatched` figure alongside M1 and M2. Silently discarding
them would move both metrics in an unknown direction.

**Registration.** The concrete keys, the proximity window, and the item-identity rule are fixed and
written into `docs/audit/PROOF_ALIGNMENT_LOG.md` **before B2a's first run**, alongside the
thresholds. Changing any of them afterwards changes the gate and re-triggers the anti-HARKing rule
(§9) — the numbers before and after such a change are not comparable and may not be reported as a
trend.

**Settling window (required).** An event counts as *never ordered* only after the PMS has had a
defined interval to catch up — start at **24 hours**, tuned by R1's observed order-entry latency.
Without it, M1 measures *PMS data-entry lag*, not blindness. Report the window with every number.

**Non-randomness requirement.** M1 must also show that the unordered events cluster by *type*
(which procedures, which shifts, which roles) rather than scattering randomly. Systematic blindness
supports the category claim; random noise indicates a capture defect and points back at compliance.

##### M2 — the commercial metric: *money is leaving the building*

| | |
|---|---|
| **Numerator** | Dispense events with **no invoice line**, after the settling window |
| **Denominator** | All dispense events in the period, **at item-level-billing clinics only** |
| **Missing side** | The **invoice line** |
| **Proves** | Value-based pricing has a number. Does **not** prove the category. |

**Bundled-billing guard (required).** At a clinic that bills flat-rate or bundled packages,
"uninvoiced" is an artifact of the billing model, not a capture gap. M2 is computed **only** at
clinics with item-level billing, and that property is verified per clinic before the clinic is
admitted as a measurement site.

##### Both metrics report with their compliance rate

Every citation of M1 or M2 carries the capture-compliance rate from R1's calibrated proxy. A delta
reported without its compliance rate is uninterpretable and may not be cited — in a pitch, a price,
or an internal decision.

**Output:** per-clinic, per-period — M1, M2, compliance, and the settling window. This *is* the
corpus.
**Musk test:** ✅ for accounts held (§3's reclassification — a compounding switching cost, not a
market-wide barrier), and only under §3's load-bearing-workflow condition.
**Unblocks:** M1 → the category claim and the pitch · M2 → 0.6 pricing and 2.4's ROI Ledger.
**Depends on B2a and a comparison side** — B1's feed **or** a labelled manual extract (§5, §7 R1) —
and on both streams being live (§5, §9). B1 specifically is required for the Provet path and G2.

#### R5 · The Musk audit — *a standing exercise*

At every phase boundary: for **every** asset claimed, ask "could an unlimited-resource team have
this within six months?" If yes, it is a feature, demoted or cut.
**Output:** the dated, versioned asset register of §3, with a pass/fail and a **named Power type**
per asset. Mislabelling a Switching Cost as a Cornered Resource — revision 1's error — is exactly
what this audit exists to catch.

#### R6 · Admissibility and retention research

What makes a chain-of-custody record acceptable to an insurer, a regulator, or in a malpractice
proceeding: requirements, precedent, evidentiary standards, signature and retention rules.

**Mandatory sub-question — deletion rights vs. the corpus (new in revision 2).** The corpus is the
moat and it is longitudinal per-clinic data. Israeli privacy law, and any GDPR-equivalent in a
target market, grants erasure rights. **Resolve before B2 commits to a retention design:**

- *Mitigating fact:* Task 0.1's allowlist already excludes owner/client PII, and `vt_cases` stores
  only an opaque `externalPatientRef`. Much of the corpus may sit outside personal-data scope **by
  construction** — verify this rather than assuming it.
- *Open risk:* an operational record linked to an external patient reference may still be
  personal-data-adjacent through re-identification. Establish whether aggregate corpus statistics
  survive an erasure request on the underlying rows.
- *Design consequence:* if they do not, the corpus needs a derived-aggregate layer that is
  erasure-safe — which is an architectural decision, not a policy one.

**⚠️ R6 must name which layer is the switching-cost asset (new in revision 3).** Erasure and
lock-in pull against each other, and the plan cannot leave that unresolved:

| Layer | Erasure-safe? | Strength as a switching cost |
|---|---|---|
| Per-case longitudinal event log | ❌ punched by erasure requests | **Strong** — irreplaceable, and what admissibility (3.1/3.2) actually needs |
| Derived aggregate / statistics | ✅ survives | **Weak** — a competitor can reach comparable aggregates faster, and aggregates alone are not admissible |

If erasure punches the event log, the lock-in erodes exactly where it was supposed to compound —
and §3's load-bearing-workflow condition becomes the *only* remaining mechanism. R6 must state,
before B2 commits a storage design, which layer carries the asset and what the retention basis is
that lets it survive.

**Output:** the specification 3.1 and 3.2 must satisfy to be worth more than a log file, **plus** a
retention design that survives erasure, **plus** a named switching-cost layer.
**Musk test:** ✅ time-locked — requires precedent, which requires elapsed cases.
**Note:** legal and regulatory work, not engineering. Budget accordingly.

### R-entry (15%) — necessary, and **not** a moat

#### R3 · Provet Cloud verification — *clearing Aethel's blocking backlog*

Aethel's `competitive-landscape.md §6` marks the webhook catalogue **"blocks adapter design"** and
"the single most load-bearing unverified assumption in the entire plan."

**Partially cleared** from the public specification: webhooks are real, **60+ triggers**, scoped
organization-wide **or per department**, retried up to 10 times on non-200. Auth is OAuth 2.0
(Client Credentials for backend, Authorization Code + PKCE for user-facing).

⚠️ **Constraint found:** the webhook POSTs **only the changed object's ID**, not the body. A
follow-up GET round-trip must fit inside the ≤2.0s end-to-end budget. Aethel's REQ-002 does not
account for this.

**Still open:** payload shapes · rate limits · sandbox terms · referral/emergency install-base
profile · **partner-programme terms, API-stability guarantees, and competing-feature provisions
(§5's concentration risk)** · the Digitail contingency branch.
**Musk test:** ❌ **Cost of entry. Label it as such** — Aethel is right that interoperability is
not a moat.

#### R4 · Incumbent capability boundary

First pass complete (zero operational endpoints across ezyVet and Provet — §1). Extend to: what
SmartFlow and Vet Radar actually do; the real ceiling of Provet's native Digital Whiteboard; ezyVet
partner-programme stages and pilot-site requirements.

Aethel marks all competitor-weakness claims `[unverified]` and **forbids putting them in a pitch**
until measured. Honour that.
**Musk test:** ❌ **Pitch defence, not moat** — but it is the defence against a pitch that
collapses in the room.

---

## 8. Track B — Build (35%) and M0 — Aethel port (5%)

### B0 · RLS floor — **promoted to G0-parallel** (was buried in Track B in revision 1)

Aethel INV-005 / ADR-0003: Row-Level Security as the tenancy enforcement floor, with
application-layer filtering as defense-in-depth rather than the control. ADR-0010 adds what
VetTrack has not considered: **connection pooling mode is itself a tenancy control** — tenant
context must survive the pooler.

VetTrack enforces tenancy at the application layer against a frozen baseline of **203 findings
across 138 `file::table` keys** (`.tenant-lint-known-violations.json`). `pnpm test:rls-pooling` and migration
`185_rls_role_precondition_guard.sql` exist as groundwork.

**Why it is not an ordinary Build item:** the Phase-4 human-healthcare horizon is gated on it, the
multi-clinic corpus depends on it, and retrofitting a tenancy floor under a live corpus is far more
expensive than laying it first. **Runs in parallel with the G0 window, not after it.**

### B1 · `ProvetCloudAdapter` — inbound clinical intent

**The missing organ.** Webhook ingestion + REST reads behind the existing `IntegrationAdapter`
interface (`server/integrations/adapters/base.ts`), which already maps almost 1:1 onto Provet's
real API — `fetchPatients` → `/patient/`, `getPatientWorklist` → `/consultation/`, `fetchInventory`
→ `/item/`, `fetchAppointments` → `/appointment/`, `exportBillingEntry` → `/invoicerow/` and
`/consultation/{id}/supplies/`.

**One real gap:** `server/integrations/adapters/generic-pms.ts:110` declares
`requiredCredentials: ["base_url", "api_key"]` and sends a static `Authorization: Bearer`. All four
candidate vendors use OAuth 2.0. An OAuth2 branch with token refresh is required (ezyVet tokens
live 12 hours).

**Reuse, do not rebuild:** `circuit-breaker.ts`, `rate-limits.ts`, `guarded-call.ts`,
`contracts/canonical.v1.ts`, `webhooks/` (inbound router + signature verification), and
`credential-manager.ts` — all exist.

### B2 · The inverse-delta engine — **split into meter and product (revision 4)**

Revision 3 had B2 as one item that was simultaneously *how M1 and M2 get computed* and *part of
what G1a unlocks*. That is circular: the gate could not open until the instrument ran, and the
instrument sat behind the gate. Two slices, on opposite sides of G1a:

#### B2a · The meter — **runs before G1, part of R2's instrumentation**

A read-only computation of M1 and M2 over the physical stream and the comparison side (B1 feed or
§5 extract). No product surface, no storage commitment, no write path. Its only consumer is R2's
report and the proof log.
**Reuse:** `vt_dispense_events`, `vt_inventory_item_prices` (full price table, zero read
call-sites) for M2's valuation. Honours the §7 R2 care-event allowlist and the settling window.
**Not blocked on R6** — it computes, it does not retain.

#### B2b · The product — **opens after G1a passes**

The delta as a live workflow input per §3's load-bearing condition: reconciliation, variance,
the ROI Ledger surface, and the outbound path via `exportBillingEntry` (`generic-pms.ts:177`,
zero callers). Task 1.4's recon established ~80% of this pipeline already exists and is
disconnected.
**Blocked on R6's retention finding and named switching-cost layer** before committing a storage
design — this is the slice where history becomes something the clinic depends on, which is exactly
where §3 says the lock is either built or forfeited.

### B3 · Capture-compliance work — *conditional on R1*

If R1 finds compliance below §9's threshold, closing that gap outranks everything except B1.
Scope is unknowable before R1 and is deliberately not pre-specified.

### B5 · Install playbook and time-to-first-value — *the land-grab work item* (new in revision 3)

§3 concludes that 3.0 is a land-grab race and that speed-to-install outranks feature depth.
Revision 2 stated that conclusion and then left Track B as RLS, adapter, engine, and compliance —
no install work at all. A strategic conclusion with no corresponding work item is decoration.

**Scope:** the repeatable path from *clinic says yes* to *clinic is generating a fact-stream*.
Zero-touch kiosk pairing (Aethel ADR-0007 — VetTrack already ships display-token pairing), tag and
reader provisioning (`server/lib/rfid/provisioning.ts` exists, with per-clinic HMAC secrets and
rotation), clinic onboarding, and a measured **time-to-first-value**.

**Why it is a moat item and not an ops chore:** switching costs start at zero on every new account
(§3) and begin accruing only once the stream starts. Days saved per install are days of lock
accrual gained, multiplied by every clinic. This is the one Track B item whose value scales with
the land-grab thesis rather than with product depth.

**Metric:** elapsed days from signed to first fact-stream row, tracked per install, trending down.

*Either this item exists, or §3's land-grab sentence is retracted. Revision 3 keeps both.*

### B4 · Whatever R1 surfaces

Reserved capacity. **Do not pre-fill.**

### M0 · The Aethel port (5%) — *a named track, not a silent tax*

Revision 1 assigned this work no home. It is real effort with a real schedule impact on G0.

| Port | Destination | Why |
|---|---|---|
| The 10 ADRs (`aethel-orchestrator/docs/adr/`) | `docs/architecture/adr/` (has `template.md` + `TRIGGERS.md`) | ADR-0003 and ADR-0010 are actionable against the real known-violations baseline; inert where they sit |
| `aethel-orchestrator/docs/strategy/product-strategy.md`, `…/competitive-landscape.md`, `…/wedge-sequencing-rationale.md` | `docs/design/` | The positioning VetTrack lacks |
| `aethel-orchestrator/docs/design/floor-board-principles.md` | `docs/design/tv-board-redesign/` | Maps directly onto `/board` |
| Evidence discipline (`[established]` / `[unverified]`) | **Merge into `pnpm verify:claims`** | Aethel's markers and `docs/claims-registry.json` are the same idea twice. Make it one. |
| ⏸ `aethel-orchestrator/docs/brand/` + the four SVGs | **Defer to the rename trigger** | Porting brand assets before the trigger fires is work with no consumer. Register domains and trademark now; move the SVGs when the rename is real. |
| ❌ `aethel-orchestrator/.claude/skills/` (~100 vendored files) | **Do not port** | Would create a second roster competing with `vettrack-team` |

**Then archive `aethel-orchestrator`** (GitHub archive = read-only, preserves history). A second
repository is a second source of truth, and this project has already paid that bill: a shipped UI
change was reported "not landing" across four consecutive requests because verification kept
checking the wrong repository. Archive rather than delete — it is the provenance record of when
these decisions were made, for the same reason `.claude/docs/ai/vettrack/10x/session-2.md` is kept
"reference only, never rewritten".

### The same logic ends the two-repo split (owner decision, 2026-08-22)

The `aethel-orchestrator` archive is the small case of a rule the owner has now stated at full
scale: **there is no reason to hold two repositories once the migration is finished. The RN
repository consolidates into the server repository.**

`VetTrack---RN-Migration-/docs/RESEARCH-CONTEXT-two-repos.md` records why they are parallel today — the Capacitor
product is the always-usable safety net and RN replaces it only past **G5**. That is a *transition*
arrangement, not the destination. The destination is one monorepo.

**Consequences for this program:**

- **This document lives in `vettrack`**, not the RN repo. Every anchor it cites — `server/`,
  `migrations/`, `verify.config.json`, `.tenant-lint-known-violations.json`,
  `docs/vettrack-2.0-roadmap.md` — is here, and this is the repository that survives consolidation.
- **The RN repo gets a pointer, never a copy.** If it needs to reference 3.0, that is one line
  linking here. A duplicated strategy document across two repos is the exact failure M0 exists to
  prevent, at twice the cost.
- **Consolidation is not 3.0 scope** and is not a tracker row here. It rides the migration's own G5
  gate. It is recorded in this section so that the two-repo state is understood as temporary by
  everyone who reads the program, rather than being mistaken for the architecture.
- The vendored seam becomes an ordinary workspace dependency on consolidation — a simplification
  the program should expect, not plan around. This repo publishes `@vettrack/contracts` from
  `packages/contracts`; the RN repo sparse-clones it (and this repo's root `shared/`) at
  `preinstall` via `VetTrack---RN-Migration-/scripts/vendor-vettrack.mjs`.

---

## 9. Gates — every one falsifiable, every one may say stop

Borrowed from Aethel ADR-0005, including its sharpest rule:

> **Uptime is a precondition, never a criterion.** A display left on in an empty corridor records
> 100% uptime while being ignored.

| Gate | Opens | Criterion |
|---|---|---|
| **G0 — Entry** | 3.0 itself | 18/18 shipped · both stores in review · live fact-stream at ≥1 clinic. **B0 (RLS) runs parallel to this window.** |
| **G1a — Category** | The category claim, the pitch, **B2b**, Track B beyond B1/B2a/B3/B5 | The thesis threshold below. **Depends on B2a and a comparison side.** |
| **G1b — Commercial** | Pricing (2.0 Task 0.6) and 2.4's ROI Ledger | The commercial threshold below. **Depends on B2a, a comparison side, and item-level billing.** |
| **G2 — Intent** | Positioning rollout | B1 delivers inbound clinical intent end-to-end from a live Provet installation within ≤2.0s p95 **including the GET round-trip** |
| **G3 — Moat** | Scale-up investment | A completed replication estimate (below), not an assertion |

**Why G1 is now two gates.** Revision 2 ran one gate on one number, and that number measured
*dispense-but-uninvoiced* — hospital billing leakage, which is common and proves nothing unique.
The category claim and the pricing claim are separate assertions with separate evidence, and
**neither may substitute for the other.** G1a can fail while G1b passes: that outcome means
VetTrack is a charge-capture tool, not a System of Execution — a real product, but a different one,
and the program should learn that rather than paper over it.

### Preconditions — both G1 gates (new in revision 3)

Checked **before** the measurement period begins, not discovered during it:

1. **Both streams live at every measurement clinic** — VetTrack captures **and** PMS order/invoice
   lines for the same period.
2. **A comparison side exists — B1's feed *or* a labelled manual extract** for the same period
   (revision 4; revision 3 required B1 specifically, which contradicted §5's manual-extract default
   and made G1 unrunnable on the lab path). **B1 remains required for the Provet path and for G2.**

   **Manual-extract audit recipe (required).** An extract with no provenance is an unauditable
   spreadsheet. Every extract records, in `docs/audit/PROOF_ALIGNMENT_LOG.md`: **who pulled it ·
   the exact date range · row counts per stream · the export method or report name · the date
   pulled.** Any citation of a number derived from an extract states that it came from one.
3. **Item-level billing verified per clinic** — required for G1b only; a bundled-billing clinic is
   not admissible as a G1b measurement site.
4. **Settling window fixed and published** before the first computation, not tuned afterwards.
5. **R1's calibration constants exist** — `r`, `c_ord`, and `c_unord` (§7 R1). Without them the
   compliance bar cannot be computed on the calibrated formula, and the raw ratio is not a
   substitute.

### G1a — the thesis threshold (M1)

**Registered before R2 runs. May not be revised downward after seeing data.**

> **PASS:** ≥10% of physical-stream care events in a clinic-month have **no corresponding PMS
> order** after the settling window · **sustained across two consecutive clinic-months at ≥2
> clinics** · **capture compliance ≥70%** on R1's calibrated proxy · **and** the unordered events
> cluster systematically by procedure type, shift, or role rather than scattering randomly.

- **10%** — not derived from data; a commitment device registered to make the gate un-gameable. It
  is lower than G1b's threshold because G1a asks whether structural blindness *exists*, not whether
  it is commercially large.
- **The clustering clause is not optional.** Random scatter indicates a capture defect and points
  back at compliance; systematic clustering is what "the PMS is structurally blind" actually means.
- **Compliance ≥70% — on the calibrated formula of §7 R1, never on the raw `captures ÷ orders`
  ratio.** The raw ratio is blind to unordered care, which is M1's entire subject, and can exceed
  100% while true compliance is failing. Below the bar, §2's condition fires: M1 is a floor, not a
  measurement, and G1a **cannot pass** regardless of its size.
- **The selection-bias rule applies (§7 R1).** If `c_unord > c_ord`, M1 is inflated and must be
  corrected by `c_ord ÷ c_unord`, with both values reported — or G1a cannot pass. If `c_ord` and
  `c_unord` were not measured separately, G1a cannot pass.

**FAIL:** M1 below 10%, or randomly scattered ⇒ **the witnessed-execution thesis is wrong and the
program stops for redesign.** Calibrated compliance below 70%, or missing calibration constants
⇒ G1a is suspended and B3 runs before re-attempt.

### G1b — the commercial threshold (M2)

> **PASS:** ≥15% of dispense events in a clinic-month have **no invoice line** after the settling
> window · sustained across two consecutive clinic-months at ≥2 **item-level-billing** clinics ·
> capture compliance ≥70%.

- **15%** — the smallest gap that could plausibly justify value-based pricing at any credible price
  point. Also a commitment device.
- Compliance is the same calibrated figure used by G1a.

### The four outcomes — all named in advance

Naming only the happy path is how a program rationalises a partial result after the fact.

| | **G1b passes** | **G1b fails** |
|---|---|---|
| **G1a passes** | Both claims hold. Category **and** value-based pricing proceed as planned. | **Category holds; pricing does not.** VetTrack *is* a System of Execution, but the money story is not in charge capture. Pricing reverts to a conventional model and the ROI Ledger's content is re-sourced from something other than M2. The thesis is untouched. |
| **G1a fails** | **You built a charge-capture tool, not a System of Execution.** A real product with a real market — and a different one. The category claim, the positioning, and §3's moat argument are all withdrawn. Do not keep the category language on a product that failed its own test. | Neither claim holds. **Stop for redesign.** |

The top-right and bottom-left cells are the ones that require discipline, because both are
partially good news and both invite keeping the half that failed.

**Anti-HARKing rule (both gates).** Both thresholds, the settling window, and the compliance
denominator are committed to this file and to `docs/audit/PROOF_ALIGNMENT_LOG.md` **before R2's
first run**. A threshold set after seeing the data is not a gate.

### G3 — the evidence form, and who produces it

Revision 1's G3 ("≥1 asset marked TIME-LOCKED with evidence") was circular: it passed if you
asserted the asset was time-locked. Replaced with a **replication estimate**:

> **PASS:** a documented adversarial assessment of exactly what a well-funded team would need to
> reproduce the named asset from a standing start — named blockers, estimated elapsed time, and an
> explicit statement of *what specifically cannot be compressed by money, and why*.

A tabletop exercise counts. "We assert the corpus requires three years" does not.

**Who produces it (new in revision 3).** "Someone not invested in the answer" is a role, not a
person, and in a founder-led shop the author is invested by definition. Two admissible paths, and
no third:

1. **External reviewer** — an engineer or advisor with no stake in the program's continuation,
   briefed adversarially and asked to argue that replication is cheap. Preferred.
2. **Dated self-assessment, labelled as such** — permitted, but the document must carry the
   conflict on its face: *"produced by the program author; not independent."* An unlabelled
   self-assessment is not evidence and does not pass G3.

---

## 10. Track P — Positioning (5%)

- **Category:** adopt *System of Execution, witnessed* — with §2's condition attached. Replace
  "operational layer from resources to bedside" in `CLAUDE.md`, the investor deck, and App Store
  copy. Cost: one sentence.
- **One persona.** Serving five archetypes is why differentiation stayed ideational. Aethel's
  candidate — lead treatment-floor technician, swing or night shift, 24/7 emergency and specialty
  referral hospital — is the starting proposal, confirmed or replaced by R1.
- **Pricing (2.0 Task 0.6, frozen).** Resolve as **value-based**, priced against loss prevented,
  using **M2** (§7 R2 — the commercial metric, never M1). Per-seat pricing competes as a generic SaaS tool against a free alternative (a
  whiteboard) and loses. Porter: there is no cost-leadership path — you cannot underprice free.

  ⚠️ **Structural tension to resolve, not defer.** M2 is **per-clinic**. A per-clinic
  negotiated price does not scale; a tiered estimate erodes the value basis that justified
  value-based pricing in the first place. Name the resolution mechanism now — banded pricing
  anchored on a measured clinic-size proxy, with the measured delta used as the *proof*, not the
  *invoice line* — even though the bands themselves wait for R2.

---

## 11. Verification — how to know 3.0 is working, not just proceeding

1. **R2 produces the full result set, repeatedly.** **M1** (thesis), **M2** (commercial),
   **compliance rate**, and the **settling window** — all four together, against a real
   clinic-month, with query and result committed to `docs/audit/PROOF_ALIGNMENT_LOG.md`. A number
   that cannot be reproduced next month is not a corpus. A delta reported without its compliance
   rate and window is not a result. **M2 cited as if it were M1 is a category error**, and it is
   the specific error revision 3 exists to prevent.
2. **B1 proven end-to-end — and it is a measuring instrument, not only a feature.** Live Provet
   sandbox webhook fires → VetTrack receives the object ID → fetches the body → an operational task
   appears on the floor surface. ≤2.0s p95. Failing test written before the adapter (RED→GREEN,
   repo law). B1 is **required for the Provet path and for G2**. It is *not* the only way to reach
   G1: the gates need B2a plus a comparison side, which on the lab path is a labelled manual extract
   (§5, §9 precondition 2).
3. **B5's time-to-first-value trends down.** Days from signed to first fact-stream row, per install.
   If it is not measured, §3's land-grab conclusion is not being executed.
4. **R5's asset register is dated, versioned, and names a Power type per asset.** Any asset failing
   the six-month test is demoted in the same commit that records the failure.
5. **B0 lowers the recorded tenancy counts.** `.tenant-lint-known-violations.json` records a count
   per `file::table` key, and `tenant:lint:enforce` fails a key when the live count **exceeds** it.
   B0's work must drive those recorded counts **down**, never up. Note what that gate does not do —
   `CLAUDE.md` is explicit that the baseline is relative **by count, not by identity**, so a
   different unscoped query replacing a known one at the same key keeps the count equal and passes.
   Reaching RLS on a key is therefore proven by removing the key, not by watching it hold steady.
   `pnpm architecture:gates`, `pnpm tenant:lint:enforce`, `pnpm verify:claims`, `pnpm typecheck`
   all green.
6. **Every claim in this document is governed.** Add it to `verify.config.json` so
   `pnpm verify:claims` checks it. A strategy document that starts lying should fail CI like any
   other.

---

## 12. Open — deliberately not decided here

- **The persona.** Proposed from Aethel; R1 confirms or replaces it. Do not lock before the
  ethnography.
- **B3's and B4's contents.** Reserved for R1's findings. Pre-filling defeats the purpose.
- **3.0's duration and phase count.** Not responsibly estimable before G0, which depends on 12
  remaining 2.0 tasks plus two store reviews.
- **Brand.** VetTrack stays; `aethel` domains and trademark registered now (cheap, reversible,
  expensive to lose). Rename trigger — first of: (a) a first non-veterinary customer conversation;
  (b) a fundraise or sale, the cheapest moment to rename; (c) the next major version.
  **Acknowledged debt:** `VetTrack` says *tracking*; the thesis says *execution*, and `Vet` is
  domain-locked — exactly the constraint Aethel's charter was written to avoid.

---

## 13. Sources

**Read:** `docs/vettrack-2.0-roadmap.md` · `docs/design/program-plan.md` ·
`docs/design/platform-strategy-research.md` · `docs/design/product-growth-roadmap.md` ·
`docs/investor-deck/COMPETITIVE_LANDSCAPE.md` ·
`docs/business-case/2026-07-12-massive-01-passive-tracking-cost-benefit.md` ·
`server/integrations/**` · `server/schema/**` · `scripts/vettrack-2.0-scope-gate.sh` ·
`exposwifty31/aethel-orchestrator` (`aethel-orchestrator/README.md`,
`aethel-orchestrator/CLAUDE.md`, `aethel-orchestrator/docs/strategy/`,
`aethel-orchestrator/docs/adr/` index, `aethel-orchestrator/specs/floor-display/spec.md`).

**Not read — outstanding:** Aethel's `unified-master-strategy-blueprint.pdf` (the source every `§`
citation points into), the full text of the ten ADRs,
`aethel-orchestrator/docs/strategy/wedge-sequencing-rationale.md`, and
`aethel-orchestrator/docs/design/floor-board-principles.md`.
**Read these before executing M0's ADR port.**

**API findings** derive from https://github.com/api-evangelist, a third-party catalogue of public API surfaces
generated 2026-07-22 from vendor documentation — **not** the vendors' own specifications. Confirm
against `developers.provetcloud.com` directly before any engineering commitment (this is R3).

**Not established by evidence:** the claim that barcode-system bypass is the dominant finding in
hospital time-and-motion studies (§2) is stated from general knowledge and is **not** sourced here.
It motivates R1's compliance measurement; it does not substitute for it.
