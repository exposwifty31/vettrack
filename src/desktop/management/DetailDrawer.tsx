import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { useDirection } from "@/hooks/useDirection";

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Wide, direction-aware detail drawer for console rows (Phase 6). Anchors to the
 * inline-END edge — right in LTR, left in RTL — so Hebrew (the default locale)
 * opens on the correct side. The default Sheet width (`sm:max-w-sm`) is
 * mobile-narrow, so it's widened for desktop tables/records.
 */
export function DetailDrawer({ open, onOpenChange, title, children, footer }: DetailDrawerProps) {
  const dir = useDirection();
  const side = dir === "rtl" ? "left" : "right"; // inline-end
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className="flex w-full flex-col sm:max-w-xl lg:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-2">{children}</div>
        {footer && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
