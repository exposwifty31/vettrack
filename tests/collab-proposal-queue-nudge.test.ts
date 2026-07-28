/**
 * VetTrack 2.0, Task 1.1 §1.5 (option 1, nudge-only) — `notifyProposalQueueChanged`.
 *
 * Binding contract this test enforces:
 *  - The emitted socket payload is EXACTLY `{ kind: "proposal_queue_changed" }` —
 *    no proposal id, kind, summary, or count ever rides this channel (the
 *    `/collab-ws` "never domain state" contract, `server/lib/realtime-collab/
 *    server.ts:1-9`).
 *  - It NEVER throws — not when the collab io singleton was never initialized
 *    (collab disabled / channel not started) and not when the underlying
 *    `io.to().emit()` call itself throws.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyProposalQueueChanged } from "../server/lib/realtime-collab/proposal-queue-nudge.js";
import { setCollabIo } from "../server/lib/realtime-collab/registry.js";
import { proposalQueueRoom } from "../server/lib/realtime-collab/rooms.js";

afterEach(() => {
  setCollabIo(undefined);
  vi.restoreAllMocks();
});

describe("notifyProposalQueueChanged — R-RTC-1 / Task 1.1 §1.5", () => {
  it("never throws when the collab io singleton was never initialized", () => {
    expect(() => notifyProposalQueueChanged("clinic-A")).not.toThrow();
  });

  it("emits exactly { kind: 'proposal_queue_changed' } to the clinic's proposal-queue room — no content", () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    setCollabIo({ to } as never);

    notifyProposalQueueChanged("clinic-A");

    expect(to).toHaveBeenCalledWith(proposalQueueRoom("clinic-A"));
    expect(emit).toHaveBeenCalledTimes(1);
    const [event, payload] = emit.mock.calls[0]!;
    expect(event).toBe("proposal-queue-changed");
    expect(payload).toEqual({ kind: "proposal_queue_changed" });
    expect(Object.keys(payload)).toEqual(["kind"]); // exactly one field — no id/summary/count
  });

  it("never throws even when io.to(...).emit(...) itself throws", () => {
    const to = vi.fn(() => ({
      emit: () => {
        throw new Error("boom");
      },
    }));
    setCollabIo({ to } as never);

    expect(() => notifyProposalQueueChanged("clinic-A")).not.toThrow();
  });

  it("scopes the room to the given clinicId — never a different clinic's room", () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    setCollabIo({ to } as never);

    notifyProposalQueueChanged("clinic-B");

    expect(to).toHaveBeenCalledWith(proposalQueueRoom("clinic-B"));
    expect(to).not.toHaveBeenCalledWith(proposalQueueRoom("clinic-A"));
  });
});
