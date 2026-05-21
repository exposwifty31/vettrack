# API client exceptions (CD-03)

> Note: `fetchWithTimeout` (a typed wrapper) is treated as `fetch()` for the purposes of this allowlist. Any caller that bypasses the typed `request()` builder must be documented.

Every raw `fetch()` call in `src/` must appear in this table with a specific justification. New exceptions require maintainer approval in PR review.

## Allowed exceptions

| Location | Reason | Justification |
|----------|--------|---------------|
| `src/lib/auth-fetch.ts` | Auth-aware `fetch` wrapper | Auth-aware fetch wrapper used by `request()` and Clerk-bypass paths. Cannot self-reference `request()` without infinite recursion. |
| `src/hooks/use-auth.tsx` | `authFetchUsersMe` / `authPostUsersSync` | Auth bootstrap predates `request()`'s session context. Using `request()` would cause 401 redirect loops and offline-queue contention before the session exists. |
| `src/lib/sync-engine.ts` `attemptSync` | Replay of queued requests | Replays items already in the offline queue; calling `request()` would re-enqueue and recurse. |
| `src/pages/app-tour.tsx` line 41 | Static MP4 download | Not an `/api/` call. Downloads tour video via `getDownloadSource()` from public asset URL. No auth headers, no JSON parsing. |
| `src/lib/api.ts` `equipment.importCsv` | Multipart FormData via `fetchWithTimeout` | `request()` only supports JSON bodies. |

## Verification

CI must enforce that every raw `fetch()` in `src/` is listed here:

```bash
# Should match exactly the locations above:
grep -rn "fetch(" src/ --include="*.ts" --include="*.tsx" \
| grep -v "refetch\|wakeLock\|notification" \
| grep -v "node_modules"
```

If output contains a location NOT in the table above, EITHER:
- Migrate that call to use `api.*` from `src/lib/api.ts`, OR
- Add it to this doc with maintainer approval.

## History

- PR-25 (CD-03 partial): added `use-auth.tsx`, `sync-engine.ts`, `equipment.importCsv` to allowed list.
- PR #366 follow-up (H5): tightened justifications; migrated `pending.tsx` (Path A); documented `auth-fetch.ts`.
- PR #366 follow-up: clarified `fetchWithTimeout` allowlist scope and `equipment.importCsv` row.
