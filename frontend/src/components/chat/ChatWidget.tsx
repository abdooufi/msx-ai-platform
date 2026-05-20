'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Send, X, Maximize2, Minimize2, Trash2, ThumbsUp, ThumbsDown, Globe } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../../lib/store'
import { streamChat, getSuggestions, submitFeedback } from '../../lib/api'
import { Message } from '../../types'
import clsx from 'clsx'

interface Props {
  mode?: 'widget' | 'fullscreen' | 'embedded'
}

export default function ChatWidget({ mode = 'widget' }: Props) {
  const [open, setOpen] = useState(mode !== 'widget')
  const [fullscreen, setFullscreen] = useState(mode === 'fullscreen')
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])

  const { messages, sessionId, isLoading, language, addMessage, updateMessage, clearHistory, setLoading, setLanguage } = useChatStore()

  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isRTL = language === 'ar'

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    getSuggestions(language).then(r => setSuggestions(r.data.suggestions || []))
  }, [language])

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || isLoading) return
    setInput('')

    // Add user message
    addMessage({ role: 'user', content: msg })

    // Add placeholder assistant message (streaming)
    const assistantId = addMessage({
      role: 'assistant',
      content: '',
      isStreaming: true,
    })

    setLoading(true)

    const history = messages
      .filter(m => m.role !== 'system')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }))

    let fullText = ''
    let sources = []
    let sessionLang: 'en' | 'ar' = language

    try {
      for await (const chunk of streamChat(msg, sessionId, history)) {
        if (chunk.type === 'meta') {
          sources = chunk.sources || []
          sessionLang = chunk.language || language
          if (chunk.language) setLanguage(chunk.language as 'en' | 'ar')
          continue
        }
        if (chunk.delta) {
          fullText += chunk.delta
          updateMessage(assistantId, { content: fullText, isStreaming: true })
        }
        if (chunk.done) {
          updateMessage(assistantId, {
            content: fullText,
            isStreaming: false,
            sources,
            tokensUsed: chunk.tokensUsed,
            latencyMs: chunk.latencyMs,
          })
        }
      }
    } catch (err) {
      updateMessage(assistantId, {
        content: isRTL
          ? 'عذراً، حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.'
          : '⚠️ Connection error. Please try again.',
        isStreaming: false,
      })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, isLoading, messages, sessionId, language])

  const handleFeedback = async (msg: Message, feedback: 'positive' | 'negative') => {
    if (msg.feedback) return
    updateMessage(msg.id, { feedback })
    await submitFeedback(sessionId, msg.id, feedback)
  }

  // ─── Floating toggle button (widget mode only) ──────────────────
  if (mode === 'widget' && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 shadow-2xl flex items-center justify-center transition-all hover:scale-110"
        aria-label="Open MSX Assistant"
      >
        <Bot size={26} color="white" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-gray-900 animate-pulse" />
      </button>
    )
  }

  const containerClass = clsx(
    'flex flex-col bg-gray-900 text-gray-100 shadow-2xl overflow-hidden',
    {
      'fixed bottom-6 right-6 z-50 w-96 h-[580px] rounded-2xl border border-gray-700 animate-slide-up': mode === 'widget' && !fullscreen,
      'fixed inset-0 z-50 rounded-none': fullscreen,
      'w-full h-full rounded-xl border border-gray-700': mode === 'embedded',
    },
  )

  return (
    <div className={containerClass} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-900 to-blue-800 border-b border-blue-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/30 border border-blue-400/40 flex items-center justify-center">
            <Bot size={16} color="#60a5fa" />
          </div>
          <div>
            <p className="text-sm font-semibold">MSX AI Assistant</p>
            <p className="text-xs text-blue-300 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              Online
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Language toggle */}
          <button
            onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
            className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
            title="Toggle language"
          >
            <Globe size={14} />
          </button>
          {messages.length > 1 && (
            <button
              onClick={clearHistory}
              className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
              title="Clear chat"
            >
              <Trash2 size={14} />
            </button>
          )}
          {mode === 'widget' && (
            <>
              <button
                onClick={() => setFullscreen(v => !v)}
                className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Messages ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {messages.length === 0 && (
          <WelcomeScreen
            language={language}
            suggestions={suggestions}
            onSend={handleSend}
          />
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isRTL={isRTL}
            onFeedback={handleFeedback}
          />
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex gap-2 items-end">
            <BotAvatar />
            <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Input ─────────────────────────────────────────────── */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-700/60">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={isRTL ? 'اسأل عن سوق مسقط...' : 'Ask about Muscat Stock Exchange...'}
            rows={1}
            className="flex-1 resize-none bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-gray-100 placeholder-gray-500 max-h-24 overflow-y-auto"
            style={{ direction: isRTL ? 'rtl' : 'ltr' }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0',
              input.trim() && !isLoading
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed',
            )}
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-1.5">
          Powered by MSX AI · {isRTL ? 'Enter للإرسال' : 'Enter to send'}
        </p>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────

function BotAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-blue-900/60 border border-blue-700/40 flex items-center justify-center flex-shrink-0">
      <Bot size={14} color="#60a5fa" />
    </div>
  )
}

function WelcomeScreen({
  language, suggestions, onSend,
}: { language: string; suggestions: string[]; onSend: (s: string) => void }) {
  const isRTL = language === 'ar'
  return (
    <div className="text-center py-6 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-blue-900/40 border border-blue-700/40 flex items-center justify-center mx-auto mb-3">
        <Bot size={28} color="#60a5fa" />
      </div>
      <h3 className="font-semibold text-gray-200 mb-1">
        {isRTL ? 'مرحباً بك في مساعد MSX' : 'MSX Smart Assistant'}
      </h3>
      <p className="text-xs text-gray-500 mb-5 max-w-60 mx-auto">
        {isRTL
          ? 'اسألني عن الأسهم والشركات والأسواق'
          : 'Ask me about stocks, companies, and markets'}
      </p>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSend(s)}
              className="text-xs text-left px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition"
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  msg, isRTL, onFeedback,
}: { msg: Message; isRTL: boolean; onFeedback: (m: Message, f: 'positive' | 'negative') => void }) {
  const isUser = msg.role === 'user'

  return (
    <div className={clsx('flex gap-2 items-end animate-fade-in', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && <BotAvatar />}

      <div className={clsx('max-w-[82%]', isUser ? 'items-end' : 'items-start', 'flex flex-col')}>
        <div
          className={clsx(
            'px-3.5 py-2.5 rounded-2xl text-sm',
            isUser
              ? 'bg-blue-700 text-white rounded-br-sm'
              : clsx('bg-gray-800 border border-gray-700 text-gray-100 rounded-bl-sm', msg.isStreaming && 'streaming'),
          )}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {isUser ? (
            <span>{msg.content}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="prose-chat"
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener" className="text-blue-400 underline">
                    {children}
                  </a>
                ),
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Sources */}
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {msg.sources.slice(0, 3).map((s, i) => (
              <a
                key={i}
                href={s.url || '#'}
                target="_blank"
                rel="noopener"
                className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:text-blue-400 transition"
              >
                📎 {s.title?.substring(0, 25) || 'Source'}
              </a>
            ))}
          </div>
        )}

        {/* Feedback */}
        {!isUser && !msg.isStreaming && msg.content && (
          <div className="flex gap-1 mt-1">
            <button
              onClick={() => onFeedback(msg, 'positive')}
              className={clsx(
                'p-1 rounded transition',
                msg.feedback === 'positive' ? 'text-green-400' : 'text-gray-600 hover:text-green-400',
              )}
            >
              <ThumbsUp size={11} />
            </button>
            <button
              onClick={() => onFeedback(msg, 'negative')}
              className={clsx(
                'p-1 rounded transition',
                msg.feedback === 'negative' ? 'text-red-400' : 'text-gray-600 hover:text-red-400',
              )}
            >
              <ThumbsDown size={11} />
            </button>
            {msg.latencyMs && (
              <span className="text-[10px] text-gray-600 py-1">{msg.latencyMs}ms</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
