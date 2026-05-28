/** CSV parsing helpers for POST /api/equipment/import (Slice 4h). */

export const EQUIPMENT_IMPORT_FIELD_MAX_LENGTH = 500;
export const VALID_IMPORT_STATUSES = new Set(["ok", "issue", "maintenance", "sterilized"]);
export const CSV_MAX_ROWS = 500;

export interface CsvRow {
  name: string;
  serial: string;
  status: string;
  location: string;
  folder: string;
  maintenanceIntervalDays: string;
  notes: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

export function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headerLine, ...dataLines] = nonEmpty;
  const normalizeImportHeader = (value: string) =>
    value
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/g, "")
      .replace(/[\s_-]+/g, "")
      .replace(/[()[\]./\\]/g, "");
  const headers = parseCsvLine(headerLine).map((h) => normalizeImportHeader(h));
  const rows = dataLines.map((l) => parseCsvLine(l));
  return { headers, rows };
}
