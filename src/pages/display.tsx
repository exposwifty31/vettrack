// src/pages/display.tsx — Equipment Command Center (Ward Display) host wrapper.
// The board UI and the entire Phase-9 realtime data path now live in the
// command-board feature module (src/features/command-board/CommandBoardScreen).
// This wrapper owns ONLY the /equipment/board entry point: the ?kiosk=1 URL
// contract and the host-owned kiosk wake-lock. It deliberately imports none of
// the realtime transport — CommandBoardScreen is its single owner.
import { useKioskWakeLock } from "@/hooks/useKioskWakeLock";
import CommandBoardScreen from "@/features/command-board";
import { useKioskModeFromUrl } from "@/features/command-board/use-kiosk-mode-from-url";

export default function WardDisplayPage() {
  // Phase 9 PR 9.2 — `?kiosk=1` opts this Department Display into TV-grade
  // behavior: screen wake-lock with bounded reacquire discipline. Non-kiosk
  // views of /equipment/board (e.g. an operator's tab) do not request it.
  const kioskMode = useKioskModeFromUrl();

  useKioskWakeLock(kioskMode);

  return <CommandBoardScreen kioskMode={kioskMode} />;
}
