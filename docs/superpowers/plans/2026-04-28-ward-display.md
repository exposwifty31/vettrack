# Ward Display Implementation Plan

> **Historical snapshot — 2026-04-28.** This plan predates the Phase 9 Department Display upgrade. The merged surface uses SSE + outbox replay (not 5 s/2 s polling), reconciliation via `useRealtimeReconciliation` (visibility, pageshow/BFCache, online, freeze/resume), heartbeat liveness via `useDisplayHeartbeat`, optional kiosk wake-lock, and emergency endpoint cache bypass. For the current architecture see `README.md` → "Realtime, Code Blue, and PWA architecture".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/display` — a read-only, large-screen ward dashboard with real-time patient status, equipment, staff, upcoming procedures, and instant full-screen Code Blue takeover.

**Architecture:** Single `/display` route with a `useDisplaySnapshot` hook (TanStack Query, 5s/2s polling). A new `GET /api/display/snapshot` endpoint aggregates all data in one call. Two render modes: normal (ward dashboard) and code-blue (full-screen overlay), swapped instantly when `snapshot.codeBlueSession` toggles. A new BullMQ repeatable job (`scan_overdue_medications`, 60s) fires push notifications to assigned vets when medication tasks go overdue. Replaces the `/code-blue/display` route planned in the Code Blue redesign spec (Batch 5 is now this feature).

**Tech Stack:** Express + Drizzle ORM, PostgreSQL, React + TanStack Query v5, Tailwind CSS, Vitest static analysis tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/074_overdue_notified_at.sql` | Create | Add `overdue_notified_at` to `vt_appointments` |
| `server/db.ts` | Modify | Add `overdueNotifiedAt` column to appointments schema |
| `server/routes/display.ts` | Create | `GET /api/display/snapshot` — aggregates 7 data domains |
| `server/app/routes.ts` | Modify | Register `/api/display` router |
| `server/lib/queue.ts` | Modify | Add `overdue_medication_alert` to `NotificationJobData` union |
| `server/workers/notification.worker.ts` | Modify | Add `scanOverdueMedications()`, repeatable job registration, job processor |
| `src/types/index.ts` | Modify | Add `DisplaySnapshot` and related types |
| `src/lib/api.ts` | Modify | Add `api.display.snapshot()` |
| `src/hooks/useDisplaySnapshot.ts` | Create | Polling hook — 5s normal / 2s Code Blue, placeholder data on error |
| `src/pages/display.tsx` | Create | `WardDisplayPage` + all subcomponents + `CodeBlueOverlay` |
| `src/app/routes.tsx` | Modify | Register `/display` route with `<AuthGuard>` |
| `tests/ward-display.test.js` | Create | Static analysis: 8 test cases |

---

## Task 1: DB Migration

**Files:**
- Create: `migrations/074_overdue_notified_at.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/073_overdue_notified_at.sql
-- Add overdue_notified_at to vt_appointments.
-- Used by the overdue-medication push notification job to deduplicate alerts.

ALTER TABLE vt_appointments
  ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;

-- Partial index to make the overdue scan query fast
CREATE INDEX IF NOT EXISTS idx_vt_appointments_overdue_med_scan
  ON vt_appointments (clinic_id, start_time)
  WHERE task_type = 'medication'
    AND status IN ('pending', 'assigned')
    AND overdue_notified_at IS NULL;
```

- [ ] **Step 2: Run the migration**

```bash
cd C:/Users/Dan/Documents/GitHub/VetTrack
npm run db:migrate
```

Expected: migration runs without error. If the column already exists, `ADD COLUMN IF NOT EXISTS` is a no-op.

- [ ] **Step 3: Commit**

```bash
git add migrations/074_overdue_notified_at.sql
git commit -m "feat(ward-display): add overdue_notified_at to vt_appointments"
```

---

## Task 2: Drizzle Schema

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Find the appointments table** — search for `export const appointments = pgTable("vt_appointments"`. The `createdAt` / `updatedAt` columns are near the end.

- [ ] **Step 2: Add the new column** — inside the `appointments` pgTable definition, after `stuckNotifiedAt`:

```typescript
  // Add after stuckNotifiedAt:
  overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:/Users/Dan/Documents/GitHub/VetTrack
npx tsc --noEmit
```

Expected: no errors on the new column.

- [ ] **Step 4: Commit**

```bash
git add server/db.ts
git commit -m "feat(ward-display): add overdueNotifiedAt to appointments Drizzle schema"
```

---

## Task 3: Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Append new types at the end of the file**

```typescript
// ─── Ward Display Snapshot ────────────────────────────────────────────────────

export interface DisplaySnapshotHospitalization {
  id: string;
  status: HospitalizationStatus;
  ward: string | null;
  bay: string | null;
  admittingVetName: string | null;
  admittedAt: string;
  animal: {
    name: string;
    species: string | null;
    breed: string | null;
    weightKg: number | null;
  };
  overdueTaskCount: number;
  overdueTaskLabel: string | null;
}

export interface DisplaySnapshotEquipment {
  id: string;
  name: string;
  status: EquipmentStatus;
  inUse: boolean;
  location: string | null;
}

export interface DisplaySnapshotTask {
  id: string;
  startTime: string;
  taskType: string | null;
  notes: string | null;
  animalName: string;
  status: string;
}

export interface DisplaySnapshotCodeBlueSession {
  id: string;
  startedAt: string;
  managerUserName: string;
  patientId: string | null;
  patientName: string | null;
  patientWeight: number | null;
  patientSpecies: string | null;
  ward: string | null;
  bay: string | null;
  preCheckPassed: boolean | null;
  pushSentAt: string;
  logEntries: Array<{
    elapsedMs: number;
    label: string;
    category: string;
    loggedByName: string;
  }>;
  presence: Array<{
    userId: string;
    userName: string;
    lastSeenAt: string;
  }>;
}

export interface DisplaySnapshot {
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: string }>;
  hospitalizations: DisplaySnapshotHospitalization[];
  equipment: DisplaySnapshotEquipment[];
  upcomingTasks: DisplaySnapshotTask[];
  activeAlertCount: number;
  totalOverdueCount: number;
  crashCartStatus: {
    lastCheckedAt: string;
    allPassed: boolean;
    performedByName: string;
  } | null;
  codeBlueSession: DisplaySnapshotCodeBlueSession | null;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(ward-display): add DisplaySnapshot types"
```

