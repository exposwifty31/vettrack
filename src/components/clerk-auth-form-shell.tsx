import { useEffect, type ReactNode } from "react";

const AUTH_INPUT_SELECTOR = [
  'input[name="identifier"]',
  'input[name="emailAddress"]',
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  ".cl-formFieldInput input",
].join(", ");

function applyAuthInputKeyboardFix(root: ParentNode) {
  root.querySelectorAll(AUTH_INPUT_SELECTOR).forEach((node) => {
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
 */
export function ClerkAuthFormShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.getElementById("clerk-auth-form-root");
    if (!root) return;

    applyAuthInputKeyboardFix(root);
    const obs = new MutationObserver(() => applyAuthInputKeyboardFix(root));
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  return (
    <div id="clerk-auth-form-root" dir="ltr" lang="en" className="w-full">
      {children}
    </div>
  );
}
