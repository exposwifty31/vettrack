/** Subset of admin outbox health used by the DLQ panel (avoids circular imports). */
export type OutboxHealthSnapshot = {
  dead_letter_count: number;
  dlq_permanent_count: number;
};
