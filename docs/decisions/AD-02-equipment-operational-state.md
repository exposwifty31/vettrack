# AD-02: Equipment Operational State as Relationship Graph

**Status:** DRAFT
**Date:** 2026-05-22
**Depends on:** AD-01 (establishes decision document pattern)

## Context

This decision emerged from structured analysis of real ER operational
scenes. The starting question was billing event policy. The actual
problem is different: staff in ER/ICU environments spend significant
time and cognitive load resolving equipment uncertainty — where is it,
is it actually deployable, who has it, is the trip worth making.

Primary research (staff WhatsApp conversations from an active ICU/ER
hospital environment) confirmed the pattern:

- Blood pressure equipment frequently non-deployable due to missing
  bundle components (cuffs, connectors) despite the monitor existing
- Staff running to find clippers while patients are actively
  deteriorating
- Portable ultrasound (FAST) constantly searched for across the
  hospital
- Informal readiness maintenance (proactive checks, WhatsApp
  coordination) that does not persist reliably across shifts
- End-of-shift supply refill identified by staff themselves as
  a needed but inconsistently executed ritual

A key distinction surfaced directly in conversation between clinical
staff and maintenance staff: maintenance defines a device as "working"
if it is mechanically functional (no hardware faults, powers on).
Clinical staff define "working" as operationally deployable in a live
workflow — charged, accessories present, location known, confirmed
ready. These two definitions diverge in practice and neither team
fully tracks the other's dimension. A blood pressure monitor with a
depleted battery is simultaneously "working" (maintenance view) and
"not available" (clinical view).

A further finding specific to the FAST machine: ultrasound gel and
probe spray are consistently missing from or taken off the portable
ultrasound. A docked FAST without gel is not operationally deployable
even if the machine itself is charged and functional. This is direct
evidence that deployability is contextual, not binary — the device
state alone does not determine readiness. Accessory and consumable
dependencies are a real second dimension of deployability. This is
documented here as a validated pressure point; accessory tracking is
explicitly deferred to V2 to protect V1 scope.

The core insight: equipment "availability" is not a device property.
It is a relationship between the device, clinical context,
task/hospitalization, time, and urgency.

## Decision

**Equipment operational state is modeled as a relationship graph,
not a device-level state machine.**

A device's effective state is derived from its relationships:
- Dock assignment — home state and readiness verification anchor
- Task association — what work is it linked to
- Hospitalization binding — is it locked to an ongoing procedure
- Staging claim — who has declared intent to use it and at what
  clinical priority
- Last confirmed state timestamp — how stale is current knowledge

A device that appears physically present may be operationally
unavailable due to any of these relationships. The system's job is
to surface the complete relationship context, not just physical
location.

## Design Principles

**Reduce operational uncertainty before optimizing workflow.**
The primary output is trusted, timestamped answers to "is this device
actually deployable right now?" — not automation or routing. Staff
make better decisions when uncertainty is reduced; the system does
not make decisions for them.

**Formalize implicit behavior that already exists socially.**
Staff already maintain mental docks ("the monitor area"), staging
signals ("this is mine for the next procedure"), and informal
priority hierarchies. Hospital staff independently proposed
end-of-shift readiness checklists before this model was described
to them. VetTrack makes these behaviors explicit and persistent,
not new.

**Mechanical readiness and operational readiness are not the same.**
A device can be mechanically functional (no hardware faults, powers
on) and operationally non-deployable (battery depleted, accessories
missing, location unknown). Existing maintenance workflows track
mechanical readiness. VetTrack tracks operational readiness. These
are complementary, not overlapping. The dock confirmation step is
the bridge: it is the moment when clinical staff assert that the
device is ready for immediate deployment — not merely that it
functions.

**Clinical urgency over role authority.**
Competing claims carry a priority level (routine | urgent | emergency)
tied to patient acuity, not to the requester's role. A technician
with an emergency claim outranks a vet with a routine claim.

**Surface conflicts, don't resolve them.**
When claims compete, the system surfaces both with clinical context.
Humans decide. VetTrack is a coordination layer, not an authority
layer.

**Intentional friction at operational transitions, not during chaos.**
Readiness confirmation happens at dock-return moments — a natural
workflow pause. Nothing is required during active procedures or
emergencies.

**Staleness is first-class.**
Every state display shows when it was last confirmed. A state
confirmed 3 minutes ago is different from one confirmed 90 minutes
ago. Staff calibrate trust from the timestamp, not from an implicit
assumption of accuracy.

**No blame surfaces.**
The system reports equipment state, not responsibility for gaps.
"Battery empty — last confirmed ready 3 shifts ago" is factual and
actionable. Deriving or displaying who failed to maintain the device
is outside scope and would undermine adoption.

## State Model

