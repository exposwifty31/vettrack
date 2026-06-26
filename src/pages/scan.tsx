import { Redirect } from "wouter";
import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { ScanScreen } from "@/features/scan";

export default function ScanPage() {
  const inMobileShell = useMobileShellContext();
  return inMobileShell ? <ScanScreen /> : <Redirect to="/equipment?scan=1" replace />;
}
