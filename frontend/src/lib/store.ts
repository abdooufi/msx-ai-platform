import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { Message, User } from '../types'

// ─── Session (persisted chat history) ────────────────────────────
export interface Session {
  id:           string
  title:        string   // first user message, truncated
  preview:      string   // last message preview
  messageCount: number
  messages:     Message[]
  createdAt:    string   // ISO string
  language:     'en' | 'ar'
}

// ─── Chat store ───────────────────────────────────────────────────
interface ChatStore {
  messages:   Message[]
  sessionId:  string
  isLoading:  boolean
  language:   'en' | 'ar'
  sessions:   Session[]

  addMessage:          (msg: Omit<Message, 'id' | 'createdAt'>) => string
  updateMessage:       (id: string, updates: Partial<Message>) => void
  clearHistory:        () => void
  setLoading:          (v: boolean) => void
  setLanguage:         (lang: 'en' | 'ar') => void
  saveCurrentSession:  () => void
  loadSession:         (session: Session) => void
  deleteSession:       (id: string) => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages:  [],
      sessionId: uuidv4(),
      isLoading: false,
      language:  'en',
      sessions:  [],

      addMessage: (msg) => {
        const id = uuidv4()
        set(s => ({
          messages: [...s.messages, { ...msg, id, createdAt: new Date() }],
        }))
        return id
      },

      updateMessage: (id, updates) =>
        set(s => ({
          messages: s.messages.map(m => m.id === id ? { ...m, ...updates } : m),
        })),

      saveCurrentSession: () => {
        const { messages, sessionId, language } = get()
        const userMsgs = messages.filter(m => m.role === 'user')
        if (!userMsgs.length) return
        const title   = userMsgs[0].content.slice(0, 60)
        const lastMsg = messages[messages.length - 1]
        const session: Session = {
          id:           sessionId,
          title,
          preview:      lastMsg?.content?.slice(0, 100) ?? '',
          messageCount: messages.length,
          messages,
          createdAt:    new Date().toISOString(),
          language,
        }
        set(s => ({
          sessions: [session, ...s.sessions.filter(x => x.id !== sessionId)].slice(0, 30),
        }))
      },

      loadSession: (session) => {
        set({
          messages:  session.messages,
          sessionId: session.id,
          language:  session.language,
        })
      },

      deleteSession: (id) =>
        set(s => ({ sessions: s.sessions.filter(x => x.id !== id) })),

      /** Save current session to history, then start fresh */
      clearHistory: () => {
        get().saveCurrentSession()
        set({ messages: [], sessionId: uuidv4() })
      },

      setLoading:  (isLoading) => set({ isLoading }),
      setLanguage: (language)  => set({ language }),
    }),
    {
      name: 'msx-chat-v3',
      partialize: s => ({
        messages:  s.messages,
        sessionId: s.sessionId,
        sessions:  s.sessions,
        language:  s.language,
      }),
    },
  ),
)

// ─── Auth store ───────────────────────────────────────────────────
interface AuthStore {
  user:  User | null
  token: string | null
  setAuth:         (user: User, token: string) => void
  clearAuth:       () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user:  null,
      token: null,
      setAuth: (user, token) => {
        set({ user, token })
        localStorage.setItem('msx_token', token)
      },
      clearAuth: () => {
        set({ user: null, token: null })
        localStorage.removeItem('msx_token')
      },
      isAuthenticated: () => !!get().token,
    }),
    { name: 'msx-auth' },
  ),
)
