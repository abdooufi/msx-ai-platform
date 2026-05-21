// Enums only — no Mongoose. All persistence is via PostgreSQL (AppPgService).

export enum EventType {
  MESSAGE_SENT        = 'message_sent',
  MESSAGE_FAILED      = 'message_failed',
  SESSION_START       = 'session_start',
  SESSION_END         = 'session_end',
  FEEDBACK_GIVEN      = 'feedback_given',
  HANDOFF             = 'handoff',
  DOCUMENT_UPLOADED   = 'document_uploaded',
  TRAINING_STARTED    = 'training_started',
  TRAINING_COMPLETED  = 'training_completed',
}
