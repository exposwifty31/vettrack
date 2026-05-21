import { describe, it, expect } from "vitest";
import { buildPharmacyOrderEmail } from "../server/lib/forecast/emailBuilder.js";
import type { ForecastResult } from "../server/lib/forecast/types.js";

const result: ForecastResult = {
  parsedAt: new Date().toISOString(),
  windowHours: 24,
  weekendMode: false,
  pdfSourceFormat: "smartflow",
  totalFlags: 0,
  patients: [{
    recordNumber: "361848", name: "שון", species: "Canine", breed: "Mixed",
    sex: "M", age: "", color: "", weightKg: 3.9,
    ownerName: "ישראל ישראלי", ownerId: "", ownerPhone: "050-1234567",
    flags: [],
    drugs: [{
      drugName: "Famotidine", type: "regular", quantityUnits: 3,
      unitLabel: "אמפולות", concentration: "10 mg/mL", packDescription: "",
      route: "IV", flags: [], administrationsPer24h: 1, administrationsInWindow: 1,
    }],
  }],
};

describe("buildPharmacyOrderEmail", () => {
  it("HTML contains drug name in per-section heading", () => {
    const { html } = buildPharmacyOrderEmail({ result, technicianName: "שרה" });
    expect(html).toContain("Famotidine");
  });

  it("HTML does not use <thead> drug table (old format gone)", () => {
    const { html } = buildPharmacyOrderEmail({ result, technicianName: "שרה" });
    expect(html).not.toContain("<thead>");
  });

  it("HTML shows owner phone", () => {
    const { html } = buildPharmacyOrderEmail({ result, technicianName: "שרה" });
    expect(html).toContain("050-1234567");
  });

  it("shows audit trace when provided", () => {
    const { html } = buildPharmacyOrderEmail({
      result,
      technicianName: "שרה",
      locale: "he",
      auditTrace: { "361848__famotidine": { forecastedQty: 4, onHandQty: 1 } },
    });
    expect(html).toContain("חזוי: 4");
    expect(html).toContain("קיים בתא: 1");
  });

  it("uses patientWeightOverride in patient header", () => {
    const { html } = buildPharmacyOrderEmail({
      result, technicianName: "שרה",
      patientWeightOverrides: { "361848": 5.2 },
    });
    expect(html).toContain("5.2");
  });

  it("plain text contains drug name and qty", () => {
    const { text } = buildPharmacyOrderEmail({ result, technicianName: "שרה" });
    expect(text).toContain("Famotidine");
    expect(text).toContain("3");
  });

  it("includes parse failure section in html and text", () => {
    const withFailures: ForecastResult = {
      ...result,
      parseFailures: [{ fileName: "ward-a.pdf", message: "פענוח PDF נכשל" }],
    };
    const { html, text } = buildPharmacyOrderEmail({
      result: withFailures,
      technicianName: "שרה",
      locale: "he",
    });
    expect(html).toContain("קבצים שלא פוענחו");
    expect(html).toContain("ward-a.pdf");
    expect(text).toContain("קבצים שלא פוענחו");
    expect(text).toContain("ward-a.pdf");
  });
});
