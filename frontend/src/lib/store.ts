import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { Message, User } from '../types'

// ─── Chat store ───────────────────────────────────────────────────
interface ChatStore {
  messages: Message[]
  sessionId: string
  isLoading: boolean
  language: 'en' | 'ar'
  addMessage: (msg: Omit<Message, 'id' | 'createdAt'>) => string
  updateMessage: (id: string, updates: Partial<Message>) => void
  clearHistory: () => void
  setLoading: (v: boolean) => void
  setLanguage: (lang: 'en' | 'ar') => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [],
      sessionId: uuidv4(),
      isLoading: false,
      language: 'en',

      addMessage: (msg) => {
        const id = uuidv4()
        set(s => ({
          messages: [
            ...s.messages,
            { ...msg, id, createdAt: new Date() },
          ],
        }))
        return id
      },

      updateMessage: (id, updates) =>
        set(s => ({
          messages: s.messages.map(m =>
            m.id === id ? { ...m, ...updates } : m,
          ),
        })),

      clearHistory: () =>
        set({ messages: [], sessionId: uuidv4() }),

      setLoading: (isLoading) => set({ isLoading }),

      setLanguage: (language) => set({ language }),
    }),
    { name: 'msx-chat-v2', partialize: s => ({ messages: s.messages, sessionId: s.sessionId }) },
  ),
)

// ─── Auth store ───────────────────────────────────────────────────
interface AuthStore {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
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
