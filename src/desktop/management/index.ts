// Web management console primitives (Phase 6 / B2). Domain-neutral, composed from
// components/ui. Deferred to Phase 7 (no consumer in the read-only scaffold):
// WriteGate (write-affordance gating), DetailDrawer (row-detail drawer),
// ConfigFormScaffold + Pagination (edit/paginate flows).
export { ManagementGuard } from "./ManagementGuard";
export { ManagementAccessDenied } from "./ManagementAccessDenied";
export { ReadOnlyChip } from "./ReadOnlyChip";
export { DataTable, type Column } from "./DataTable";
export { PendingConsolePage } from "./PendingConsolePage";
