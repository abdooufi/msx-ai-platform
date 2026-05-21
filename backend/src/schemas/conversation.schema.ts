// Enums only — no Mongoose. All persistence is via PostgreSQL (AppPgService).

export enum MessageRole {
  USER      = 'user',
  ASSISTANT = 'assistant',
  SYSTEM    = 'system',
}

export enum MessageStatus {
  SUCCESS = 'success',
  FAILED  = 'failed',
  PENDING = 'pending',
}
