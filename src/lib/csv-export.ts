/**
 * Minimal RFC-4180 CSV export (Phase 7e). Client-side only — the analytics payloads
 * are already fully aggregated in the query cache, so there is no server round-trip.
 */

/** Escape one cell: wrap in quotes when it contains a comma, quote, or newline. */
function escapeCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
