// Enums only — no Mongoose. All persistence is via PostgreSQL (AppPgService).

export enum KnowledgeType {
  WEBSITE  = 'website',
  DOCUMENT = 'document',
  DATABASE = 'database',
  MANUAL   = 'manual',
}
