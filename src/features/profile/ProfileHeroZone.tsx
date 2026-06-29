import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function getInitials(name: string | null): string {
  if (!name?.trim()) return "?";
  return name
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function roleLabel(role: string): string {
  const roles = t.profile.roles as Record<string, string>;
  return roles[role] ?? role;
}

export function ProfileHeroZone() {
  const { name, role, userId } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!userId || !draft.trim() || draft.trim() === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.users.updateDisplayName(userId, draft.trim());
      queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setEditing(false);
    } catch {
      toast.error(t.profile.saveError);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(name ?? "");
    setEditing(false);
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 12,
      paddingBlock: 28,
      paddingInline: 24,
    }}>
      {/* Avatar */}
      <div style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        background: "hsl(var(--primary))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 26,
        fontWeight: 700,
        color: "hsl(var(--primary-foreground))",
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}>
        {getInitials(name)}
      </div>

      {/* Name + edit */}
      {editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            autoFocus
            aria-label={t.profile.editDisplayName}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
            style={{
              fontSize: 18,
              fontWeight: 600,
              textAlign: "center",
              border: "none",
              borderBottom: "2px solid hsl(var(--primary))",
              background: "transparent",
              color: "hsl(var(--foreground))",
              outline: "none",
              padding: "2px 4px",
              minWidth: 140,
            }}
          />
          <button type="button" onClick={handleSave} disabled={saving} aria-label={t.common.save} style={iconActionBtn}>
            <Check size={16} color="hsl(var(--primary))" />
          </button>
          <button type="button" onClick={handleCancel} aria-label={t.common.cancel} style={iconActionBtn}>
            <X size={16} color="hsl(var(--muted-foreground))" />
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>
            {saved ? t.profile.displayNameUpdated : (name ?? "—")}
          </span>
          <button
            type="button"
            aria-label={t.profile.editDisplayName}
            onClick={() => { setDraft(name ?? ""); setEditing(true); }}
            style={iconActionBtn}
          >
            <Pencil size={14} color="hsl(var(--muted-foreground))" />
          </button>
        </div>
      )}

      {/* Role badge */}
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        paddingInline: 10,
        paddingBlock: 3,
        borderRadius: 20,
        background: "hsl(var(--primary) / 0.12)",
        color: "hsl(var(--primary))",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        {roleLabel(role)}
      </span>
    </div>
  );
}

const iconActionBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "none",
  background: "transparent",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  WebkitTapHighlightColor: "transparent",
};
