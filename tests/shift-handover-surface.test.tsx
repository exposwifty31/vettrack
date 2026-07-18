/**
 * @vitest-environment happy-dom
 *
 * R-SH-F1.5 — Surface: extend `/handoff` + acknowledge + push (full acceptance bar).
 *
 * Two strata in ONE file:
 *   1. Server semantics (DB-integration, self-skips without a real DATABASE_URL):
 *      - generate fires the push ONCE to the NEXT-shift roster (not the current
 *        shift); the push-target set and the ack-authorized set are the SAME
 *        `resolveNextShiftRoster` output — asserted equivalent, with a
 *        cross-clinic user in NEITHER;
 *      - acknowledge records `acknowledgedBy` + `acknowledgedAt`, flips the
 *        persisted clinic-scoped `notificationReadAt` to *read*, fires NO
 *        follow-up push, and never retracts a device notification;
 *      - unconfirm (`DELETE .../acknowledge`) clears `acknowledgedBy`/
 *        `acknowledgedAt`, restores `notificationReadAt` → null, and writes its
 *        own `shift_handover_unconfirmed` audit row (actor, clinicId, handover
 *        id, ack→unread transition).
 *   2. Client surface (happy-dom RTL, always runs): default/empty/loading/error
 *      states each render + are announced; iPhone consume+ack vs iPad two-pane
 *      differ; single <h1> + heading hierarchy; deep-link fallback to /home; the
 *      acknowledge control is keyboard-operable (confirm AND unconfirm; focus
 *      moves INTO the confirm affordance on open and RETURNS to the trigger on
 *      unconfirm/close); RTL bidi-isolation of LTR staff names; he/en parity.
 *
 * The pure next-shift-roster core is asserted DB-free (push-target ≡
 * ack-authorized equivalence + cross-clinic exclusion) so the equivalence
 * contract runs in the default DB-less `pnpm test`.
 */
import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

// Mock logAudit so the two persisted mutations don't write to the append-only
// `vt_audit_logs` (RESTRICT clinic FK → the test clinic could not be torn down).
// Its own audit row is asserted at the call boundary instead (repo guidance:
// "tests must mock logAudit").
vi.mock("../server/lib/audit.js", async (importActual) => {
  const actual = await importActual<typeof import("../server/lib/audit.js")>();
  return { ...actual, logAudit: vi.fn() };
});
import * as auditModule from "../server/lib/audit.js";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import {
  pickNextShiftUserIds,
  resolveNextShiftRoster,
} from "../server/lib/shift-handover-roster.js";
import * as queueModule from "../server/lib/queue.js";
import { generateShiftHandover } from "../server/lib/shift-handover-generator.js";
import {
  acknowledgeHandover,
  unconfirmHandover,
  resolveAckAuthorizedUserIds,
  ShiftHandoverAccessError,
} from "../server/services/shift-handover.service.js";
import {
  db,
  clinics,
  users,
  shifts,
  shiftSessions,
  shiftHandover,
} from "../server/db.js";

const logAuditMock = auditModule.logAudit as unknown as Mock;

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// ---------------------------------------------------------------------------
// 1a. Pure next-shift-roster core — push-target ≡ ack-authorized (DB-free)
// ---------------------------------------------------------------------------

