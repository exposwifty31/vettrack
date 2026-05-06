import { useState } from "react";
import { useSignIn } from "@clerk/clerk-react";
import { normalizePhoneE164 } from "@/lib/utils";

type Step = "phone" | "code" | "error";

export function PhoneSignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isLoaded) return null;

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    setErrorMsg(null);
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
        setErrorMsg(
          "התחברות עם טלפון אינה זמינה לחשבון זה. השתמש בשיטת התחברות אחרת, או פנה לתמיכה אם אתה מתחבר עם מספר ישראלי (+972) ומקבל שגיאה — יש לאפשר ישראל ב-Clerk Dashboard (Configure → Phone numbers → SMS sending → Allowed countries)."
        );
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
        "אירעה שגיאה. נסה שוב.";
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
        setErrorMsg("האימות נכשל. נסה שוב.");
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ message?: string; longMessage?: string }> };
      const msg =
        clerkErr?.errors?.[0]?.longMessage ||
        clerkErr?.errors?.[0]?.message ||
        "קוד שגוי. נסה שוב.";
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
        <h2 className="text-base font-semibold text-foreground mb-1">התחברות עם טלפון</h2>
        <p className="text-xs text-muted-foreground mb-4">
          הזן מספר טלפון בפורמט בינלאומי (לדוגמה:{" "}
          <span className="font-mono">+972501234567</span>) או בפורמט ישראלי מקומי (לדוגמה:{" "}
          <span className="font-mono">0501234567</span>).
        </p>
        <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="phone-sign-in-input" className="sr-only">
              מספר טלפון
            </label>
            <input
              id="phone-sign-in-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+972501234567 או 0501234567"
              autoComplete="tel"
              required
              aria-required="true"
              aria-describedby={errorMsg ? "phone-sign-in-error" : undefined}
              className="w-full border border-input rounded-xl px-4 py-3 text-sm bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus:border-transparent"
            />
            {isILLocal && e164Preview && (
              <p className="text-xs text-primary mt-1">
                יישלח בתור <span className="font-mono">{e164Preview}</span>
              </p>
            )}
          </div>
          {errorMsg && (
            <p
              id="phone-sign-in-error"
              className="text-sm text-destructive bg-destructive/10 border border-destructive/25 rounded-lg px-3 py-2"
              role="alert"
            >
              {errorMsg.toLowerCase().includes("not supported") || errorMsg.toLowerCase().includes("phone sign-in is not available")
                ? "התחברות עם טלפון אינה זמינה לחשבון זה. נסה שיטה אחרת, או פנה למנהל."
                : errorMsg.toLowerCase().includes("clerk") || errorMsg.length > 120
                ? "אירעה שגיאה. נסה שוב או השתמש בשיטת התחברות אחרת."
                : errorMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? "שולח קוד..." : "שלח קוד אימות"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm w-full">
      <h2 className="text-base font-semibold text-foreground mb-1">הזן קוד אימות</h2>
      <p className="text-xs text-muted-foreground mb-4">
        נשלח קוד אל <span className="font-mono font-medium">{normalizePhoneE164(phone)}</span>
      </p>
      <form onSubmit={handleCodeSubmit} className="flex flex-col gap-3">
        <label htmlFor="verification-code-input" className="sr-only">
          קוד אימות בן 6 ספרות
        </label>
        <input
          id="verification-code-input"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="קוד בן 6 ספרות"
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
          {loading ? "מאמת..." : "אמת"}
        </button>
        <button
          type="button"
          onClick={() => { setStep("phone"); setCode(""); setErrorMsg(null); }}
          className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
        >
          שנה מספר טלפון
        </button>
      </form>
    </div>
  );
}
