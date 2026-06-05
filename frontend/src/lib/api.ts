import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('msx_token')
    : null
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Response interceptor: auth redirect + human-readable error messages ──
api.interceptors.response.use(
  r => r,
  err => {
    const status  = err.response?.status
    const isAdmin = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')

    if (status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('msx_token')
      window.location.href = '/admin/login'
      return Promise.reject(err)
    }

    // Attach a human-readable message so UI components can show it
    if (!err.friendlyMessage) {
      if (status === 400)      err.friendlyMessage = err.response?.data?.message || 'Invalid request. Please check your input.'
      else if (status === 403) err.friendlyMessage = 'You don\'t have permission to do that.'
      else if (status === 404) err.friendlyMessage = 'Resource not found.'
      else if (status === 409) err.friendlyMessage = 'This record already exists.'
      else if (status === 413) err.friendlyMessage = 'File is too large.'
      else if (status === 422) err.friendlyMessage = 'Validation failed. Please check your input.'
      else if (status === 429) err.friendlyMessage = 'Too many requests — please wait a moment and try again.'
      else if (status >= 500)  err.friendlyMessage = isAdmin
        ? `Server error (${status}). Check the backend logs.`
        : 'Something went wrong on our end. Please try again later.'
      else if (!status)        err.friendlyMessage = 'Network error — check your connection.'
    }

    return Promise.reject(err)
  },
)

export default api

// ─── Auth ─────────────────────────────────────────────────────────
export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password })

// ─── Chat ─────────────────────────────────────────────────────────
export const getSuggestions = (lang = 'en') =>
  api.get(`/chat/suggestions?lang=${lang}`)

