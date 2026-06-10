# VetTrack — Environment Setup

---

## Prerequisites

| Tool | Required version | Check |
|------|-----------------|-------|
| Node.js | 20+ (22 recommended) | `node -v` |
| pnpm | 9+ | `pnpm -v` |
| PostgreSQL | 16 | `psql --version` |
| Redis | 7+ (optional in dev) | `redis-cli ping` |
| Xcode | 15+ | macOS only, for iOS builds |
| Android Studio | Hedgehog+ | for Android builds |

---

## Local setup (dev-bypass auth)

1. **Clone and install**
   ```bash
   git clone git@gitlab.com:dboy31561/vettrack.git
   cd vettrack
   pnpm install
   ```

2. **Create `.env`** (minimal — no Clerk keys needed)
   ```
   DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
   SESSION_SECRET=dev-session-secret-for-local-development
   NODE_ENV=development
   ```

3. **Create database**
   ```bash
   createdb vettrack
   createuser vettrack --pwprompt   # password: vettrack
   psql vettrack -c "GRANT ALL ON DATABASE vettrack TO vettrack;"
   ```

4. **Apply migrations**
   ```bash
   pnpm db:migrate
   ```

5. **Start dev servers**
   ```bash
   pnpm dev   # API :3001 + Vite :5000
   ```

6. **Verify**
   - Frontend: http://localhost:5000
   - API health: http://localhost:3001/api/healthz
   - Auth: dev-bypass (admin user auto-created, no login required)

---

## Environment variables

### Required for all environments

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session secret (≥32 chars) |
| `NODE_ENV` | `development` / `test` / `production` |

### Clerk authentication (production)

| Variable | Description |
|----------|-------------|
| `CLERK_SECRET_KEY` | Clerk backend secret (`sk_*`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_*`) |
| `CLERK_WEBHOOK_SECRET` | Webhook signing secret |

Omit both Clerk keys for dev-bypass mode (hardcoded admin user, no SDK required).

### Optional services

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis for BullMQ workers (app runs without; queues log `QUEUE_DISABLED_NO_REDIS`) |
| `ALLOWED_ORIGIN` | CORS allowed origin(s) for production |
| `DB_CONFIG_ENCRYPTION_KEY` | AES-256-GCM key for `vt_server_config` integration credentials |
| `DATA_INTEGRITY_HEALTH_TOKEN` | Bearer token for `/api/admin/data-integrity` endpoint |
| `SENTRY_DSN` | Sentry error tracking |
| `PORT` | API server port (default: 3001) |

### Feature flags

| Variable | Description |
|----------|-------------|
| `VITE_FEATURE_CAMERA` | Enable camera capture UI (`true` / unset) |
| `CAPACITOR_SERVER_URL` | Override WebView URL for live-reload in Capacitor (staging only) |
| `SMART_COP_VALIDATION_FAIL_OPEN` | Clinical invariant evaluator degrades to allow on DB throw |

### Mobile / native

| Variable | Description |
|----------|-------------|
| `APNS_KEY_ID` | APNs p8 key ID (10-char string) |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_P8_KEY` | APNs p8 private key content |
| `FCM_JSON` | FCM service account JSON (stringified) |

---

## CI setup

GitLab CI uses Docker image `node:20-alpine` for most jobs. Required CI/CD variables (set in GitLab → Settings → CI/CD → Variables):

```
DATABASE_URL          postgresql://vettrack:vettrack@postgres:5432/vettrack_test
SESSION_SECRET        <long random string>
CLERK_SECRET_KEY      sk_test_...
VITE_CLERK_PUBLISHABLE_KEY  pk_test_...
ALLOWED_ORIGIN        https://vettrack.uk
DB_CONFIG_ENCRYPTION_KEY    <32-byte hex>
CLERK_WEBHOOK_SECRET  whsec_...
DATA_INTEGRITY_HEALTH_TOKEN  <token>
RAILWAY_TOKEN         (deploy only)
RAILWAY_SERVICE       (deploy only)
```

Pipeline stages: `typecheck → build → test → integration → architecture → deploy → playwright → release-gate`

See [`docs/devops/ci-cd.md`](../devops/ci-cd.md) for full CI architecture.

---

## Mobile setup

### iOS

1. Install Xcode 15+ from the Mac App Store
2. Accept Xcode license: `sudo xcodebuild -license accept`
3. Install CocoaPods: `sudo gem install cocoapods`
4. Install iOS simulator runtimes in Xcode → Platforms
5. Build and sync:
   ```bash
   pnpm cap:sync
   pnpm cap:open:ios
   ```
6. In Xcode: select your team in **Signing & Capabilities**, add **Near Field Communication Tag Reading** capability

### Android

1. Install Android Studio
2. Install Android SDK via SDK Manager: API 24, 33, 36
3. Set `ANDROID_HOME` in your shell profile:
   ```bash
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools
   ```
4. Build and sync:
   ```bash
   pnpm cap:sync
   pnpm cap:open:android
   ```

---

## Env precedence

`.env.local` → `.env` → OS environment

Both `.env.local` and `.env` are loaded by `server/lib/env-bootstrap.ts` at server startup. Never commit either file.

---

## Validation script

```bash
pnpm validate:prod   # checks env vars, DB connectivity, Clerk config
pnpm auth:preflight  # verifies Clerk auth mode
```
