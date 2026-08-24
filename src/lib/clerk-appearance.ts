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
    // Clerk 5 draws the border/shadow/background on `cardBox` — the wrapper
    // OUTSIDE `card` — so flattening `card` alone still leaves a floating white
    // card inside the door (core-2 upgrade guide). `max-w-none` is load-bearing:
    // `cardBox` otherwise caps at Clerk's own width and the form renders
    // narrower than the social buttons stacked above it.
    cardBox: "w-full max-w-none shadow-none border-0 bg-transparent p-0",
    card: "shadow-none border-0 bg-transparent p-0 w-full",
    // `footer` is grey by default and sits outside `card` but inside `cardBox`
    // — the band under the CTA. It has to match the door, not Clerk's card.
    footer: "bg-transparent bg-none shadow-none border-0",
    footerItem: "bg-transparent",
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
    // ORDER is no longer handled here: `ClerkAuthFormShell` stopped forcing the
    // whole form to `dir="ltr"` and now carries that on the inputs, so this row
    // inherits the page direction like everything else.
    //
    // CLIPPING still is. The row's inline-end item sits flush against an
    // ancestor's `overflow`, and Hebrew final forms carry ink past their advance
    // width, so the last glyph was sheared (on device: the nun of the use-phone
    // action and the yod of the "optional" hint, each surviving as a hairline).
    // Measured, not guessed: `overflow-visible` on this row did NOT clear it
    // (the clipping ancestor is higher up) and neither did `direction`. Only
    // insetting the inline-end side does. Padding the row rather than the item
    // keeps the label flush with the input below it.
    formFieldLabelRow: "rtl:pe-2",
    // Clerk collapses the password row on the identifier step with
    // `height:0; opacity:0` and `overflow:visible`, and takes it off the keyboard
    // (`tabindex="-1"`) and the pointer (`pointer-events:none`) — but not out of
    // the accessibility tree: no `aria-hidden`, no `inert`, no `visibility`.
    // Zero height with visible overflow does not clip children, so the input keeps
    // a 232x35 box and the show-password button a 44x44 one, and VoiceOver
    // announces a password field a sighted user cannot see, before the email one.
    // `visibility` is the one property that removes it: measured against Chrome's
    // AXTree on the live site, `overflow:hidden` changed nothing while
    // `visibility:hidden` dropped all three nodes. Scoped to `cl-signIn-start`
    // because that state class — present on BOTH cardBox and card — marks exactly
    // the step where the row is collapsed; on the password step the rule releases
    // and the field is exposed again (verified by swapping the class).
    formFieldRow__password: "[.cl-signIn-start_&]:invisible",
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
