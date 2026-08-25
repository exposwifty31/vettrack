import { useEffect, type ReactNode } from "react";

/**
 * Identifier-style fields, which additionally must not be auto-capitalised or
 * autocorrected — an email typed with a leading capital fails the lookup.
 */
const AUTH_IDENTIFIER_SELECTOR = [
  'input[name="identifier"]',
  'input[name="emailAddress"]',
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  ".cl-formFieldInput input",
].join(", ");

function applyAuthInputFixes(root: ParentNode) {
  // EVERY field the user types into stays LTR — email, username, password, and
  // the one-time code are all Latin/numeric. This used to come free from `dir`
  // on the wrapper below; carrying it per-input is what lets the wrapper go.
  root.querySelectorAll("input").forEach((node) => {
    node.setAttribute("dir", "ltr");
  });

  root.querySelectorAll(AUTH_IDENTIFIER_SELECTOR).forEach((node) => {
    if (!(node instanceof HTMLInputElement)) return;
    node.autocapitalize = "none";
    node.spellcheck = false;
    node.setAttribute("autocapitalize", "none");
    node.setAttribute("autocorrect", "off");
  });
}

/**
 * Clerk auth fields inside a Hebrew RTL shell inherit RTL + sentence-case keyboard
 * behavior on iOS WKWebView. Email identifiers must stay LTR with no auto-capitalization.
 *
 * That fix used to be `dir="ltr"` on this wrapper, which was too blunt: it put the
 * whole Clerk form into an LTR box, so every row Clerk lays out with
 * `justify-content` or a leading icon came out mirrored in Hebrew — the field
 * label and its hint swapped ends, the alert icon sat on the wrong side, the
 * continue arrow trailed on the wrong side pointing the wrong way. Each was
 * being patched one at a time through `appearance`; they are all one bug.
 *
 * The direction now belongs to the INPUTS, which is the only place it was ever
 * needed, and the surrounding chrome inherits the page's direction. The
 * MutationObserver already re-applies on every Clerk re-render, so a field that
 * mounts on a later step (password, one-time code) is covered too.
 *
 * `lang="en"` stays off deliberately: the visible copy here is Hebrew, and
 * claiming otherwise makes a screen reader pronounce it with an English voice.
 */
export function ClerkAuthFormShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.getElementById("clerk-auth-form-root");
    if (!root) return;

    applyAuthInputFixes(root);
    const obs = new MutationObserver(() => applyAuthInputFixes(root));
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  return (
    <div id="clerk-auth-form-root" className="w-full">
      {children}
    </div>
  );
}
