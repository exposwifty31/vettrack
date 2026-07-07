import { Bdi } from "@/components/ui/bdi";
import { t, formatDateByLocale } from "@/lib/i18n";

/** Time-of-day greeting including the user's first name. */
function greetingFor(hour: number, name: string): string {
  if (hour < 12) return t.homePage.greetingMorning(name);
  if (hour < 18) return t.homePage.greetingAfternoon(name);
  return t.homePage.greetingEvening(name);
}

/**
 * Home greeting header, shared by both surfaces (extracted from home.tsx; also
 * supersedes the copy-pasted greeting in HomeTabletDashboard). `large` is the warm
 * floor variant (personal); `compact` is the quieter ops orientation line — the ops
 * answer is the coverage read below, not the greeting.
 */
export function HomeGreeting({
  name,
  size = "large",
}: {
  name?: string | null;
  size?: "compact" | "large";
}) {
  const firstName = name?.split(" ")[0] || t.homePage.fallbackName;
  const greeting = greetingFor(new Date().getHours(), firstName);
  const dateLine = formatDateByLocale(new Date(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <header>
      <h1
        className={
          size === "large"
            ? "text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] text-ivory-text"
            : "text-2xl font-bold leading-[1.1] tracking-[-0.02em] text-ivory-text"
        }
      >
        <Bdi>{greeting}</Bdi>
      </h1>
      <p className="mt-1.5 text-[15px] font-medium text-ivory-text3">{dateLine}</p>
    </header>
  );
}
