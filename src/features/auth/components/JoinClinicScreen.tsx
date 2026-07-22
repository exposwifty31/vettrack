import { useEffect, useRef, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { joinClinic } from "@/lib/api";
import { readCarriedJoinCode, writeCarriedJoinCode } from "@/features/auth/join-code-store";

interface JoinClinicScreenProps {
  onJoined: () => void;
  onSignOut: () => void;
}

/**
 * Post-auth membership step for users whose session resolves to no clinic
 * (403 MISSING_CLINIC_ID): redeem a clinic join code for PENDING membership.
 * Rendered by AuthGuard in place of the generic access-denied screen. A code
 * carried from the invite link (`/signup?clinic=CODE`, see join-code-store) is
 * auto-submitted once; manual entry covers native social sign-ups, where the
 * link parameter cannot survive the OAuth hop.
 */
export function JoinClinicScreen({ onJoined, onSignOut }: JoinClinicScreenProps) {
  const [code, setCode] = useState(() => readCarriedJoinCode() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);

  async function submit(candidate: string) {
    const trimmed = candidate.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await joinClinic(trimmed);
      if (result.ok) {
        writeCarriedJoinCode(null);
        onJoined();
        return;
      }
      setError(
        result.reason === "INVALID_JOIN_CODE"
          ? t.auth.joinClinic.invalidCode
          : t.auth.joinClinic.genericError,
      );
    } catch {
      setError(t.auth.joinClinic.genericError);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoSubmittedRef.current) return;
    const carried = readCarriedJoinCode();
    if (!carried) return;
    autoSubmittedRef.current = true;
    void submit(carried);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen flex-col items-center justify-center text-center p-6 bg-gradient-to-b from-primary/5 to-background">
      <Building2 className="h-16 w-16 text-primary mb-4" />
      <h1 className="text-2xl font-bold text-foreground mb-2">{t.auth.joinClinic.title}</h1>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{t.auth.joinClinic.subtitle}</p>

      <form
        className="w-full max-w-xs flex flex-col gap-3 text-start"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <Label htmlFor="clinicJoinCode" className="text-xs font-semibold text-foreground">
          {t.auth.joinClinic.codeLabel}
        </Label>
        <Input
          id="clinicJoinCode"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t.auth.joinClinic.codePlaceholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          dir="ltr"
          className="font-mono tracking-widest text-center"
          maxLength={32}
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || code.trim().length < 8}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin me-2" />
              {t.auth.joinClinic.joining}
            </>
          ) : (
            t.auth.joinClinic.submit
          )}
        </Button>
      </form>

      <Button variant="ghost" className="mt-6" onClick={onSignOut}>
        {t.auth.guard.signOut}
      </Button>
    </div>
  );
}
