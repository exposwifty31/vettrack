/**
 * Shared Clerk `<SignIn />` / `<SignUp />` theme: matches Stage 1 Ivory door
 * chrome — flattened card (inset form, not a second bordered box), hidden
 * leftover headers (page `h1` is the only title), brand-indigo primary CTA.
 *
 * Type annotation is intentionally omitted — `@clerk/types` is deprecated upstream
 * (replaced by `@clerk/shared/types` in Clerk Core 3+), and `@clerk/clerk-react`
 * accepts this shape structurally at the `<SignIn appearance={...} />` call site.
 */
/**
 * Clerk `variables` need concrete colors (Clerk derives shades from them, so
 * `hsl(var(--…))` indirection breaks). Both palettes mirror `src/index.css`:
 * light = `:root` clinical, dark = `.dark` clinical.
 */
const lightVariables = {
  colorPrimary: "hsl(243, 75%, 59%)",
  colorText: "hsl(240, 6%, 10%)",
  colorTextSecondary: "hsl(240, 4%, 44%)",
  colorBackground: "hsl(0, 0%, 100%)",
  colorInputBackground: "hsl(0, 0%, 100%)",
  borderRadius: "0.5rem",
};

const darkVariables = {
  colorPrimary: "hsl(234, 89%, 74%)",
  colorText: "hsl(0, 0%, 100%)",
  colorTextSecondary: "hsl(240, 5%, 64%)",
  colorBackground: "hsl(240, 2%, 11%)",
  colorInputBackground: "hsl(240, 3%, 15%)",
  borderRadius: "0.5rem",
};

export const clerkAppearance = {
  variables: lightVariables,
  elements: {
    rootBox: "w-full",
    logoBox: "hidden",
    logoImage: "hidden",
    // Page chrome owns the sheet; Clerk is an inset form, not a second card.
    card: "shadow-none border-0 bg-transparent p-0 w-full",
    // Kill every Clerk leftover title so page h1 is the only heading
    // (Sign-In's "Welcome back" must never appear on /signup).
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    formHeader: "hidden",
    formHeaderTitle: "hidden",
    formHeaderSubtitle: "hidden",
    socialButtonsBlockButton:
      "min-h-[44px] rounded-md border-ivory-border bg-ivory-surface text-ivory-text hover:bg-muted",
    formFieldLabel: "vt-text-sm text-ivory-text",
    formFieldInput:
      "min-h-[44px] rounded-md border-ivory-border bg-ivory-surface text-ivory-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface",
    formFieldInputShowPasswordButton: "text-ivory-text2 hover:text-ivory-text",
    // Brand indigo — NOT --action (scan-confirm only).
    formButtonPrimary:
      "min-h-[44px] rounded-md bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm",
    footerActionLink: "text-primary hover:text-primary/90",
    formFieldErrorText: "vt-text-xs text-destructive",
    identityPreviewText: "text-ivory-text",
    dividerLine: "bg-ivory-border",
    dividerText: "vt-text-xs text-ivory-text3",
  },
};

/**
 * Native (Capacitor) variant: hides Clerk's built-in social buttons and the
 * "or" divider, because the in-WebView provider redirect is blocked by Apple /
 * Google. In the native shell we render our own system-browser social buttons
 * (`<NativeSocialButtons />`) above the Clerk form and keep only the
 * email/password + email-code flows inside the Clerk component.
 */
export const clerkAppearanceNative = {
  ...clerkAppearance,
  // Email/password first; Clerk social buttons are hidden (native uses
  // NativeSocialButtons + system browser). "top" + hidden social = blank card.
  options: {
    socialButtonsPlacement: "bottom" as const,
  },
  elements: {
    ...clerkAppearance.elements,
    socialButtonsRoot: "hidden",
    socialButtonsBlockButton: "hidden",
    socialButtonsProviderIcon: "hidden",
    dividerRow: "hidden",
    dividerText: "hidden",
  },
};

/**
 * Dark-aware accessors: element classes above already flip with the `.dark`
 * Tailwind tokens, but Clerk paints its card/inputs from `variables`, which
 * are static — a signed-out dark-mode device got a white card (TestFlight
 * 1.1.0/21 screenshot). Pass `isDark` from `useIsDarkActive()`.
 */
export function getClerkAppearance(isDark: boolean) {
  return isDark ? { ...clerkAppearance, variables: darkVariables } : clerkAppearance;
}

export function getClerkAppearanceNative(isDark: boolean) {
  return isDark
    ? { ...clerkAppearanceNative, variables: darkVariables }
    : clerkAppearanceNative;
}
