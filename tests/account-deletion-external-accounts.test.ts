/**
 * B2 — explicit Clerk external-account revocation on self-deletion.
 *
 * The RN app's Apple sign-in goes THROUGH Clerk (`oauth_apple`), so the Apple
 * OAuth grant lives on the Clerk user as an external account — not in our
 * `vt_apple_oauth_tokens` table (that table serves the Capacitor apple-link
 * path). Clerk's documented contract: deleting an external account "also
 * revokes all tokens related to the same OAuth grant". Deleting the USER
 * removes its external accounts too, but only the external-account DELETE is
 * documented to revoke — so the service deletes them EXPLICITLY, then deletes
 * the user (Guideline 5.1.1(v) / TN3194 ordering: revoke first).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const getUser = vi.fn();
const deleteUserExternalAccount = vi.fn();
const deleteUser = vi.fn();
vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      get getUser() {
        return getUser;
      },
      get deleteUserExternalAccount() {
        return deleteUserExternalAccount;
      },
      get deleteUser() {
        return deleteUser;
      },
    },
  },
}));

import { deleteClerkUser, revokeClerkExternalAccounts } from "../server/services/account-deletion.service.js";

describe("revokeClerkExternalAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_SECRET_KEY = "sk_test_x";
  });

  it("deletes every external account on the Clerk user (the documented revocation path)", async () => {
    getUser.mockResolvedValue({
      externalAccounts: [{ id: "eac_apple" }, { id: "eac_google" }],
    });
    deleteUserExternalAccount.mockResolvedValue({});

    const count = await revokeClerkExternalAccounts("user_1");

    expect(count).toBe(2);
    expect(deleteUserExternalAccount).toHaveBeenCalledWith({ userId: "user_1", externalAccountId: "eac_apple" });
    expect(deleteUserExternalAccount).toHaveBeenCalledWith({ userId: "user_1", externalAccountId: "eac_google" });
  });

  it("is non-fatal per account — one failure never blocks the rest or the deletion", async () => {
    getUser.mockResolvedValue({
      externalAccounts: [{ id: "eac_a" }, { id: "eac_b" }],
    });
    deleteUserExternalAccount.mockRejectedValueOnce(new Error("api down")).mockResolvedValueOnce({});

    const count = await revokeClerkExternalAccounts("user_1");

    expect(count).toBe(1);
    expect(deleteUserExternalAccount).toHaveBeenCalledTimes(2);
  });

  it("skips synthetic/dev identities and unconfigured Clerk, like deleteClerkUser", async () => {
    expect(await revokeClerkExternalAccounts("dev-user")).toBe(0);
    delete process.env.CLERK_SECRET_KEY;
    expect(await revokeClerkExternalAccounts("user_1")).toBe(0);
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("deleteClerkUser — revocation ordering and boundedness (review #269)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_SECRET_KEY = "sk_test_x";
  });

  it("does not START user deletion until external-account revocation settles (runtime order)", async () => {
    let releaseRevocation!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    getUser.mockResolvedValue({ externalAccounts: [{ id: "eac_apple" }] });
    deleteUserExternalAccount.mockImplementation(() => gate.then(() => ({})));
    deleteUser.mockResolvedValue({});

    const run = deleteClerkUser("user_1");
    await Promise.resolve();
    await Promise.resolve();
    expect(deleteUser).not.toHaveBeenCalled(); // revocation still pending

    releaseRevocation();
    await expect(run).resolves.toBe(true);
    expect(deleteUser).toHaveBeenCalledWith("user_1");
  });

  it("a STALLED revocation cannot block the deletion — the timeout hands control back", async () => {
    vi.useFakeTimers();
    try {
      getUser.mockImplementation(() => new Promise(() => undefined)); // never resolves
      deleteUser.mockResolvedValue({});

      const run = deleteClerkUser("user_1");
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(run).resolves.toBe(true);
      expect(deleteUser).toHaveBeenCalledWith("user_1");
    } finally {
      vi.useRealTimers();
    }
  });
});
