import { describe, it, expect, afterEach } from "vitest";
import {
  AccountDeletionProtectedError,
  isAccountDeletionProtected,
} from "../server/services/account-deletion.service.js";

describe("isAccountDeletionProtected", () => {
  const prev = process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;

  afterEach(() => {
    if (prev === undefined) delete process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;
    else process.env.ACCOUNT_DELETION_PROTECTED_EMAILS = prev;
  });

  it("blocks the default App Review demo account", () => {
    delete process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;
    expect(isAccountDeletionProtected("reviewer@vettrack.uk")).toBe(true);
    expect(isAccountDeletionProtected("Reviewer@VetTrack.UK")).toBe(true);
  });

  it("honors ACCOUNT_DELETION_PROTECTED_EMAILS override", () => {
    process.env.ACCOUNT_DELETION_PROTECTED_EMAILS = "demo@example.com, other@test.io";
    expect(isAccountDeletionProtected("demo@example.com")).toBe(true);
    expect(isAccountDeletionProtected("reviewer@vettrack.uk")).toBe(false);
  });

  it("does not block ordinary accounts", () => {
    delete process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;
    expect(isAccountDeletionProtected("user@clinic.example")).toBe(false);
  });
});

describe("AccountDeletionProtectedError", () => {
  it("uses a stable error code", () => {
    const err = new AccountDeletionProtectedError();
    expect(err.message).toBe("ACCOUNT_DELETION_PROTECTED");
  });
});
