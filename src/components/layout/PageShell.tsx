// src/components/layout/PageShell.tsx
// Desktop page wrapper. Renders Topbar + content area.
// Does NOT replace the existing mobile Layout — that stays for mobile views.
// Use this for desktop-first pages.
//
// T22: PageShell used to also render the icon-rail `Sidebar` alongside Topbar —
// both were driven by the exact same NAV + WEB_MANAGEMENT_NAV models, so every
// destination appeared twice (a text link in Topbar, an icon in the rail). Topbar
// is the richer, canonical desktop nav (logo, search, alerts, settings, avatar,
// plus the M2 management dropdown for overflow) so it's the one that stays;
// the icon rail is retired from the render tree. `Sidebar`/`IconSidebar` remain
// as components (design-system barrel still re-exports them) — just unused here.

import { Topbar } from "@/components/layout/Topbar";
import { SidebarDivider } from "@/components/layout/IconSidebar";
import { useDirection } from "@/hooks/useDirection";
import { t } from "@/lib/i18n";
import type { SidebarItem } from "@/components/layout/IconSidebar";

interface PageShellProps {
  /** @deprecated No longer rendered (T22 — removed the duplicate icon rail). Kept so existing call sites don't need a signature change. */
  sidebarItems?: SidebarItem[];
  children: React.ReactNode;
}

export function PageShell({ children }: PageShellProps) {
  const dir = useDirection();

  return (
    <div dir={dir} className="h-screen min-w-0 overflow-hidden bg-ivory-bg text-ivory-text flex flex-col">
      <a
        href="#page-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:start-2 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-medium"
      >
        {t.layoutHebrew.skipToMainContent}
      </a>
      <Topbar />
      <div className="flex flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-hidden">
        <main id="page-main" tabIndex={-1} className="flex-1 min-h-0 min-w-0 px-5 sm:px-6 pt-3 pb-5 overflow-x-hidden overflow-y-auto overscroll-contain bg-ivory-bg text-ivory-text">
          {children}
        </main>
      </div>
    </div>
  );
}

export { SidebarDivider };
