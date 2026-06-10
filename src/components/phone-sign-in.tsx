import { useState } from "react";
import { useSignIn } from "@clerk/clerk-react";
import { normalizePhoneE164 } from "@/lib/utils";
import { t } from "@/lib/i18n";

type Step = "phone" | "code" | "error";
type PhoneErrorCode = "NOT_AVAILABLE" | "GENERIC" | null;

export function PhoneSignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [phoneErrorCode, setPhoneErrorCode] = useState<PhoneErrorCode>(null);

  if (!isLoaded) return null;

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    setErrorMsg(null);
    setPhoneErrorCode(null);
    setLoading(true);
    try {
      const e164 = normalizePhoneE164(phone);
      await signIn.create({
        identifier: e164,
      });
      const phoneFactor = signIn.supportedFirstFactors?.find(
        (f) => f.strategy === "phone_code"
      );
      if (!phoneFactor || !phoneFactor.phoneNumberId) {
        setPhoneErrorCode("NOT_AVAILABLE");
        setErrorMsg(t.phoneSignIn.errorNotAvailableFull);
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: "phone_code",
        phoneNumberId: phoneFactor.phoneNumberId,
      });
      setStep("code");
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ message?: string; longMessage?: string }> };
      const msg =
        clerkErr?.errors?.[0]?.longMessage ||
        clerkErr?.errors?.[0]?.message ||
        t.phoneSignIn.errorUnexpected;
      const lower = msg.toLowerCase();
      if (
        lower.includes("not supported") ||
        lower.includes("phone sign-in is not available")
      ) {
        setPhoneErrorCode("NOT_AVAILABLE");
      } else if (lower.includes("clerk") || msg.length > 120) {
        setPhoneErrorCode("GENERIC");
      } else {
        setPhoneErrorCode(null);
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn || !setActive) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "phone_code",
        code,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      } else {
        setErrorMsg(t.phoneSignIn.errorVerificationFailed);
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ message?: string; longMessage?: string }> };
      const msg =
        clerkErr?.errors?.[0]?.longMessage ||
        clerkErr?.errors?.[0]?.message ||
        t.phoneSignIn.errorInvalidCode;
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  const isILLocal = /^05\d/.test(phone.trim());
  const e164Preview = phone.trim() ? normalizePhoneE164(phone) : null;

  if (step === "phone") {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm w-full">
        <h2 className="text-base font-semibold text-foreground mb-1">{t.phoneSignIn.title}</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t.phoneSignIn.phoneFormatHintA}{" "}
          <span className="font-mono">+972501234567</span>{t.phoneSignIn.phoneFormatHintB}{" "}
          <span className="font-mono">0501234567</span>{t.phoneSignIn.phoneFormatHintC}
        </p>
        <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="phone-sign-in-input" className="sr-only">
              {t.phoneSignIn.phoneInputLabel}
            </label>
            <input
              id="phone-sign-in-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t.phoneSignIn.phoneInputPlaceholder}
              autoComplete="tel"
              required
              aria-required="true"
              aria-describedby={errorMsg ? "phone-sign-in-error" : undefined}
              className="w-full border border-input rounded-xl px-4 py-3 text-sm bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:border-transparent"
            />
            {isILLocal && e164Preview && (
              <p className="text-xs text-primary mt-1">
                {t.phoneSignIn.sendingAs} <span className="font-mono">{e164Preview}</span>
              </p>
            )}
          </div>
          {errorMsg && (
            <p
              id="phone-sign-in-error"
              className="text-sm text-destructive bg-destructive/10 border border-destructive/25 rounded-lg px-3 py-2"
              role="alert"
            >
              {phoneErrorCode === "NOT_AVAILABLE"
                ? t.phoneSignIn.errorNotAvailableShort
                : phoneErrorCode === "GENERIC"
                ? t.phoneSignIn.errorGeneric
                : errorMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? t.phoneSignIn.sendingCode : t.phoneSignIn.sendCode}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm w-full">
      <h2 className="text-base font-semibold text-foreground mb-1">{t.phoneSignIn.codeStepTitle}</h2>
      <p className="text-xs text-muted-foreground mb-4">
        {t.phoneSignIn.codeSentTo} <span className="font-mono font-medium">{normalizePhoneE164(phone)}</span>
      </p>
      <form onSubmit={handleCodeSubmit} className="flex flex-col gap-3">
        <label htmlFor="verification-code-input" className="sr-only">
          {t.phoneSignIn.codeInputLabel}
        </label>
        <input
          id="verification-code-input"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder={t.phoneSignIn.codeInputPlaceholder}
          maxLength={6}
          autoComplete="one-time-code"
          required
          aria-required="true"
          className="w-full border border-input rounded-xl px-4 py-3 text-sm text-center tracking-widest bg-background text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:border-transparent"
        />
        {errorMsg && (
          <p
            className="text-xs text-destructive bg-destructive/10 border border-destructive/25 rounded-lg px-3 py-2"
            role="alert"
          >
            {errorMsg}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || code.length < 4}
          className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
        >
          {loading ? t.phoneSignIn.verifying : t.phoneSignIn.verify}
        </button>
        <button
          type="button"
          onClick={() => { setStep("phone"); setCode(""); setErrorMsg(null); }}
          className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
        >
          {t.phoneSignIn.changePhone}
        </button>
      </form>
    </div>
  );
}
