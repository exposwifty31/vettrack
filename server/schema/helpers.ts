import { pgTable } from "drizzle-orm/pg-core";

// Alias used by all domain schema files. Tables are named "vt_xxx" explicitly
// so drizzle-kit sees identical table names as the original db.ts monolith.
export const vtTable = pgTable;
