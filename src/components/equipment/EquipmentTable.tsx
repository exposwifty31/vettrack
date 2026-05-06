// src/components/equipment/EquipmentTable.tsx
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";

export interface EquipmentRow {
  id: string;
  name: string;
  location: string;
  lastScan: string;   // display string, e.g. "28/04/26 09:02"
  status: string;
}

interface EquipmentTableProps {
  rows: EquipmentRow[];
}

export function EquipmentTable({ rows }: EquipmentTableProps) {
  return (
    <div className="bg-ivory-surface border border-ivory-border rounded-[7px] overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-ivory-borderMd">
            {(["מזהה", "שם", "מיקום", "סריקה אחרונה", "סטטוס"] as const).map((col) => (
              <th
                key={col}
                className="px-[10px] py-[7px] text-start text-[10.5px] font-bold uppercase tracking-[0.08em] text-ivory-text"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isCritical = row.status === "Review Needed";
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-ivory-border last:border-b-0 transition-colors duration-100",
                  isCritical
                    ? "bg-[#fff5f5] hover:bg-[#ffe8e8]"
                    : "hover:bg-[#f5f2eb]"
                )}
              >
                <td className="px-[10px] py-[7px] font-mono text-[11px] text-ivory-text3">
                  {row.id}
                </td>
                <td className="px-[10px] py-[7px] text-[13px] font-semibold text-ivory-text">
                  {row.name}
                </td>
                <td className="px-[10px] py-[7px] text-[13px] text-ivory-text2">
                  {row.location}
                </td>
                <td className="px-[10px] py-[7px] font-mono text-[11px] text-ivory-text3">
                  {row.lastScan}
                </td>
                <td className="px-[10px] py-[7px]">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
