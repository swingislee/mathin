export const CHECKPOINT_CHUNK_HARD_BYTES = 192 * 1024;
/** Leaves room for PostgreSQL jsonb::text whitespace before the 192 KiB DB check. */
export const CHECKPOINT_CHUNK_TARGET_BYTES = 160 * 1024;
export const CHECKPOINT_WARNING_BYTES = 768 * 1024;
export const CHECKPOINT_MAX_CHUNKS = 64;
export const CHECKPOINT_MAX_ITEMS = 4000;
