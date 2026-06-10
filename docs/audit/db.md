# VetTrack — Database Schema Inventory

All tables prefixed `vt_`. Schema source of truth: `server/schema/` (split into domain files, re-exported from `server/schema/index.ts`, re-exported by `server/db.ts`).

Generated 2026-06-09.

---

## Core (`server/schema/core.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_clinics` | `id`, `timezone` | Multi-tenant clinic config and timezone |
| `vt_users` | `id`, `clinic_id`, `clerk_id` (unique), `role`, `status` | User accounts; role read from DB, not JWT |

---

## Equipment (`server/schema/equipment.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_folders` | `id`, `clinic_id`, `name`, `type` | Equipment folder organization |
| `vt_rooms` | `id`, `clinic_id`, `name`, `master_nfc_tag_id`, `gateway_code` | Physical rooms/locations with NFC + RFID gateway |
| `vt_docks` | `id`, `clinic_id`, `room_id`, `name` | Charging docks within rooms |
| `vt_asset_types` | `id`, `clinic_id`, `name` | Equipment type classification |
| `vt_asset_type_conditions` | `id`, `asset_type_id`, `condition_name`, `stale_after_minutes` | Per-type verification rules |
| `vt_equipment` | `id`, `clinic_id`, `name`, `status`, `nfc_tag_id`, `rfid_tag_epc`, `custody_state`, `readiness_state`, `usage_state` | Core equipment records (multi-state) |
| `vt_equipment_rfid_reads` | `id`, `equipment_id`, `from_room_id`, `to_room_id`, `gateway_code` | RFID location-tracking events |
| `vt_unit_condition_states` | `id`, `equipment_id`, `condition_id`, `verified` | Per-equipment condition checks |
| `vt_equipment_returns` | `id`, `equipment_id`, `returned_by_id`, `is_plugged_in` | Return events + charging status |
| `vt_staging_queue` | `id`, `equipment_id`, `status`, `clinical_priority` | Pre-use staging queue |
| `vt_equipment_waitlist` | `id`, `equipment_id`, `user_id`, `status`, `reservation_expires_at` | Equipment waitlist + reservations |
| `vt_operational_metrics` | `id`, `equipment_id`, `event_type`, `duration_ms` | Equipment performance metrics |
| `vt_scan_logs` | `id`, `equipment_id`, `user_id`, `status` | Scan/verification audit trail |
| `vt_transfer_logs` | `id`, `equipment_id`, `from_folder_id`, `to_folder_id` | Folder-move history |
| `vt_whatsapp_alerts` | `id`, `equipment_id`, `status` | WhatsApp alert delivery |
| `vt_alert_acks` | `id`, `equipment_id`, `alert_type`, `ack_status` | Alert acknowledgment tracking |
| `vt_undo_tokens` | `id`, `equipment_id`, `scan_log_id`, `expires_at` | Undo action tokens |
| `vt_equipment_readiness_config` | `clinic_id` (PK), `key` (PK), `value` | Per-clinic readiness rule config |

---

## ER & Safety (`server/schema/er.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_code_blue_events` | `id`, `clinic_id`, `started_at`, `outcome` | Code Blue event records (legacy; superseded by sessions) |
| `vt_code_blue_sessions` | `id`, `clinic_id`, `status`, `outcome`, `is_reconciled` | Active Code Blue sessions |
| `vt_code_blue_log_entries` | `id`, `session_id`, `category`, `label`, `elapsed_ms` | Equipment/note log during Code Blue |
| `vt_code_blue_presence` | `session_id` (PK), `user_id` (PK) | User presence in Code Blue session |
| `vt_crash_cart_items` | `id`, `clinic_id`, `key`, `required_qty`, `expiry_warn_days` | Crash cart item definitions |
| `vt_crash_cart_checks` | `id`, `clinic_id`, `performed_by_user_id`, `items_checked` (JSONB) | Crash cart check audit |

---

## Inventory (`server/schema/inventory.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_containers` | `id`, `clinic_id`, `name`, `target_quantity`, `current_quantity` | Inventory containers (cabinets) with stock |
| `vt_items` | `id`, `clinic_id`, `code`, `label`, `item_type`, `is_active` | Item catalog (drugs, consumables) |
| `vt_inventory_item_prices` | `id`, `item_id`, `context_type`, `context_id`, `price_cents` | Context-aware pricing |
| `vt_container_items` | `id`, `container_id`, `item_id`, `quantity` | On-hand stock per container |
| `vt_restock_sessions` | `id`, `container_id`, `owned_by_user_id`, `status` | Restock session lifecycle |
| `vt_restock_events` | `id`, `session_id`, `item_id`, `delta`, `observed_quantity` | Per-item scan during restock |
| `vt_inventory_logs` | `id`, `container_id`, `log_type`, `quantity_before`, `quantity_after` | Inventory mutation audit |
| `vt_dispense_events` | `id`, `container_id`, `status`, `inventory_mismatch`, `items` (JSONB) | Dispensing operations |
| `vt_purchase_orders` | `id`, `clinic_id`, `supplier_name`, `status` | PO header |
| `vt_po_lines` | `id`, `purchase_order_id`, `item_id`, `quantity_ordered` | PO line items |

