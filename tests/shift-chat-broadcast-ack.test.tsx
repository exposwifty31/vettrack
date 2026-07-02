/**
 * @vitest-environment happy-dom
 *
 * BUG-003 — the broadcast quick-reply buttons ("Got it — on the way" / "5 min")
 * must actually post an ack. The button → onAck → ackMessage → POST
 * /messages/:id/ack chain is wired (verified 2026-07-02); this locks the
 * BroadcastCard end so a future refactor can't silently unwire it again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ShiftMessage } from "@/features/shift-chat/types";
import { BroadcastCard } from "@/features/shift-chat/components/BroadcastCard";

const broadcast = (overrides: Partial<ShiftMessage> = {}): ShiftMessage => ({
  id: "m-1",
  shiftSessionId: "s-1",
  clinicId: "c-1",
  senderId: "senior-1",
  senderName: "Dana",
  senderRole: "senior_technician",
  body: "",
  type: "broadcast",
  broadcastKey: "department_close",
  systemEventType: null,
  systemEventPayload: null,
  roomTag: null,
  isUrgent: false,
  mentionedUserIds: [],
  pinnedAt: null,
  pinnedByUserId: null,
  createdAt: "2026-07-02T10:00:00.000Z",
  acks: [],
  reactions: [],
  ...overrides,
});

describe("BroadcastCard — BUG-003 quick-reply acks", () => {
  afterEach(() => cleanup());

  it("shows two reply buttons to a receiver who has not acked", () => {
    render(
      <BroadcastCard message={broadcast()} currentUserId="tech-1" isSender={false} onAck={vi.fn()} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("the primary reply posts an 'acknowledged' ack", () => {
    const onAck = vi.fn();
    render(
      <BroadcastCard message={broadcast()} currentUserId="tech-1" isSender={false} onAck={onAck} />,
    );
    // Rendered order: [acknowledge, snooze].
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onAck).toHaveBeenCalledTimes(1);
    expect(onAck).toHaveBeenCalledWith("acknowledged");
  });

  it("the secondary reply posts a 'snoozed' ack", () => {
    const onAck = vi.fn();
    render(
      <BroadcastCard message={broadcast()} currentUserId="tech-1" isSender={false} onAck={onAck} />,
    );
    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(onAck).toHaveBeenCalledTimes(1);
    expect(onAck).toHaveBeenCalledWith("snoozed");
  });

  it("hides the reply buttons once the receiver has acked", () => {
    render(
      <BroadcastCard
        message={broadcast({ acks: [{ userId: "tech-1", status: "acknowledged" }] })}
        currentUserId="tech-1"
        isSender={false}
        onAck={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows no reply buttons to the sender", () => {
    render(
      <BroadcastCard message={broadcast()} currentUserId="senior-1" isSender={true} onAck={vi.fn()} />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