/** Public — no auth needed. Returns [{symbol, nameEn, nameAr}] */
export const searchCompanySymbols = (q?: string) =>
  api.get<{ symbol: string; nameEn: string; nameAr: string }[]>(
    `/chat/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  )

export const submitFeedback = (
  sessionId: string, messageId: string,
  feedback: 'positive' | 'negative', note?: string,
) => api.post('/chat/feedback', { sessionId, messageId, feedback, note })

// Streaming chat via fetch (not axios) to handle SSE
export async function* streamChat(
  message: string,
  sessionId: string | null,
  history: Array<{ role: string; content: string }>,
  channel = 'web',
) {
  const token = localStorage.getItem('msx_token')
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, sessionId, history, channel }),
  })

  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  // Buffer incomplete lines across TCP chunks — critical for large chart payloads
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Split on newlines but keep any trailing incomplete line in the buffer
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''   // last element may be incomplete — save for next read

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        yield JSON.parse(payload)
      } catch { /* malformed line — skip */ }
    }
  }

  // Flush any remaining data in the buffer
  if (buffer.startsWith('data: ')) {
    try { yield JSON.parse(buffer.slice(6).trim()) } catch {}
  }
}

// ─── Admin ────────────────────────────────────────────────────────
export const getStats    = ()            => api.get('/admin/stats')
export const getConvs    = (p = 1, lang?: string) =>
  api.get(`/admin/conversations?page=${p}${lang ? `&lang=${lang}` : ''}`)
export const getConvDetail = (id: string) => api.get(`/admin/pg/conversations/${id}`)
export const getFailed   = (p = 1)      => api.get(`/admin/failed?page=${p}`)
export const getAnalytics = (days = 7)  => api.get(`/analytics?days=${days}`)

// ─── Documents ────────────────────────────────────────────────────
export const uploadDocument = (form: FormData) =>
  api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
export const listDocuments = (page = 1) => api.get(`/upload?page=${page}`)
export const deleteDocument = (id: string) => api.delete(`/upload/${id}`)

// URL ingestion
export const uploadFromUrl = (url: string, companySymbol?: string) =>
  api.post('/upload/from-url', { url, companySymbol })

// URL watch schedules
export const listUrlSchedules    = ()                                              => api.get('/upload/url-schedules')
export const addUrlSchedule      = (url: string, cron: string, companySymbol?: string) => api.post('/upload/url-schedule', { url, cron, companySymbol })
export const deleteUrlSchedule   = (id: string)                                    => api.delete(`/upload/url-schedule/${id}`)

// ─── Training ─────────────────────────────────────────────────────
export const startCrawl        = (url?: string) => api.post('/train/website', { url })
export const crawlPage         = (url: string)  => api.post('/train/website/page', { url })
export const getCrawlStatus    = ()             => api.get('/train/website/status')
export const startSitemapCrawl = ()             => api.post('/train/website/sitemap')
export const startCompanyCrawl = ()             => api.post('/train/website/companies')
export const startAllCrawl     = (url?: string) => api.post('/train/website/all', { url })
// Schedule management
export const getCrawlSchedule    = ()             => api.get('/train/website/schedule')
export const setCrawlSchedule    = (cron: string) => api.post('/train/website/schedule', { cron })
export const cancelCrawlSchedule = ()             => api.delete('/train/website/schedule')
// Document retry
export const retryDocument = (id: string) => api.post(`/upload/${id}/retry`)

// ─── Settings ─────────────────────────────────────────────────────
export const getSettings    = ()              => api.get('/admin/settings')
export const updateSettings = (body: object)  => api.patch('/admin/settings', body)

// ─── AI Provider ──────────────────────────────────────────────────
export const getAiProvider        = ()                 => api.get('/admin/ai-provider')
export const getAiProviderBalance = ()                 => api.get('/admin/ai-provider/balance')
export const setAiProvider        = (provider: string) => api.post('/admin/ai-provider', { provider })

// ─── PG Summary ───────────────────────────────────────────────────
export const getPgSummary   = ()                   => api.get('/admin/pg/summary')

// ─── PG Knowledge Base ────────────────────────────────────────────
export const getPgKnowledge = (page = 1, limit = 20, category?: string, search?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (category) params.set('category', category)
  if (search)   params.set('search', search)
  return api.get(`/admin/pg/knowledge-base?${params}`)
}
export const getPgKnowledgeEntry = (id: string)     => api.get(`/admin/pg/knowledge-base/${id}`)
export const upsertPgKnowledge   = (body: object)   => api.post('/admin/pg/knowledge-base', body)
export const deletePgKnowledge   = (id: string)     => api.delete(`/admin/pg/knowledge-base/${id}`)

// ─── PG FAQs ──────────────────────────────────────────────────────
export const getPgFaqs   = (page = 1, limit = 20, category?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (category) params.set('category', category)
  return api.get(`/admin/pg/faqs?${params}`)
}
export const upsertPgFaq = (body: object) => api.post('/admin/pg/faqs', body)
export const deletePgFaq = (id: string)   => api.delete(`/admin/pg/faqs/${id}`)

// ─── PG API Endpoints ─────────────────────────────────────────────
export const getPgApiEndpoints   = (page = 1, limit = 20) =>
  api.get(`/admin/pg/api-endpoints?page=${page}&limit=${limit}`)
export const upsertPgApiEndpoint = (body: object) => api.post('/admin/pg/api-endpoints', body)
export const deletePgApiEndpoint = (id: string)   => api.delete(`/admin/pg/api-endpoints/${id}`)
export const testPgApiEndpoint   = (id: string, symbol = 'OQEP') =>
  api.post(`/admin/pg/api-endpoints/${id}/test?symbol=${symbol}`)
export const seedPgApiEndpoints  = ()             => api.post('/admin/pg/api-endpoints/seed')
export const clearApiCache       = (symbol?: string) =>
  symbol ? api.delete(`/admin/admin/cache/${symbol}`) : api.delete('/admin/admin/cache')

// ─── PG Companies ─────────────────────────────────────────────────
export const getPgCompanies   = (page = 1, limit = 20, search?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set('search', search)
  return api.get(`/admin/pg/companies?${params}`)
}
export const upsertPgCompany  = (body: object) => api.post('/admin/pg/companies', body)
export const deletePgCompany  = (id: string)   => api.delete(`/admin/pg/companies/${id}`)

// ─── PG Qdrant Indexing ───────────────────────────────────────────
export const getIndexStatus   = ()                  => api.get('/admin/pg/index-status')
export const indexAllTables   = ()                  => api.post('/admin/pg/index-all')
export const indexTable       = (table: string)     => api.post(`/admin/pg/index/${table}`)
export const clearTableIndex  = (table: string)     => api.delete(`/admin/pg/index/${table}`)

// ─── PG Unanswered Questions ──────────────────────────────────────
export const getPgUnanswered  = (page = 1, status?: string) => {
  const params = new URLSearchParams({ page: String(page) })
  if (status) params.set('status', status)
  return api.get(`/admin/pg/unanswered-questions?${params}`)
}
export const updatePgUnanswered = (id: string, body: object) =>
  api.patch(`/admin/pg/unanswered-questions/${id}`, body)
export const deletePgUnanswered = (id: string) =>
  api.delete(`/admin/pg/unanswered-questions/${id}`)

// ─── Cache Stats ──────────────────────────────────────────────────
export const getCacheStats = () => api.get('/admin/cache/stats')
export const getModels     = () => api.get('/admin/models')

// ─── User Management ──────────────────────────────────────────────
export const listUsers      = (page = 1, limit = 20) =>
  api.get(`/auth/users?page=${page}&limit=${limit}`)
export const getUser        = (id: string) => api.get(`/auth/users/${id}`)
export const createUser     = (body: { email: string; password: string; name: string; role: string }) =>
  api.post('/auth/users', body)
export const updateUser     = (id: string, body: { name?: string; role?: string; isActive?: boolean }) =>
  api.put(`/auth/users/${id}`, body)
export const changeUserPassword = (id: string, password: string) =>
  api.patch(`/auth/users/${id}/password`, { password })
export const deleteUser     = (id: string) => api.delete(`/auth/users/${id}`)

// ─── Audit Logs ───────────────────────────────────────────────────
export const getAuditLogs  = (params: {
  page?: number; limit?: number; action?: string;
  resource?: string; email?: string; from?: string; to?: string;
} = {}) => {
  const p = new URLSearchParams()
  if (params.page)     p.set('page',     String(params.page))
  if (params.limit)    p.set('limit',    String(params.limit))
  if (params.action)   p.set('action',   params.action)
  if (params.resource) p.set('resource', params.resource)
  if (params.email)    p.set('email',    params.email)
  if (params.from)     p.set('from',     params.from)
  if (params.to)       p.set('to',       params.to)
  return api.get(`/audit?${p}`)
}
export const getAuditStats = () => api.get('/audit/stats')

// ─── RAG Debug / Audit ────────────────────────────────────────────
export const testRagQuery = (body: { query: string; language?: string; companySymbol?: string }) =>
  api.post('/admin/rag/test', body)
export const getRetrievalLogs = (page = 1) =>
  api.get(`/admin/retrieval-logs?page=${page}`)
export const getFailedJobs = (page = 1, queue?: string) =>
  api.get(`/admin/failed-jobs?page=${page}${queue ? `&queue=${queue}` : ''}`)

// ─── Qdrant Admin ─────────────────────────────────────────────────
export const listQdrantCollections = () => api.get('/admin/qdrant/collections')
export const searchQdrant = (body: {
  query: string; collection?: string; topK?: number;
  scoreThreshold?: number; filterType?: string; filterLanguage?: string;
}) => api.post('/admin/qdrant/search', body)
export const browseQdrant = (collection?: string, limit = 20, offset?: string, type?: string) => {
  const p = new URLSearchParams({ limit: String(limit) })
  if (collection) p.set('collection', collection)
  if (offset)     p.set('offset', offset)
  if (type)       p.set('type', type)
  return api.get(`/admin/qdrant/browse?${p}`)
}
export const deleteQdrantPoint = (id: string, collection?: string) =>
  api.delete(`/admin/qdrant/point/${id}${collection ? `?collection=${collection}` : ''}`)

// ─── Qdrant Snapshots ─────────────────────────────────────────────
/** Create a snapshot for all collections (omit collection) or one.
 *  Uses a longer timeout (3 min) because snapshotting all collections can be slow. */
export const createQdrantSnapshot      = (collection?: string) =>
  api.post(
    `/admin/qdrant/snapshot${collection ? `?collection=${encodeURIComponent(collection)}` : ''}`,
    undefined,
    { timeout: 180_000 },
  )

/** List all snapshots for a specific collection */
export const listQdrantSnapshots       = (collection: string) =>
  api.get(`/admin/qdrant/snapshots/${encodeURIComponent(collection)}`)

/** Delete a named snapshot from a collection */
export const deleteQdrantSnapshot      = (collection: string, name: string) =>
  api.delete(`/admin/qdrant/snapshot/${encodeURIComponent(collection)}/${encodeURIComponent(name)}`)

/** Delete ALL Qdrant collections — super_admin only (long timeout: many collections) */
export const deleteAllQdrantData = () => api.delete('/admin/qdrant/all', { timeout: 300_000 })

// ─── Qdrant Snapshot Schedule (via scraper queue) ─────────────────
export const getQdrantSnapshotSchedule    = ()             => api.get('/train/website/snapshot-schedule')
export const setQdrantSnapshotSchedule    = (cron: string) => api.post('/train/website/snapshot-schedule', { cron })
export const cancelQdrantSnapshotSchedule = ()             => api.delete('/train/website/snapshot-schedule')

// ─── Company Live Data ────────────────────────────────────────────
export const getCompanySnapshot  = (symbol: string) => api.get(`/admin/companies/snapshot/${symbol}`)
export const getCompanyNews      = (symbol: string) => api.get(`/admin/companies/news/${symbol}`)
export const getCompanyChart     = (symbol: string, period = '1m') =>
  api.get(`/admin/companies/chart/${symbol}?period=${period}`)
export const getCompanyDividends = (symbol: string) => api.get(`/admin/companies/dividends/${symbol}`)
export const getCompanyFinancial = (symbol: string) => api.get(`/admin/companies/financial/${symbol}`)
export const getCompanyBoard     = (symbol: string) => api.get(`/admin/companies/board/${symbol}`)
export const getCompanyOwnership = (symbol: string) => api.get(`/admin/companies/ownership/${symbol}`)
