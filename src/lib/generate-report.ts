import { format } from "date-fns";
import type { Equipment } from "@/types";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import {
  computeDashboardCounts,
  computeCriticalItems,
  computeCostEstimate,
  computeOperationalPercent,
} from "./dashboard-utils";

export async function generateMonthlyReport(equipment: Equipment[]): Promise<void> {
  let jsPDF: typeof import("jspdf")["jsPDF"];
  try {
    ({ jsPDF } = await import("jspdf"));
  } catch (importErr) {
    console.error("Failed to load jsPDF module", importErr);
    throw new Error("Could not load PDF generator. Please refresh and try again.");
  }
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = 210;
  const pageH = 297;
  const marginL = 14;
  const marginR = 14;
  const contentW = pageW - marginL - marginR;

  const now = new Date();
  const monthYear = format(now, "MMMM yyyy");
  const generatedAt = format(now, "MMM d, yyyy 'at' h:mm a");

  const counts = computeDashboardCounts(equipment);
  const criticalItems = computeCriticalItems(equipment);
  const costEstimate = computeCostEstimate(equipment);
  const operationalPct = computeOperationalPercent(equipment);

  let y = 14;

  doc.setFillColor(13, 148, 136);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("VetTrack Monthly Report", marginL, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(monthYear, marginL, 20);
  doc.setFontSize(8);
  doc.text(`Generated: ${generatedAt}`, pageW - marginR, 24, { align: "right" });

  y = 38;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Equipment Summary", marginL, y);
  y += 2;
  doc.setDrawColor(13, 148, 136);
  doc.setLineWidth(0.5);
  doc.line(marginL, y, marginL + contentW, y);
  y += 6;

  const colW = contentW / 4;
  const summaryData = [
    { label: "Available", value: counts.available, color: [16, 185, 129] as [number, number, number] },
    { label: "In Use", value: counts.inUse, color: [59, 130, 246] as [number, number, number] },
    { label: "Issues", value: counts.issues, color: [239, 68, 68] as [number, number, number] },
    { label: "Missing", value: counts.missing, color: [245, 158, 11] as [number, number, number] },
  ];

  summaryData.forEach((item, i) => {
    const x = marginL + i * colW;
    const bW = colW - 3;
    const bH = 18;
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.roundedRect(x, y, bW, bH, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(String(item.value), x + bW / 2, y + 10, { align: "center" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(item.label, x + bW / 2, y + 15, { align: "center" });
  });

  y += 26;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Issues & Missing Equipment", marginL, y);
  y += 2;
  doc.setDrawColor(239, 68, 68);
  doc.line(marginL, y, marginL + contentW, y);
  y += 5;

  if (criticalItems.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text("No critical items — all equipment accounted for.", marginL, y);
    y += 8;
  } else {
    doc.setFillColor(240, 240, 240);
    doc.rect(marginL, y, contentW, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text("Equipment", marginL + 2, y + 4);
    doc.text("Reason", marginL + 70, y + 4);
    doc.text("Location", marginL + 120, y + 4);
    doc.text("Status", marginL + 160, y + 4);
    y += 6;

    const maxRows = Math.min(criticalItems.length, 12);
    criticalItems.slice(0, maxRows).forEach((item, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(marginL, y, contentW, 6, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      const name = item.name.length > 25 ? item.name.slice(0, 24) + "…" : item.name;
      doc.text(name, marginL + 2, y + 4);
      doc.text(item.reason, marginL + 70, y + 4);
      const loc = (item.location || "—").slice(0, 18);
      doc.text(loc, marginL + 120, y + 4);
      const statusColor = item.status === "issue" ? [239, 68, 68] : [245, 158, 11];
      doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text(item.status.toUpperCase(), marginL + 160, y + 4);
      doc.setTextColor(30, 30, 30);
      y += 6;
    });

    if (criticalItems.length > maxRows) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`… and ${criticalItems.length - maxRows} more items`, marginL + 2, y + 4);
      y += 8;
    }
  }

  y += 8;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Cost Estimate", marginL, y);
  y += 2;
  doc.setDrawColor(245, 158, 11);
  doc.line(marginL, y, marginL + contentW, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text("Missing equipment replacement estimate (@ $500/item):", marginL + 2, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(239, 68, 68);
  doc.text(`$${costEstimate.missingCost.toLocaleString()}`, pageW - marginR, y, { align: "right" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text("Issue repair estimate (@ $75/item):", marginL + 2, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(245, 158, 11);
  doc.text(`$${costEstimate.issueCost.toLocaleString()}`, pageW - marginR, y, { align: "right" });
  y += 6;

  doc.setDrawColor(200, 200, 200);
  doc.line(marginL + 2, y, pageW - marginR, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text("Total Estimated Cost:", marginL + 2, y);
  doc.text(`$${costEstimate.total.toLocaleString()}`, pageW - marginR, y, { align: "right" });
  y += 10;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Insights", marginL, y);
  y += 2;
  doc.setDrawColor(59, 130, 246);
  doc.line(marginL, y, marginL + contentW, y);
  y += 6;

  doc.setFillColor(239, 246, 255);
  doc.roundedRect(marginL, y, contentW, 16, 2, 2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 100);

  const insightLines: string[] = [];
  insightLines.push(`${operationalPct}% of equipment is currently operational (available or in use).`);
  if (counts.missing > 0) {
    insightLines.push(`${counts.missing} item${counts.missing !== 1 ? "s" : ""} flagged missing — immediate follow-up recommended.`);
  } else {
    insightLines.push("All equipment accounted for — no missing items detected.");
  }
  if (counts.issues > 0) {
    insightLines.push(`${counts.issues} active issue${counts.issues !== 1 ? "s" : ""} requiring attention.`);
  }

  insightLines.slice(0, 3).forEach((line, i) => {
    doc.text(`• ${line}`, marginL + 3, y + 5 + i * 4.5);
  });
  y += 22;

  doc.setFillColor(240, 240, 240);
  doc.rect(0, pageH - 10, pageW, 10, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `VetTrack — Confidential | ${equipment.length} total items | Report generated ${generatedAt}`,
    pageW / 2,
    pageH - 4,
    { align: "center" }
  );

  const filename = `vettrack-report-${format(now, "yyyy-MM")}.pdf`;

  if (isCapacitorNative()) {
    // Native (Capacitor iOS/Android): the browser download `doc.save()` is a
    // no-op inside a WebView, so the old "downloaded" toast was misleading.
    // Write the PDF to the cache dir and hand it to the OS share/save sheet.
    // Imported dynamically so the web bundle never pulls in the native plugins.
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const dataUri = doc.output("datauristring");
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({ title: filename, url: written.uri });
    return;
  }

  doc.save(filename);
}
