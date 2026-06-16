import type { Equipment } from "@/types";

type EquipmentNameFields = Pick<Equipment, "name"> & { nameHe?: string | null };

/** User-facing equipment label: Hebrew name when set, otherwise the canonical name. */
export function getEquipmentDisplayName(equipment: EquipmentNameFields): string {
  const he = equipment.nameHe?.trim();
  return he ? he : equipment.name;
}
