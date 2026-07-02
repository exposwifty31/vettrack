import { useRef, useState } from "react";
import { Pencil, Check, X, Camera } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getInitials } from "@/lib/user-utils";
import type { UserRole } from "@/types/platform";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function roleLabel(role: UserRole): string {
  return t.profile.roles[role];
}

export function ProfileHeroZone() {
  const { name, role, userId } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: api.users.me,
    enabled: Boolean(userId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const avatarUrl = previewUrl ?? me?.avatarUrl ?? null;

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t.profile.photoUploadError);
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t.profile.photoTooLarge);
      return;
    }
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);
    try {
      await api.users.uploadAvatar(file);
      await queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
      // The refetched `me` now carries the real presigned URL. Drop the local
      // preview so the <img> renders that — a revoked object URL (see finally)
      // must never remain the display source, or the avatar breaks on re-decode.
      setPreviewUrl(null);
      toast.success(t.profile.photoUpdated);
    } catch {
      setPreviewUrl(null);
      toast.error(t.profile.photoUploadError);
    } finally {
      URL.revokeObjectURL(localPreview);
      setUploading(false);
    }
  }

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
      {/* Avatar + upload control */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        aria-label={t.profile.changePhoto}
        style={{
          position: "relative",
          width: 72,
          height: 72,
          padding: 0,
          border: "none",
          borderRadius: "50%",
          background: "transparent",
          cursor: uploading ? "default" : "pointer",
          flexShrink: 0,
          WebkitTapHighlightColor: "transparent",
          opacity: uploading ? 0.7 : 1,
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={t.profile.avatarAlt}
            width={72}
            height={72}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <span style={{
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
          }}>
            {getInitials(name)}
          </span>
        )}
        <span
          aria-hidden
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            bottom: 0,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            border: "2px solid hsl(var(--background))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Camera size={13} />
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarChange}
        style={{ display: "none" }}
      />

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