| State            | Meaning                                 | Release trigger                     |
|------------------|-----------------------------------------|-------------------------------------|
| docked_ready     | At dock, readiness confirmed            | Departure scan or staging claim     |
| docked_not_ready | At dock, needs charging or maintenance  | Readiness confirmation              |
| staged           | Declared intent, pre-use, task-linked   | Task start, expiry, or conflict     |
| in_use_primary   | Actively in clinical use                | Task completion or explicit release |
| procedure_bound  | Support role locked to hospitalization  | Hospitalization close or release    |
| maintenance      | Under repair                            | Manual release                      |
| overdue          | Expected return, no scan                | Manual acknowledgment               |

Staging claims form a priority-ordered queue when multiple claims
exist for the same device. Each claim carries: requester, task
context, clinical priority, timestamp, expiry.

## V1 Scope: FAST Machine Only

**The portable ultrasound (FAST) is the sole asset in V1.**

Rationale:
- Highest-frequency, highest-visibility pain in ER environments
- Doctor-facing — strong signal if it works, credible failure if not
- Mobile, high-demand, short use duration: stresses the full model
- Single asset class: tractable without premature generalization
- Measurable success criterion: reduction in cross-staff "where is
  the FAST?" coordination events per shift

**V1 implements:**
- docked_ready / docked_not_ready with return confirmation
- staged with task linkage and clinical priority level
- in_use_primary
- Priority-ordered queue with conflict visibility
- Expected release time inferred from task type
- Staleness display on all states
- overdue detection

**V1 explicitly excludes:**
- Accessory/consumable tracking for the FAST (gel, spray, probe
  covers) — deployability is contextual and accessories matter,
  but tracking consumable depletion state, accessory freshness,
  and separate staleness thresholds would expand V1 from "mobile
  critical equipment operational visibility" into "consumable
  lifecycle and bundle management." Deferred to V2.
- Bundle/accessory completeness model for other equipment
  (deferred — crash cart, V2)
- procedure_bound state (deferred to V2)
- General equipment rollout (after V1 validated)
- Predictive availability or analytics
- Role-authority encoding of any kind
- Organizational or staffing-window state modeling

## Schema Requirements for V1

New tables:
- `vt_docks` — named operational home locations
  (clinic_id, name, description, room_id nullable)
- `vt_equipment_staging_queue` — ordered staging claims per device
  (equipment_id, requested_by_id, task_id, clinical_priority,
   staged_at, expires_at, status)

New columns on `vt_equipment`:
- current_state (enum: state model above)
- current_state_since (timestamp)
- dock_id (FK → vt_docks, nullable)
- dock_confirmed_ready_at (timestamp)
- dock_confirmed_by_id (FK → vt_users)
- current_task_id (FK → vt_appointments, nullable)
- current_hospitalization_id (FK → vt_hospitalizations, nullable)
- current_holder_id (FK → vt_users, nullable)

Soak class: schema migration — 48h minimum after CI passes before
production promotion.

## Success Criteria for V1

**Qualitative (first 2 weeks at pilot hospital):**
- Staff report reduction in "where is the FAST?" WhatsApp events
- Zero reported "someone took my staged FAST" collisions
- Dock confirmation rate ≥ 80% of FAST return events

**Failure signals (stop and reassess):**
- Staff bypass staging and revert to WhatsApp coordination
- Dock confirmation rate < 50%
- Frequent phantom staging (claims expire unused repeatedly),
  indicating staging friction is too high

## Open Questions

Q1: What triggers staged → in_use? Explicit user confirmation when
connecting to patient, or inference from task state transition?

Q2: What is the right expiry window for staged claims? Candidate:
20 min routine, 10 min urgent, no auto-expiry for emergency.

Q3: How is expected release time surfaced — duration estimate
("~15 min") or absolute time ("free by 16:20")? The latter requires
task-type duration estimates per procedure.

Q4: Does docked_not_ready distinguish between low battery and
needs post-procedure cleaning, or is this a single not-ready state
with an optional note?

Q5: What does the FAST dock look like physically — a designated
charging station in a fixed room? Must be defined per hospital
during onboarding.

Q6 (deferred — informs V2 design): Accessory staleness threshold.
Gel/spray confirmed present at dock return may be consumed or taken
within hours. Should accessory confirmation carry a shorter staleness
window than equipment state? And does confirming accessories at dock
return require a separate interaction or fold into the same
readiness tap? Not in V1 scope, but the answer shapes the V2
dock confirmation UX.

## Must Not Implement Until

- This DRAFT reviewed in an adversarial session (same discipline as AD-01)
- Open questions Q1–Q3 resolved
- Pilot hospital has identified the physical FAST dock location
- vt_docks and vt_equipment_staging_queue migration files generated and reviewed
- Rollback plan documented if V1 causes operational disruption (deploy revert)
