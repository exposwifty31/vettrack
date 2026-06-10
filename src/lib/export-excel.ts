import type { Equipment } from "@/types";
import { getCurrentLocale } from "@/lib/i18n";

export async function exportEquipmentToExcel(items: Equipment[], filename = "equipment.xlsx") {
  let XLSX: typeof import("xlsx");
  try {
    XLSX = await import("xlsx");
  } catch (err) {
    console.error("Failed to load xlsx module", err);
    throw new Error("Could not load Excel exporter. Please refresh and try again.");
  }
  const locale = getCurrentLocale();
  const rows = items.map((eq) => ({
    Name: eq.name,
    "Serial Number": eq.serialNumber ?? "",
    Model: eq.model ?? "",
    Manufacturer: eq.manufacturer ?? "",
    Status: eq.status,
    Folder: eq.folderName ?? "",
    Room: eq.roomName ?? "",
    Location: eq.location ?? "",
    "Last Seen": eq.lastSeen ? new Date(eq.lastSeen).toLocaleString(locale) : "",
    "Last Maintenance": eq.lastMaintenanceDate ? new Date(eq.lastMaintenanceDate).toLocaleDateString(locale) : "",
    "Last Sterilization": eq.lastSterilizationDate ? new Date(eq.lastSterilizationDate).toLocaleDateString(locale) : "",
    "Checked Out By": eq.checkedOutByEmail ?? "",
    "Checked Out At": eq.checkedOutAt ? new Date(eq.checkedOutAt).toLocaleString(locale) : "",
    "Created At": eq.createdAt ? new Date(eq.createdAt).toLocaleDateString(locale) : "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Equipment");

  const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.max(key.length, ...rows.map((r) => String(r[key as keyof typeof r] ?? "").length)),
  }));
  ws["!cols"] = colWidths;

  try {
    XLSX.writeFile(wb, filename);
  } catch (err) {
    console.error("Failed to write Excel file", err);
    throw new Error("Export failed. Please try again.");
  }
}
