import type { ForecastResult } from "./types.js";
import { normalizeQuantityKey as nk } from "../../../src/shared/normalizeQuantityKey.js";
import { getLocaleDictionaries } from "../../../lib/i18n/loader.js";
import { translate } from "../../../lib/i18n/index.js";

type Tr = (key: string, params?: Record<string, string | number>) => string;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function freqLabel(n: number | null, tr: Tr): string {
  if (n == null) return "—";
  switch (n) {
    case 1: return tr("freqSid");
    case 2: return tr("freqBid");
    case 3: return tr("freqTid");
    case 4: return tr("freqQid");
    default: return tr("freqOther", { n });
  }
}

function tdRow(label: string, val: string): string {
  return `<tr>
    <td style="color:#6b7280;width:42%;padding:3px 0;font-size:13px;vertical-align:top">${label}</td>
    <td style="padding:3px 0;font-size:13px">${val}</td>
  </tr>`;
}

/**
 * Builds the ICU pharmacy-order email. All user-facing copy is resolved
 * from `locales/<locale>.json` (`forecastEmail.*`) via the server i18n
 * `translate()` path — pass `locale` (typically `req.locale`). When
 * `locale` is omitted it falls back to the i18n DEFAULT_LOCALE.
 */
export function buildPharmacyOrderEmail(params: {
  result: ForecastResult;
  technicianName: string;
  locale?: string | null;
  auditOrOrderHint?: string;
  auditTrace?: Record<string, { forecastedQty: number | null; onHandQty: number }>;
  patientWeightOverrides?: Record<string, number>;
}): { subject: string; text: string; html: string } {
  const {
    result,
    technicianName,
    auditTrace = {},
    patientWeightOverrides = {},
  } = params;

  const { primary, fallback, locale: loc } = getLocaleDictionaries(params.locale);
  const tr: Tr = (key, p) =>
    translate(primary, `forecastEmail.${key}`, p, { fallbackDict: fallback, locale: loc });
  const dir = loc === "he" ? "rtl" : "ltr";
  const localeTag = loc === "he" ? "he-IL" : "en-US";

  const n = result.patients.length;
  const mode = result.weekendMode || result.windowHours === 72
    ? tr("modeWeekend")
    : tr("modeRegular");
  const dayStr = new Date(result.parsedAt).toLocaleDateString(localeTag);
  const hourUnit = tr("hourUnit");

  const subject = tr("subject", {
    count: n,
    hours: result.windowHours,
    mode,
    date: dayStr,
    tech: technicianName,
  });

  const sorted = [...result.patients].sort((a, b) =>
    a.recordNumber.localeCompare(b.recordNumber, undefined, { numeric: true }),
  );

  // ── Plain text ──────────────────────────────────────────────────────────────
  const lines: string[] = [
    subject, "",
    `${tr("technicianLabel")} ${technicianName}`,
    `${tr("dateLabel")} ${dayStr}  |  ${tr("windowLabel")} ${result.windowHours}${hourUnit} (${mode})`,
  ];
  if (params.auditOrOrderHint) lines.push(`${tr("idLabel")} ${params.auditOrOrderHint}`);
  lines.push("");
  if (result.parseFailures && result.parseFailures.length > 0) {
    lines.push(tr("parseFailuresHeading"));
    for (const failure of result.parseFailures) {
      lines.push(`• ${failure.fileName} — ${failure.message}`);
    }
    lines.push("");
  }

  for (const p of sorted) {
    const wt = patientWeightOverrides[p.recordNumber] ?? p.weightKg;
    lines.push("─────────────────────────────────");
    lines.push(`${p.name}  ·  ${tr("recordNoLabel")} ${p.recordNumber}  ·  ${p.species} ${p.breed}  ·  ${wt} ${tr("kgUnit")}`);
    if (p.ownerName || p.ownerPhone)
      lines.push(`${tr("ownerLabel")} ${p.ownerName}${p.ownerPhone ? `  |  ${p.ownerPhone}` : ""}`);
    lines.push("");
    if (p.flags.includes("PATIENT_UNKNOWN")) lines.push(tr("warnPatientUnknownText"));
    if (p.flags.includes("WEIGHT_UNKNOWN")) lines.push(tr("warnWeightManual", { weight: wt }));
    if (p.flags.includes("ALL_DRUGS_EXCLUDED")) lines.push(tr("warnAllDrugsExcludedText"));
    p.drugs.forEach((d, i) => {
      const key = nk(p.recordNumber, d.drugName);
      const trace = auditTrace[key];
      const qty = d.quantityUnits ?? 0;
      const tracePart = trace
        ? `  ${tr("traceText", { forecast: trace.forecastedQty ?? "—", onHand: trace.onHandQty })}`
        : "";
      const admins = d.administrationsInWindow;
      const perAdmin = admins && admins > 0 ? `${Math.ceil(qty / admins)} ${d.unitLabel}` : "—";
      lines.push(`${i + 1}. ${d.drugName} — ${d.concentration} · ${d.unitLabel}`);
      lines.push(`   ${tr("labelTotalQty")} ${qty} ${d.unitLabel}${tracePart}`);
      lines.push(`   ${tr("labelPerAdmin")} ${perAdmin}  ·  ${tr("labelRoute")} ${d.route || "—"}  ·  ${tr("labelFrequency")} ${freqLabel(d.administrationsPer24h, tr)}  ·  ${tr("labelDuration")} ${result.windowHours}${hourUnit}`);
      lines.push("");
    });
  }
  lines.push(`${tr("preparedByLabel")} ${technicianName}  ·  ${dayStr}  ·  ${tr("windowLabel")} ${result.windowHours}${hourUnit}`);
  const text = lines.join("\n");

  // ── HTML ─────────────────────────────────────────────────────────────────────
  const patientSections = sorted.map((p) => {
    const wt = patientWeightOverrides[p.recordNumber] ?? p.weightKg;

    const warnings: string[] = [];
    if (p.flags.includes("PATIENT_UNKNOWN"))
      warnings.push(`<div style="color:#c0392b;margin-bottom:5px">${tr("warnPatientUnknownHtml")}</div>`);
    if (p.flags.includes("WEIGHT_UNKNOWN"))
      warnings.push(`<div style="color:#e67e22;margin-bottom:5px">${tr("warnWeightManual", { weight: esc(String(wt)) })}</div>`);
    if (p.flags.includes("ALL_DRUGS_EXCLUDED"))
      warnings.push(`<div style="color:#c0392b;margin-bottom:5px">${tr("warnAllDrugsExcludedHtml")}</div>`);

    const drugCards = p.drugs.map((d, idx) => {
      const key = nk(p.recordNumber, d.drugName);
      const trace = auditTrace[key];
      const qty = d.quantityUnits ?? 0;
      const tracePart = trace
        ? ` <span style="color:#6b7280;font-size:12px">${tr("traceText", { forecast: trace.forecastedQty ?? "—", onHand: trace.onHandQty })}</span>`
        : "";
      const admins = d.administrationsInWindow;
      const perAdmin = admins && admins > 0 ? `${Math.ceil(qty / admins)} ${esc(d.unitLabel)}` : "—";

      return `
      <div style="border:1px solid #d1d5db;border-radius:6px;padding:10px 14px;margin-bottom:8px">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#1a3a6b">${idx + 1}. ${esc(d.drugName)}</div>
        <table style="width:100%;border-collapse:collapse">
          ${tdRow(tr("tdNameStrengthForm"), `${esc(d.drugName)} ${esc(d.concentration)} · ${esc(d.unitLabel)}`)}
          ${tdRow(tr("tdQtyToSupply"), `<strong>${qty} ${esc(d.unitLabel)}</strong>${tracePart}`)}
          ${tdRow(tr("tdDosePerAdmin"), perAdmin)}
          ${tdRow(tr("tdRoute"), esc(d.route || "—"))}
          ${tdRow(tr("tdFrequency"), esc(freqLabel(d.administrationsPer24h, tr)))}
          ${tdRow(tr("tdDuration"), tr("durationHours", { hours: result.windowHours }))}
        </table>
      </div>`;
    }).join("\n");

    return `
    <div style="margin-bottom:28px;border:1px solid #ddd;border-radius:8px;overflow:hidden">
      <div style="background:#1a3a6b;color:#fff;padding:10px 16px">
        <span style="font-size:16px;font-weight:bold">${esc(p.name)}</span>
        <span style="margin-right:10px;opacity:.85;font-size:13px">${tr("recordNoLabel")} ${esc(p.recordNumber)}</span>
        <span style="opacity:.75;font-size:13px">${esc(p.species)} ${esc(p.breed)}</span>
      </div>
      <div style="padding:8px 16px;background:#f7f9fc;border-bottom:1px solid #ddd;font-size:13px;color:#444" dir="${dir}">
        <div>${esc(String(wt))} ${tr("kgUnit")}${p.sex ? `  ·  ${esc(p.sex)}` : ""}${p.age ? `  ·  ${tr("ageLabel")} ${esc(p.age)}` : ""}</div>
        ${(p.ownerName || p.ownerPhone)
          ? `<div style="margin-top:3px">${tr("ownerLabel")} <strong>${esc(p.ownerName)}</strong>${p.ownerPhone ? `  |  ${esc(p.ownerPhone)}` : ""}</div>`
          : ""}
      </div>
      ${warnings.length ? `<div style="padding:8px 16px;background:#fff8f0;border-bottom:1px solid #fce4b0">${warnings.join("")}</div>` : ""}
      <div style="padding:12px 16px" dir="${dir}">
        <div style="font-weight:600;font-size:13px;color:#374151;margin-bottom:8px">${tr("medsToOrderHeading")}</div>
        ${p.drugs.length > 0 ? drugCards : `<div style="color:#888;font-size:13px">${tr("noMedications")}</div>`}
      </div>
    </div>`;
  }).join("\n");

  const parseFailuresSection =
    result.parseFailures && result.parseFailures.length > 0
      ? `
    <div style="margin:0 0 20px;border:1px solid #f59e0b;border-radius:8px;overflow:hidden">
      <div style="background:#fef3c7;color:#92400e;padding:10px 16px;font-size:14px;font-weight:700">
        ${tr("parseFailuresHeadingHtml")}
      </div>
      <div style="padding:12px 16px;background:#fffbeb" dir="${dir}">
        ${result.parseFailures
          .map((failure) => `<div style="font-size:13px;color:#92400e;margin-bottom:6px"><strong>${esc(failure.fileName)}</strong> — ${esc(failure.message)}</div>`)
          .join("")}
      </div>
    </div>`
      : "";

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${loc}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#f0f2f5;font-family:Arial,'Segoe UI',sans-serif;direction:${dir}">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)">
    <div style="background:#1a3a6b;color:#fff;padding:20px 24px">
      <div style="font-size:20px;font-weight:bold;margin-bottom:4px">${tr("emailTitle")}</div>
      <div style="opacity:.85;font-size:14px">${esc(dayStr)}  ·  ${tr("windowLabel")} ${result.windowHours}${hourUnit} (${esc(mode)})  ·  ${n} ${tr("patientsWord")}</div>
    </div>
    <div style="background:#2c5282;color:#e2e8f0;padding:10px 24px;font-size:13px;display:flex;justify-content:space-between">
      <span>${tr("preparedByLabel")} <strong>${esc(technicianName)}</strong></span>
      ${params.auditOrOrderHint ? `<span style="opacity:.75">${tr("idLabel")} ${esc(params.auditOrOrderHint)}</span>` : ""}
    </div>
    <div style="padding:16px 24px">${parseFailuresSection}${patientSections}</div>
    <div style="background:#f7f9fc;border-top:1px solid #e2e8f0;padding:12px 24px;font-size:12px;color:#888;text-align:center">
      ${tr("footer", { date: esc(dayStr) })}
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
