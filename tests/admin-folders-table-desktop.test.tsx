/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — `/admin` folders tab. The section renders a stack of
 * full-width `<div>` rows inside a Card at every width; on a management browser
 * that is mobile chrome. `FoldersTable` is the dense counterpart built on the
 * shared `DataTable`.
 *
 * Action parity is the point of the actions column: the edit and delete controls
 * (and their aria-labels) must survive the card→table swap, or Track A would
 * silently take management away while claiming to add it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { t } from "@/lib/i18n";
import type { Folder } from "@/types";

import { FoldersTable } from "@/pages/admin/desktop/FoldersTable";

const FOLDERS = [
  { id: "f1", name: "Imaging" },
  { id: "f2", name: "חדר ניתוח" },
] as Folder[];

afterEach(() => cleanup());

describe("FoldersTable — dense desktop body for the /admin folders tab", () => {
  it("renders a table with a name column and an actions column", () => {
    render(<FoldersTable folders={FOLDERS} onEdit={() => {}} onDelete={() => {}} />);

    expect(document.querySelector("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: new RegExp(t.console.colName) })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: new RegExp(t.console.colActions) })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(FOLDERS.length + 1);
  });

  it("keeps the edit control, with the same aria-label the card row used", () => {
    const onEdit = vi.fn();
    render(<FoldersTable folders={FOLDERS} onEdit={onEdit} onDelete={() => {}} />);

    fireEvent.click(screen.getByLabelText(`${t.adminPage.editFolder} — Imaging`));

    expect(onEdit).toHaveBeenCalledWith(FOLDERS[0]);
  });

  it("keeps the delete control, with the same aria-label the card row used", () => {
    const onDelete = vi.fn();
    render(<FoldersTable folders={FOLDERS} onEdit={() => {}} onDelete={onDelete} />);

    fireEvent.click(screen.getByLabelText(`${t.common.delete} — Imaging`));

    expect(onDelete).toHaveBeenCalledWith(FOLDERS[0]);
  });

  it("bidi-isolates the folder name so an LTR name survives the RTL console", () => {
    render(<FoldersTable folders={FOLDERS} onEdit={() => {}} onDelete={() => {}} />);

    const bdi = screen.getByText("Imaging").closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });

  it("renders the existing empty copy instead of a table when there are no folders", () => {
    render(<FoldersTable folders={[]} onEdit={() => {}} onDelete={() => {}} />);

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText(t.adminPage.noFoldersYet)).toBeTruthy();
  });
});

// CodeRabbit #3921508563 (Major), verified: FoldersSection sets manualFolders to []
// when api.folders.list fails, and the desktop table had no isError/onRetry props —
// so a failed request rendered "no folders yet", which is a different claim.
describe("FoldersTable — a failed request must not read as an empty list", () => {
  it("surfaces the error state and a retry instead of the empty message", () => {
    const onRetry = vi.fn();
    render(
      <FoldersTable folders={[]} isError onRetry={onRetry} onEdit={() => {}} onDelete={() => {}} />,
    );

    expect(screen.queryByText(t.adminPage.noFoldersYet)).toBeNull();
    expect(document.querySelector("table")).toBeNull();
  });
});
