/**
 * Shared Clerk `<SignIn />` / `<SignUp />` theme: matches `src/index.css` primary/foreground
 * and adds visible focus rings for accessibility (Phase 4 app-wide UI/UX).
 *
 * Type annotation is intentionally omitted — `@clerk/types` is deprecated upstream
 * (replaced by `@clerk/shared/types` in Clerk Core 3+), and `@clerk/clerk-react`
 * accepts this shape structurally at the `<SignIn appearance={...} />` call site.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "hsl(221 83% 53%)",
    colorText: "hsl(220 15% 20%)",
    colorTextSecondary: "hsl(220 10% 50%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInputBackground: "hsl(0 0% 100%)",
    borderRadius: "1rem",
  },
  elements: {
    rootBox: "w-full",
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
  elements: {
    ...clerkAppearance.elements,
    socialButtonsRoot: "hidden",
    socialButtonsBlockButton: "hidden",
    socialButtonsProviderIcon: "hidden",
    dividerRow: "hidden",
    dividerText: "hidden",
  },
};
