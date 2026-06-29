import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { QrScanner } from "@/components/qr-scanner";
import { AccountabilityConfirm } from "./AccountabilityConfirm";
import { t } from "@/lib/i18n";

export function ScanScreen() {
  const [, navigate] = useLocation();
  const [confirmedName, setConfirmedName] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    navigate("/home");
  }, [navigate]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "hsl(var(--background))",
      }}
    >
      <div
        style={{
          padding: "calc(env(safe-area-inset-top) + 16px) 16px 12px",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 800,
            color: "hsl(var(--foreground))",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {t.scan.title}
        </h1>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "hsl(var(--muted-foreground))",
            margin: "4px 0 0",
          }}
        >
          {t.scan.scanPrompt}
        </p>
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <QrScanner onClose={handleClose} />
      </div>

      {confirmedName && (
        <AccountabilityConfirm
          equipmentName={confirmedName}
          onDismiss={() => setConfirmedName(null)}
        />
      )}
    </div>
  );
}
