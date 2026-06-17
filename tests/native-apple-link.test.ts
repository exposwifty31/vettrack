import { beforeEach, describe, expect, it, vi } from "vitest";

const authorize = vi.fn();
const linkAppleAuthorizationCode = vi.fn();

vi.mock("@capacitor-community/apple-sign-in", () => ({
  SignInWithApple: { authorize },
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: vi.fn(() => true),
}));

vi.mock("@/lib/api", () => ({
  linkAppleAuthorizationCode,
}));

describe("native-apple-link", () => {
  beforeEach(() => {
    authorize.mockReset();
    linkAppleAuthorizationCode.mockReset();
    linkAppleAuthorizationCode.mockResolvedValue({ ok: true });
  });

  it("requestNativeAppleCredential returns identity token and authorization code", async () => {
    authorize.mockResolvedValue({
      response: {
        identityToken: " id.jwt ",
        authorizationCode: " auth-code ",
        givenName: "Ada",
        familyName: "Lovelace",
        email: "ada@example.com",
        user: "001",
      },
    });

    const { requestNativeAppleCredential } = await import("@/lib/native-apple-link");
    const credential = await requestNativeAppleCredential();

    expect(credential).toEqual({
      identityToken: "id.jwt",
      authorizationCode: "auth-code",
      givenName: "Ada",
      familyName: "Lovelace",
    });
    expect(authorize).toHaveBeenCalledWith({
      clientId: "uk.vettrack.app",
      redirectURI: "https://vettrack.uk",
      scopes: "email name",
    });
  });

  it("linkCapturedAppleAuthorizationCode no-ops on empty code", async () => {
    const { linkCapturedAppleAuthorizationCode } = await import("@/lib/native-apple-link");
    await linkCapturedAppleAuthorizationCode(null);
    expect(linkAppleAuthorizationCode).not.toHaveBeenCalled();
  });

  it("linkCapturedAppleAuthorizationCode posts a trimmed code", async () => {
    const { linkCapturedAppleAuthorizationCode } = await import("@/lib/native-apple-link");
    await linkCapturedAppleAuthorizationCode("  code-123  ");
    expect(linkAppleAuthorizationCode).toHaveBeenCalledWith("code-123");
  });
});
