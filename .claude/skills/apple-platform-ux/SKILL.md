---
name: apple-platform-ux
description: Designs Apple-platform product experiences by separating iPhone, iPad, and Mac cognition, attention, motor control, information architecture, and workflow economics. Use when planning or reviewing iOS/iPadOS/macOS features, mobile/tablet layouts, clinical workflows, split-view workspaces, keyboard/pointer/Pencil support, Apple HIG-aligned interaction models, or when deciding whether a feature belongs on iPhone, iPad, or both.
---

# Apple Platform UX

## Quick Start

Start from the computing environment, not the screen size:

1. Identify the user posture, attention span, stress level, and primary actuator.
2. Decide whether the task is phone-like action cognition or tablet-like workspace cognition.
3. Choose an information architecture that matches the workflow.
4. Design the feature matrix separately for iPhone and iPad.
5. Verify success across functional, behavioral, cognitive, emotional, and business outcomes.

Read [references/device-models.md](references/device-models.md) when the task needs deeper iPhone-versus-iPad reasoning or a formal design critique.

## Device Strategy

- Treat iPhone as an interruption-tolerant action device. Optimize for seconds, thumb reach, few choices, direct completion, and error prevention.
- Treat iPad as a touch-first workstation. Optimize for concentration, externalized memory, visible context, persistent spatial anchors, and error recovery.
- Treat Mac as an expertise environment. Optimize for precision, density, command surfaces, persistence, and multiwindow workflows.

## Workflow

### 1. Classify the job

Ask what the user is actually trying to complete. Prefer workflow language over table, page, or component language.

Clinical example: "patient arrives -> assign room -> assign equipment -> administer drugs -> monitor -> bill -> discharge" is more useful than "patient page, equipment page, medication page."

### 2. Split iPhone and iPad intent

Use iPhone for:

- Capture, scan, approve, respond, confirm, and recover under stress.
- One primary action per moment.
- Short sessions measured in seconds or a few minutes.

Use iPad for:

- Planning, reviewing, monitoring, comparing, handoff, bulk actions, and dashboards.
- Simultaneous information and stable spatial memory.
- Sessions measured in tens of minutes or hours.

### 3. Choose architecture

- Sequential: phones, onboarding, checkout, urgent single-path tasks.
- Hierarchical: settings, file-like browsing, structured admin areas.
- Network: professional tools, hospital operations, related clinical entities.
- Spatial: iPad, desktop, dashboards, creative or operational workspaces.

### 4. Design interaction surfaces

- iPhone: bottom navigation, bottom actions, large reachable controls, reduced options, destructive-action prevention.
- iPad: sidebars, inspectors, toolbars, panels, drag/drop where valuable, keyboard shortcuts, undo/redo, multiwindow, workspace persistence.
- Group by Gestalt structure. Users should see patient, medication, equipment, and operational groupings before individual fields.

### 5. Produce a feature matrix

For each proposed capability, mark iPhone, iPad, both, or neither. Explain why using attention cost, discoverability, density, input method, and workflow value.

## Review Checklist

- Does the iPhone version reduce cognitive load?
- Does the iPad version externalize cognitive load?
- Are primary controls appropriate for thumb, finger, pointer, Pencil, and keyboard?
- Does the iPad layout use persistent spatial anchors instead of forcing memory through navigation stacks?
- Are options reduced on iPhone and grouped on iPad?
- Are professional workflows represented directly rather than as database-table screens?
- Does error handling prevent mistakes on iPhone and provide recovery on iPad?
- Are success criteria stated beyond "the task works"?

## VetTrack Lens

For VetTrack clinical surfaces, iPhone success usually means scanning, administering, responding, or confirming under time pressure. iPad success usually means managing ICU context, monitoring many patients or devices, supporting shift handoff, and preserving operational awareness from one workspace.
