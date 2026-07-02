import { useState } from "react";
import { Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { EquipmentSearchBox } from "./EquipmentSearchBox";

/**
 * Phone search affordance. The 44px header can't hold a field next to the
 * wordmark + icon trio, so search is a leading icon that opens a top overlay
 * carrying the full typeahead (iOS search-sheet pattern).
 */
export function EquipmentSearchButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={t.equipmentList.search.placeholder}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        style={{
          width: 44,
          height: 44,
          border: "none",
          background: "transparent",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Search size={20} strokeWidth={1.8} color="hsl(var(--foreground))" aria-hidden />
      </button>

      {open && (
        <>
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.3)" }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.equipmentList.search.placeholder}
            style={{
              position: "fixed",
              insetInlineStart: 0,
              insetInlineEnd: 0,
              top: 0,
              zIndex: 71,
              background: "hsl(var(--background))",
              borderBottom: "1px solid hsl(var(--border))",
              paddingTop: "calc(env(safe-area-inset-top) + 10px)",
              paddingInline: 12,
              paddingBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <EquipmentSearchBox tone="surface" autoFocus onNavigate={() => setOpen(false)} />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                flexShrink: 0,
                border: "none",
                background: "transparent",
                color: "hsl(var(--primary))",
                fontSize: 14,
                fontWeight: 600,
                padding: "0 6px",
                height: 36,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t.common.cancel}
            </button>
          </div>
        </>
      )}
    </>
  );
}
