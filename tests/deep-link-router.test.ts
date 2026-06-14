import { describe, it, expect, vi, beforeEach } from "vitest";

const navigateMock = vi.fn();
const toastLoadingMock = vi.fn();

vi.mock("wouter/use-browser-location", () => ({
  navigate: (...args: unknown[]) => navigateMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    loading: (...args: unknown[]) => toastLoadingMock(...args),
  },
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/i18n", () => ({
  t: {
    nfcEntry: {
      openingEquipment: "Opening equipment…",
    },
  },
}));

import { __test } from "../src/lib/deep-link-router.js";

const EQUIP_UUID = "550e8400-e29b-41d4-a716-446655440000";

beforeEach(() => {
  vi.clearAllMocks();
  __test.__resetDeepLinkRouterStateForTests();
});

describe("deep-link-router", () => {
  it("OAuth callback → no navigate, no dedupe side effect on next link", () => {
    __test.handleDeepLink("vettrack://oauth-callback?rotating_token_nonce=abc");
    expect(navigateMock).not.toHaveBeenCalled();

    __test.handleDeepLink(`https://vettrack.uk/equipment/${EQUIP_UUID}`);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("scan shortcut → navigate to /equipment?scan=1", () => {
    __test.handleDeepLink("vettrack://scan");
    expect(navigateMock).toHaveBeenCalledWith("/equipment?scan=1");
  });

  it("Universal Link → navigate with nfcAction=toggle + nfcTs", () => {
    __test.handleDeepLink(`https://vettrack.uk/equipment/${EQUIP_UUID}`);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const path = navigateMock.mock.calls[0][0] as string;
    expect(path).toMatch(new RegExp(`^/equipment/${EQUIP_UUID}\\?nfcAction=toggle&nfcTs=\\d+$`));
    expect(toastLoadingMock).toHaveBeenCalledWith("Opening equipment…", { id: "nfc-open" });
  });

  it("dedupe: same URL twice within 1500ms → second call no-op", () => {
    const url = `https://vettrack.uk/equipment/${EQUIP_UUID}`;
    __test.handleDeepLink(url);
    __test.handleDeepLink(url);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("evil host → ignored", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    __test.handleDeepLink("https://evil.example/equipment/x");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
