import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment, folders } from "../../../db.js";
import { and, eq, isNull } from "drizzle-orm";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import {
  CSV_MAX_ROWS,
  EQUIPMENT_IMPORT_FIELD_MAX_LENGTH,
  type CsvRow,
  parseCsv,
  VALID_IMPORT_STATUSES,
} from "../equipment-import-csv.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment/import */
export const postEquipmentImportHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    let csv: string;
    if (req.file) {
      csv = req.file.buffer.toString("utf-8");
    } else {
      const body = req.body as { csv?: string };
      if (!body.csv || typeof body.csv !== "string") {
        return res.status(400).json(
          apiError({
            code: "VALIDATION_FAILED",
            reason: "CSV_INPUT_REQUIRED",
            message: "Provide a CSV file upload (multipart field 'file') or JSON body with 'csv' string",
            requestId,
          }),
        );
      }
      csv = body.csv;
    }

    const { headers, rows } = parseCsv(csv);

    const nameIdx = headers.indexOf("name");
    const serialIdx = headers.indexOf("serial");
    const statusIdx = headers.indexOf("status");
    const locationIdx = headers.indexOf("location");
    const folderIdx = headers.indexOf("folder");
    const maintIdx = headers.indexOf("maintenanceintervaldays");

    if (nameIdx === -1) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "CSV_NAME_COLUMN_REQUIRED",
          message: "CSV must have a 'name' column",
          requestId,
        }),
      );
    }

    if (rows.length > CSV_MAX_ROWS) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "CSV_ROW_LIMIT_EXCEEDED",
          message: `CSV exceeds max ${CSV_MAX_ROWS} rows`,
          requestId,
        }),
      );
    }

    const existingSerials = new Set<string>(
      (await db.select({ s: equipment.serialNumber }).from(equipment).where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt))))
        .map((r) => r.s)
        .filter((s): s is string => !!s)
        .map((s) => s.toLowerCase()),
    );

    const allFolders = await db.select().from(folders).where(and(eq(folders.clinicId, clinicId), isNull(folders.deletedAt)));
    const folderByName = new Map<string, string>(allFolders.map((f) => [f.name.toLowerCase(), f.id]));

    type SkipEntry = { row: number; reason: string; data: Partial<CsvRow> };
    const skipped: SkipEntry[] = [];

    type InsertRow = {
      id: string;
      clinicId: string;
      name: string;
      serialNumber: string | null;
      status: string;
      location: string | null;
      folderId: string | null;
      maintenanceIntervalDays: number | null;
    };
    const toInsert: InsertRow[] = [];
    const seenSerials = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const cols = rows[i];
      const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? "").trim() : "");

      const name = get(nameIdx);
      const serial = get(serialIdx);
      const status = (get(statusIdx) || "ok").toLowerCase();
      const location = get(locationIdx);
      const folderName = get(folderIdx);
      const maintStr = get(maintIdx);

      const rowData: Partial<CsvRow> = { name, serial, status, location, folder: folderName };

      if (!name) {
        skipped.push({ row: rowNum, reason: "Name is required", data: rowData });
        continue;
      }
      if (name.length > EQUIPMENT_IMPORT_FIELD_MAX_LENGTH) {
        skipped.push({ row: rowNum, reason: `Name exceeds ${EQUIPMENT_IMPORT_FIELD_MAX_LENGTH} chars`, data: rowData });
        continue;
      }
      if (serial && serial.length > EQUIPMENT_IMPORT_FIELD_MAX_LENGTH) {
        skipped.push({ row: rowNum, reason: `Serial exceeds ${EQUIPMENT_IMPORT_FIELD_MAX_LENGTH} chars`, data: rowData });
        continue;
      }
      if (!VALID_IMPORT_STATUSES.has(status)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid status "${status}" — must be ok, issue, maintenance, or sterilized`,
          data: rowData,
        });
        continue;
      }

      const serialLower = serial ? serial.toLowerCase() : null;
      if (serialLower) {
        if (existingSerials.has(serialLower)) {
          skipped.push({ row: rowNum, reason: `Serial "${serial}" already exists in the database`, data: rowData });
          continue;
        }
        if (seenSerials.has(serialLower)) {
          skipped.push({ row: rowNum, reason: `Duplicate serial "${serial}" within this CSV`, data: rowData });
          continue;
        }
        seenSerials.add(serialLower);
      }

      let maintenanceIntervalDays: number | null = null;
      if (maintStr) {
        const parsed = parseInt(maintStr, 10);
        if (isNaN(parsed) || parsed < 1) {
          skipped.push({ row: rowNum, reason: `maintenanceIntervalDays must be a positive integer (got "${maintStr}")`, data: rowData });
          continue;
        }
        maintenanceIntervalDays = parsed;
      }

      const folderId = folderName ? (folderByName.get(folderName.toLowerCase()) ?? null) : null;

      toInsert.push({
        id: randomUUID(),
        clinicId,
        name: name.trim(),
        serialNumber: serial || null,
        status,
        location: location || null,
        folderId,
        maintenanceIntervalDays,
      });
    }

    if (toInsert.length === 0) {
      return res.status(200).json({ inserted: 0, skipped });
    }

    await db.transaction(async (tx) => {
      const BATCH = 50;
      for (let b = 0; b < toInsert.length; b += BATCH) {
        await tx.insert(equipment).values(toInsert.slice(b, b + BATCH));
      }
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_imported",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: null,
      targetType: "equipment",
      metadata: { inserted: toInsert.length, skipped: skipped.length },
    });

    invalidateAnalyticsCache(clinicId);
    res.json({ inserted: toInsert.length, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_IMPORT_FAILED",
        message: "Import failed",
        requestId,
      }),
    );
  }
};
