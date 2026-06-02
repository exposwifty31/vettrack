// Desktop sidebar: icon rail for primary navigation.
import { IconSidebar } from "@/components/layout/IconSidebar";
import type { SidebarItem } from "@/components/layout/IconSidebar";

interface SidebarProps {
  sidebarItems?: SidebarItem[];
}

export function Sidebar({ sidebarItems }: SidebarProps) {
  if (!sidebarItems?.length) {
    return null;
  }

  return (
    <div className="flex flex-row shrink-0 min-h-0 min-w-0 overflow-x-visible overflow-y-auto max-h-[100dvh]">
      <IconSidebar items={sidebarItems} />
    </div>
  );
}
