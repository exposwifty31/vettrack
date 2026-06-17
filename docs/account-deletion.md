# In-App Account Deletion (App Store Guideline 5.1.1(v))

VetTrack offers account creation (including Sign in with Apple), so Apple requires
an in-app flow that **deletes** the account and personal data — deactivation is not
sufficient — and, because Sign in with Apple is offered, the app must **revoke** the
user's Apple tokens via Apple's REST API at deletion time.

## User-facing flow

Settings → **Danger zone** → **Delete account** → typed-confirmation dialog
(`DELETE` / `מחק`) → on confirm the client calls `DELETE /api/users/delete-account`,
then signs out and redirects to the signed-out state.

- UI: `src/pages/settings.tsx` (Danger Zone section) + `src/components/delete-account-dialog.tsx`
- API client: `deleteOwnAccount()` in `src/lib/api.ts`

## Server flow

`DELETE /api/users/delete-account` (`server/routes/users.ts`) →
`deleteOwnAccount()` (`server/services/account-deletion.service.ts`):

1. **Revoke Apple token** at `POST https://appleid.apple.com/auth/revoke` if one is
   stored. Non-fatal per Apple TN3194 — a failure is logged and deletion continues.
2. **Erase personal data**: hard-delete the `vt_users` row when foreign keys allow
   (cascades remove the stored Apple token and other `ON DELETE CASCADE` children).
   Many `vt_users` FKs are `ON DELETE RESTRICT`, so when a hard delete is blocked the
   row is **anonymized** (PII stripped) and soft-deleted as a tombstone — the PII is
   gone either way.
3. **Delete the Clerk user** (`clerkClient.users.deleteUser`). Skipped in dev-bypass.
   Non-fatal; the existing `user.deleted` Clerk webhook reconciles the DB.

Audit kinds: `account_self_deleted`, `apple_token_revoked`, `apple_token_revoke_failed`.

## Apple token capture (revocation prerequisite)

Clerk's native id-token flow never yields an Apple refresh token, so the app must
capture the Apple `authorizationCode` at sign-in, exchange it at
`POST https://appleid.apple.com/auth/token`, and store the resulting refresh token.

- `POST /api/users/apple-link` accepts `{ authorizationCode }`, exchanges it, and
  stores the refresh token **AES-256-GCM encrypted** (`config-crypto`) in
  `vt_apple_oauth_tokens` (migration `155`).
- API client: `linkAppleAuthorizationCode(code)` in `src/lib/api.ts`.
- Apple ES256 client-secret signing + exchange/revoke: `server/lib/apple-auth.ts`
  (signed with Node's built-in `crypto`, no extra JWT dependency).

> Capturing the `authorizationCode` requires the native Sign in with Apple credential
> (the Capacitor Apple plugin). The current native flow runs Clerk web OAuth in the
> system browser and does not surface the code. Wire the native plugin's
> `authorizationCode` into `linkAppleAuthorizationCode()` to complete the pipeline.
> Until then, deletion still erases the account and deletes the Clerk user; Apple's
> manual fallback (revoke under iOS Settings → Apple ID, plus the credential-revoked
> notification) satisfies the requirement.

## Configuration (Railway)

Revocation is gated on all four being present (otherwise it cleanly no-ops):

| Variable            | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `APPLE_TEAM_ID`     | JWT `iss` (10-char Team ID / App ID Prefix)              |
| `APPLE_KEY_ID`      | JWT header `kid` (Sign in with Apple key)                |
| `APPLE_CLIENT_ID`   | JWT `sub` + revoke `client_id` (Services ID / bundle ID) |
| `APPLE_PRIVATE_KEY` | `.p8` contents (literal `\n` escapes tolerated)          |

`DB_CONFIG_ENCRYPTION_KEY` should be set so stored refresh tokens are encrypted.

## App Store resubmission checklist

1. Record a single continuous screen recording: sign in → Settings → Danger zone →
   Delete account → typed confirmation → deletion completes → signed-out state.
2. In App Store Connect, reply to App Review with the recording and the exact
   navigation steps; put steps + demo credentials in App Review Notes.
3. Protect the reviewer demo account (provide fresh credentials each submission).
4. Resubmit via Distribution → Update Review.
