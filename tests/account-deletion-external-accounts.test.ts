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
vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      get getUser() {
        return getUser;
      },
      get deleteUserExternalAccount() {
        return deleteUserExternalAccount;
      },
    },
  },
}));

import { revokeClerkExternalAccounts } from "../server/services/account-deletion.service.js";

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

describe("deleteClerkUser calls the explicit revocation BEFORE deleting the user (source pin)", () => {
  it("revokeClerkExternalAccounts precedes users.deleteUser in the function body", () => {
    const source = readFileSync("server/services/account-deletion.service.ts", "utf8");
    const body = source.slice(source.indexOf("async function deleteClerkUser"));
    const revokeAt = body.indexOf("revokeClerkExternalAccounts(");
    const deleteAt = body.indexOf("users.deleteUser(");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(deleteAt);
  });
});