---

## Task 4: Server Route

**Files:**
- Create: `server/routes/display.ts`

- [ ] **Step 1: Create the route file**

```typescript
// server/routes/display.ts
import { randomUUID } from "crypto";
import { Router } from "express";
import { and, desc, eq, gte, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import {
  db,
  animals,
  appointments,
  codeBlueSessions,
  codeBlueLogEntries,
  codeBluePresence,
  crashCartChecks,
  equipment,
  hospitalizations,
  shifts,
} from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(p: { code: string; reason: string; message: string; requestId: string }) {
  return { code: p.code, error: p.code, reason: p.reason, message: p.message, requestId: p.requestId };
}

router.get("/snapshot", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // ── 1. Active hospitalizations ─────────────────────────────────────────
    const hospRows = await db
      .select({ hosp: hospitalizations, animal: animals })
      .from(hospitalizations)
      .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
      .where(
        and(
          eq(hospitalizations.clinicId, clinicId),
          notInArray(hospitalizations.status, ["discharged", "deceased"]),
        ),
      )
      .orderBy(hospitalizations.admittedAt);

    // ── 2. Overdue medication tasks ────────────────────────────────────────
    const overdueRows = await db
      .select({
        animalId: appointments.animalId,
        startTime: appointments.startTime,
        notes: appointments.notes,
        taskType: appointments.taskType,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["pending", "assigned"]),
          lt(appointments.startTime, now),
          isNull(appointments.animalId)
            ? sql`false`
            : and(
                sql`${appointments.animalId} is not null`,
              ),
        ),
      )
      .orderBy(appointments.startTime);

    // Group overdue by animalId
    const overdueByAnimal = new Map<
      string,
      Array<{ startTime: Date; notes: string | null; taskType: string | null }>
    >();
    for (const row of overdueRows) {
      if (!row.animalId) continue;
      if (!overdueByAnimal.has(row.animalId)) overdueByAnimal.set(row.animalId, []);
      overdueByAnimal.get(row.animalId)!.push({
        startTime: row.startTime,
        notes: row.notes,
        taskType: row.taskType,
      });
    }

    // ── 3. Upcoming tasks (next 2h) ────────────────────────────────────────
    const upcomingRows = await db
      .select({
        id: appointments.id,
        startTime: appointments.startTime,
        taskType: appointments.taskType,
        notes: appointments.notes,
        status: appointments.status,
        animalName: animals.name,
      })
      .from(appointments)
      .innerJoin(animals, eq(appointments.animalId, animals.id))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          inArray(appointments.status, ["pending", "assigned", "scheduled"]),
          gte(appointments.startTime, now),
          lte(appointments.startTime, twoHoursLater),
        ),
      )
      .orderBy(appointments.startTime)
      .limit(20);

    // ── 4. Equipment ───────────────────────────────────────────────────────
    const equipRows = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)));

    // ── 5. Active alert count (equipment with critical/issue/needs_attention) ─
    const [alertCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          isNull(equipment.deletedAt),
          inArray(equipment.status, ["critical", "issue", "needs_attention"]),
        ),
      );

    // ── 6. Current shift ───────────────────────────────────────────────────
    const todayDate = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const nowTimeStr = now.toTimeString().slice(0, 5); // "HH:MM"
    const shiftRows = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.clinicId, clinicId),
          eq(shifts.date, todayDate),
          lte(shifts.startTime, nowTimeStr),
          gte(shifts.endTime, nowTimeStr),
        ),
      );

    // ── 7. Crash cart — latest check ───────────────────────────────────────
    const [latestCart] = await db
      .select()
      .from(crashCartChecks)
      .where(eq(crashCartChecks.clinicId, clinicId))
      .orderBy(desc(crashCartChecks.performedAt))
      .limit(1);

    // ── 8. Active Code Blue session ────────────────────────────────────────
    const [activeSession] = await db
      .select()
      .from(codeBlueSessions)
      .where(
        and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")),
      );

    let codeBluePayload = null;
    if (activeSession) {
      const logEntries = await db
        .select()
        .from(codeBlueLogEntries)
        .where(eq(codeBlueLogEntries.sessionId, activeSession.id))
        .orderBy(codeBlueLogEntries.elapsedMs);

      const presence = await db
        .select()
        .from(codeBluePresence)
        .where(eq(codeBluePresence.sessionId, activeSession.id));

      let patientName: string | null = null;
      let patientWeight: number | null = null;
      let patientSpecies: string | null = null;
      let cbWard: string | null = null;
      let cbBay: string | null = null;

      if (activeSession.patientId) {
        const [animal] = await db
          .select()
          .from(animals)
          .where(eq(animals.id, activeSession.patientId));
        if (animal) {
          patientName = animal.name;
          patientWeight = animal.weightKg;
          patientSpecies = animal.species;
        }
        const [cbHosp] = await db
          .select()
          .from(hospitalizations)
          .where(
            and(
              eq(hospitalizations.animalId, activeSession.patientId),
              notInArray(hospitalizations.status, ["discharged", "deceased"]),
            ),
          );
        if (cbHosp) {
          cbWard = cbHosp.ward;
          cbBay = cbHosp.bay;
        }
      }

      codeBluePayload = {
        id: activeSession.id,
        startedAt: activeSession.startedAt.toISOString(),
        managerUserName: activeSession.managerUserName,
        patientId: activeSession.patientId,
        patientName,
        patientWeight,
        patientSpecies,
        ward: cbWard,
        bay: cbBay,
        preCheckPassed: activeSession.preCheckPassed,
        pushSentAt: activeSession.startedAt.toISOString(),
        logEntries: logEntries.map((e) => ({
          elapsedMs: e.elapsedMs,
          label: e.label,
          category: e.category,
          loggedByName: e.loggedByName,
        })),
        presence: presence.map((p) => ({
          userId: p.userId,
          userName: p.userName,
          lastSeenAt: p.lastSeenAt.toISOString(),
        })),
      };
    }

    // ── Build response ─────────────────────────────────────────────────────
    const hospData = hospRows.map(({ hosp, animal }) => {
      const overdueList = overdueByAnimal.get(hosp.animalId) ?? [];
      let overdueLabel: string | null = null;
      if (overdueList.length > 0) {
        const first = overdueList[0];
        const minutesLate = Math.floor((now.getTime() - first.startTime.getTime()) / 60_000);
        const drugName = first.notes ?? "תרופה";
        const timeStr = first.startTime.toLocaleTimeString("he-IL", {
          hour: "2-digit",
          minute: "2-digit",
        });
        overdueLabel = `${drugName} — ${timeStr} (${minutesLate} דק׳ באיחור)`;
      }
      return {
        id: hosp.id,
        status: hosp.status,
        ward: hosp.ward,
        bay: hosp.bay,
        admittingVetName: hosp.admittingVetName,
        admittedAt: hosp.admittedAt.toISOString(),
        animal: {
          name: animal.name,
          species: animal.species,
          breed: animal.breed,
          weightKg: animal.weightKg,
        },
        overdueTaskCount: overdueList.length,
        overdueTaskLabel: overdueLabel,
      };
    });

    res.json({
      currentTime: now.toISOString(),
      currentShift: shiftRows.map((s) => ({
        employeeName: s.employeeName,
        role: s.role,
      })),
      hospitalizations: hospData,
      equipment: equipRows.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        inUse: !!e.checkedOutAt,
        location: e.checkedOutLocation ?? e.location ?? null,
      })),
      upcomingTasks: upcomingRows.map((r) => ({
        id: r.id,
        startTime: r.startTime.toISOString(),
        taskType: r.taskType,
        notes: r.notes,
        animalName: r.animalName,
        status: r.status,
      })),
      activeAlertCount: alertCountRow?.count ?? 0,
      totalOverdueCount: overdueRows.filter((r) => r.animalId).length,
      crashCartStatus: latestCart
        ? {
            lastCheckedAt: latestCart.performedAt.toISOString(),
            allPassed: latestCart.allPassed,
            performedByName: latestCart.performedByName,
          }
        : null,
      codeBlueSession: codeBluePayload,
    });
  } catch (err) {
    console.error("[display snapshot]", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SNAPSHOT_FAILED",
        message: "Failed to load display snapshot",
        requestId,
      }),
    );
  }
});

export default router;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no type errors. If you see an error about `isNull(appointments.animalId)` in the overdue query, simplify the `where` to:

```typescript
.where(
  and(
    eq(appointments.clinicId, clinicId),
    inArray(appointments.status, ["pending", "assigned"]),
    lt(appointments.startTime, now),
    sql`${appointments.animalId} is not null`,
  ),
)
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/display.ts
git commit -m "feat(ward-display): add GET /api/display/snapshot endpoint"
```

---

## Task 5: Register Router

**Files:**
- Modify: `server/app/routes.ts`

- [ ] **Step 1: Add import** — at the top of `server/app/routes.ts`, alongside the other route imports:

```typescript
import displayRoutes from "../routes/display.js";
```

- [ ] **Step 2: Register the router** — inside `registerApiRoutes`, alongside similar registrations:

```typescript
app.use("/api/display", displayRoutes);
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add server/app/routes.ts
git commit -m "feat(ward-display): register /api/display router"
```

---

## Task 6: API Client

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add import** — at the top of `src/lib/api.ts`, add `DisplaySnapshot` to the existing import from `@/types`:

```typescript
import type { ..., DisplaySnapshot } from "@/types";
// (Add DisplaySnapshot to whatever type import already exists)
```

- [ ] **Step 2: Add the `display` namespace to the `api` object** — add it alongside other namespaces (e.g., near `codeBlue`):

```typescript
display: {
  snapshot: (): Promise<DisplaySnapshot> =>
    request<DisplaySnapshot>("/api/display/snapshot"),
},
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(ward-display): add api.display.snapshot() client function"
```

---

## Task 7: Polling Hook

**Files:**
- Create: `src/hooks/useDisplaySnapshot.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/useDisplaySnapshot.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DisplaySnapshot } from "@/types";

