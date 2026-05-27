# RFID doorway tracking — local smoke runbook

End-to-end check for advisory RFID ingest (feature flag, HMAC POST, SSE list refresh).

## Prerequisites

- `pnpm dev` stack running (`DATABASE_URL`, API on `:3001`, Vite on `:5000`)
- Migration `138_rfid_doorway.sql` applied (automatic on server boot)

## Steps

1. **Provision webhook secret**

   ```bash
   tsx scripts/rfid/provision-secret.ts dev-clinic-default
   ```

   Copy the printed secret.

2. **Enable ingest for the clinic**

   Insert or update `vt_server_config`:

   - Key: `rfid.ingest_enabled.dev-clinic-default`
   - Value: `true`

3. **Bind hardware identifiers in the UI**

   - Equipment edit: set **RFID tag (EPC)** on one device.
   - Rooms → create room (or PATCH via API): set **Doorway gateway code**.
   - For the attention-badge path, ensure the RFID room has a `vt_docks` row (equipment storage).

4. **Sign and POST a sample batch**

   Save `batch.json`:

   ```json
   {
     "batchId": "smoke-1",
     "events": [
       {
         "tagEpc": "<your-epc>",
         "gatewayCode": "<your-gateway>",
         "readAt": "2026-05-27T12:00:00.000Z"
       }
     ]
   }
   ```

   ```bash
   tsx scripts/rfid/sign-batch.ts dev-clinic-default <secret> batch.json
   ```

   Run the printed `curl` against `http://localhost:3001/api/rfid/events`.

5. **Verify in an open equipment list tab (no manual refresh)**

   - Subtitle: “Last seen via RFID near …”
   - If device is checked out and RFID room is a dock room: attention badge appears.
   - Authoritative **room** on the row does **not** change.

6. **Flag off**

   Set `rfid.ingest_enabled.dev-clinic-default` to `false`. Within ~10s, POSTs return **403** `RFID_INGEST_DISABLED`.

## Middleware order (authoritative)

See `server/index.ts`: `/api/rfid` uses `express.raw` **before** global `express.json()`, same pattern as integration webhooks.
