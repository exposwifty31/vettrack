/**
 * Minimal RFC-4180 CSV export (Phase 7e). Client-side only — the analytics payloads
 * are already fully aggregated in the query cache, so there is no server round-trip.
 */

/**
 * Escape one cell. First neutralizes spreadsheet formula injection — values
 * starting with `= + - @`, tab, or CR can execute as formulas in Excel/Sheets, and
 * this export carries staff-editable strings (e.g. room names) — by prefixing a
 * single quote. Then applies RFC-4180 quoting when the cell contains a comma,
 * quote, or newline.
 */
function escapeCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export type CsvCell = string | number | null | undefined;

/** Build an RFC-4180 CSV string (CRLF line endings) from a header + rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

/** Trigger a browser download of `csv` as `filename`. Prepends a UTF-8 BOM so Excel
 *  renders Hebrew correctly. Mirrors the Blob/createObjectURL pattern used elsewhere. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
