// Lands at: src/components/general/csv-import-history-row.tsx
// §21-D5 — companion to the real CsvImportDialog (which performs the import;
// this renders one row of its history list). Stage 8 Admin Shifts Import.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface CsvImportHistoryRowProps
  extends React.HTMLAttributes<HTMLDivElement> {
  fileName: string;
  /** Already locale-formatted, e.g. "Jun 29 · 40 rows · Admin". */
  meta: string;
}

export function CsvImportHistoryRow({
  fileName,
  meta,
  className,
  ...props
}: CsvImportHistoryRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0",
        className,
      )}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4 flex-shrink-0 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground" title={fileName}>
          {fileName}
        </p>
        <p className="truncate text-xs font-medium text-muted-foreground" title={meta}>
          {meta}
        </p>
      </div>
    </div>
  );
}
