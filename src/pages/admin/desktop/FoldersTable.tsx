import { useMemo } from "react";
import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/desktop/management/DataTable";
import { Button } from "@/components/ui/button";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { Folder } from "@/types";

interface FoldersTableProps {
  folders: Folder[] | undefined;
  isLoading?: boolean;
  onEdit: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}

/**
 * Dense desktop body for the `/admin` folders tab (Track A). The card row stack in
 * `FoldersSection` is unchanged and still serves narrow widths.
 *
 * The actions column carries the same two controls, with the same aria-labels, that
 * the card row exposes — de-mobilizing the layout must not cost an affordance.
 */
export function FoldersTable({ folders, isLoading, onEdit, onDelete }: FoldersTableProps) {
  const columns = useMemo<Column<Folder>[]>(
    () => [
      {
        key: "name",
        header: t.console.colName,
        sortValue: (f) => f.name,
        cell: (f) => (
          <span className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <Bdi className="font-medium">{f.name}</Bdi>
          </span>
        ),
      },
      {
        key: "actions",
        header: t.console.colActions,
        className: "w-24",
        cell: (f) => (
          <span className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t.adminPage.editFolder} — ${f.name}`}
              data-testid={`btn-edit-folder-${f.id}`}
              onClick={() => onEdit(f)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t.common.delete} — ${f.name}`}
              className="text-destructive hover:text-destructive"
              data-testid={`btn-delete-folder-${f.id}`}
              onClick={() => onDelete(f)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        ),
      },
    ],
    [onEdit, onDelete],
  );

  return (
    <DataTable
      columns={columns}
      rows={folders}
      rowKey={(f) => f.id}
      isLoading={isLoading}
      emptyIcon={FolderOpen}
      emptyMessage={t.adminPage.noFoldersYet}
    />
  );
}
