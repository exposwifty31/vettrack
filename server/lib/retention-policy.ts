/**
 * Shared retention window for soft-deleted users and animals before hard purge.
 * Kept in a leaf module so schedulers and services do not circularly import.
 */
export const PURGE_AFTER_DAYS = 90;
