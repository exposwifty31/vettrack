import { t } from "@/lib/i18n";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { QRCodeSVG } from "qrcode.react";
import { generateQrUrl } from "@/lib/utils";
import {
  Printer,
  Search,
  CheckSquare,
  Square,
  QrCode,
  Package,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import type { Equipment } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { isPilotMode } from "@/lib/pilot-mode";

export default function QrPrintPage() {
  const { userId } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const printRef = useRef<HTMLDivElement>(null);

  const { data: equipment, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const baseFiltered = equipment?.filter(
    (eq) =>
      !search ||
      eq.name.toLowerCase().includes(search.toLowerCase()) ||
      eq.serialNumber?.toLowerCase().includes(search.toLowerCase())
  );

  const filtered = isPilotMode && baseFiltered
    ? [...baseFiltered].sort((a, b) => {
        const aNever = a.lastSeen == null ? 0 : 1;
        const bNever = b.lastSeen == null ? 0 : 1;
        return aNever - bNever;
      })
    : baseFiltered;

  const selectUnconfirmed = () => {
    const unconfirmed = equipment?.filter((e) => e.lastSeen == null) ?? [];
    setSelected(new Set(unconfirmed.map((e) => e.id)));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!filtered) return;
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((e) => e.id)));
    }
  };

  const selectedEquipment = equipment?.filter((eq) => selected.has(eq.id)) || [];

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const qrItems = selectedEquipment
      .map((eq) => {
        const qrUrl = generateQrUrl(eq.id);
        return `
          <div class="qr-item">
            <div id="qr-${eq.id}"></div>
            <p class="name">${eq.name}</p>
            ${eq.serialNumber ? `<p class="serial">#${eq.serialNumber}</p>` : ""}
            ${eq.location ? `<p class="location">${eq.location}</p>` : ""}
            <p class="url">${qrUrl}</p>
          </div>
        `;
      })
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>VetTrack QR Codes — Print</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; background: white; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 20px; }
            .qr-item { border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; page-break-inside: avoid; }
            .name { font-weight: bold; font-size: 12px; margin-top: 8px; }
            .serial { font-size: 10px; color: #666; margin-top: 2px; }
            .location { font-size: 10px; color: #666; margin-top: 2px; }
            .url { font-size: 8px; color: #aaa; margin-top: 4px; word-break: break-all; }
            @media print { body { -webkit-print-color-adjust: exact; } }
          </style>
          <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
        </head>
        <body>
          <div class="grid">${qrItems}</div>
          <script>
            const items = ${JSON.stringify(selectedEquipment.map((eq) => ({ id: eq.id, url: generateQrUrl(eq.id) })))};
            items.forEach(item => {
              const container = document.getElementById('qr-' + item.id);
              if (container) {
                QRCode.toCanvas(item.url, { width: 120, margin: 1 }, (err, canvas) => {
                  if (!err) container.appendChild(canvas);
                });
              }
            });
            setTimeout(() => {
              try {
                window.print();
              } catch {}
            }, 1000);
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <Layout>
      <Helmet>
        <title>{t.qrPrintPage.titleFull}</title>
        <meta name="description" content="Generate and print QR code labels for veterinary equipment. Select items, preview QR codes, and print sheets for physical labeling." />
        <link rel="canonical" href="https://vettrack.replit.app/print" />
      </Helmet>
      <div className="flex flex-col gap-4 pb-24 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold leading-tight flex items-center gap-2">
            <QrCode className="w-6 h-6 text-primary" />
            {t.qrPrintPage.title}
          </h1>
          {selected.size > 0 && (
            <Button
              onClick={handlePrint}
              data-testid="btn-print"
              className="gap-2"
            >
              <Printer className="w-4 h-4" />
              Print {selected.size}
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {t.qrPrintPage.selectHint}
        </p>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.qrPrintPage.searchPlaceholder}
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Select all / count */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAll}
              className="text-xs gap-1 h-11"
              data-testid="btn-select-all"
            >
              {selected.size === (filtered?.length ?? 0) && filtered?.length! > 0 ? (
                <CheckSquare className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              {selected.size === (filtered?.length ?? 0) && filtered?.length! > 0
                ? t.qrPrintPage.unselectAll
                : t.qrPrintPage.selectAll}
            </Button>
            {isPilotMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={selectUnconfirmed}
                className="text-xs gap-1 h-11 text-red-600 hover:text-red-700 hover:bg-red-50"
                data-testid="btn-select-unconfirmed"
              >
                {t.qrPrintPage.selectUnconfirmed}
              </Button>
            )}
          </div>
          {selected.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {selected.size} selected
            </span>
          )}
        </div>

        {/* Equipment list */}
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-destructive opacity-60" />
            <div>
              <p className="text-sm font-medium text-foreground">טעינת הציוד נכשלה</p>
              <p className="text-xs text-muted-foreground mt-0.5">בדוק את החיבור ונסה שוב</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="gap-1.5 h-11 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
              {isRefetching ? t.qrPrintPage.trying : t.qrPrintPage.retry}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered?.map((eq) => (
              <Card
                key={eq.id}
                className={`cursor-pointer transition-all hover:border-primary/30 ${
                  selected.has(eq.id)
                    ? "border-primary bg-primary/5"
                    : ""
                }`}
                onClick={() => toggleSelect(eq.id)}
                data-testid={`qr-select-${eq.id}`}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      selected.has(eq.id) ? "bg-primary border-primary" : "border-border"
                    }`}
                  >
                    {selected.has(eq.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">{eq.name}</p>
                      {isPilotMode && eq.lastSeen == null && (
                        <Badge variant="issue" className="text-[9px] py-0 px-1.5 h-4 shrink-0">
                          {t.qrPrintPage.pilotNeverBadge}
                        </Badge>
                      )}
                    </div>
                    {eq.serialNumber && (
                      <p className="text-xs text-muted-foreground">#{eq.serialNumber}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <QRCodeSVG
                      value={generateQrUrl(eq.id)}
                      size={40}
                      level="M"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Preview for selected */}
        {selectedEquipment.length > 0 && (
          <div className="mt-2">
            <h2 className="font-semibold text-sm mb-3">Print Preview ({selected.size} items)</h2>
            <div
              ref={printRef}
              className="grid grid-cols-3 gap-3 p-4 bg-white border rounded-xl"
            >
              {selectedEquipment.map((eq) => (
                <div key={eq.id} className="flex flex-col items-center gap-1 p-2 border rounded-lg">
                  <QRCodeSVG
                    value={generateQrUrl(eq.id)}
                    size={72}
                    level="M"
                    includeMargin={false}
                  />
                  <p className="text-xs font-bold text-center leading-tight line-clamp-2">
                    {eq.name}
                  </p>
                  {eq.serialNumber && (
                    <p className="text-xs text-muted-foreground">#{eq.serialNumber}</p>
                  )}
                </div>
              ))}
            </div>

            <Button
              onClick={handlePrint}
              className="w-full mt-3 gap-2"
              data-testid="btn-print-bottom"
            >
              <Printer className="w-4 h-4" />
              Print {selected.size} QR Code{selected.size !== 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