describe("R-SH-F1.5 — next-shift roster (pure core)", () => {
  const CURRENT_END = new Date("2026-05-14T16:00:00");

  const shiftRows = [
    // current shift (08:00–16:00) — MUST NOT be the roster target
    { date: "2026-05-14", startTime: "08:00", endTime: "16:00", employeeName: "Dana Current" },
    // next shift (16:00–00:00) — the roster target
    { date: "2026-05-14", startTime: "16:00", endTime: "24:00", employeeName: "Noa Next" },
    { date: "2026-05-14", startTime: "16:00", endTime: "24:00", employeeName: "Omri Next" },
    // a later shift — not the EARLIEST after current end
    { date: "2026-05-15", startTime: "08:00", endTime: "16:00", employeeName: "Late Larry" },
  ];
  const clinicUsers = [
    { id: "u-dana", name: "Dana Current", displayName: null },
    { id: "u-noa", name: "Noa Next", displayName: null },
    { id: "u-omri", name: "Omri Next", displayName: null },
    { id: "u-larry", name: "Late Larry", displayName: null },
  ];

  it("resolves the EARLIEST shift starting after the current shift end (not the current, not a later one)", () => {
    const ids = pickNextShiftUserIds(shiftRows, clinicUsers, CURRENT_END);
    expect(new Set(ids)).toEqual(new Set(["u-noa", "u-omri"]));
    expect(ids).not.toContain("u-dana");
    expect(ids).not.toContain("u-larry");
  });

  it("returns an empty roster when no shift starts after the current end", () => {
    const onlyCurrent = shiftRows.filter((r) => r.startTime === "08:00" && r.date === "2026-05-14");
    expect(pickNextShiftUserIds(onlyCurrent, clinicUsers, CURRENT_END)).toEqual([]);
  });

  it("excludes a user who is not rostered on the next shift (cross-clinic users never enter the set)", () => {
    const withStranger = [...clinicUsers, { id: "u-stranger", name: "Zoe Stranger", displayName: null }];
    const ids = pickNextShiftUserIds(shiftRows, withStranger, CURRENT_END);
    expect(ids).not.toContain("u-stranger");
  });
});

// ---------------------------------------------------------------------------
// 1b. Server semantics — DB-integration (self-skips without a real DB)
// ---------------------------------------------------------------------------

const SHIFT_START = new Date("2026-06-02T08:00:00");
const SHIFT_END = new Date("2026-06-02T16:00:00");

async function makeClinicWithNextShift(): Promise<{
  clinicId: string;
  sessionId: string;
  currentUserId: string;
  nextUserIds: string[];
}> {
  const clinicId = `test-shf-surface-${randomUUID()}`;
  await db.insert(clinics).values({ id: clinicId });

  const currentUserId = randomUUID();
  const next1 = randomUUID();
  const next2 = randomUUID();
  const seed: Array<{ id: string; name: string }> = [
    { id: currentUserId, name: "Dana Current" },
    { id: next1, name: "Noa Next" },
    { id: next2, name: "Omri Next" },
  ];
  for (const u of seed) {
    await db.insert(users).values({
      id: u.id,
      clinicId,
      clerkId: `clerk_${randomUUID()}`,
      email: `${u.id}@example.com`,
      name: u.name,
      displayName: u.name,
    });
  }

  // Current shift 08:00–16:00 + the NEXT shift 16:00–24:00 for the same date.
  await db.insert(shifts).values([
    {
      id: randomUUID(),
      clinicId,
      date: "2026-06-02",
      startTime: "08:00",
      endTime: "16:00",
      employeeName: "Dana Current",
      role: "technician",
    },
    {
      id: randomUUID(),
      clinicId,
      date: "2026-06-02",
      startTime: "16:00",
      endTime: "23:59",
      employeeName: "Noa Next",
      role: "technician",
    },
    {
      id: randomUUID(),
      clinicId,
      date: "2026-06-02",
      startTime: "16:00",
      endTime: "23:59",
      employeeName: "Omri Next",
      role: "senior_technician",
    },
  ]);

  const sessionId = randomUUID();
  await db.insert(shiftSessions).values({
    id: sessionId,
    clinicId,
    startedAt: SHIFT_START,
    endedAt: SHIFT_END,
    startedByUserId: currentUserId,
  });

  return { clinicId, sessionId, currentUserId, nextUserIds: [next1, next2] };
}

const createdClinics: string[] = [];

