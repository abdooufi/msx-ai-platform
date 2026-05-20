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
