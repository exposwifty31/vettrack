# Local DB workflow

## 1) Start PostgreSQL 16

```bash
sudo pg_ctlcluster 16 main start
```

## 2) Push schema changes

```bash
pnpm db:push
```

`db:push` reads `DATABASE_URL` from `.env.local` first, then `.env`.

## 3) Seed dev data

```bash
pnpm seed:dev
```

## 4) Start the app

```bash
pnpm dev
```

## 5) Test health endpoint

```bash
curl -i http://localhost:3001/api/health
```

Expected when DB is up: HTTP 200 with `"db": { "status": "up" }`.

## 6) Test equipment scan endpoint

```bash
curl -i -X POST http://localhost:3001/api/equipment/scan \
  -H "Content-Type: application/json" \
  -d '{"qrCode":"eq1","status":"ok"}'
```

If seed data is present, `eq1` should resolve through the equipment scan alias and return success.
