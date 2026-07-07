import { useMemo, useState, type AriaAttributes, type ElementType, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Provide to make the column sortable (client-side). */
  sortValue?: (row: T) => string | number;
  /** Extra classes on header + cells. Use LOGICAL props for RTL (text-start, ps-*). */
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Empty-state icon + message (i18n-keyed copy from the caller). */
  emptyIcon: ElementType;
  emptyMessage: string;
  /** Footer slot (e.g. pagination controls) rendered below the table. */
  footer?: ReactNode;
  onRowClick?: (row: T) => void;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

/**
 * Headless, generic console data table (Phase 6). No table library — column-def
 * model + client-side sort + the four states (loading/empty/error/data). RTL is
 * handled with logical properties (`text-start`, symmetric `px-*`) so one markup
 * serves both directions; the sort chevrons are vertical (up/down), so they do not
 * mirror. Server-side pagination plugs into the `footer` slot.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  isError,
  onRetry,
  emptyIcon,
  emptyMessage,
  footer,
  onRowClick,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows ?? [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    const sortValue = col.sortValue; // narrowed non-null by the guard above
    return [...rows].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return cmp * dir;
    });
  }, [rows, sort, columns]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-11 rounded-lg" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorCard onRetry={onRetry} />;
  if (!rows || rows.length === 0) return <EmptyState icon={emptyIcon} message={emptyMessage} />;

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const ariaSort: AriaAttributes["aria-sort"] = c.sortValue
                  ? isSorted
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn("px-3 py-2 text-start font-semibold text-muted-foreground", c.className)}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {c.header}
                        {isSorted ? (
                          sort.dir === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  "border-t border-border/50",
                  onRowClick && "cursor-pointer hover:bg-muted/30",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2 align-middle", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