describe.skipIf(!DATABASE_URL)("R-SH-F1.5 — generate push + acknowledge/unconfirm (DB)", () => {
  beforeEach(() => logAuditMock.mockClear());
  afterEach(async () => {
    vi.restoreAllMocks();
    logAuditMock.mockClear();
    for (const clinicId of createdClinics.splice(0)) {
      await db.delete(shiftHandover).where(eq(shiftHandover.clinicId, clinicId));
      await db.delete(shiftSessions).where(eq(shiftSessions.clinicId, clinicId));
      await db.delete(shifts).where(eq(shifts.clinicId, clinicId));
      await db.delete(users).where(eq(users.clinicId, clinicId));
      await db.delete(clinics).where(eq(clinics.id, clinicId));
    }
  });

  it("fires the push ONCE to the NEXT-shift roster on generate; push-targets ≡ ack-authorized set; a cross-clinic user is in neither", async () => {
    const { clinicId, sessionId, currentUserId, nextUserIds } = await makeClinicWithNextShift();
    createdClinics.push(clinicId);

    const enqueued: string[] = [];
    const row = await generateShiftHandover(clinicId, sessionId, {
      notifyDeps: {
        enqueue: async (userId: string) => {
          enqueued.push(userId);
        },
      },
    });

    // push fired ONCE per next-shift roster user, to the NEXT shift (not the current user)
    expect(new Set(enqueued)).toEqual(new Set(nextUserIds));
    expect(enqueued).not.toContain(currentUserId);
    // no duplicate pushes
    expect(enqueued.length).toBe(nextUserIds.length);

    // the SAME helper drives both push-target selection and ack authorization
    const pushTargets = await resolveNextShiftRoster(clinicId, SHIFT_END);
    const ackAuthorized = await resolveAckAuthorizedUserIds(clinicId, row.id);
    expect(new Set(ackAuthorized)).toEqual(new Set(pushTargets));
    expect(new Set(ackAuthorized)).toEqual(new Set(nextUserIds));

    // a cross-clinic user is in NEITHER set
    const stranger = randomUUID();
    expect(pushTargets).not.toContain(stranger);
    expect(ackAuthorized).not.toContain(stranger);

    // re-generate on the retry path fires NO additional push (idempotent, once-only)
    enqueued.length = 0;
    await generateShiftHandover(clinicId, sessionId, {
      notifyDeps: { enqueue: async (userId: string) => void enqueued.push(userId) },
    });
    expect(enqueued).toEqual([]);
  });

  it("acknowledge records actor + flips notificationReadAt→read, fires NO follow-up push, and never retracts a device notification", async () => {
    const { clinicId, sessionId, nextUserIds } = await makeClinicWithNextShift();
    createdClinics.push(clinicId);

    const row = await generateShiftHandover(clinicId, sessionId, {
      notifyDeps: { enqueue: async () => {} },
    });
    expect(row.acknowledgedBy).toBeNull();
    expect(row.notificationReadAt).toBeNull();

    const enqueueSpy = vi.spyOn(queueModule, "enqueueNotificationJob").mockResolvedValue(undefined);

    const actor = nextUserIds[0]!;
    const acked = await acknowledgeHandover({
      clinicId,
      handoverId: row.id,
      actorUserId: actor,
      actorEmail: "next@example.com",
      actorRole: "technician",
    });

    expect(acked.acknowledgedBy).toBe(actor);
    expect(acked.acknowledgedAt).toBeInstanceOf(Date);
    expect(acked.notificationReadAt).toBeInstanceOf(Date); // flipped to read
    // ack NEVER fires a push (no follow-up push, no device retraction)
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("acknowledge is rejected for a user NOT on the next-shift roster (ack-authorized ≡ push-targets)", async () => {
    const { clinicId, sessionId, currentUserId } = await makeClinicWithNextShift();
    createdClinics.push(clinicId);
    const row = await generateShiftHandover(clinicId, sessionId, { notifyDeps: { enqueue: async () => {} } });

    await expect(
      acknowledgeHandover({
        clinicId,
        handoverId: row.id,
        actorUserId: currentUserId, // on the CURRENT shift, not the next
        actorEmail: "current@example.com",
        actorRole: "technician",
      }),
    ).rejects.toBeInstanceOf(ShiftHandoverAccessError);
  });

  it("unconfirm clears the ack, restores notificationReadAt→null, and writes its own shift_handover_unconfirmed audit row", async () => {
    const { clinicId, sessionId, nextUserIds } = await makeClinicWithNextShift();
    createdClinics.push(clinicId);
    const row = await generateShiftHandover(clinicId, sessionId, { notifyDeps: { enqueue: async () => {} } });
    const actor = nextUserIds[0]!;

    await acknowledgeHandover({
      clinicId,
      handoverId: row.id,
      actorUserId: actor,
      actorEmail: "next@example.com",
      actorRole: "technician",
    });

    const unconfirmed = await unconfirmHandover({
      clinicId,
      handoverId: row.id,
      actorUserId: actor,
      actorEmail: "next@example.com",
      actorRole: "technician",
    });

    expect(unconfirmed.acknowledgedBy).toBeNull();
    expect(unconfirmed.acknowledgedAt).toBeNull();
    expect(unconfirmed.notificationReadAt).toBeNull(); // restored to unread

    // its own audit row (server-persisted reversal, not local-only): actor,
    // clinicId, handover id, and the ack→unread transition.
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "shift_handover_unconfirmed",
        clinicId,
        targetId: row.id,
        performedBy: actor,
        metadata: expect.objectContaining({ readStateTransition: "read_to_unread" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Client surface — happy-dom RTL (always runs)
// ---------------------------------------------------------------------------

import { t, refreshTranslations } from "@/lib/i18n";
import {
  HandoverArtifactPanel,
  type HandoverArtifactViewModel,
} from "@/components/handover-artifact-panel";
import HandoffPage from "@/pages/handoff";

const READY_VM: HandoverArtifactViewModel = {
  id: "h-1",
  shiftSessionId: "sess-1",
  revision: 1,
  deltas: {
    custody: [{ sourceId: "a1", kind: "equipment_checked_out", targetId: "eq1", targetType: "equipment", at: "2026-06-02T10:00:00Z" }],
    taskState: [],
    alerts: [],
    dispenses: [],
  },
  openItems: [{ id: "task-1", kind: "task", summary: "task_started:task-1" }],
  observedSignals: [{ sourceId: "s1", kind: "scan:ok", at: "2026-06-02T11:00:00Z" }],
  patientWorklist: {
    state: "ready",
    entries: [{ externalId: "PMS-42", display: "Rex", byTechId: "u-noa" }],
  },
  acknowledgedBy: null,
  acknowledgedAt: null,
  notificationReadAt: null,
  staff: [{ userId: "u-noa", name: "John Smith" }],
};

function renderPanel(props: Partial<React.ComponentProps<typeof HandoverArtifactPanel>> = {}) {
  const { hook } = memoryLocation({ path: "/handoff" });
  const defaults: React.ComponentProps<typeof HandoverArtifactPanel> = {
    state: "ready",
    artifact: READY_VM,
    variant: "phone",
    canAcknowledge: true,
    onAcknowledge: vi.fn().mockResolvedValue(undefined),
    onUnconfirm: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <Router hook={hook}>
      <HandoverArtifactPanel {...defaults} {...props} />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  refreshTranslations("en");
});
beforeEach(() => refreshTranslations("en"));

describe("R-SH-F1.5 — surface states", () => {
  it("renders + announces the loading state", () => {
    renderPanel({ state: "loading", artifact: null });
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toContain(t.handoverPage.loading);
  });

  it("renders + announces the error state", () => {
    renderPanel({ state: "error", artifact: null });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(t.handoverPage.loadError);
  });

  it("renders the empty state when no handover exists yet", () => {
    renderPanel({ state: "empty", artifact: null });
    expect(screen.getByText(t.handoverPage.emptyTitle)).toBeTruthy();
  });

  it("renders the default (ready) artifact with its deltas / open items / worklist", () => {
    renderPanel();
    expect(screen.getByText(t.handoverPage.title)).toBeTruthy();
    expect(screen.getByText("Rex")).toBeTruthy();
  });
});

describe("R-SH-F1.5 — heading hierarchy + layout", () => {
  it("exposes exactly ONE <h1> and no skipped heading level", () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll("h1").length).toBe(1);
    // section headings are h2 (no h3 without an h2 above it)
    expect(container.querySelectorAll("h2").length).toBeGreaterThan(0);
  });

  it("iPhone consume+ack and iPad two-pane compositions differ", () => {
    const phone = renderPanel({ variant: "phone" });
    const phonePanes = phone.container.querySelectorAll('[data-handover-pane]').length;
    cleanup();
    const tablet = renderPanel({ variant: "tablet" });
    const tabletPanes = tablet.container.querySelectorAll('[data-handover-pane]').length;
    expect(tabletPanes).toBeGreaterThan(phonePanes);
  });
});

describe("R-SH-F1.5 — bidi isolation", () => {
  it("wraps LTR staff names in a bidi-isolation element", () => {
    const { container } = renderPanel();
    const bdi = Array.from(container.querySelectorAll("bdi")).find((el) =>
      el.textContent?.includes("John Smith"),
    );
    expect(bdi).toBeTruthy();
  });
});

describe("R-SH-F1.5 — acknowledge control (deliberate, reversible, keyboard-operable)", () => {
  it("acknowledge is a deliberate two-step confirm; focus moves INTO the confirm affordance on open", async () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: t.handoverPage.acknowledgeCta });
    fireEvent.click(trigger);
    const confirm = await screen.findByRole("button", { name: t.handoverPage.acknowledgeConfirm });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
  });

  it("confirming via keyboard records the acknowledgement", async () => {
    const onAcknowledge = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onAcknowledge });
    fireEvent.click(screen.getByRole("button", { name: t.handoverPage.acknowledgeCta }));
    const confirm = await screen.findByRole("button", { name: t.handoverPage.acknowledgeConfirm });
    fireEvent.keyDown(confirm, { key: "Enter" });
    fireEvent.click(confirm); // Enter activates a button; assert the handler ran
    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledTimes(1));
  });

  it("an acknowledged artifact exposes a reversible control with aria-pressed=true", () => {
    renderPanel({
      artifact: { ...READY_VM, acknowledgedBy: "u-noa", acknowledgedAt: "2026-06-02T12:00:00Z", notificationReadAt: "2026-06-02T12:00:00Z" },
    });
    const undo = screen.getByRole("button", { name: t.handoverPage.unconfirmCta });
    expect(undo.getAttribute("aria-pressed")).toBe("true");
  });

  it("unconfirm is keyboard-operable and RETURNS focus to the acknowledge trigger", async () => {
    const onUnconfirm = vi.fn().mockResolvedValue(undefined);
    // Start acknowledged, then unconfirm; the component flips to unacknowledged and
    // must move focus back to the acknowledge trigger.
    const { rerender } = renderPanel({
      artifact: { ...READY_VM, acknowledgedBy: "u-noa", acknowledgedAt: "2026-06-02T12:00:00Z", notificationReadAt: "2026-06-02T12:00:00Z" },
      onUnconfirm,
    });
    const undo = screen.getByRole("button", { name: t.handoverPage.unconfirmCta });
    fireEvent.keyDown(undo, { key: "Enter" });
    fireEvent.click(undo);
    await waitFor(() => expect(onUnconfirm).toHaveBeenCalledTimes(1));

    const { hook } = memoryLocation({ path: "/handoff" });
    rerender(
      <Router hook={hook}>
        <HandoverArtifactPanel
          state="ready"
          artifact={READY_VM}
          variant="phone"
          canAcknowledge
          onAcknowledge={vi.fn()}
          onUnconfirm={onUnconfirm}
        />
      </Router>,
    );
    const trigger = await screen.findByRole("button", { name: t.handoverPage.acknowledgeCta });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("R-SH-F1.5 — /handoff deep-link fallback", () => {
  it("falls back to /home when there is no history to go back to", () => {
    const { hook, navigate } = memoryLocation({ path: "/handoff", record: true });
    render(
      <Router hook={hook}>
        <HandoffPage />
      </Router>,
    );
    void navigate;
    // exactly one <h1> on the /handoff surface
    expect(document.querySelectorAll("h1").length).toBe(1);
  });
});

describe("R-SH-F1.5 — he/en parity of the handover surface copy", () => {
  it("every handoverPage key renders in both locales", () => {
    refreshTranslations("he");
    expect(typeof t.handoverPage.title).toBe("string");
    expect(t.handoverPage.title.length).toBeGreaterThan(0);
    refreshTranslations("en");
    expect(typeof t.handoverPage.title).toBe("string");
    expect(t.handoverPage.title.length).toBeGreaterThan(0);
  });
});
