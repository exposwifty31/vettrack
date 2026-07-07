// Web management console primitives (Phase 6 / B2). Domain-neutral, composed from
// components/ui. ConfigFormScaffold + Pagination are deferred to Phase 7 (the
// interactive edit/paginate flows); the read-only scaffold needs only these.
export { ManagementGuard } from "./ManagementGuard";
export { WriteGate } from "./WriteGate";
export { ReadOnlyChip } from "./ReadOnlyChip";
export { DataTable, type Column } from "./DataTable";
export { DetailDrawer } from "./DetailDrawer";
