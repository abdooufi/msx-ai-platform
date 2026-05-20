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

// Auto-redirect on 401
api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('msx_token')
      window.location.href = '/admin/login'
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    const lines = text.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6))
        yield data
      } catch { /* partial chunk */ }
    }
  }
}

// ─── Admin ────────────────────────────────────────────────────────
export const getStats    = ()            => api.get('/admin/stats')
export const getConvs    = (p = 1, lang?: string) =>
  api.get(`/admin/conversations?page=${p}${lang ? `&lang=${lang}` : ''}`)
export const getFailed   = (p = 1)      => api.get(`/admin/failed?page=${p}`)
export const getAnalytics = (days = 7)  => api.get(`/analytics?days=${days}`)

// ─── Documents ────────────────────────────────────────────────────
export const uploadDocument = (form: FormData) =>
  api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
export const listDocuments = (page = 1) => api.get(`/upload?page=${page}`)
export const deleteDocument = (id: string) => api.delete(`/upload/${id}`)

// ─── Training ─────────────────────────────────────────────────────
export const startCrawl    = (url?: string) => api.post('/train/website', { url })
export const crawlPage     = (url: string)  => api.post('/train/website/page', { url })
export const getCrawlStatus = ()            => api.get('/train/website/status')

// ─── Settings ─────────────────────────────────────────────────────
export const getSettings    = ()              => api.get('/admin/settings')
export const updateSettings = (body: object)  => api.patch('/admin/settings', body)

// ─── AI Provider ──────────────────────────────────────────────────
export const getAiProvider  = ()                   => api.get('/admin/ai-provider')
export const setAiProvider  = (provider: string)   => api.post('/admin/ai-provider', { provider })

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
