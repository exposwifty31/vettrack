# VetTrack — Database Schema Inventory

All tables prefixed `vt_`. Schema source of truth: `server/schema/` (re-exported from `server/schema/index.ts` and `server/db.ts`).

Generated 2026-06-16.

---

## Core (`server/schema/core.ts`)

| Table |
|-------|
| `vt_clinics` |
| `vt_users` |

## Equipment (`server/schema/equipment.ts`)

| Table |
|-------|
| `vt_alert_acks` |
| `vt_asset_type_conditions` |
| `vt_asset_types` |
| `vt_docks` |
| `vt_equipment` |
| `vt_equipment_readiness_config` |
| `vt_equipment_returns` |
| `vt_equipment_rfid_reads` |
| `vt_equipment_waitlist` |
| `vt_folders` |
| `vt_operational_metrics` |
| `vt_rooms` |
| `vt_scan_logs` |
| `vt_staging_queue` |
| `vt_transfer_logs` |
| `vt_undo_tokens` |
| `vt_unit_condition_states` |
| `vt_whatsapp_alerts` |

## Emergency & safety (`server/schema/er.ts`)

| Table |
|-------|
| `vt_code_blue_events` |
| `vt_code_blue_log_entries` |
| `vt_code_blue_presence` |
| `vt_code_blue_sessions` |
| `vt_crash_cart_checks` |
| `vt_crash_cart_items` |

## Inventory (`server/schema/inventory.ts`)

| Table |
|-------|
| `vt_container_items` |
| `vt_containers` |
| `vt_dispense_events` |
| `vt_inventory_item_prices` |
| `vt_inventory_logs` |
| `vt_items` |
| `vt_po_lines` |
| `vt_purchase_orders` |
| `vt_restock_events` |
| `vt_restock_sessions` |

## Tasks / appointments (`server/schema/tasks.ts`)

| Table |
|-------|
| `vt_appointments` |

## Operations (`server/schema/ops.ts`)

| Table |
|-------|
| `vt_audit_logs` |
| `vt_bulk_audit_log` |
| `vt_clinical_check_ins` |
| `vt_doctor_shifts` |
| `vt_event_outbox` |
| `vt_idempotency_keys` |
| `vt_push_subscriptions` |
| `vt_scheduled_notifications` |
| `vt_server_config` |
| `vt_shift_imports` |
| `vt_shift_message_acks` |
| `vt_shift_message_reactions` |
| `vt_shift_messages` |
| `vt_shift_sessions` |
| `vt_shifts` |
| `vt_support_tickets` |
| `vt_task_ownership_confirm_queue` |
| `vt_tasks` |

## Integrations (`server/schema/integrations.ts`)

| Table |
|-------|
| `vt_integration_configs` |
| `vt_integration_mapping_reviews` |
| `vt_integration_sync_conflicts` |
| `vt_integration_sync_log` |
| `vt_integration_sync_log_archive` |
| `vt_integration_webhook_events` |
| `vt_integration_webhook_events_archive` |

---

**Total tables:** 62
