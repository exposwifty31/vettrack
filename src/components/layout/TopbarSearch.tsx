// src/components/layout/TopbarSearch.tsx
// Desktop topbar equipment search. Delegates to the shared typeahead
// (EquipmentSearchBox): live results dropdown + "/" focus shortcut, navigating
// to /equipment/:id on a pick or /equipment?q=… on submit. Wider than the old
// field so the full "Search by name, serial number, model…" placeholder fits.
import { EquipmentSearchBox } from "@/components/search/EquipmentSearchBox";

export function TopbarSearch() {
  return (
    <div className="hidden lg:block w-[min(340px,30vw)]">
      <EquipmentSearchBox tone="bar" enableSlashShortcut />
    </div>
  );
}
