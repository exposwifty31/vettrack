/**
 * PATCH /api/equipment/:id payload builder — extracted from new-equipment.tsx
 * so the clear-a-field wire contract is unit-testable (the RN repo extracted
 * its builders the same way).
 *
 * THE CONTRACT THE SERVER ENFORCES (server/routes/equipment.ts
 * patchEquipmentSchema, .strict()): `serialNumber`, `model`, `manufacturer`
 * and `location` are `optional()` and NOT `.nullable()` — sending `null` for
 * any of them 400s the whole PATCH. Clearing those four ships the EMPTY
 * STRING (the semantics the RN form already ships); the remaining optional
 * fields are `.nullable()` and keep `null` as their cleared value.
 */

export type EquipmentUpdateFormInput = Readonly<{
  name: string;
  nameHe?: string | null;
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  purchaseDate?: string;
  expiryDate?: string | null;
  location?: string;
  folderId?: string;
  maintenanceIntervalDays?: number;
  expectedReturnMinutes?: number;
  imageUrl?: string;
  usuallyFoundHere?: string | null;
  searchAlias?: string | null;
  staffNote?: string | null;
  rfidTagEpc?: string | null;
}>;

export type EquipmentUpdateOpts = Readonly<{
  /** Admin-only field — include only when the form showed it. */
  includeExpectedReturn: boolean;
  /** Optimistic concurrency echo — include only when the loaded row had one. */
  version: number | undefined;
}>;

export function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildEquipmentUpdatePayload(data: EquipmentUpdateFormInput, opts: EquipmentUpdateOpts) {
  return {
    name: data.name,
    nameHe: normalizeOptionalString(data.nameHe ?? undefined) ?? null,
    serialNumber: normalizeOptionalString(data.serialNumber) ?? "",
    model: normalizeOptionalString(data.model) ?? "",
    manufacturer: normalizeOptionalString(data.manufacturer) ?? "",
    purchaseDate: normalizeOptionalString(data.purchaseDate) ?? null,
    expiryDate: data.expiryDate ? normalizeOptionalString(data.expiryDate) ?? null : null,
    location: normalizeOptionalString(data.location) ?? "",
    folderId: data.folderId === "none" ? null : data.folderId,
    maintenanceIntervalDays: data.maintenanceIntervalDays ?? null,
    ...(opts.includeExpectedReturn && { expectedReturnMinutes: data.expectedReturnMinutes ?? null }),
    imageUrl: normalizeOptionalString(data.imageUrl) ?? null,
    usuallyFoundHere: normalizeOptionalString(data.usuallyFoundHere ?? undefined) ?? null,
    searchAlias: normalizeOptionalString(data.searchAlias ?? undefined) ?? null,
    staffNote: normalizeOptionalString(data.staffNote ?? undefined) ?? null,
    rfidTagEpc: normalizeOptionalString(data.rfidTagEpc ?? undefined) ?? null,
    ...(opts.version !== undefined && { version: opts.version }),
  };
}
