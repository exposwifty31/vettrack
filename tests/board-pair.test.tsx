/**
 * @vitest-environment happy-dom
 *
 * Phase 9 — Display-device pairing kiosk screen (GET /board/pair). Covers the
 * code-entry → claim → token-persisted → redirect happy path, the submit gating
 * (button disabled until an 8-char code is present), and the error branch when
 * the claim is rejected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const claimMock = vi.fn();
const setTokenMock = vi.fn();
vi.mock("@/lib/api", () => ({
  claimDisplayPairing: (...a: unknown[]) => claimMock(...a),
}));
vi.mock("@/lib/display-token-store", () => ({
  setStoredDisplayToken: (...a: unknown[]) => setTokenMock(...a),
}));

import BoardPairPage from "@/pages/board-pair";

function LocationProbe() {
  const [loc] = useLocation();
  return <div data-testid="loc">{loc}</div>;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { hook } = memoryLocation({ path: "/board/pair" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <BoardPairPage />
        <LocationProbe />
      </Router>
    </QueryClientProvider>,
  );
}

function typeCode(value: string) {
  fireEvent.change(screen.getByLabelText(t.boardPair.codeLabel), { target: { value } });
}

beforeEach(() => {
  claimMock.mockReset();
  setTokenMock.mockReset();
});
afterEach(() => cleanup());

describe("BoardPairPage — submit gating", () => {
  it("keeps the pair button disabled until an 8-character code is entered", () => {
    renderPage();
    const button = screen.getByRole("button", { name: t.boardPair.pairButton }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    typeCode("ABC");
    expect(button.disabled).toBe(true);
    typeCode("ABCD2345");
    expect(button.disabled).toBe(false);
  });
});

describe("BoardPairPage — claim happy path", () => {
  it("claims the code, persists the token, and redirects to /board", async () => {
    claimMock.mockResolvedValue({ id: "d1", token: "vtd_secret", name: "Ward TV", clinicId: "clinic-A" });
    renderPage();
    typeCode("abcd-2345");
    fireEvent.click(screen.getByRole("button", { name: t.boardPair.pairButton }));

    await waitFor(() => expect(claimMock).toHaveBeenCalledTimes(1));
    // Code is passed through trimmed; the server normalizes dashes/case.
    expect(claimMock).toHaveBeenCalledWith("ABCD-2345", undefined);
    await waitFor(() => expect(setTokenMock).toHaveBeenCalledWith("vtd_secret", "clinic-A"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/board"));
  });

  it("forwards an optional device name to the claim", async () => {
    claimMock.mockResolvedValue({ id: "d1", token: "vtd_secret", name: "Lobby", clinicId: "clinic-A" });
    renderPage();
    typeCode("ABCD2345");
    fireEvent.change(screen.getByLabelText(t.boardPair.nameLabel), { target: { value: "Lobby" } });
    fireEvent.click(screen.getByRole("button", { name: t.boardPair.pairButton }));
    await waitFor(() => expect(claimMock).toHaveBeenCalledWith("ABCD2345", "Lobby"));
  });
});

describe("BoardPairPage — error branch", () => {
  it("shows an error and does not persist a token when the claim is rejected", async () => {
    claimMock.mockRejectedValue(new Error("bad code"));
    renderPage();
    typeCode("ABCD2345");
    fireEvent.click(screen.getByRole("button", { name: t.boardPair.pairButton }));

    expect(await screen.findByText(t.boardPair.error)).toBeTruthy();
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("loc").textContent).toBe("/board/pair");
  });
});
