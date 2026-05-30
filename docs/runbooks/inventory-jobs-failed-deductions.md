# Runbook — Failed medication inventory jobs

**Audience:** Clinic admin, pharmacy lead, engineering on-call  
**UI:** `/billing/inventory-jobs` (admin role)  
**Table:** `vt_inventory_jobs`

---

## When to use this runbook

A technician **completed a medication task** but stock was not deducted. Symptoms:

- Billing ledger shows the med charge, but container/on-hand quantity unchanged after ~10 minutes
- Admin **Inventory Jobs** page shows one or more rows with status `failed`
- Server logs contain `[inventory-deduction]` errors for the job id

Brief lag (&lt;10 min) after `completeTask` is **expected** — the worker runs asynchronously.

---

## Operator steps (preferred)

1. Sign in as **admin** for the clinic.
2. Open **Billing → Inventory Jobs** (`/billing/inventory-jobs`).
3. Filter **Failed**.
4. Read the **Failure** column (last error message).
5. If the underlying issue is resolved (container restocked, network restored, Redis healthy), click **Retry** on the row.
6. Wait for status to move `pending` → `processing` → `resolved`. Refresh auto-runs every 30s.

The background recovery scheduler also re-enqueues eligible failed jobs every **10 minutes** (`recoverPendingInventoryJobs` in `server/index.ts`).

---

## Engineering checks

| Check | Command / location |
|-------|-------------------|
| Redis up (production) | `GET /api/health/ready` → `checks.redis: ok` |
| Worker heartbeat | `GET /api/health/ready` → `checks.worker: ok` (job-runtime process) |
| Job row | `SELECT id, clinic_id, status, retries, last_error, created_at FROM vt_inventory_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20;` |
| BullMQ queue | Redis `INVENTORY_DEDUCTION` queue depth (if using separate worker host) |

---

## Manual SQL retry (break-glass)

Use only when the UI is unavailable and clinical/financial impact is reviewed.

```sql
-- Reset a single failed job to pending (clinic-scoped)
UPDATE vt_inventory_jobs
SET status = 'pending',
    retries = 0,
    last_error = NULL,
    updated_at = NOW()
WHERE id = '<job-uuid>'
  AND clinic_id = '<clinic-uuid>'
  AND status = 'failed';
```

The inventory-deduction worker or the 10-minute recovery sweep will pick up `pending` rows.

**Do not** delete failed jobs without documenting the billing task id — billing may already be committed.

---

## Common failure reasons

| Error pattern | Likely cause | Action |
|---------------|--------------|--------|
| Container not found / wrong clinic | Data mismatch or deleted container | Fix container link; retry |
| Insufficient quantity | On-hand below dose | Restock or adjust container; retry |
| Redis / queue disabled | `REDIS_URL` missing in prod | Fix Railway env; redeploy worker |
| Repeated failures after 3 retries | Poison payload | Escalate engineering; inspect `calculation_snapshot` on linked task |

---

## Related docs

- `docs/pilot-operator-checklist.md` — shift monitoring table
- `docs/technical-debt.md` — async billing vs inventory doctrine
- `CLAUDE.md` — medication completion + inventory job flow
