/**
 * Shared Clerk `<SignIn />` / `<SignUp />` theme: matches `src/index.css` primary/foreground
 * and adds visible focus rings for accessibility (Phase 4 app-wide UI/UX).
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
  borderRadius: "1rem",
};

const darkVariables = {
  colorPrimary: "hsl(234, 89%, 74%)",
  colorText: "hsl(0, 0%, 100%)",
  colorTextSecondary: "hsl(240, 5%, 64%)",
  colorBackground: "hsl(240, 2%, 11%)",
  colorInputBackground: "hsl(240, 3%, 15%)",
  borderRadius: "1rem",
};

export const clerkAppearance = {
  variables: lightVariables,
  elements: {
    rootBox: "w-full",
    logoBox: "hidden",
    logoImage: "hidden",
    card: "rounded-2xl border border-border shadow-sm",
    headerTitle: "text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButton:
      "border-border bg-background text-foreground hover:bg-muted",
    formFieldLabel: "text-foreground",
    formFieldInput:
      "rounded-xl border-input bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    formFieldInputShowPasswordButton: "text-muted-foreground hover:text-foreground",
    formButtonPrimary: "bg-primary hover:bg-primary/90 shadow-sm",
    footerActionLink: "text-primary hover:text-primary/90",
    formFieldErrorText: "text-destructive",
    identityPreviewText: "text-foreground",
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
