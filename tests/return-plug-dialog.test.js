/**
 * Return plug dialog UI logic tests.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dialogPath = path.join(__dirname, "..", "src", "components", "return-plug-dialog.tsx");
const detailPath = path.join(__dirname, "..", "src", "pages", "equipment-detail.tsx");
const listPath = path.join(__dirname, "..", "src", "pages", "equipment-list.tsx");
const qrPath = path.join(__dirname, "..", "src", "components", "qr-scanner.tsx");
const apiPath = path.join(__dirname, "..", "src", "lib", "api.ts");

const dialogSource = fs.readFileSync(dialogPath, "utf8");
const detailSource = fs.readFileSync(detailPath, "utf8");
const listSource = fs.readFileSync(listPath, "utf8");
const qrSource = fs.readFileSync(qrPath, "utf8");
const apiSource = fs.readFileSync(apiPath, "utf8");

describe("Return plug dialog UI tests", () => {
  it("Dialog exposes plugged yes/no controls and deadline input", () => {
    expect(
      dialogSource.includes("data-testid=\"btn-plugged-no\"") &&
        dialogSource.includes("data-testid=\"btn-plugged-yes\"") &&
        dialogSource.includes("data-testid=\"input-plug-deadline\""),
    ).toBe(true);
  });

  it("Warning text is rendered when isPluggedIn is false", () => {
    expect(
      dialogSource.includes("!isPluggedIn && (") &&
        dialogSource.includes("data-testid=\"return-plug-warning\"") &&
        dialogSource.includes("An alert will be sent after"),
    ).toBe(true);
  });

  it("Dialog omits deadline payload when isPluggedIn is true", () => {
    expect(dialogSource).toContain("...(isPluggedIn ? {} : { plugInDeadlineMinutes: normalizedDeadline })");
  });

  it("Equipment detail return action opens the plug dialog", () => {
    expect(
      detailSource.includes("<ReturnPlugDialog") &&
        detailSource.includes("data-testid=\"btn-return\"") &&
        detailSource.includes("onClick={handleOpenReturnDialog}"),
    ).toBe(true);
  });

  it("Equipment list return quick action routes through the plug dialog", () => {
    expect(
      listSource.includes("<ReturnPlugDialog") &&
        listSource.includes("setReturnDialogOpen(true)") &&
        listSource.includes("returnMut.mutate(payload"),
    ).toBe(true);
  });

  it("QR scanner return flow routes through the plug dialog", () => {
    expect(
      qrSource.includes("<ReturnPlugDialog") &&
        qrSource.includes("setReturnDialogOpen(true)") &&
        qrSource.includes("await api.equipment.return(scannedEquipment.id, {"),
    ).toBe(true);
  });

  it("Offline return replay carries plug-in tracking payload", () => {
    expect(
      apiSource.includes('syncType: "return_with_charge"') &&
        apiSource.includes("requestBody: returnRequest") &&
        apiSource.includes("if (response.returnRecord)"),
    ).toBe(true);
  });
});