export function useDisplaySnapshot(): DisplaySnapshot | undefined {
  const { data } = useQuery<DisplaySnapshot>({
    queryKey: ["/api/display/snapshot"],
    queryFn: () => api.display.snapshot(),
    // Polls faster during Code Blue, slower otherwise
    refetchInterval: (query) => {
      const snapshot = query.state.data as DisplaySnapshot | undefined;
      return snapshot?.codeBlueSession ? 2_000 : 5_000;
    },
    // Always poll even when the tab is in the background (this is a room display)
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
    // On error: keep showing last-known state (read-only display, no queue needed)
    placeholderData: (previous) => previous,
    retry: false,
  });
  return data;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDisplaySnapshot.ts
git commit -m "feat(ward-display): add useDisplaySnapshot polling hook"
```

---

## Task 8: Normal Mode Page

**Files:**
- Create: `src/pages/display.tsx`

This task builds the full normal-mode layout. The Code Blue overlay is added in Task 9.

- [ ] **Step 1: Create the page file with all normal-mode components**

```tsx
// src/pages/display.tsx
import { useEffect, useState } from "react";
import { useDisplaySnapshot } from "@/hooks/useDisplaySnapshot";
import type {
  DisplaySnapshot,
  DisplaySnapshotHospitalization,
  DisplaySnapshotEquipment,
  DisplaySnapshotTask,
  DisplaySnapshotCodeBlueSession,
  HospitalizationStatus,
} from "@/types";

// ── Status lookup tables ────────────────────────────────────────────────────

const STATUS_ORDER: Record<HospitalizationStatus, number> = {
  critical: 0,
  observation: 1,
  admitted: 2,
  recovering: 3,
  discharged: 4,
  deceased: 5,
};

const STATUS_LABELS_HE: Record<HospitalizationStatus, string> = {
  critical: "קריטי",
  observation: "תצפית",
  admitted: "מאושפז",
  recovering: "התאוששות",
  discharged: "שוחרר",
  deceased: "נפטר",
};

const STATUS_CARD: Record<HospitalizationStatus, string> = {
  critical: "bg-red-950/40 border-red-700/50",
  observation: "bg-amber-950/30 border-amber-700/40",
  admitted: "bg-indigo-950/30 border-indigo-600/30",
  recovering: "bg-green-950/20 border-green-700/30",
  discharged: "bg-white/5 border-white/10",
  deceased: "bg-white/5 border-white/10",
};

const STATUS_BAR: Record<HospitalizationStatus, string> = {
  critical: "bg-red-600",
  observation: "bg-amber-600",
  admitted: "bg-indigo-500",
  recovering: "bg-green-600",
  discharged: "bg-gray-600",
  deceased: "bg-gray-600",
};

const STATUS_BADGE: Record<HospitalizationStatus, string> = {
  critical: "bg-red-600 text-white",
  observation: "bg-amber-600 text-white",
  admitted: "bg-indigo-500 text-white",
  recovering: "bg-green-600 text-white",
  discharged: "bg-gray-600 text-white",
  deceased: "bg-gray-700 text-white",
};

const SHIFT_ROLE_LABELS: Record<string, string> = {
  admin: "מנהל",
  technician: "טכנאי",
  senior_technician: "טכנאי בכיר",
};

// ── AwarenessBar ─────────────────────────────────────────────────────────────

function AwarenessBar({ snapshot }: { snapshot: DisplaySnapshot }) {
  const now = new Date(snapshot.currentTime);
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const cart = snapshot.crashCartStatus;
  const cartAgeHours = cart
    ? Math.round((Date.now() - new Date(cart.lastCheckedAt).getTime()) / 3_600_000)
    : null;
  const cartOk = cart !== null && cartAgeHours !== null && cartAgeHours < 24;

  const firstOverdue = snapshot.hospitalizations.find((h) => h.overdueTaskCount > 0);
  const extraOverdue = snapshot.totalOverdueCount > 1 ? snapshot.totalOverdueCount - 1 : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-[#141922] border-b border-[#1e2740] text-sm flex-wrap">
      <span className="font-mono text-xl font-bold text-white tabular-nums min-w-[52px]">
        {timeStr}
      </span>
      <div className="w-px h-5 bg-[#2d3748] shrink-0" />

      <div className="flex gap-2 flex-wrap">
        {snapshot.currentShift.map((s) => (
          <div
            key={s.employeeName}
            className="flex items-center gap-1.5 bg-[#1e2740] border border-[#2d3d5c] rounded-full px-3 py-0.5 text-[11px] text-blue-300"
          >
            <span>{s.employeeName}</span>
            <span className="text-gray-500 text-[10px]">
              {SHIFT_ROLE_LABELS[s.role] ?? s.role}
            </span>
          </div>
        ))}
      </div>

      <div className="w-px h-5 bg-[#2d3748] shrink-0" />

      {cartOk ? (
        <span className="flex items-center gap-1 bg-green-900/30 border border-green-700/40 text-green-300 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
          ✓ עגלה נבדקה · {cartAgeHours} שע׳
        </span>
      ) : (
        <span className="flex items-center gap-1 bg-amber-900/20 border border-amber-700/40 text-yellow-300 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
          ⚠ עגלה לא נבדקה היום
        </span>
      )}

      {snapshot.activeAlertCount > 0 && (
        <span className="flex items-center gap-1 bg-amber-900/20 border border-amber-700/40 text-yellow-300 rounded px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
          ⚠ {snapshot.activeAlertCount} התראות
        </span>
      )}

      {snapshot.totalOverdueCount > 0 && firstOverdue && (
        <span className="flex items-center gap-1 bg-red-900/30 border border-red-600/60 text-red-300 rounded px-2.5 py-1 text-[11px] font-semibold animate-pulse whitespace-nowrap">
          💊 תרופה באיחור — {firstOverdue.animal.name}
          {extraOverdue > 0 && ` ועוד ${extraOverdue}`}
        </span>
      )}

      <span className="mr-auto flex items-center bg-white/5 border border-white/10 text-gray-400 rounded px-2.5 py-1 text-[11px] whitespace-nowrap">
        {snapshot.hospitalizations.length} מאושפזים
      </span>
    </div>
  );
}

// ── PatientCard ───────────────────────────────────────────────────────────────

function PatientCard({ hosp }: { hosp: DisplaySnapshotHospitalization }) {
  const { animal } = hosp;
  const statusKey = hosp.status as HospitalizationStatus;
  const meta = [animal.species, animal.breed, animal.weightKg ? `${animal.weightKg} ק״ג` : null]
    .filter(Boolean)
    .join(" · ");
  const location = [hosp.ward, hosp.bay ? `מיטה ${hosp.bay}` : null].filter(Boolean).join(" · ");

  return (
    <div className={`rounded-lg p-3 border ${STATUS_CARD[statusKey] ?? "bg-white/5 border-white/10"}`}>
      <div className={`h-0.5 rounded mb-3 ${STATUS_BAR[statusKey] ?? "bg-gray-600"}`} />
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[statusKey] ?? "bg-gray-600 text-white"}`}>
          {STATUS_LABELS_HE[statusKey] ?? hosp.status}
        </span>
        {hosp.status === "critical" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-950 border border-red-600 text-red-300">
            CPR Risk
          </span>
        )}
      </div>
      <div className="text-[15px] font-bold text-white mb-0.5">{animal.name}</div>
      {meta && <div className="text-[11px] text-gray-500 mb-2">{meta}</div>}
      {location && <div className="text-[11px] text-gray-400">{location}</div>}
      {hosp.admittingVetName && (
        <div className="text-[11px] text-gray-500 mt-0.5">{hosp.admittingVetName}</div>
      )}
      {hosp.overdueTaskCount > 0 && hosp.overdueTaskLabel && (
        <div className="mt-2 rounded px-2 py-1.5 text-[10px] font-semibold text-red-300 border border-red-600/60 bg-red-950/30 animate-pulse">
          💊 {hosp.overdueTaskLabel}
        </div>
      )}
    </div>
  );
}

// ── PatientGrid ───────────────────────────────────────────────────────────────

function PatientGrid({
  hospitalizations,
}: {
  hospitalizations: DisplaySnapshotHospitalization[];
}) {
  const sorted = [...hospitalizations].sort((a, b) => {
    const orderDiff =
      (STATUS_ORDER[a.status as HospitalizationStatus] ?? 99) -
      (STATUS_ORDER[b.status as HospitalizationStatus] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.admittedAt).getTime() - new Date(b.admittedAt).getTime();
  });

  return (
    <div className="p-4 flex-1">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        מטופלים מאושפזים
      </div>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        {sorted.map((h) => (
          <PatientCard key={h.id} hosp={h} />
        ))}
      </div>
    </div>
  );
}

// ── EquipmentPane ─────────────────────────────────────────────────────────────

const EQ_STATUS_LABELS: Record<string, string> = {
  ok: "פנוי",
  sterilized: "פנוי",
  issue: "תקלה",
  critical: "קריטי",
  needs_attention: "דורש טיפול",
  maintenance: "תחזוקה",
};

const EQ_STATUS_CLASSES: Record<string, string> = {
  ok: "bg-indigo-900/20 text-indigo-300",
  sterilized: "bg-indigo-900/20 text-indigo-300",
  issue: "bg-red-900/25 text-red-300",
  critical: "bg-red-900/25 text-red-300",
  needs_attention: "bg-amber-900/20 text-yellow-300",
  maintenance: "bg-red-900/25 text-red-300",
};

function EquipmentPane({ equipment }: { equipment: DisplaySnapshotEquipment[] }) {
  const sorted = [...equipment].sort((a, b) => {
    if (a.inUse !== b.inUse) return a.inUse ? -1 : 1;
    return a.name.localeCompare(b.name, "he");
  });

  return (
    <div className="p-4 border-b border-[#1f2937]">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        ציוד · מיקום ושימוש
      </div>
      <div>
        {sorted.map((eq) => (
          <div
            key={eq.id}
            className="flex items-start justify-between py-1.5 border-b border-[#1a1f2b] last:border-0"
          >
            <div className="min-w-0 ml-2">
              <div className="text-[12px] text-gray-300 truncate">{eq.name}</div>
              <div className="text-[10px] text-gray-500 truncate">
                {eq.location ?? "—"}
              </div>
            </div>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                eq.inUse
                  ? "bg-green-900/30 text-green-300"
                  : (EQ_STATUS_CLASSES[eq.status] ?? "bg-white/5 text-gray-400")
              }`}
            >
              {eq.inUse ? "בשימוש" : (EQ_STATUS_LABELS[eq.status] ?? eq.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── UpcomingTasksPane ─────────────────────────────────────────────────────────

function UpcomingTasksPane({
  tasks,
  currentTime,
}: {
  tasks: DisplaySnapshotTask[];
  currentTime: string;
}) {
  const now = new Date(currentTime);
  const displayed = tasks.slice(0, 6);
  const overflow = tasks.length - displayed.length;

  return (
    <div className="p-4">
      <div className="text-[11px] font-bold tracking-widest uppercase text-gray-600 mb-3">
        פרוצדורות קרובות · 2 שע׳
      </div>
      <div>
        {displayed.map((task) => {
          const taskTime = new Date(task.startTime);
          const minutesUntil = Math.round((taskTime.getTime() - now.getTime()) / 60_000);
          const soon = minutesUntil <= 30;
          const timeLabel = taskTime.toLocaleTimeString("he-IL", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const isMed = task.taskType === "medication";
          return (
            <div
              key={task.id}
              className="flex items-center gap-2 py-1.5 border-b border-[#1a1f2b] last:border-0 text-[12px]"
            >
              <span
                className={`min-w-[38px] tabular-nums ${
                  soon ? "text-yellow-300 font-bold" : "text-gray-500"
                }`}
              >
                {timeLabel}
              </span>
              <span className="flex-1 text-gray-300 truncate">
                {task.notes ?? task.taskType ?? "משימה"} — {task.animalName}
              </span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                  isMed
                    ? "bg-violet-900/30 text-violet-300"
                    : "bg-sky-900/20 text-sky-300"
                }`}
              >
                {isMed ? "תרופה" : "פרוצדורה"}
              </span>
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="text-[11px] text-gray-600 py-1">+{overflow} נוספים</div>
        )}
      </div>
    </div>
  );
}

// ── CodeBlueOverlay placeholder (filled in Task 9) ────────────────────────────

function CodeBlueOverlay(_props: {
  session: DisplaySnapshotCodeBlueSession;
  hospitalizations: DisplaySnapshotHospitalization[];
}) {
  return <div className="min-h-screen bg-[#0d0505]" />;
}

// ── WardDisplayPage ───────────────────────────────────────────────────────────

export default function WardDisplayPage() {
  const snapshot = useDisplaySnapshot();

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-gray-500 text-sm">טוען...</div>
      </div>
    );
  }

  if (snapshot.codeBlueSession) {
    return (
      <CodeBlueOverlay
        session={snapshot.codeBlueSession}
        hospitalizations={snapshot.hospitalizations}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200 flex flex-col" dir="rtl">
      <AwarenessBar snapshot={snapshot} />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <PatientGrid hospitalizations={snapshot.hospitalizations} />
        </div>
        <div className="w-[420px] shrink-0 border-r border-[#1f2937] flex flex-col overflow-auto">
          <EquipmentPane equipment={snapshot.equipment} />
          <UpcomingTasksPane tasks={snapshot.upcomingTasks} currentTime={snapshot.currentTime} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/display.tsx
git commit -m "feat(ward-display): add normal mode page — AwarenessBar, PatientGrid, EquipmentPane, UpcomingTasksPane"
```

---

## Task 9: Code Blue Overlay

**Files:**
- Modify: `src/pages/display.tsx`

Replace the placeholder `CodeBlueOverlay` function from Task 8 with the full implementation.

- [ ] **Step 1: Locate the placeholder** — find `function CodeBlueOverlay(_props: {` in `src/pages/display.tsx`. Replace it entirely.

- [ ] **Step 2: Replace with full implementation**

```tsx
function CodeBlueOverlay({
  session,
  hospitalizations,
}: {
  session: DisplaySnapshotCodeBlueSession;
  hospitalizations: DisplaySnapshotHospitalization[];
}) {
  // Live timer — updates every second using server startedAt (not local clock)
  const [elapsedMs, setElapsedMs] = useState(
    () => Date.now() - new Date(session.startedAt).getTime(),
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - new Date(session.startedAt).getTime());
    }, 1_000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
  const timerStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const staleThreshold = Date.now() - 30_000;
  const activePresence = session.presence.filter(
    (p) => new Date(p.lastSeenAt).getTime() > staleThreshold,
  );

  const minutesSincePush = session.pushSentAt
    ? Math.floor((Date.now() - new Date(session.pushSentAt).getTime()) / 60_000)
    : null;

  const attachedEquipment = session.logEntries.filter((e) => e.category === "equipment");
  // Show last 15 entries — enough to fill the column without scroll
  const displayedLogs = session.logEntries.slice(-15);

  const remaining = hospitalizations.filter(
    (h) => !session.patientId || h.id !== session.patientId,
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#0d0505]" dir="rtl">
      {/* Pulsing red header */}
      <div className="flex items-center gap-4 px-6 py-4 bg-red-600 animate-pulse flex-wrap">
        <span className="text-2xl font-black tracking-wider text-white">⚠ CODE BLUE</span>
        <span className="font-mono text-[22px] font-bold text-white bg-black/25 px-3 py-1 rounded tabular-nums">
          {timerStr}
        </span>
        <span className="text-[14px] text-white/85 mr-auto">
          מנהל הפצה: {session.managerUserName}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {activePresence.map((p) => (
            <div
              key={p.userId}
              className="flex items-center gap-1.5 bg-red-900/40 border border-red-600/40 rounded-full px-3 py-0.5 text-[11px] text-red-200"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping shrink-0" />
              {p.userName}
            </div>
          ))}
        </div>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 divide-x divide-red-900/30 divide-x-reverse">
        {/* Column 1 — Patient */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            מטופל
          </div>
          {session.patientName ? (
            <>
              <div className="text-[20px] font-bold text-white mb-1">{session.patientName}</div>
              <div className="text-[13px] text-red-200 leading-loose">
                {[
                  session.patientSpecies,
                  session.patientWeight ? `${session.patientWeight} ק״ג` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {(session.ward || session.bay) && (
                  <>
                    <br />
                    {[session.ward, session.bay ? `מיטה ${session.bay}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </>
                )}
              </div>
              <div className="mt-3 text-red-500 font-bold text-[13px]">⚠ CPR Risk</div>
            </>
          ) : (
            <div className="text-gray-500 text-[13px]">מטופל לא צוין</div>
          )}
          {attachedEquipment.length > 0 && (
            <div className="mt-5">
              <div className="text-[10px] font-bold tracking-[.08em] uppercase text-red-700/60 mb-2">
                ציוד מחובר
              </div>
              {attachedEquipment.map((e, i) => (
                <div key={i} className="text-[12px] text-red-200 mb-1">
                  {e.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2 — Event timeline */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            יומן אירוע
          </div>
          <div className="space-y-2">
            {displayedLogs.map((entry, i) => {
              const em = Math.floor(entry.elapsedMs / 60_000);
              const es = Math.floor((entry.elapsedMs % 60_000) / 1_000);
              const entryTime = `${String(em).padStart(2, "0")}:${String(es).padStart(2, "0")}`;
              return (
                <div key={i} className="flex gap-2 text-[12px]">
                  <span className="text-red-500 tabular-nums min-w-[42px] text-[11px] shrink-0">
                    {entryTime}
                  </span>
                  <span className="flex-1 text-red-200">{entry.label}</span>
                  <span className="text-gray-600 text-[10px] shrink-0">{entry.loggedByName}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3 — Sidebar */}
        <div className="w-64 shrink-0 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            שאר המאושפזים
          </div>
          <div className="space-y-1 mb-5">
            {remaining.map((h) => (
              <div key={h.id} className="text-[12px] text-gray-400">
                {h.animal.name} · {h.ward} {h.bay} ·{" "}
                <span
                  className={
                    h.status === "critical"
                      ? "text-red-400"
                      : h.status === "observation"
                        ? "text-amber-400"
                        : "text-green-400"
                  }
                >
                  {STATUS_LABELS_HE[h.status as HospitalizationStatus] ?? h.status}
                </span>
              </div>
            ))}
          </div>

          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
            עגלת חירום
          </div>
          <div className="text-[12px] text-green-400 mb-4">✓ זמינה</div>

          {minutesSincePush !== null && (
            <>
              <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
                הודעות
              </div>
              <div className="text-[11px] text-gray-400">
                📱 Push נשלח לכל הצוות
                <br />
                <span className="text-gray-600 text-[10px]">לפני {minutesSincePush} דק׳</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/display.tsx
git commit -m "feat(ward-display): add CodeBlueOverlay full-screen takeover"
```

---

## Task 10: Route Registration

**Files:**
- Modify: `src/app/routes.tsx`

- [ ] **Step 1: Add lazy import** — at the top of `src/app/routes.tsx`, alongside other lazy imports:

```typescript
const WardDisplayPage = lazy(() => import("@/pages/display"));
```

- [ ] **Step 2: Add route** — inside the `<Switch>` in `AppRoutes`, alongside the `/code-blue` route:

```tsx
<Route path="/display"><AuthGuard><WardDisplayPage /></AuthGuard></Route>
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Smoke-test** — start the dev server and navigate to `http://localhost:5173/display`. The page should load and show either the ward dashboard or the Code Blue overlay depending on clinic state.

```bash
npm run dev
# Open http://localhost:5173/display in browser
# Expected: dark background, awareness bar, patient grid, right rail
```

- [ ] **Step 5: Commit**

```bash
git add src/app/routes.tsx
git commit -m "feat(ward-display): register /display route"
```

---

## Task 11: Overdue Medication Push Notification Job

**Files:**
- Modify: `server/lib/queue.ts`
- Modify: `server/workers/notification.worker.ts`

### Part A — Add job type to queue.ts

- [ ] **Step 1: Find `NotificationJobData`** — in `server/lib/queue.ts`, find the `NotificationJobData` type union (currently ends with `shift_report_email`).

- [ ] **Step 2: Add new union member** — append to the end of the union:

```typescript
  | {
      type: "overdue_medication_alert";
      clinicId: string;
      userId: string;
      animalName: string;
      drugName: string;
      minutesLate: number;
      animalId: string;
    };
```

### Part B — Add scanner and job processor to notification.worker.ts

- [ ] **Step 3: Add imports** — at the top of `server/workers/notification.worker.ts`, find the existing db import line (the one that imports `db`, `appointments`, etc.) and add the imports needed for the new scanner:

```typescript
// Add to existing db import — check which symbols are already imported and add only what's missing:
// appointments, animals, shifts, eq, and, inArray, lt, lte, gte, isNull, sql
```

The exact import line already exists — just add any missing symbols. If `appointments` and `animals` are already imported, no change needed.

- [ ] **Step 4: Add `scanOverdueMedications` function** — add this function near `scanOverdueAndEnqueue` (around line 74):

```typescript
const OVERDUE_MED_SCAN_MS = 60_000;

async function scanOverdueMedications(): Promise<void> {
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);
  const nowTimeStr = now.toTimeString().slice(0, 5); // "HH:MM"

  // Find medication tasks that are overdue and not yet notified
  const overdueAppts = await db
    .select({
      id: appointments.id,
      clinicId: appointments.clinicId,
      animalId: appointments.animalId,
      animalName: animals.name,
      notes: appointments.notes,
      startTime: appointments.startTime,
      vetId: appointments.vetId,
    })
    .from(appointments)
    .innerJoin(animals, eq(appointments.animalId, animals.id))
    .where(
      and(
        eq(appointments.taskType, "medication"),
        inArray(appointments.status, ["pending", "assigned"]),
        lt(appointments.startTime, now),
        isNull(appointments.overdueNotifiedAt),
        sql`${appointments.animalId} is not null`,
      ),
    );

  for (const appt of overdueAppts) {
    if (!appt.animalId || !appt.clinicId) continue;

    const minutesLate = Math.floor((now.getTime() - appt.startTime.getTime()) / 60_000);
    const drugName = appt.notes ?? "תרופה";

    if (appt.vetId) {
      // Notify the assigned vet directly
      await enqueueNotificationJob({
        type: "overdue_medication_alert",
        clinicId: appt.clinicId,
        userId: appt.vetId,
        animalName: appt.animalName,
        drugName,
        minutesLate,
        animalId: appt.animalId,
      });
    }

    // Mark as notified to prevent re-firing on next scan
    await db
      .update(appointments)
      .set({ overdueNotifiedAt: now })
      .where(eq(appointments.id, appt.id));
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("OVERDUE_MED_SCAN", { count: overdueAppts.length });
  }
}
```

- [ ] **Step 5: Add job processor** — inside `processSendNotification`, after the `automation_push_user` block (around line 113):

```typescript
  if (data.type === "overdue_medication_alert") {
    await withTimeout(
      sendPushToUser(data.clinicId, data.userId, {
        title: "💊 תרופה באיחור",
        body: `${data.animalName} — ${data.drugName} · ${data.minutesLate} דק׳ באיחור`,
        tag: `overdue-med-${data.animalId}`,
        url: `/patients/${data.animalId}`,
      }),
      5_000,
      "overdue medication alert",
    );
    return;
  }
```

- [ ] **Step 6: Register the repeatable job** — in the worker startup section, near where `scan_overdue_reminders` is registered (around line 380):

```typescript
  await queue.add(
    "scan_overdue_medications",
    {},
    {
      jobId: "repeat-overdue-medications",
      repeat: { every: OVERDUE_MED_SCAN_MS },
      removeOnComplete: 100,
    },
  );
```

- [ ] **Step 7: Handle the job name** — in the worker's job processor switch (near line 427):

```typescript
        } else if (job.name === "scan_overdue_medications") {
          await scanOverdueMedications();
```

Add this alongside the existing `scan_overdue_reminders` handler.

- [ ] **Step 8: Add initial scan** — near line 399 alongside the other initial scans:

```typescript
  void scanOverdueMedications().catch((err) => console.error("[worker] initial overdue med scan failed:", err));
```

- [ ] **Step 9: Verify**

```bash
npx tsc --noEmit
```

Expected: no type errors. The `sendPushToUser` function already exists in the worker — verify its signature matches (it takes `clinicId, userId, { title, body, tag, url }`).

- [ ] **Step 10: Commit**

```bash
git add server/lib/queue.ts server/workers/notification.worker.ts
git commit -m "feat(ward-display): add overdue medication push notification job (60s scan)"
```

---

## Task 12: Tests

**Files:**
- Create: `tests/ward-display.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// tests/ward-display.test.js
import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";

const routeSource = readFileSync("./server/routes/display.ts", "utf-8");
const pageSource = readFileSync("./src/pages/display.tsx", "utf-8");
const hookSource = readFileSync("./src/hooks/useDisplaySnapshot.ts", "utf-8");
const workerSource = readFileSync("./server/workers/notification.worker.ts", "utf-8");
const queueSource = readFileSync("./server/lib/queue.ts", "utf-8");

describe("Ward Display — route", () => {
  it("GET /snapshot route is defined", () => {
    expect(routeSource).toMatch(/router\.get\(["']\/snapshot["']/);
  });

  it("route requires auth", () => {
    expect(routeSource).toContain("requireAuth");
  });

  it("response includes codeBlueSession field", () => {
    expect(routeSource).toContain("codeBlueSession");
  });

  it("response includes totalOverdueCount field", () => {
    expect(routeSource).toContain("totalOverdueCount");
  });

  it("equipment sorted: inUse first", () => {
    expect(pageSource).toContain("inUse");
    expect(pageSource).toMatch(/inUse.*?-1.*?1|a\.inUse.*?b\.inUse/s);
  });
});

describe("Ward Display — Code Blue mode", () => {
  it("WardDisplayPage renders CodeBlueOverlay when codeBlueSession is not null", () => {
    expect(pageSource).toContain("CodeBlueOverlay");
    expect(pageSource).toContain("codeBlueSession");
    // The page must branch on codeBlueSession
    expect(pageSource).toMatch(/snapshot\.codeBlueSession[\s\S]{0,30}CodeBlueOverlay/);
  });

  it("CodeBlueOverlay uses server startedAt for timer, not Date.now()", () => {
    // Timer must reference session.startedAt, not Date.now() alone
    expect(pageSource).toContain("session.startedAt");
    // Should not use Date.now() as the timer source directly
    const timerSection = pageSource.slice(pageSource.indexOf("CodeBlueOverlay"));
    expect(timerSection).toContain("startedAt");
  });

  it("CodeBlueOverlay is read-only — no buttons or click handlers", () => {
    const overlaySection = pageSource.slice(
      pageSource.indexOf("function CodeBlueOverlay"),
      pageSource.indexOf("function WardDisplayPage"),
    );
    expect(overlaySection).not.toContain("onClick");
    expect(overlaySection).not.toContain("<button");
    expect(overlaySection).not.toContain("<a href");
  });
});

describe("Ward Display — polling hook", () => {
  it("uses 2000ms interval when Code Blue session is active", () => {
    expect(hookSource).toContain("2_000");
    expect(hookSource).toContain("codeBlueSession");
  });

  it("uses 5000ms interval in normal mode", () => {
    expect(hookSource).toContain("5_000");
  });

  it("polls in background — refetchIntervalInBackground: true", () => {
    expect(hookSource).toContain("refetchIntervalInBackground: true");
  });

  it("keeps last-known state on error — placeholderData", () => {
    expect(hookSource).toContain("placeholderData");
    expect(hookSource).toContain("previous");
  });
});

describe("Ward Display — overdue medication job", () => {
  it("overdue_medication_alert is a valid NotificationJobData type", () => {
    expect(queueSource).toContain("overdue_medication_alert");
  });

  it("scan_overdue_medications job is registered as repeatable", () => {
    expect(workerSource).toContain("scan_overdue_medications");
    expect(workerSource).toContain("repeat-overdue-medications");
  });

  it("scanner sets overdueNotifiedAt to prevent duplicate notifications", () => {
    expect(workerSource).toContain("overdueNotifiedAt");
    expect(workerSource).toContain("scanOverdueMedications");
  });

  it("WardDisplayPage contains no interactive elements (read-only)", () => {
    // Full page should have no click handlers or buttons
    expect(pageSource).not.toContain("onClick");
    expect(pageSource).not.toContain("<button");
    expect(pageSource).not.toContain("<a href");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd C:/Users/Dan/Documents/GitHub/VetTrack
npx vitest run tests/ward-display.test.js
```

Expected: all tests pass. If any fail, fix the corresponding source file — do not relax the test.

- [ ] **Step 3: Commit**

```bash
git add tests/ward-display.test.js
git commit -m "test(ward-display): add static analysis tests (12 assertions)"
```

---

## Task 13: Remove /code-blue/display from Code Blue Plan

**Files:**
- Modify: `docs/superpowers/plans/2026-04-27-code-blue-redesign.md`

The ward display (`/display`) replaces Batch 5 of the Code Blue redesign plan. Strike it from the plan to prevent double-implementation.

- [ ] **Step 1: Find and update Batch 5** — in `docs/superpowers/plans/2026-04-27-code-blue-redesign.md`, find the section for Batch 5 (`CodeBlueDisplay` / `/code-blue/display`). Replace its content with:

```markdown
**Batch 5 — REPLACED by ward display**

> `/code-blue/display` is no longer implemented here. The `/display` route
> (implemented in `docs/superpowers/plans/2026-04-28-ward-display.md`) covers
> both the ward dashboard and the Code Blue room view in a single page.
> `src/pages/code-blue-display.tsx` is not created.
```

Also remove `src/pages/code-blue-display.tsx` from the File Map at the top of the plan.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-04-27-code-blue-redesign.md
git commit -m "docs: mark code-blue Batch 5 as replaced by ward-display plan"
```
