// Enums only — no Mongoose. All persistence is via PostgreSQL (AppPgService).

export enum AuditAction {
  // Auth
  LOGIN           = 'login',
  LOGOUT          = 'logout',
  LOGIN_FAILED    = 'login_failed',
  PASSWORD_CHANGE = 'password_change',
  // Users
  USER_CREATE     = 'user_create',
  USER_UPDATE     = 'user_update',
  USER_DELETE     = 'user_delete',
  USER_DEACTIVATE = 'user_deactivate',
  // Knowledge
  KB_CREATE       = 'kb_create',
  KB_UPDATE       = 'kb_update',
  KB_DELETE       = 'kb_delete',
  // FAQs
  FAQ_CREATE      = 'faq_create',
  FAQ_UPDATE      = 'faq_update',
  FAQ_DELETE      = 'faq_delete',
  // Companies
  COMPANY_CREATE  = 'company_create',
  COMPANY_UPDATE  = 'company_update',
  COMPANY_DELETE  = 'company_delete',
  // Documents
  DOC_UPLOAD      = 'doc_upload',
  DOC_DELETE      = 'doc_delete',
  DOC_RETRY       = 'doc_retry',
  // Crawl / Training
  CRAWL_START     = 'crawl_start',
  CRAWL_SCHEDULE  = 'crawl_schedule',
  CRAWL_SCHEDULE_CANCEL = 'crawl_schedule_cancel',
  // Settings
  SETTINGS_UPDATE    = 'settings_update',
  AI_PROVIDER_CHANGE = 'ai_provider_change',
  // API Endpoints
  ENDPOINT_CREATE = 'endpoint_create',
  ENDPOINT_UPDATE = 'endpoint_update',
  ENDPOINT_DELETE = 'endpoint_delete',
  // Cache
  CACHE_CLEAR     = 'cache_clear',
}
