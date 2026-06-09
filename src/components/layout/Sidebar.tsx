// Desktop sidebar: icon rail — always rendered, driven by NAV model.
import { IconSidebar } from "@/components/layout/IconSidebar";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { NAV } from "@/lib/routes/nav-model";

interface SidebarProps {
  /** @deprecated NAV model drives the sidebar; items are ignored. Kept for PageShell compat. */
  sidebarItems?: SidebarItem[];
}

// NAV is the source of truth — imported here so this module participates in the nav model.
void NAV;

export function Sidebar(_props: SidebarProps) {
  return (
    <div className="flex flex-row shrink-0 min-h-0 min-w-0 overflow-x-visible overflow-y-auto max-h-[100dvh]">
      <IconSidebar />
    </div>
  );
}
