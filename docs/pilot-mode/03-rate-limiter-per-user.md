# 03 — Rate limiters per-user + high ceilings (P2.2 / F2)

## Context

**F2:** `scanLimiter`, `checkoutLimiter`, and `writeLimiter` keyed on `req.ip`, so technicians behind one clinic NAT shared one bucket (10 scans/min). Morning rounds with 3+ users hit 429s during normal scanning.

## Change

| File | Summary |
|------|---------|
| `server/middleware/rate-limiters.ts` | `rateLimitUserKey()` — `req.authUser.id` when present, else IP. Applied to scan/checkout/write. Ceilings: 600/min each. `globalApiLimiter` stays IP-scoped at 6000/min. |
| `tests/rate-limiters-f2.test.ts` | F2 key separation + ceiling contract. |

## Why this approach

- Mirrors existing `rfidEventLimiter` clinic+IP pattern intent, but uses user id for equipment hot paths.  
- **Rejected:** Removing limiters — breaks 429 safety tests and removes DoS protection.  
- **Rejected:** Per-clinic only — still shares quota across users on same NAT.

## Verification

```bash
npx tsc --noEmit
pnpm test -- rate-limiters-f2
pnpm test
```

Manual (post-deploy): two sessions, same network, 35 scans each → no 429.

## Rollback

`git revert` — restores per-IP keys and 10/20/30 ceilings.

## Refs

- Plan: P2.2 (F2)  
- PR: (after merge)  
- Deployed SHA: (after merge)
