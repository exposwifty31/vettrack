import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import { api, containerDispenseWithResult, type ContainerDispenseSuccessPayload } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Minus,
  Plus,
  ChevronRight,
} from "lucide-react";
import type { InventoryContainerWithItems } from "@/types";

interface DispenseSheetProps {
  containerId: string;
  isOpen: boolean;
  onClose: () => void;
  /** If provided, opens directly in STATE 4 (emergency complete) */
  emergencyEventId?: string;
  /** Pre-select this animal (patient) on the patient step — e.g. ER Command Center quick scan. */
  patientId?: string | null;
  /** True when opened from QR/quick scan — enables auto-focus on the confirm primary action. */
  openedViaScan?: boolean;
}

type SheetState = "items" | "patient" | "confirm" | "success" | "emergency-success" | "emergency-complete";

type BypassReason = "EMERGENCY_CPR" | "PROTOCOL_OVERRIDE" | "TECH_ERROR";

interface ItemSelection {
  itemId: string;
  quantity: number;
}

interface DispenseSuccessData {
  takenBy: { userId: string; displayName: string };
  takenAt: string;
  dispensed?: Array<{ itemId: string; label: string; quantity: number; newStock: number }>;
  emergencyEventId?: string;
  isEmergency: boolean;
}

function formatTimeHHMM(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function isEnglishLabel(label: string | null): boolean {
  if (!label) return false;
  return /^[a-zA-Z0-9\s/\-.]+$/.test(label);
}

export function DispenseSheet({
  containerId,
  isOpen,
  onClose,
  emergencyEventId,
  patientId: patientIdProp,
  openedViaScan = false,
}: DispenseSheetProps) {
  const qc = useQueryClient();

  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const bypassBtnRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const [sheetState, setSheetState] = useState<SheetState>(emergencyEventId ? "emergency-complete" : "items");
  const [selections, setSelections] = useState<Map<string, number>>(new Map());
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null | undefined>(undefined);
  const [successData, setSuccessData] = useState<DispenseSuccessData | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [completedEventId, setCompletedEventId] = useState<string | undefined>(emergencyEventId);
  const [showBypassOptions, setShowBypassOptions] = useState(false);
  const [bypassReason, setBypassReason] = useState<BypassReason | null>(null);
  const [isEmergency, setIsEmergency] = useState(false);
  const [dispenseBusy, setDispenseBusy] = useState(false);

  const fieldProps = useCallback(
    (extra?: { disabled?: boolean } & Record<string, unknown>) => ({
      ...extra,
      disabled: dispenseBusy || Boolean(extra?.disabled),
      ...(dispenseBusy ? { "aria-busy": true as const } : {}),
    }),
    [dispenseBusy],
  );

  // Reset state when sheet opens/closes; fresh idempotency key each open and after close.
  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = crypto.randomUUID();
      if (emergencyEventId) {
        setSheetState("emergency-complete");
        setCompletedEventId(emergencyEventId);
      } else {
        setSheetState("items");
      }
      setSelections(new Map());
      setSelectedAnimalId(patientIdProp !== undefined ? patientIdProp : undefined);
      setSuccessData(null);
      setShowBypassOptions(false);
      setBypassReason(null);
      setIsEmergency(false);
    } else {
      setBypassReason(null);
      setShowBypassOptions(false);
      setIsEmergency(false);
      idempotencyKeyRef.current = crypto.randomUUID();
    }
  }, [isOpen, emergencyEventId, patientIdProp]);

  // Orphan bypass: focus first reason radio when the bypass panel appears (same Sheet step; onOpenAutoFocus does not re-fire).
  useEffect(() => {
    if (!showBypassOptions) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) bypassBtnRef.current?.focus();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [showBypassOptions]);

  // Fetch container with items via restock containerItems (provides live quantities)
  const containerItemsQ = useQuery({
    queryKey: ["/api/containers/detail", containerId],
    queryFn: async (): Promise<InventoryContainerWithItems> => {
      const view = await api.restock.containerItems(containerId);
      const itemsWithIds = view.lines
        .filter((l) => l.itemId && l.itemId.trim().length > 0)
        .map((l) => ({
          id: l.itemId!,
          itemId: l.itemId!,
          quantity: l.actual,
          label: l.label,
          code: l.code,
        }));
      return {
        ...view.container,
        items: itemsWithIds,
      };
    },
    enabled: isOpen,
    staleTime: 30_000,
    retry: false,
  });

  const activePatients: { animalId: string; animalName: string; species?: string }[] = [];

  const applyDispenseSuccess = useCallback(
    (result: ContainerDispenseSuccessPayload) => {
      idempotencyKeyRef.current = crypto.randomUUID();
      qc.invalidateQueries({ queryKey: ["/api/containers/detail", containerId] });
      qc.invalidateQueries({ queryKey: ["/api/shift-handover"] });
      setSuccessData({
        takenBy: result.takenBy,
        takenAt: result.takenAt,
        dispensed: result.dispensed,
        emergencyEventId: result.emergencyEventId,
        isEmergency: Boolean(result.emergencyEventId),
      });
      setSheetState(result.emergencyEventId ? "emergency-success" : "success");
      const autoBilledCents = result.autoBilledCents ?? 0;
      if (autoBilledCents > 0) {
        toast.success(`✓ Dispense recorded — ₪${(autoBilledCents / 100).toFixed(2)} captured`);
      } else {
        toast.success("✓ Dispense recorded");
      }
    },
    [qc, containerId],
  );

  const completeEmergencyMut = useMutation({
    mutationFn: (data: { items: Array<{ itemId: string; quantity: number }>; animalId?: string | null }) =>
      api.containers.completeEmergency(completedEventId!, data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/containers/detail", containerId] });
      qc.invalidateQueries({ queryKey: ["/api/shift-handover"] });
      setSuccessData({
        takenBy: result.takenBy,
        takenAt: result.takenAt,
        dispensed: result.dispensed,
        isEmergency: true,
      });
      setSheetState("success");
    },
    onError: () => {
      toast.error("שגיאה בשרת — נסה שוב");
    },
  });

  // Auto-close normal success after 3 seconds
  useEffect(() => {
    if (sheetState === "success") {
      const timer = setTimeout(() => onClose(), 3000);
      return () => clearTimeout(timer);
    }
  }, [sheetState, onClose]);

  const handleEmergencyTap = useCallback(async () => {
    setEmergencyLoading(true);
    try {
      const res = await containerDispenseWithResult(
        containerId,
        {
          items: [],
          animalId: null,
          isEmergency: true,
          bypassReason: "EMERGENCY_CPR",
        },
        crypto.randomUUID(),
      );
      if (!res.ok) {
        toast.error(t.dispense.errorMessage(res.error));
        return;
      }
      applyDispenseSuccess(res.data);
    } finally {
      setEmergencyLoading(false);
    }
  }, [containerId, applyDispenseSuccess]);

  const updateQuantity = useCallback((itemId: string, delta: number, maxQty: number) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? 0;
      const newVal = Math.max(0, Math.min(maxQty, current + delta));
      if (newVal === 0) {
        next.delete(itemId);
      } else {
        next.set(itemId, newVal);
      }
      return next;
    });
  }, []);

  const totalSelected = [...selections.values()].reduce((sum, q) => sum + q, 0);
  const selectedItems: ItemSelection[] = [...selections.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));

  const handleDispense = useCallback(async () => {
    setDispenseBusy(true);
    try {
      const res = await containerDispenseWithResult(
        containerId,
        {
          items: selectedItems,
          animalId: selectedAnimalId,
          isEmergency,
          bypassReason: bypassReason ?? undefined,
        },
        idempotencyKeyRef.current,
      );
      if (!res.ok) {
        if (res.error === "ORPHAN_DISPENSE_BLOCKED") {
          setShowBypassOptions(true);
          return;
        }
        if (res.error === "INSUFFICIENT_STOCK") {
          setSheetState("items");
          toast.error(t.dispense.errorMessage("INSUFFICIENT_STOCK"));
          return;
        }
        toast.error(t.dispense.errorMessage(res.error));
        return;
      }
      applyDispenseSuccess(res.data);
    } finally {
      setDispenseBusy(false);
    }
  }, [containerId, selectedItems, selectedAnimalId, isEmergency, bypassReason, applyDispenseSuccess]);

  const container = containerItemsQ.data;
  const items = container?.items ?? [];

  const renderDragHandle = () => (
    <div className="flex justify-center pt-3 pb-1">
      <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
    </div>
  );

  // STATE: EMERGENCY COMPLETE (STATE 4)
  if (sheetState === "emergency-complete") {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[90dvh] overflow-y-auto p-0 rounded-t-2xl">
          {renderDragHandle()}
          <div className="px-4 pb-6 space-y-4">
            <SheetHeader>
              <SheetTitle className="text-xl text-right">השלמת חירום</SheetTitle>
              <p className="text-sm text-muted-foreground text-right">פרט את הפריטים שנלקחו בחירום</p>
            </SheetHeader>

            {containerItemsQ.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {items.map((item) => {
                    const qty = selections.get(item.itemId) ?? 0;
                    return (
                      <div key={item.itemId} className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
                        <div className="flex-1 text-right min-w-0">
                          <span className="text-base font-medium break-words leading-snug">{item.label}</span>
                          {isEnglishLabel(item.label) && (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1 align-middle shrink-0"
                              title="שם באנגלית — מומלץ לתרגם"
                            />
                          )}
                          <span className="text-xs text-muted-foreground mr-2">({item.quantity} במלאי)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            {...fieldProps({ disabled: qty === 0 })}
                            onClick={() => updateQuantity(item.itemId, -1, item.quantity)}
                            className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center disabled:opacity-30"
                            aria-label="הפחת"
                          >
                            <Minus className="w-5 h-5" />
                          </button>
                          <span className="w-8 text-center text-lg font-bold tabular-nums">{qty}</span>
                          <button
                            type="button"
                            {...fieldProps({ disabled: qty >= item.quantity })}
                            onClick={() => updateQuantity(item.itemId, 1, item.quantity)}
                            className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30"
                            aria-label="הוסף"
                          >
                            <Plus className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Patient selection for emergency complete */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-right">שייך למטופל (אופציונלי)</p>
                  <div className="grid grid-cols-2 gap-2">
                    {activePatients.map((p) => (
                      <button
                        key={p.animalId}
                        type="button"
                        {...fieldProps()}
                        onClick={() => setSelectedAnimalId(p.animalId)}
                        className={cn(
                          "p-3 rounded-xl border text-right min-h-[80px] transition-colors",
                          selectedAnimalId === p.animalId
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background",
                        )}
                      >
                        <div className="font-semibold text-sm break-words">{p.animalName || "מטופל ללא שם"}</div>
                        {p.species && <div className="text-xs text-muted-foreground">{p.species}</div>}
                        {selectedAnimalId === p.animalId && (
                          <CheckCircle className="w-4 h-4 text-primary mt-1" />
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    {...fieldProps()}
                    onClick={() => setSelectedAnimalId(null)}
                    className={cn(
                      "w-full py-3 px-4 rounded-xl border text-sm text-right transition-colors min-h-[48px]",
                      selectedAnimalId === null ? "border-primary bg-primary/10" : "border-border",
                    )}
                  >
                    ללא שיוך למטופל
                  </button>
                </div>

                <div className="sticky bottom-0 bg-background pt-2 pb-2 space-y-2">
                  <Button
                    className="w-full min-h-[52px] text-lg font-bold rounded-xl"
                    {...fieldProps({
                      disabled:
                        totalSelected === 0 ||
                        selectedAnimalId === undefined ||
                        completeEmergencyMut.isPending,
                    })}
                    onClick={() => completeEmergencyMut.mutate({ items: selectedItems, animalId: selectedAnimalId })}
                  >
                    {completeEmergencyMut.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    ) : null}
                    אשר פירוט חירום
                  </Button>
                  <button
                    type="button"
                    {...fieldProps()}
                    onClick={onClose}
                    className="w-full text-sm text-muted-foreground py-2 min-h-[44px]"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // STATE: SUCCESS
  if (sheetState === "success") {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[90dvh] overflow-y-auto p-0 rounded-t-2xl">
          {renderDragHandle()}
          <div className="px-4 pb-8 flex flex-col items-center text-center space-y-4">
            <CheckCircle className="w-20 h-20 text-green-500 mt-4" />
            <SheetTitle className="text-2xl font-bold">
              {successData?.isEmergency ? "עודכן בהצלחה" : "נלקח בהצלחה"}
            </SheetTitle>
            {successData && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>על ידי: {successData.takenBy.displayName}</p>
                <p>בשעה: {formatTimeHHMM(successData.takenAt)}</p>
                {successData.dispensed && successData.dispensed.length > 0 && (
                  <ul className="mt-2 text-right space-y-1">
                    {successData.dispensed.map((d) => (
                      <li key={d.itemId}>
                        {d.label} × {d.quantity}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">נסגר אוטומטית בעוד שניות...</p>
            <Button
              variant="outline"
              {...fieldProps()}
              onClick={onClose}
              className="min-h-[48px] w-full rounded-xl"
            >
              סגור
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // STATE: EMERGENCY SUCCESS
  if (sheetState === "emergency-success") {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" dir="rtl" className="max-h-[90dvh] overflow-y-auto p-0 rounded-t-2xl">
          {renderDragHandle()}
          <div className="px-4 pb-8 flex flex-col items-center text-center space-y-4">
            <XCircle className="w-20 h-20 text-red-500 mt-4" />
            <SheetTitle className="text-2xl font-bold text-red-700">חירום נרשם</SheetTitle>
            {successData && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium">{successData.takenBy.displayName} — {formatTimeHHMM(successData.takenAt)}</p>
              </div>
            )}
            <Button
              variant="outline"
              {...fieldProps()}
              className="w-full min-h-[52px] rounded-xl border-red-300 text-red-700"
              onClick={() => {
                setCompletedEventId(successData?.emergencyEventId);
                setSheetState("emergency-complete");
              }}
            >
              השלם פירוט אחרי הטיפול
            </Button>
            <p className="text-xs text-muted-foreground px-2">
              תוכל להשלים גם מדף חפיפת משמרת
            </p>
            <button
              type="button"
              {...fieldProps()}
              onClick={onClose}
              className="text-sm text-muted-foreground py-2 min-h-[44px]"
            >
              סגור לעכשיו
            </button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // STATE: CONFIRM (patient selection — STATE 2)
  if (sheetState === "confirm") {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="bottom"
          dir="rtl"
          className="max-h-[90dvh] overflow-y-auto p-0 rounded-t-2xl"
          onOpenAutoFocus={(e) => {
            if (!openedViaScan) return;
            e.preventDefault();
            requestAnimationFrame(() => confirmBtnRef.current?.focus());
          }}
        >
          {renderDragHandle()}
          <div className="px-4 pb-6 space-y-4">
            <SheetHeader>
              <SheetTitle className="text-xl text-right">למי שייך?</SheetTitle>
              <p className="text-sm text-muted-foreground text-right">בחר מטופל או השאר ללא שיוך</p>
            </SheetHeader>

            <>
                <div className="grid grid-cols-2 gap-2">
                  {activePatients.map((p) => (
                    <button
                      key={p.animalId}
                      type="button"
                      {...fieldProps()}
                      onClick={() => setSelectedAnimalId(p.animalId)}
                      className={cn(
                        "p-3 rounded-xl border text-right min-h-[80px] transition-colors",
                        selectedAnimalId === p.animalId
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background",
                      )}
                    >
                      <div className="font-semibold text-sm break-words">{p.animalName || "מטופל ללא שם"}</div>
                      {p.species && <div className="text-xs text-muted-foreground">{p.species}</div>}
                      {selectedAnimalId === p.animalId && (
                        <CheckCircle className="w-4 h-4 text-primary mt-1" />
                      )}
                    </button>
                  ))}
                  {activePatients.length === 0 && (
                    <div className="col-span-2 text-center text-sm text-muted-foreground py-4">
                      אין מטופלים פעילים היום
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  {...fieldProps()}
                  onClick={() => setSelectedAnimalId(null)}
                  className={cn(
                    "w-full py-3 px-4 rounded-xl border text-sm text-right transition-colors min-h-[48px]",
                    selectedAnimalId === null ? "border-primary bg-primary/10 font-medium" : "border-border",
                  )}
                >
                  ללא שיוך למטופל
                </button>

                {showBypassOptions && (
                  <div
                    className="mt-4 rounded-[var(--radius)] border-[1.5px] border-destructive bg-destructive/10 p-4 text-right"
                  >
                    <p className="font-medium text-destructive mb-2">
                      {t.dispense.bypass.sectionTitle}
                    </p>
                    <p className="text-sm text-destructive/95 mb-3">
                      {t.dispense.bypass.auditWarning}
                    </p>
                    <p className="text-sm font-medium text-foreground mb-2">
                      {t.dispense.bypass.reasonPrompt}
                    </p>
                    {(
                      [
                        ["EMERGENCY_CPR", t.dispense.bypass.reasons.EMERGENCY_CPR],
                        ["PROTOCOL_OVERRIDE", t.dispense.bypass.reasons.PROTOCOL_OVERRIDE],
                        ["TECH_ERROR", t.dispense.bypass.reasons.TECH_ERROR],
                      ] as const
                    ).map(([val, label], idx) => (
                      <label
                        key={val}
                        className="flex gap-2 mb-2 cursor-pointer items-start"
                      >
                        <input
                          ref={idx === 0 ? bypassBtnRef : undefined}
                          type="radio"
                          name="bypassReason"
                          value={val}
                          checked={bypassReason === val}
                          onChange={() => {
                            setBypassReason(val);
                            setIsEmergency(true);
                          }}
                          className="mt-1"
                          {...fieldProps()}
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                    <Button
                      type="button"
                      variant="destructive"
                      {...fieldProps({ disabled: !bypassReason })}
                      className="mt-3 w-full min-h-12"
                      onClick={() => void handleDispense()}
                    >
                      {dispenseBusy ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : null}
                      {t.dispense.bypass.confirmButton}
                    </Button>
                  </div>
                )}

                <div className="sticky bottom-0 bg-background pt-2 pb-2 space-y-2">
                  <Button
                    ref={confirmBtnRef}
                    className="w-full min-h-[52px] text-lg font-bold rounded-xl"
                    {...fieldProps({
                      disabled: selectedAnimalId === undefined || showBypassOptions,
                    })}
                    onClick={() => void handleDispense()}
                  >
                    {dispenseBusy ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                    אשר לקיחה
                  </Button>
                  <button
                    type="button"
                    {...fieldProps()}
                    onClick={() => {
                      setSelectedAnimalId(undefined);
                      setShowBypassOptions(false);
                      setBypassReason(null);
                      setIsEmergency(false);
                      setSheetState("items");
                    }}
                    className="w-full text-sm text-muted-foreground py-2 min-h-[44px]"
                  >
                    חזור
                  </button>
                </div>
            </>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // STATE: ITEMS (STATE 0 + STATE 1 — emergency button + item list)
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" dir="rtl" className="max-h-[90dvh] overflow-y-auto p-0 rounded-t-2xl">
        {renderDragHandle()}
        <div className="px-4 pb-6 space-y-4">
          <SheetHeader>
            <SheetTitle className="text-xl text-right">
              {container?.name ?? "טוען..."}
            </SheetTitle>
          </SheetHeader>

          {/* STATE 0: Emergency button — always at top, always visible */}
          <button
            type="button"
            {...fieldProps({ disabled: emergencyLoading })}
            onClick={handleEmergencyTap}
            className="w-full min-h-[64px] rounded-xl bg-red-600 text-white text-xl font-bold flex items-center justify-center gap-3 active:bg-red-700 disabled:opacity-70"
          >
            {emergencyLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <AlertTriangle className="w-6 h-6" />
            )}
            🚨 חירום
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">או בחר פריטים</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* STATE 1: Item list */}
          {containerItemsQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => {
                const qty = selections.get(item.itemId) ?? 0;
                return (
                  <div key={item.itemId} className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
                    <div className="flex-1 text-right min-w-0">
                      <span className="text-base font-medium break-words leading-snug">{item.label}</span>
                      {isEnglishLabel(item.label) && (
                        <span
                          className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1 align-middle shrink-0"
                          title="שם באנגלית — מומלץ לתרגם"
                        />
                      )}
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                        {item.quantity}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        {...fieldProps({ disabled: qty === 0 })}
                        onClick={() => updateQuantity(item.itemId, -1, item.quantity)}
                        className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center disabled:opacity-30"
                        aria-label="הפחת"
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <span className="w-8 text-center text-lg font-bold tabular-nums">{qty}</span>
                      <button
                        type="button"
                        {...fieldProps({ disabled: qty >= item.quantity })}
                        onClick={() => updateQuantity(item.itemId, 1, item.quantity)}
                        className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30"
                        aria-label="הוסף"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && !containerItemsQ.isLoading && (
                <p className="text-center text-sm text-muted-foreground py-4">אין פריטים במכלול זה</p>
              )}
            </div>
          )}

          {/* Sticky bottom bar */}
          <div className="sticky bottom-0 bg-background pt-2 pb-2 space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
              <span>{totalSelected} פריטים נבחרו</span>
              <ChevronRight className="w-4 h-4" />
            </div>
            <Button
              className="w-full min-h-[52px] text-lg font-bold rounded-xl"
              {...fieldProps({ disabled: totalSelected === 0 })}
              onClick={() => {
                setSelectedAnimalId(undefined);
                setShowBypassOptions(false);
                setBypassReason(null);
                setIsEmergency(false);
                setSheetState("confirm");
              }}
            >
              המשך
            </Button>
            <button
              type="button"
              {...fieldProps()}
              onClick={onClose}
              className="w-full text-sm text-muted-foreground py-2 min-h-[44px]"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
