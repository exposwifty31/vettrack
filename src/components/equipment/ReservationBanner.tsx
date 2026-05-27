import { useEffect, useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  formatReservationCountdown,
  reservationMinutesRemaining,
} from "@/lib/equipment-waitlist-ui";

export interface ReservationBannerProps {
  equipmentId: string;
  expiresAt: string;
  onCheckout: () => void | Promise<void>;
  checkoutPending?: boolean;
  /** When true, show "You are next in line" metadata (position 1). */
  showNextInLine?: boolean;
}

export function ReservationBanner({
  equipmentId,
  expiresAt,
  onCheckout,
  checkoutPending = false,
  showNextInLine = false,
}: ReservationBannerProps) {
  const [countdown, setCountdown] = useState(() => formatReservationCountdown(expiresAt));
  const [minutesRemaining, setMinutesRemaining] = useState(() =>
    reservationMinutesRemaining(expiresAt),
  );

  useEffect(() => {
    const tick = () => {
      setCountdown(formatReservationCountdown(expiresAt));
      setMinutesRemaining(reservationMinutesRemaining(expiresAt));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const subtitle = t.equipmentWaitlist.reservedForYou.subtitle.replace(
    "{minutesRemaining}",
    String(minutesRemaining),
  );

  return (
    <div
      className="rounded-xl border border-primary/30 bg-primary/10 p-4 space-y-3"
      data-testid="equipment-reservation-banner"
      data-equipment-id={equipmentId}
    >
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">
          {t.equipmentWaitlist.reservedForYou.title}
        </p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <p className="text-sm font-medium tabular-nums" data-testid="reservation-countdown">
          {t.equipmentWaitlist.reservedForYou.expiresIn} {countdown}
        </p>
        {showNextInLine && (
          <p className="text-xs text-muted-foreground">
            {t.equipmentWaitlist.reservedForYou.nextInLine}
          </p>
        )}
      </div>
      <Button
        className="w-full h-12 gap-2 text-sm font-semibold rounded-2xl"
        onClick={() => void onCheckout()}
        disabled={checkoutPending}
        data-testid="btn-reservation-checkout"
      >
        {checkoutPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <LogIn className="w-4 h-4" />
        )}
        {t.equipmentWaitlist.reservedForYou.checkout}
      </Button>
    </div>
  );
}
