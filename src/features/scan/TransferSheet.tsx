import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { User } from "@/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onTransfer: (userId: string, userName: string) => void;
};

export function TransferSheet({ open, onClose, onTransfer }: Props) {
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["/api/users", "active"],
    queryFn: () => api.users.list("active"),
    enabled: open,
  });

  const filtered = users.filter((u: User) =>
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 40,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.scan.transferTitle}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "var(--background)",
          borderRadius: "20px 20px 0 0",
          paddingBottom: "env(safe-area-inset-bottom)",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "var(--muted)",
              margin: "0 auto 12px",
            }}
          />
          <h3 style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 700 }}>
            {t.scan.transferTitle}
          </h3>
          <input
            type="search"
            placeholder={t.scan.transfer.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              marginTop: 10,
              width: "100%",
              height: 36,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--muted)",
              padding: "0 12px",
              fontSize: "var(--text-sm)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "8px 0" }}>
          {isLoading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted-foreground)", fontSize: "var(--text-sm)" }}>
              {t.scan.transfer.loading}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted-foreground)", fontSize: "var(--text-sm)" }}>
              {t.scan.transfer.noUsers}
            </div>
          ) : (
            filtered.map((user: User) => (
              <button
                key={user.id}
                type="button"
                onClick={() => onTransfer(user.id, user.displayName || user.name)}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  textAlign: "start",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--brand)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--text-sm)",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {(user.displayName || user.name).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--foreground)" }}>
                    {user.displayName || user.name}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
                    {user.role}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
