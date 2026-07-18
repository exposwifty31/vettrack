/**
 * R-SH-F1.5 — `/handoff` surface. Renders the current shift-handover artifact
 * (deltas / open-items / observed-signals / PMS worklist) with a deliberate,
 * reversible acknowledge control. Data + mutations are owned here; the
 * presentational panel is `HandoverArtifactPanel`. Deep-link entry falls back to
 * `/home` when there is no history to return to.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  HandoverArtifactPanel,
  type HandoverPanelState,
} from "@/components/handover-artifact-panel";
import { api } from "@/lib/api";
import type { ShiftHandoverArtifact } from "@/types/shift-handover";

function useHandoverVariant(): "phone" | "tablet" {
  const [variant, setVariant] = useState<"phone" | "tablet">("phone");
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const apply = () => setVariant(mql.matches ? "tablet" : "phone");
    apply();
    mql.addEventListener?.("change", apply);
    return () => mql.removeEventListener?.("change", apply);
  }, []);
  return variant;
}

export default function HandoffPage() {
  const [, navigate] = useLocation();
  const variant = useHandoverVariant();
  const [state, setState] = useState<HandoverPanelState>("loading");
  const [artifact, setArtifact] = useState<ShiftHandoverArtifact | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await api.shiftHandover.current();
      if (res.handover) {
        setArtifact(res.handover);
        setState("ready");
      } else {
        setArtifact(null);
        setState("empty");
      }
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate("/home");
  }, [navigate]);

  const handleAcknowledge = useCallback(async () => {
    if (!artifact) return;
    const { handover } = await api.shiftHandover.acknowledge(artifact.id);
    setArtifact(handover);
  }, [artifact]);

  const handleUnconfirm = useCallback(async () => {
    if (!artifact) return;
    const { handover } = await api.shiftHandover.unconfirm(artifact.id);
    setArtifact(handover);
  }, [artifact]);

  return (
    <HandoverArtifactPanel
      state={state}
      artifact={artifact}
      variant={variant}
      canAcknowledge
      onAcknowledge={handleAcknowledge}
      onUnconfirm={handleUnconfirm}
      onBack={handleBack}
    />
  );
}
