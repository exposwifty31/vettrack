/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — `/admin` users tab. The card row stacks eight affordances
 * vertically; this is the dense counterpart on the shared `DataTable`.
 *
 * The row carries more management than any other legacy surface (role, secondary
 * role, status, two eligibility flags, approve/reject, soft-delete, restore), so
 * the tests are written as an ACTION-PARITY contract: every control keeps the same
 * `data-testid` the card row used, and firing it calls the same handler. A layout
 * change must not quietly cost an admin an affordance.
 *
 * Note: this is deliberately richer than `/admin/people` (PeopleRolesConsolePage),
 * which is a reduced four-column console view with a role-only drawer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";
import type { User } from "@/types";

import { UsersTable, type UserRowActions } from "@/pages/admin/desktop/UsersTable";

function user(over: Partial<User> & Pick<User, "id">): User {
  return {
    clerkId: `ck-${over.id}`,
    email: "vet@clinic.test",
    name: "Dana Vet",
    displayName: "Dana Vet",
    role: "technician",
    status: "active",
    createdAt: "2026-08-01T08:00:00.000Z",
    ...over,
  } as User;
}

const ACTIVE_TECH = user({ id: "u1", displayName: "Dana Tech", role: "technician" });
const PENDING = user({ id: "u2", displayName: "Noa Pending", status: "pending" });
const VET = user({ id: "u3", displayName: "Ron Vet", role: "vet" });
const USERS = [ACTIVE_TECH, PENDING, VET];

function actions(): UserRowActions {
  return {
    onRoleChange: vi.fn(),
    onSecondaryRoleChange: vi.fn(),
    onStatusChange: vi.fn(),
    onToggleEquipmentCoordinator: vi.fn(),
    onToggleSeniorDoctorEligible: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onSoftDelete: vi.fn(),
    onRestore: vi.fn(),
  };
}

function renderTable(users: User[] | undefined, a: UserRowActions = actions()) {
  return { a, ...render(<UsersTable users={users} actions={a} />) };
}

afterEach(() => cleanup());

describe("UsersTable — dense desktop body for the /admin users tab", () => {
  it("renders a table with the seven console column headers", () => {
    renderTable(USERS);

    expect(document.querySelector("table")).toBeTruthy();
    for (const header of [
      t.console.colName,
      t.console.colEmail,
      t.console.colRole,
      t.adminPage.secondaryRoleTooltip,
      t.console.colStatus,
      t.console.colFlags,
      t.console.colJoined,
      t.console.colActions,
    ]) {
      // Exact accessible-name match: colRole ("תפקיד") is a prefix of the
      // secondary-role header ("תפקיד משני"), so a substring regex hits both.
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(screen.getAllByRole("row")).toHaveLength(USERS.length + 1);
  });

  it("keeps every per-row control the card row exposed, under the same testid", () => {
    renderTable(USERS);

    for (const id of ["u1", "u2", "u3"]) {
      expect(screen.getByTestId(`select-role-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`select-secondary-role-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`select-status-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`btn-soft-delete-user-${id}`)).toBeTruthy();
    }
    // Conditional controls stay conditional.
    expect(screen.getByTestId("checkbox-equipment-coordinator-u1")).toBeTruthy();
    expect(screen.queryByTestId("checkbox-equipment-coordinator-u3")).toBeNull();
    expect(screen.getByTestId("checkbox-senior-doctor-eligible-u3")).toBeTruthy();
    expect(screen.queryByTestId("checkbox-senior-doctor-eligible-u1")).toBeNull();
    // Approve/reject only for a pending user.
    expect(screen.getByTestId("btn-approve-user-u2")).toBeTruthy();
    expect(screen.queryByTestId("btn-approve-user-u1")).toBeNull();
  });

  it("routes approve, reject and soft-delete to their handlers", () => {
    const { a } = renderTable(USERS);

    fireEvent.click(screen.getByTestId("btn-approve-user-u2"));
    expect(a.onApprove).toHaveBeenCalledWith(PENDING);

    fireEvent.click(screen.getByTestId("btn-reject-user-u2"));
    expect(a.onReject).toHaveBeenCalledWith(PENDING);

    fireEvent.click(screen.getByTestId("btn-soft-delete-user-u1"));
    expect(a.onSoftDelete).toHaveBeenCalledWith(ACTIVE_TECH);
  });

  it("routes the eligibility flags to their handlers", () => {
    const { a } = renderTable(USERS);

    fireEvent.click(screen.getByTestId("checkbox-equipment-coordinator-u1"));
    expect(a.onToggleEquipmentCoordinator).toHaveBeenCalledWith(ACTIVE_TECH, true);

    fireEvent.click(screen.getByTestId("checkbox-senior-doctor-eligible-u3"));
    expect(a.onToggleSeniorDoctorEligible).toHaveBeenCalledWith(VET, true);
  });

  it("offers restore only for a soft-deleted user, and routes it", () => {
    const deleted = user({ id: "u4", displayName: "Gone", deletedAt: "2026-08-20T00:00:00.000Z" });
    const { a } = renderTable([deleted]);

    fireEvent.click(screen.getByTestId("btn-restore-user-inline-u4"));
    expect(a.onRestore).toHaveBeenCalledWith(deleted);
  });

  it("bidi-isolates the display name and forces the email LTR", () => {
    renderTable([ACTIVE_TECH]);

    expect(screen.getByText("Dana Tech").closest("bdi")?.getAttribute("dir")).toBe("auto");
    expect(screen.getByText("vet@clinic.test").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });
});