---

## Tasks / Appointments (`server/schema/tasks.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_appointments` | `id`, `clinic_id`, `vet_id`, `status`, `appointment_type`, `container_id` | Unified task model (medication tasks + general tasks) |

---

## Operations (`server/schema/ops.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_shift_sessions` | `id`, `clinic_id`, `started_by_user_id`, `started_at`, `ended_at` | Active shift/session tracking |
| `vt_shifts` | `id`, `clinic_id`, `date`, `employee_name`, `role` | Shift schedule records |
| `vt_shift_imports` | `id`, `clinic_id`, `imported_by`, `filename` | Shift import audit |
| `vt_doctor_shifts` | `id`, `clinic_id`, `user_id`, `date`, `operational_role` | Vet/doctor shift assignments |
| `vt_push_subscriptions` | `id`, `clinic_id`, `user_id`, `endpoint` (unique) | Web push subscriptions |
| `vt_scheduled_notifications` | `id`, `clinic_id`, `type`, `user_id`, `scheduled_at` | Scheduled push notifications |
| `vt_support_tickets` | `id`, `clinic_id`, `user_id`, `severity`, `status` | User support tickets |
| `vt_bulk_audit_log` | `id`, `clinic_id`, `event_type`, `equipment_id` | Bulk-operation audit (equipment state changes) |
| `vt_audit_logs` | `id`, `clinic_id`, `action_type`, `performed_by` | High-level action audit |
| `vt_event_outbox` | `id` (bigserial), `clinic_id`, `type`, `published_at` | Realtime SSE outbox (monotonic cursor) |
| `vt_shift_messages` | `id`, `shift_session_id`, `sender_id`, `body`, `type` | Shift chat messages |
| `vt_shift_message_acks` | `shift_session_id`, `user_id`, `status` (composite PK) | Message read status |
| `vt_shift_message_reactions` | `message_id`, `user_id`, `emoji` (composite PK) | Emoji reactions |
| `vt_tasks` | `id`, `clinic_id`, `type`, `tag`, `title` | Operational platform tasks |
| `vt_idempotency_keys` | `clinic_id` (PK), `key` (PK), `endpoint`, `request_hash` | Request deduplication |
| `vt_clinical_check_ins` | `id`, `clinic_id`, `user_id`, `checked_in_at`, `checked_out_at` | Clinical check-in/out (authority source) |
| `vt_task_ownership_confirm_queue` | `id`, `appointment_id`, `raw_acknowledged_by`, `candidate_user_ids` (JSONB) | Task ownership disambiguation |
| `vt_server_config` | `key` (PK) | Global server config key-value store |

---

## Integrations (`server/schema/integrations.ts`)

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `vt_integration_configs` | `id`, `clinic_id`, `adapter_id`, `enabled` | External integration config |
| `vt_integration_sync_conflicts` | `id`, `clinic_id`, `entity_type`, `status` | Sync conflict queue |
| `vt_integration_sync_log` | `id`, `clinic_id`, `adapter_id`, `sync_type`, `status` | Sync attempt audit |
| `vt_integration_mapping_reviews` | `id`, `clinic_id`, `entity_type`, `review_status` | External→local ID mapping review |
| `vt_integration_webhook_events` | `id`, `clinic_id`, `adapter_id`, `status` | Inbound webhook events |
| `vt_integration_webhook_events_archive` | `id`, `clinic_id`, `adapter_id` | Archived webhook events |
| `vt_integration_sync_log_archive` | `id`, `clinic_id`, `adapter_id` | Archived sync logs |

---

## Summary

| Schema file | Tables |
|-------------|--------|
| `core.ts` | 2 |
| `equipment.ts` | 18 |
| `er.ts` | 6 |
| `inventory.ts` | 10 |
| `tasks.ts` | 1 |
| `ops.ts` | 18 |
| `integrations.ts` | 7 |
| **Total** | **62** |

Tenant-scoped tables either have a direct `clinic_id` column or inherit tenant scope via a foreign key to a clinic-scoped parent (e.g. `vt_code_blue_presence`, `vt_shift_message_acks`, `vt_shift_message_reactions` use composite PKs without a direct `clinic_id`). Global config tables such as `vt_server_config` are exceptions. Every tenant-scoped query must still constrain `clinicId` (directly or via FK join); a read without tenant scope = P0 bug.
