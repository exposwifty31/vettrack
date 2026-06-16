import { format } from "date-fns";
import { he, enUS } from "date-fns/locale";
import type { Equipment } from "@/types";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { getStoredLocale, t, formatDateByLocale } from "@/lib/i18n";
import {
  computeDashboardCounts,
  computeCriticalItems,
  computeCostEstimate,
  computeOperationalPercent,
  type CriticalItem,
} from "./dashboard-utils";

function dateFnsLocale() {
  return getStoredLocale() === "he" ? he : enUS;
}

function criticalReasonLabel(item: CriticalItem): string {
  if (item.status === "issue") return t.monthlyReport.reasonActiveIssue;
  if (item.reason.toLowerCase().includes("never")) return t.monthlyReport.reasonNeverScanned;
  return t.monthlyReport.reasonNotSeen24h;
}

function statusLabel(item: CriticalItem): string {
  return item.status === "issue" ? t.monthlyReport.statusIssue : t.monthlyReport.statusMissing;
}

function buildInsightLines(counts: ReturnType<typeof computeDashboardCounts>, operationalPct: number): string[] {
  const lines: string[] = [];
  lines.push(t.monthlyReport.insightOperational(operationalPct));
  if (counts.missing > 0) {
    lines.push(t.monthlyReport.insightMissing(counts.missing));
  } else {
    lines.push(t.monthlyReport.insightAllAccounted);
  }
  if (counts.issues > 0) {
    lines.push(t.monthlyReport.insightIssues(counts.issues));
  }
  return lines.slice(0, 3);
}

