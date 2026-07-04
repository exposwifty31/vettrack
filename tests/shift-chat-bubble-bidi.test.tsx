/**
 * @vitest-environment happy-dom
 *
 * Bubble bidi isolation — a Latin-script message body in the RTL panel
 * rendered "!Hi everyone" (trailing punctuation reordered by the Unicode
 * Bidi Algorithm) until the body was wrapped in <Bdi>, the same fix the
 * pinned banner received (2026-07-04 device audit, undeclared residue #2).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ShiftMessage } from "@/features/shift-chat/types";
import { MessageBubble } from "@/features/shift-chat/components/MessageBubble";

const message = (overrides: Partial<ShiftMessage> = {}): ShiftMessage => ({
  id: "m-1",
  shiftSessionId: "s-1",
  clinicId: "c-1",
  senderId: "tech-2",
  senderName: "Dana",
  senderRole: "vet_tech",
  body: "Hi everyone!",
  type: "regular",
  broadcastKey: null,
  systemEventType: null,
  systemEventPayload: null,
  roomTag: null,
  isUrgent: false,
  mentionedUserIds: [],
  pinnedAt: null,
  pinnedByUserId: null,
  createdAt: "2026-07-04T10:00:00.000Z",
  acks: [],
  reactions: [],
  ...overrides,
});

describe("MessageBubble — body bidi isolation", () => {
  afterEach(() => cleanup());

  it("wraps the message body in a <bdi dir='auto'> isolate", () => {
    render(
      <MessageBubble
        message={message()}
        currentUserId="tech-1"
        onReact={vi.fn()}
        canPin={false}
      />,
    );
    const body = screen.getByText("Hi everyone!");
    const bdi = body.closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });

  it("mention highlighting still renders inside the isolate", () => {
    render(
      <MessageBubble
        message={message({ body: "ping @dana now" })}
        currentUserId="tech-1"
        onReact={vi.fn()}
        canPin={false}
      />,
    );
    const mention = screen.getByText("@dana");
    expect(mention.closest("bdi")).not.toBeNull();
  });
});
