import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { QrScanner } from "@/components/qr-scanner";
import { getCurrentUserId } from "@/lib/auth-store";
import type { Equipment } from "@/types";
import { Search, Scan, MapPin, ChevronRight, CheckCircle2, Loader2 } from "lucide-react";

const STALE_MS = 4 * 60 * 60 * 1000;
const RECENT_KEY = "vt_pilot_recent";
const MAX_RECENT = 5;

interface RecentItem {
  id: string;
  name: string;
  location: string | null;
  accessedAt: number;
}

function getRecent(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function trackRecent(item: RecentItem) {
  const prev = getRecent().filter((r) => r.id !== item.id);
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...prev].slice(0, MAX_RECENT)));
}

function relativeTime(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function lastConfirmedText(lastSeen: string | null | undefined): string {
  if (!lastSeen) return "Never confirmed";
  const hrs = (Date.now() - new Date(lastSeen).getTime()) / 3_600_000;
  const rel =
    hrs < 1
      ? `${Math.round(hrs * 60)}m ago`
      : hrs < 24
        ? `${Math.round(hrs)}h ago`
        : `${Math.floor(hrs / 24)}d ago`;
  return `Last confirmed ${rel}`;
}

function stalenessText(lastSeen: string | null | undefined): string {
  if (!lastSeen) return "Not recently confirmed";
  const hrs = (Date.now() - new Date(lastSeen).getTime()) / 3_600_000;
  const rel =
    hrs < 1
      ? `${Math.round(hrs * 60)}m ago`
      : hrs < 24
        ? `${Math.round(hrs)}h ago`
        : `${Math.floor(hrs / 24)}d ago`;
  return `Not recently confirmed · ${rel}`;
}

function isWorthChecking(e: Equipment): boolean {
  if (!e.lastSeen) return true;
  return Date.now() - new Date(e.lastSeen).getTime() > STALE_MS;
}

export default function PilotHomePage() {
  const userId = getCurrentUserId();
  const queryClient = useQueryClient();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  useEffect(() => {
    setRecent(getRecent());
  }, []);

  const { data: equipment = [] } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return equipment
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.location ?? "").toLowerCase().includes(q) ||
          (e.model ?? "").toLowerCase().includes(q) ||
          (e.usuallyFoundHere ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [query, equipment]);

  const confirmedCount = useMemo(
    () => equipment.filter((e) => !!e.lastSeen).length,
    [equipment],
  );

  const worthChecking = useMemo(
    () =>
      equipment
        .filter(isWorthChecking)
        .sort((a, b) => {
          if (!a.lastSeen && !b.lastSeen) return 0;
          if (!a.lastSeen) return -1;
          if (!b.lastSeen) return 1;
          return new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
        })
        .slice(0, 6),
    [equipment],
  );

  const hasEnoughScanHistory = confirmedCount >= 5;

  const isSearching = query.trim().length > 0;

  const handleSelect = (e: Equipment) => {
    trackRecent({ id: e.id, name: e.name, location: e.location ?? null, accessedAt: Date.now() });
    setRecent(getRecent());
  };

  const confirmMut = useMutation({
    mutationFn: (id: string) => api.equipment.scan(id, { status: "ok" }),
  });

  async function handleConfirmHere(e: Equipment) {
    if (confirmingId) return;
    setConfirmingId(e.id);
    try {
      await confirmMut.mutateAsync(e.id);
      trackRecent({ id: e.id, name: e.name, location: e.location ?? null, accessedAt: Date.now() });
      setRecent(getRecent());
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setConfirmedId(e.id);
      setTimeout(() => setConfirmedId((prev) => (prev === e.id ? null : prev)), 1500);
    } catch {
      toast.error("Couldn't confirm — check connection");
    } finally {
      setConfirmingId(null);
    }
  }

  const content = (
    <>
      <Helmet>
        <title>Equipment — VetTrack</title>
      </Helmet>

      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-3 pb-nav-safe pt-4 sm:px-5">
        {/* Search + Scan */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-text3"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find equipment..."
              aria-label="Find equipment"
              className="h-11 w-full rounded-xl border border-ivory-border bg-ivory-surface ps-9 pe-3 text-sm text-ivory-text placeholder:text-ivory-text3 focus:border-primary/40 focus:outline-none focus:ring-0"
            />
          </div>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan QR code"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1a3d28] text-white transition-opacity active:opacity-80"
          >
            <Scan className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>

        {/* Search results */}
        {isSearching && (
          <section aria-label="Search results">
            {searchResults.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-ivory-border bg-ivory-surface">
                {searchResults.map((e, i) => (
                  <div
                    key={e.id}
                    className={`flex items-center gap-2 transition-colors hover:bg-muted/50 ${
                      i < searchResults.length - 1 ? "border-b border-ivory-border/60" : ""
                    }`}
                  >
                    <Link
                      href={`/equipment/${e.id}`}
                      onClick={() => handleSelect(e)}
                      className="flex min-w-0 flex-1 items-center px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ivory-text">{e.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-ivory-text3">
                          {e.location ? `${e.location} · ` : ""}
                          {lastConfirmedText(e.lastSeen)}
                        </p>
                        {e.usuallyFoundHere && (
                          <p className="mt-0.5 truncate text-[10.5px] text-ivory-text3/70 italic">
                            {e.usuallyFoundHere}
                          </p>
                        )}
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleConfirmHere(e)}
                      disabled={confirmingId !== null}
                      aria-label={`Confirm ${e.name} is here`}
                      className="me-4 flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-ivory-border px-2.5 text-[11px] font-medium text-ivory-text3 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                    >
                      {confirmingId === e.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : confirmedId === e.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      <span>{confirmedId === e.id ? "Done" : "Confirm"}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-ivory-border bg-ivory-surface px-4 py-3 text-sm text-ivory-text3">
                Nothing matching &ldquo;{query}&rdquo; &mdash; try a shorter name, or{" "}
                <Link
                  href="/rooms"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  browse by room
                </Link>
                .
              </p>
            )}
          </section>
        )}

        {/* Recently retrieved */}
        {!isSearching && recent.length > 0 && (
          <section aria-label="Recently retrieved">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ivory-text3">
              Recently retrieved
            </p>
            <div className="overflow-hidden rounded-2xl border border-ivory-border bg-ivory-surface">
              {recent.map((item, i) => (
                <Link
                  key={item.id}
                  href={`/equipment/${item.id}`}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 ${
                    i < recent.length - 1 ? "border-b border-ivory-border/60" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ivory-text">{item.name}</p>
                    {item.location && (
                      <p className="text-[11px] text-ivory-text3">{item.location}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-ivory-text3">
                    {relativeTime(item.accessedAt)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Worth checking */}
        {!isSearching && (
          hasEnoughScanHistory ? (
            worthChecking.length > 0 && (
              <section aria-label="Worth checking">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ivory-text3">
                  Worth checking
                </p>
                <div className="overflow-hidden rounded-2xl border border-ivory-border bg-ivory-surface">
                  {worthChecking.map((e, i) => (
                    <div
                      key={e.id}
                      className={`flex items-center gap-2 transition-colors hover:bg-muted/50 ${
                        i < worthChecking.length - 1 ? "border-b border-ivory-border/60" : ""
                      }`}
                    >
                      <Link
                        href={`/equipment/${e.id}`}
                        onClick={() => handleSelect(e)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ivory-text">{e.name}</p>
                          <p className="mt-0.5 text-[11px] text-ivory-text3">{stalenessText(e.lastSeen)}</p>
                          {e.usuallyFoundHere && (
                            <p className="mt-0.5 truncate text-[10.5px] text-ivory-text3/70 italic">
                              {e.usuallyFoundHere}
                            </p>
                          )}
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleConfirmHere(e)}
                        disabled={confirmingId !== null}
                        aria-label={`Confirm ${e.name} is here`}
                        className="me-4 flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 px-2.5 text-[11px] font-medium text-amber-600 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {confirmingId === e.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : confirmedId === e.id ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>{confirmedId === e.id ? "Done" : "Confirm"}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )
          ) : (
            <section aria-label="Worth checking">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ivory-text3">
                Worth checking
              </p>
              <p className="rounded-2xl border border-ivory-border bg-ivory-surface px-4 py-3 text-sm text-ivory-text3">
                Equipment confirmations will appear here as staff scan items during the pilot.
              </p>
            </section>
          )
        )}

        {/* Browse by room */}
        {!isSearching && (
          <Link
            href="/rooms"
            className="flex items-center justify-between gap-3 rounded-2xl border border-ivory-border bg-ivory-surface px-4 py-3 transition-colors hover:border-primary/30"
          >
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 text-ivory-text3" aria-hidden />
              <span className="text-sm font-semibold text-ivory-text">Browse by room</span>
            </div>
            <ChevronRight className="h-4 w-4 text-ivory-text3" aria-hidden />
          </Link>
        )}
      </div>

      {scannerOpen && <QrScanner onClose={() => setScannerOpen(false)} />}
    </>
  );

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  if (isDesktop) return <PageShell>{content}</PageShell>;
  return (
    <Layout
      onScan={() => setScannerOpen(true)}
      scannerOpen={scannerOpen}
      onCloseScan={() => setScannerOpen(false)}
    >
      {content}
    </Layout>
  );
}
