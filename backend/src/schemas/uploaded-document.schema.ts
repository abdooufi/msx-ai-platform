// Enums only — no Mongoose. All persistence is via PostgreSQL (AppPgService).

export enum DocStatus {
  PENDING    = 'pending',
  PROCESSING = 'processing',
  INDEXED    = 'indexed',
  FAILED     = 'failed',
}
