import { useEffect, useState } from "react";
import { SyncQueueSheet } from "@/components/sync-queue-sheet";

/**
 * Global mount for the sync-queue viewer (Phase 7 #3). The sync engine's
 * permanent-failure toast and the detail page's "view queue" button dispatch
 * `vettrack:open-sync-queue`, but the only listener lived in the legacy
 * `components/layout.tsx` chrome that no shell mounts anymore — the event
 * fired into the void on every surface. Mounted next to SyncStatusBanner in
 * main.tsx so the sheet opens everywhere.
 */
export function GlobalSyncQueue() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openSyncQueue = () => setOpen(true);
    window.addEventListener("vettrack:open-sync-queue", openSyncQueue);
    return () => window.removeEventListener("vettrack:open-sync-queue", openSyncQueue);
  }, []);

  return <SyncQueueSheet open={open} onClose={() => setOpen(false)} />;
}
