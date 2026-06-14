import { t } from "@/lib/i18n";
import { useRef, useMemo, useEffect } from "react";
import { useLocation, useSearch, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { haptics } from "@/lib/haptics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const SUBMIT_TIMEOUT_MS = 30_000;

const schema = z.object({
  name: z.string().trim().min(1, t.newEquipment.fields.name.error),
  serialNumber: z.string().optional(),
  model: z.string().optional(),
  manufacturer: z.string().optional(),
  purchaseDate: z.string().optional(),
  expiryDate: z.string().optional().nullable(),
  location: z.string().optional(),
  folderId: z.string().optional(),
  maintenanceIntervalDays: z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined) return undefined;
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
      }
      return value;
    },
    z.number().int().positive().optional()
  ),
  expectedReturnMinutes: z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined) return undefined;
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
      }
      return value;
    },
    z.number().int().positive().optional()
  ),
  imageUrl: z.string().optional(),
  usuallyFoundHere: z.string().max(200).optional().nullable(),
  searchAlias: z.string().max(200).optional().nullable(),
  staffNote: z.string().max(500).optional().nullable(),
  rfidTagEpc: z.string().max(128).optional().nullable(),
});

type FormValues = z.infer<typeof schema>;
type CreateEquipmentPayload = Parameters<(typeof api.equipment)["create"]>[0];
type UpdateEquipmentPayload = Parameters<(typeof api.equipment)["update"]>[1];

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export default function NewEquipmentPage() {
  const { isAdmin, userId } = useAuth();
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const { id: editId } = useParams<{ id?: string }>();
  const isEditing = !!editId;
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefill = useMemo(() => {
    const p = new URLSearchParams(searchStr);
    return {
      name: p.get("copyName") ?? "",
      model: p.get("copyModel") ?? "",
      manufacturer: p.get("copyManuf") ?? "",
      purchaseDate: p.get("copyPurchaseDate") ?? "",
      expiryDate: p.get("copyExpiryDate") ?? "",
      location: p.get("copyLocation") ?? "",
      folderId: p.get("copyFolder") ?? "",
      maintenanceIntervalDays: p.get("copyMaint") ?? "",
      copiedFrom: p.get("copiedFrom") ?? "",
    };
  }, [searchStr]);

  const isCopy = !isEditing && !!prefill.copiedFrom;
  const showExpectedReturnField = isAdmin;

  const { data: folders } = useQuery({
    queryKey: ["/api/folders"],
    queryFn: api.folders.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: existingEquipment, isLoading: editLoading } = useQuery({
    queryKey: [`/api/equipment/${editId}`],
    queryFn: () => api.equipment.get(editId!),
    enabled: isEditing && !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      name: prefill.name,
      model: prefill.model || undefined,
      manufacturer: prefill.manufacturer || undefined,
      purchaseDate: prefill.purchaseDate || undefined,
      expiryDate: prefill.expiryDate || undefined,
      location: prefill.location || undefined,
      folderId: prefill.folderId || undefined,
      maintenanceIntervalDays: prefill.maintenanceIntervalDays
        ? parseInt(prefill.maintenanceIntervalDays, 10)
        : undefined,
      expectedReturnMinutes: undefined,
    },
  });

  useEffect(() => {
    if (isEditing && existingEquipment) {
      reset({
        name: existingEquipment.name,
        serialNumber: existingEquipment.serialNumber ?? undefined,
        model: existingEquipment.model ?? undefined,
        manufacturer: existingEquipment.manufacturer ?? undefined,
        purchaseDate: existingEquipment.purchaseDate ?? undefined,
        expiryDate: existingEquipment.expiryDate ?? undefined,
        location: existingEquipment.location ?? undefined,
        folderId: existingEquipment.folderId ?? undefined,
        maintenanceIntervalDays: existingEquipment.maintenanceIntervalDays ?? undefined,
        expectedReturnMinutes: existingEquipment.expectedReturnMinutes ?? undefined,
        imageUrl: existingEquipment.imageUrl ?? undefined,
        usuallyFoundHere: existingEquipment.usuallyFoundHere ?? undefined,
        searchAlias: existingEquipment.searchAlias ?? undefined,
        staffNote: existingEquipment.staffNote ?? undefined,
        rfidTagEpc: existingEquipment.rfidTagEpc ?? undefined,
      });
    }
  }, [isEditing, existingEquipment, reset]);

  const createMut = useMutation({
    mutationFn: ({ data, signal }: { data: Parameters<(typeof api.equipment)["create"]>[0]; signal: AbortSignal }) =>
      api.equipment.create(data, signal),
    onSuccess: (data) => {
      haptics.tap();
      clearSubmitTimeout();
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.newEquipment.toast.addSuccess);
      navigate(`/equipment/${data.id}`);
    },
    onError: (err: Error) => {
      clearSubmitTimeout();
      toast.error(t.newEquipment.toast.addError(err.message));
    },
    onSettled: () => {
      clearSubmitTimeout();
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: FormValues) =>
      api.equipment.update(editId!, buildUpdatePayload(data)),
    onSuccess: () => {
      haptics.tap();
      clearSubmitTimeout();
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${editId}`] });
      toast.success(t.newEquipment.toast.updateSuccess);
      navigate(`/equipment/${editId}`);
    },
    onError: (err: Error) => {
      clearSubmitTimeout();
      toast.error(t.newEquipment.toast.updateError(err.message));
    },
    onSettled: () => {
      clearSubmitTimeout();
    },
  });

  function buildCreatePayload(data: FormValues): CreateEquipmentPayload {
    return {
      name: data.name,
      serialNumber: normalizeOptionalString(data.serialNumber),
      model: normalizeOptionalString(data.model),
      manufacturer: normalizeOptionalString(data.manufacturer),
      purchaseDate: normalizeOptionalString(data.purchaseDate) ?? null,
      expiryDate: data.expiryDate ? normalizeOptionalString(data.expiryDate) ?? null : null,
      location: normalizeOptionalString(data.location),
      folderId: data.folderId === "none" ? undefined : data.folderId,
      maintenanceIntervalDays: data.maintenanceIntervalDays,
      ...(showExpectedReturnField && { expectedReturnMinutes: data.expectedReturnMinutes }),
      imageUrl: normalizeOptionalString(data.imageUrl),
      usuallyFoundHere: normalizeOptionalString(data.usuallyFoundHere ?? undefined) ?? null,
      searchAlias: normalizeOptionalString(data.searchAlias ?? undefined) ?? null,
      staffNote: normalizeOptionalString(data.staffNote ?? undefined) ?? null,
      rfidTagEpc: normalizeOptionalString(data.rfidTagEpc ?? undefined),
    };
  }

  function buildUpdatePayload(data: FormValues): UpdateEquipmentPayload {
    return {
      name: data.name,
      serialNumber: normalizeOptionalString(data.serialNumber) ?? null,
      model: normalizeOptionalString(data.model) ?? null,
      manufacturer: normalizeOptionalString(data.manufacturer) ?? null,
      purchaseDate: normalizeOptionalString(data.purchaseDate) ?? null,
      expiryDate: data.expiryDate ? normalizeOptionalString(data.expiryDate) ?? null : null,
      location: normalizeOptionalString(data.location) ?? null,
      folderId: data.folderId === "none" ? null : data.folderId,
      maintenanceIntervalDays: data.maintenanceIntervalDays ?? null,
      ...(showExpectedReturnField && { expectedReturnMinutes: data.expectedReturnMinutes ?? null }),
      imageUrl: normalizeOptionalString(data.imageUrl) ?? null,
      usuallyFoundHere: normalizeOptionalString(data.usuallyFoundHere ?? undefined) ?? null,
      searchAlias: normalizeOptionalString(data.searchAlias ?? undefined) ?? null,
      staffNote: normalizeOptionalString(data.staffNote ?? undefined) ?? null,
      rfidTagEpc: normalizeOptionalString(data.rfidTagEpc ?? undefined) ?? null,
      // Optimistic concurrency: echo back the version we loaded so the
      // server can 409 if someone else edited the row meanwhile.
      ...(existingEquipment?.version !== undefined && { version: existingEquipment.version }),
    };
  }

  function clearSubmitTimeout() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current = null;
    }
  }

  const onSubmit = (data: FormValues) => {
    if (isEditing) {
      updateMut.mutate(data);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    timeoutRef.current = setTimeout(() => {
      controller.abort();
      createMut.reset();
      toast.error(t.newEquipment.toast.timeout);
      abortRef.current = null;
      timeoutRef.current = null;
    }, SUBMIT_TIMEOUT_MS);

    createMut.mutate({
      data: buildCreatePayload(data),
      signal: controller.signal,
    });
  };

  const manualFolders = folders?.filter((f) => f.type !== "smart") || [];
  const isPending = createMut.isPending || updateMut.isPending;

  if (isEditing && editLoading) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 pb-24">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Helmet>
        <title>
          {isEditing
            ? `עריכת ${existingEquipment?.name ?? "ציוד"} — VetTrack`
            : isCopy
            ? `ציוד חדש (העתק מ-${prefill.copiedFrom}) — VetTrack`
            : "הוספת ציוד — VetTrack"}
        </title>
        <meta name="description" content="Register a new piece of veterinary equipment. Assign a name, serial number, location, folder, and maintenance schedule to begin QR tracking." />
        <link rel="canonical" href="https://vettrack.replit.app/equipment/new" />
      </Helmet>
      <div className="flex flex-col gap-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => isEditing ? navigate(`/equipment/${editId}`) : navigate("/equipment")}
            data-testid="btn-back"
            className="text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold">
              {isEditing ? t.newEquipment.heading.edit : isCopy ? t.newEquipment.heading.duplicate : t.newEquipment.heading.add}
            </h1>
            {isCopy && (
              <p className="text-xs text-muted-foreground mt-0.5">Copied from {prefill.copiedFrom}</p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Card className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-5 flex flex-col gap-5">
              <h2 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                Basic Info
              </h2>

              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Name <span className="text-destructive" aria-hidden>*</span>
                </Label>
                <Input
                  id="name"
                  placeholder={t.newEquipment.fields.name.placeholder}
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  required
                  aria-required="true"
                  {...register("name")}
                  data-testid="input-name"
                />
                {errors.name && (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="serialNumber" className="text-sm font-medium">Serial Number</Label>
                <Input
                  id="serialNumber"
                  placeholder={t.newEquipment.fields.serialNumber.placeholder}
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  {...register("serialNumber")}
                  data-testid="input-serial"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rfidTagEpc" className="text-sm font-medium">
                  {t.equipment.rfidTagEpc.label}
                </Label>
                <Input
                  id="rfidTagEpc"
                  placeholder={t.equipment.rfidTagEpc.placeholder}
                  className="h-12 rounded-xl border-border/60 bg-background text-base font-mono"
                  {...register("rfidTagEpc")}
                  data-testid="input-rfid-tag-epc"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="model" className="text-sm font-medium">Model</Label>
                  <Input
                    id="model"
                    placeholder={t.newEquipment.fields.model.placeholder}
                    className="h-12 rounded-xl border-border/60 bg-background text-base"
                    {...register("model")}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="manufacturer" className="text-sm font-medium">Manufacturer</Label>
                  <Input
                    id="manufacturer"
                    placeholder={t.newEquipment.fields.manufacturer.placeholder}
                    className="h-12 rounded-xl border-border/60 bg-background text-base"
                    {...register("manufacturer")}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-5 flex flex-col gap-5">
              <h2 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                Organization
              </h2>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Folder / Category</Label>
                <Select
                  defaultValue={prefill.folderId || "none"}
                  key={isEditing ? (existingEquipment?.folderId ?? "none") : undefined}
                  onValueChange={(v) => setValue("folderId", v)}
                >
                  <SelectTrigger className="h-12 rounded-xl border-border/60 bg-background text-base" data-testid="select-folder">
                    <SelectValue placeholder={t.newEquipment.fields.folder.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.newEquipment.fields.folder.none}</SelectItem>
                    {manualFolders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="location" className="text-sm font-medium">Location</Label>
                <Input
                  id="location"
                  placeholder={t.newEquipment.fields.location.placeholder}
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  {...register("location")}
                  data-testid="input-location"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="usuallyFoundHere" className="text-sm font-medium">Floor note</Label>
                <Textarea
                  id="usuallyFoundHere"
                  placeholder="e.g. Usually near ICU prep alcove beside oxygen tanks"
                  className="min-h-[72px] rounded-xl border-border/60 bg-background text-base resize-none"
                  maxLength={200}
                  {...register("usuallyFoundHere")}
                />
                <p className="text-xs text-muted-foreground">
                  Where staff actually find this. Shown during equipment lookup.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="searchAlias" className="text-sm font-medium">Also known as</Label>
                <Input
                  id="searchAlias"
                  placeholder="e.g. good FAST, parvo pump, doppler probe"
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  maxLength={200}
                  {...register("searchAlias")}
                />
                <p className="text-xs text-muted-foreground">
                  Alternate names staff use when searching. Not displayed — only affects search results.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="staffNote" className="text-sm font-medium">Staff note</Label>
                <Textarea
                  id="staffNote"
                  placeholder="e.g. Probe loses contact on right side"
                  className="min-h-[72px] rounded-xl border-border/60 bg-background text-base resize-none"
                  maxLength={500}
                  {...register("staffNote")}
                />
                <p className="text-xs text-muted-foreground">
                  Floor memory — shown faintly during search. Anonymous, no names.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="purchaseDate" className="text-sm font-medium">Purchase Date</Label>
                <Input
                  id="purchaseDate"
                  type="date"
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  {...register("purchaseDate")}
                  data-testid="input-purchase-date"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="expiryDate" className="text-sm font-medium">תאריך תפוגה</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  {...register("expiryDate")}
                  data-testid="input-expiry-date"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/60 shadow-sm">
            <CardContent className="p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                Maintenance
              </h2>

              <div className="flex flex-col gap-2">
                <Label htmlFor="maintenanceIntervalDays" className="text-sm font-medium">
                  Maintenance Interval (days)
                </Label>
                <Input
                  id="maintenanceIntervalDays"
                  type="number"
                  placeholder="e.g. 30"
                  min={1}
                  className="h-12 rounded-xl border-border/60 bg-background text-base"
                  {...register("maintenanceIntervalDays")}
                  data-testid="input-maintenance-interval"
                />
                <p className="text-xs text-muted-foreground">
                  Set to auto-alert when maintenance is overdue.
                </p>
              </div>

              {showExpectedReturnField && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="expectedReturnMinutes" className="text-sm font-medium">
                    {t.newEquipment.fields.expectedReturnMinutes.label}
                  </Label>
                  <Input
                    id="expectedReturnMinutes"
                    type="number"
                    placeholder={t.newEquipment.fields.expectedReturnMinutes.placeholder}
                    min={1}
                    className="h-12 rounded-xl border-border/60 bg-background text-base"
                    {...register("expectedReturnMinutes")}
                    data-testid="input-expected-return-minutes"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t.newEquipment.fields.expectedReturnMinutes.description}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="h-14 rounded-2xl text-base font-semibold shadow-sm"
            data-testid="btn-save"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" aria-hidden />
            ) : (
              <Save className="w-4 h-4 me-2" aria-hidden />
            )}
            {isPending
              ? isEditing ? "Saving changes…" : "Saving equipment…"
              : isEditing ? t.newEquipment.saveChanges : t.newEquipment.saveEquipment}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
