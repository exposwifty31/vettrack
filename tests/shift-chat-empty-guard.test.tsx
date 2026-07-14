/**
 * @vitest-environment happy-dom
 *
 * T-47 (CLICK-PATH-029) — handleSend guarded with
 * `if (!trimmed && !showBroadcast) return;`. Broadcasts go through a separate
 * handleBroadcast path, so the `&& !showBroadcast` made the empty-guard dead
 * whenever the broadcast selector was open: pressing Enter with an empty
 * composer sent an empty message (the disabled Send *button* is bypassed by the
 * Enter key handler). The guard must simply be `if (!trimmed) return;`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";

const sendMessage = vi.fn();
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1" }) }));
vi.mock("@/hooks/use-experience", () => ({ useExperience: () => ({ can: () => true }) }));

import { ShiftChatPanel } from "@/features/shift-chat/components/ShiftChatPanel";

const chat = {
  sendMessage,
  isSending: false,
  notifyTyping: vi.fn(),
  ackMessage: vi.fn(),
  reactToMessage: vi.fn(),
  pinMessage: vi.fn(),
  isLoading: false,
  messages: [],
  onlineUserIds: [],
  pinnedMessage: null,
  typing: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShiftChatPanel — empty-message guard (T-47)", () => {
  it("does not send an empty message on Enter while the broadcast selector is open", () => {
    render(<ShiftChatPanel isOpen onClose={() => {}} chat={chat} />);

    // Open the broadcast selector — this is where the dead guard let Enter through.
    fireEvent.click(screen.getByLabelText(t.shiftChat.panel.sendBroadcastAria));

    // Empty composer + Enter must NOT fire a message.
    const textarea = screen.getByPlaceholderText(t.shiftChat.panel.placeholder);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("still sends a non-empty message on Enter", () => {
    render(<ShiftChatPanel isOpen onClose={() => {}} chat={chat} />);
    const textarea = screen.getByPlaceholderText(t.shiftChat.panel.placeholder);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ body: "hello" }));
  });
});
