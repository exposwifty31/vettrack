import { cn } from "@/lib/utils";

type VetTrackMarkProps = {
  size?: number;
  className?: string;
};

/**
 * Brand mark aligned with the App Store icon and `public/icons/icon-192.png`
 * (purple VT monogram on navy). Do not use the legacy green QR favicon here.
 */
export function VetTrackMark({ size = 40, className }: VetTrackMarkProps) {
  return (
    <img
      src="/icons/icon-192.png"
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={cn("shrink-0 rounded-[18.2%]", className)}
    />
  );
}