function printHtmlMonthlyReport(
  equipment: Equipment[],
  counts: ReturnType<typeof computeDashboardCounts>,
  criticalItems: CriticalItem[],
  costEstimate: ReturnType<typeof computeCostEstimate>,
  operationalPct: number,
): void {
  const now = new Date();
  const monthYear = format(now, "MMMM yyyy", { locale: dateFnsLocale() });
  const generatedAt = formatDateByLocale(now, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const rtl = getStoredLocale() === "he";
  const insightLines = buildInsightLines(counts, operationalPct);
  const maxRows = Math.min(criticalItems.length, 12);

  const criticalRows = criticalItems
    .slice(0, maxRows)
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(criticalReasonLabel(item))}</td>
        <td>${escapeHtml(item.location || "—")}</td>
        <td>${escapeHtml(statusLabel(item))}</td>
      </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="${rtl ? "he" : "en"}" dir="${rtl ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(t.monthlyReport.printTitle)}</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid #0d9488; padding-bottom: 4px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
    .pill { border-radius: 8px; color: #fff; padding: 10px; text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: start; }
    th { background: #f3f4f6; }
    .cost { font-size: 12px; line-height: 1.6; }
    ul { margin: 0; padding-inline-start: 18px; font-size: 12px; }
    footer { margin-top: 24px; font-size: 10px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(t.monthlyReport.title)}</h1>
  <p class="meta">${escapeHtml(monthYear)} · ${escapeHtml(t.monthlyReport.generatedLabel)} ${escapeHtml(generatedAt)}</p>

  <h2>${escapeHtml(t.monthlyReport.equipmentSummary)}</h2>
  <div class="summary">
    <div class="pill" style="background:#10b981"><div style="font-size:22px;font-weight:700">${counts.available}</div><div>${escapeHtml(t.monthlyReport.available)}</div></div>
    <div class="pill" style="background:#3b82f6"><div style="font-size:22px;font-weight:700">${counts.inUse}</div><div>${escapeHtml(t.monthlyReport.inUse)}</div></div>
    <div class="pill" style="background:#ef4444"><div style="font-size:22px;font-weight:700">${counts.issues}</div><div>${escapeHtml(t.monthlyReport.issues)}</div></div>
    <div class="pill" style="background:#f59e0b"><div style="font-size:22px;font-weight:700">${counts.missing}</div><div>${escapeHtml(t.monthlyReport.missing)}</div></div>
  </div>

  <h2>${escapeHtml(t.monthlyReport.issuesMissingTitle)}</h2>
  ${
    criticalItems.length === 0
      ? `<p>${escapeHtml(t.monthlyReport.noCriticalItems)}</p>`
      : `<table>
          <thead><tr>
            <th>${escapeHtml(t.monthlyReport.colEquipment)}</th>
            <th>${escapeHtml(t.monthlyReport.colReason)}</th>
            <th>${escapeHtml(t.monthlyReport.colLocation)}</th>
            <th>${escapeHtml(t.monthlyReport.colStatus)}</th>
          </tr></thead>
          <tbody>${criticalRows}</tbody>
        </table>
        ${criticalItems.length > maxRows ? `<p>${escapeHtml(t.monthlyReport.andMore(criticalItems.length - maxRows))}</p>` : ""}`
  }

  <h2>${escapeHtml(t.monthlyReport.costEstimate)}</h2>
  <div class="cost">
    <div>${escapeHtml(t.monthlyReport.missingCostLine)} <strong>$${costEstimate.missingCost.toLocaleString()}</strong></div>
    <div>${escapeHtml(t.monthlyReport.issueCostLine)} <strong>$${costEstimate.issueCost.toLocaleString()}</strong></div>
    <div><strong>${escapeHtml(t.monthlyReport.totalEstimated)}</strong> $${costEstimate.total.toLocaleString()}</div>
  </div>

  <h2>${escapeHtml(t.monthlyReport.insights)}</h2>
  <ul>${insightLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>

  <footer>${escapeHtml(t.monthlyReport.footer(equipment.length, generatedAt))}</footer>
</body>
</html>`;

  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) {
    throw new Error("Could not open print window. Allow pop-ups and try again.");
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function generatePdfMonthlyReport(
  equipment: Equipment[],
  counts: ReturnType<typeof computeDashboardCounts>,
  criticalItems: CriticalItem[],
  costEstimate: ReturnType<typeof computeCostEstimate>,
  operationalPct: number,
): Promise<void> {
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
  const monthYear = format(now, "MMMM yyyy", { locale: dateFnsLocale() });
  const generatedAt = formatDateByLocale(now, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  let y = 14;

  doc.setFillColor(13, 148, 136);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(t.monthlyReport.title, marginL, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(monthYear, marginL, 20);
  doc.setFontSize(8);
  doc.text(`${t.monthlyReport.generatedLabel} ${generatedAt}`, pageW - marginR, 24, { align: "right" });

  y = 38;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(t.monthlyReport.equipmentSummary, marginL, y);
  y += 8;

  const colW = contentW / 4;
  const summaryData = [
    { label: t.monthlyReport.available, value: counts.available, color: [16, 185, 129] as [number, number, number] },
    { label: t.monthlyReport.inUse, value: counts.inUse, color: [59, 130, 246] as [number, number, number] },
    { label: t.monthlyReport.issues, value: counts.issues, color: [239, 68, 68] as [number, number, number] },
    { label: t.monthlyReport.missing, value: counts.missing, color: [245, 158, 11] as [number, number, number] },
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
  doc.text(t.monthlyReport.issuesMissingTitle, marginL, y);
  y += 6;

  if (criticalItems.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(t.monthlyReport.noCriticalItems, marginL, y);
    y += 8;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(t.monthlyReport.colEquipment, marginL + 2, y + 4);
    doc.text(t.monthlyReport.colReason, marginL + 70, y + 4);
    doc.text(t.monthlyReport.colLocation, marginL + 120, y + 4);
    doc.text(t.monthlyReport.colStatus, marginL + 160, y + 4);
    y += 6;

    const maxRows = Math.min(criticalItems.length, 12);
    criticalItems.slice(0, maxRows).forEach((item) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      const name = item.name.length > 25 ? `${item.name.slice(0, 24)}…` : item.name;
      doc.text(name, marginL + 2, y + 4);
      doc.text(criticalReasonLabel(item), marginL + 70, y + 4);
      const loc = (item.location || "—").slice(0, 18);
      doc.text(loc, marginL + 120, y + 4);
      doc.text(statusLabel(item), marginL + 160, y + 4);
      y += 6;
    });

    if (criticalItems.length > maxRows) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(t.monthlyReport.andMore(criticalItems.length - maxRows), marginL + 2, y + 4);
      y += 8;
    }
  }

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(t.monthlyReport.costEstimate, marginL, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(t.monthlyReport.missingCostLine, marginL + 2, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(239, 68, 68);
  doc.text(`$${costEstimate.missingCost.toLocaleString()}`, pageW - marginR, y, { align: "right" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text(t.monthlyReport.issueCostLine, marginL + 2, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(245, 158, 11);
  doc.text(`$${costEstimate.issueCost.toLocaleString()}`, pageW - marginR, y, { align: "right" });
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(t.monthlyReport.totalEstimated, marginL + 2, y);
  doc.text(`$${costEstimate.total.toLocaleString()}`, pageW - marginR, y, { align: "right" });
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(t.monthlyReport.insights, marginL, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 100);
  buildInsightLines(counts, operationalPct).forEach((line, i) => {
    doc.text(`• ${line}`, marginL + 3, y + i * 4.5);
  });

  doc.setFillColor(240, 240, 240);
  doc.rect(0, pageH - 10, pageW, 10, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(t.monthlyReport.footer(equipment.length, generatedAt), pageW / 2, pageH - 4, { align: "center" });

  const filename = `vettrack-report-${format(now, "yyyy-MM")}.pdf`;

  if (isCapacitorNative()) {
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

export async function generateMonthlyReport(equipment: Equipment[]): Promise<void> {
  const counts = computeDashboardCounts(equipment);
  const criticalItems = computeCriticalItems(equipment);
  const costEstimate = computeCostEstimate(equipment);
  const operationalPct = computeOperationalPercent(equipment);

  if (getStoredLocale() === "he") {
    printHtmlMonthlyReport(equipment, counts, criticalItems, costEstimate, operationalPct);
    return;
  }

  await generatePdfMonthlyReport(equipment, counts, criticalItems, costEstimate, operationalPct);
}
