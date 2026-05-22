'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Bot, Send, X, Maximize2, Minimize2, Trash2, ThumbsUp, ThumbsDown,
  Globe, Search, Mic, MicOff, Volume2, VolumeX, Download, Copy, Check,
  History, ChevronLeft, Plus, Trash,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useChatStore, Session } from '../../lib/store'
import { streamChat, getSuggestions, submitFeedback, searchCompanySymbols } from '../../lib/api'
import { Message, ChartData } from '../../types'
import clsx from 'clsx'

interface CompanyOption { symbol: string; nameEn: string; nameAr: string }
interface Props { mode?: 'widget' | 'fullscreen' | 'embedded' }

// ─── Speech API detection (SSR-safe) ─────────────────────────────
function getSpeechRecognition() {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}
const hasTTS = () => typeof window !== 'undefined' && !!window.speechSynthesis

export default function ChatWidget({ mode = 'widget' }: Props) {
  const [open,        setOpen]        = useState(mode !== 'widget')
  const [fullscreen,  setFullscreen]  = useState(mode === 'fullscreen')
  const [input,       setInput]       = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showHistory,   setShowHistory]   = useState(false)
  const [isRecording,   setIsRecording]   = useState(false)
  const [ttsId,         setTtsId]         = useState<string | null>(null)
  const [copiedId,      setCopiedId]      = useState<string | null>(null)
  const [showSuggest,   setShowSuggest]   = useState(false)
  // Detected client-side only (avoids SSR/hydration mismatch)
  const [hasSpeechInput, setHasSpeechInput] = useState(false)
  const [hasSpeechTTS,   setHasSpeechTTS]   = useState(false)

  // Symbol autocomplete
  const [symResults, setSymResults] = useState<CompanyOption[]>([])
  const [showSym,    setShowSym]    = useState(false)
  const [symIdx,     setSymIdx]     = useState(0)
  const symDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const symMenuRef   = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)

  const {
    messages, sessionId, isLoading, language, sessions,
    addMessage, updateMessage, clearHistory, setLoading, setLanguage,
    saveCurrentSession, loadSession, deleteSession,
  } = useChatStore()

  const endRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isRTL    = language === 'ar'

  // ── Symbol autocomplete ─────────────────────────────────────────
  const getSlashQuery = useCallback((val: string, cursor: number) => {
    const before = val.slice(0, cursor)
    const m = before.match(/(?:^|(?<=\s))\/(\S*)$/)
    return m ? m[1] : null
  }, [])

  const fetchSymbols = useCallback((q: string) => {
    if (symDebounce.current) clearTimeout(symDebounce.current)
    symDebounce.current = setTimeout(async () => {
      try {
        const r = await searchCompanySymbols(q || undefined)
        setSymResults(r.data ?? [])
        setSymIdx(0)
      } catch { setSymResults([]) }
    }, 200)
  }, [])

  const pickSymbol = useCallback((opt: CompanyOption) => {
    const cursor  = inputRef.current?.selectionStart ?? input.length
    const before  = input.slice(0, cursor)
    const slashPos = before.search(/(?:^|(?<=\s))\/\S*$/)
    if (slashPos !== -1) {
      const after  = input.slice(cursor)
      const newVal = input.slice(0, slashPos) + opt.symbol + after
      setInput(newVal)
      requestAnimationFrame(() => {
        const pos = slashPos + opt.symbol.length
        inputRef.current?.setSelectionRange(pos, pos)
        inputRef.current?.focus()
      })
    }
    setShowSym(false)
  }, [input])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isLoading])
  useEffect(() => {
    getSuggestions(language).then(r => setSuggestions(r.data.suggestions || []))
  }, [language])

  // Auto-resize textarea as user types
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [input])

  // Detect browser speech APIs once — after hydration, client-only
  useEffect(() => {
    setHasSpeechInput(!!getSpeechRecognition())
    setHasSpeechTTS(hasTTS())
  }, [])

  // Stop TTS when unmounting
  useEffect(() => () => { window.speechSynthesis?.cancel() }, [])

  // ── Send message ────────────────────────────────────────────────
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || isLoading) return
    setInput('')
    setShowSuggest(false)

    addMessage({ role: 'user', content: msg })
    const assistantId = addMessage({ role: 'assistant', content: '', isStreaming: true })
    setLoading(true)

    const history = messages
      .filter(m => m.role !== 'system')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }))

    let fullText = '', sources = [], sessionLang: 'en' | 'ar' = language
    let chartData: ChartData | undefined

    try {
      for await (const chunk of streamChat(msg, sessionId, history)) {
        if (chunk.type === 'meta') {
          sources     = chunk.sources || []
          sessionLang = chunk.language || language
          if (chunk.language) setLanguage(chunk.language as 'en' | 'ar')
          continue
        }
        if (chunk.type === 'chart') { chartData = chunk.chartData as ChartData; continue }
        if (chunk.delta) {
          fullText += chunk.delta
          updateMessage(assistantId, { content: fullText, isStreaming: true, chartData })
        }
        if (chunk.done) {
          updateMessage(assistantId, {
            content: fullText, isStreaming: false, sources,
            tokensUsed: chunk.tokensUsed, latencyMs: chunk.latencyMs, chartData,
          })
        }
      }
    } catch {
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

  // ── Copy message ────────────────────────────────────────────────
  const copyMessage = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  // ── Export chat ─────────────────────────────────────────────────
  const exportChat = useCallback(() => {
    if (!messages.length) return
    const lines = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const who  = m.role === 'user' ? 'You' : 'MSX AI'
        const time = new Date(m.createdAt).toLocaleString('en-GB')
        return `[${time}] ${who}:\n${m.content}\n`
      })
    const text = [
      'MSX AI Chat Export',
      `Session: ${sessionId}`,
      `Date:    ${new Date().toLocaleString('en-GB')}`,
      '─'.repeat(50),
      '',
      ...lines,
    ].join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `msx-chat-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages, sessionId])

  // ── Voice input ─────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    const SpeechRec = getSpeechRecognition()
    if (!SpeechRec) return

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }
    const rec            = new SpeechRec()
    rec.lang             = isRTL ? 'ar-SA' : 'en-US'
    rec.interimResults   = false
    rec.maxAlternatives  = 1
    rec.onresult         = (e: any) => {
      const t = e.results[0][0].transcript
      setInput(prev => prev ? `${prev} ${t}` : t)
    }
    rec.onend  = () => setIsRecording(false)
    rec.onerror = () => setIsRecording(false)
    recognitionRef.current = rec
    rec.start()
    setIsRecording(true)
  }, [isRecording, isRTL])

  // ── TTS ─────────────────────────────────────────────────────────
  const speakMessage = useCallback((id: string, text: string) => {
    if (!hasSpeechTTS) return
    if (ttsId === id) {
      window.speechSynthesis.cancel()
      setTtsId(null)
      return
    }
    window.speechSynthesis.cancel()
    const utt   = new SpeechSynthesisUtterance(text.replace(/[#*`_~]/g, ''))
    utt.lang    = isRTL ? 'ar-SA' : 'en-US'
    utt.rate    = 0.9
    utt.onend   = () => setTtsId(null)
    utt.onerror = () => setTtsId(null)
    setTtsId(id)
    window.speechSynthesis.speak(utt)
  }, [ttsId, isRTL, hasSpeechTTS])

  // ── Floating button (widget mode) ───────────────────────────────
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
    'flex flex-col bg-gray-900 text-gray-100 shadow-2xl overflow-hidden relative',
    {
      'fixed bottom-6 right-6 z-50 w-96 h-[580px] rounded-2xl border border-gray-700 animate-slide-up': mode === 'widget' && !fullscreen,
      'fixed inset-0 z-50 rounded-none': fullscreen,
      'w-full h-full rounded-xl border border-gray-700': mode === 'embedded',
    },
  )

  return (
    <div className={containerClass} dir={isRTL ? 'rtl' : 'ltr'}>

      {/* ── History sidebar (overlay) ─────────────────────────── */}
      {showHistory && (
        <HistorySidebar
          sessions={sessions}
          currentId={sessionId}
          onLoad={(s) => { loadSession(s); setShowHistory(false) }}
          onDelete={deleteSession}
          onNew={() => { clearHistory(); setShowHistory(false) }}
          onClose={() => setShowHistory(false)}
          isRTL={isRTL}
        />
      )}

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-900 to-blue-800 border-b border-blue-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* History toggle */}
          <button
            onClick={() => setShowHistory(v => !v)}
            className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
            title="Chat history"
          >
            <History size={14} />
          </button>
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
          {/* Export */}
          {messages.length > 1 && (
            <button
              onClick={exportChat}
              className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
              title="Export chat"
            >
              <Download size={14} />
            </button>
          )}
          {/* Clear */}
          {messages.length > 1 && (
            <button
              onClick={clearHistory}
              className="p-1.5 rounded-lg text-blue-300 hover:bg-blue-700/50 transition"
              title="New chat"
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
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <WelcomeScreen language={language} suggestions={suggestions} onSend={handleSend} />
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isRTL={isRTL}
            onFeedback={handleFeedback}
            onCopy={copyMessage}
            onSpeak={speakMessage}
            copiedId={copiedId}
            ttsId={ttsId}
            hasTTSSupport={hasSpeechTTS}
          />
        ))}

        {/* Show typing dots while waiting for first token from the LLM */}
        {isLoading && (() => {
          const last = messages[messages.length - 1]
          return !last || last.role !== 'assistant' || (!last.content && last.isStreaming)
        })() && (
          <div className="flex gap-2 items-end">
            <BotAvatar />
            <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
              <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Suggestion chips (while chatting) ─────────────────── */}
      {messages.length > 0 && suggestions.length > 0 && (
        <div className="px-3 pt-1 flex-shrink-0">
          <button
            onClick={() => setShowSuggest(v => !v)}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition flex items-center gap-1 mb-1"
          >
            <Plus size={9} className={clsx('transition-transform', showSuggest && 'rotate-45')} />
            {isRTL ? 'أسئلة مقترحة' : 'Suggested questions'}
          </button>
          {showSuggest && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {suggestions.slice(0, 5).map((s, i) => (
                <button
                  key={i}
                  onClick={() => { handleSend(s); setShowSuggest(false) }}
                  className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 transition whitespace-nowrap"
                  dir={isRTL ? 'rtl' : 'ltr'}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Input ─────────────────────────────────────────────── */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-700/60 flex-shrink-0">

        {/* Symbol autocomplete */}
        {showSym && symResults.length > 0 && (
          <div
            ref={symMenuRef}
            className="mb-2 bg-gray-800 border border-gray-600 rounded-xl overflow-hidden shadow-2xl max-h-52 overflow-y-auto"
          >
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-700 bg-gray-900/60">
              <Search size={11} className="text-blue-400" />
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                Company symbols — ↑↓ to navigate · Enter to select · Esc to close
              </span>
            </div>
            {symResults.map((opt, i) => (
              <button
                key={opt.symbol}
                onMouseDown={e => { e.preventDefault(); pickSymbol(opt) }}
                className={clsx(
                  'w-full text-left flex items-center gap-3 px-3 py-2 transition',
                  i === symIdx ? 'bg-blue-700/40 text-white' : 'text-gray-300 hover:bg-gray-700/50',
                )}
              >
                <span className="font-mono font-bold text-blue-300 text-sm w-16 flex-shrink-0">{opt.symbol}</span>
                <span className="text-xs text-gray-400 truncate flex-1">{opt.nameEn}</span>
                {opt.nameAr && (
                  <span className="text-xs text-gray-600 truncate max-w-[80px]" dir="rtl">{opt.nameAr}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                const val    = e.target.value
                setInput(val)
                const cursor = e.target.selectionStart ?? val.length
                const q      = getSlashQuery(val, cursor)
                if (q !== null) { setShowSym(true); fetchSymbols(q) }
                else { setShowSym(false) }
              }}
              onKeyDown={e => {
                if (showSym && symResults.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSymIdx(i => Math.min(i + 1, symResults.length - 1)); return }
                  if (e.key === 'ArrowUp')   { e.preventDefault(); setSymIdx(i => Math.max(i - 1, 0)); return }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (symResults[symIdx]) pickSymbol(symResults[symIdx]); return }
                  if (e.key === 'Escape')    { e.preventDefault(); setShowSym(false); return }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              onBlur={() => setTimeout(() => setShowSym(false), 150)}
              placeholder={isRTL ? 'اسأل عن سوق مسقط... (اكتب / للبحث عن شركة)' : 'Ask about MSX... (type / to search a company)'}
              rows={1}
              className="w-full resize-none bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-gray-100 placeholder-gray-500 max-h-24 overflow-y-auto"
              style={{ direction: isRTL ? 'rtl' : 'ltr' }}
            />
          </div>

          {/* Mic button */}
          {hasSpeechInput && (
            <button
              onClick={toggleVoice}
              title={isRecording ? 'Stop recording' : 'Voice input'}
              className={clsx(
                'w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0',
                isRecording
                  ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white',
              )}
            >
              {isRecording ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          )}

          {/* Send button */}
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
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <p className="text-xs text-gray-600">
            Powered by MSX AI · {isRTL ? 'اكتب / للبحث عن شركة' : 'Type / to look up a company symbol'}
          </p>
          {input.length > 200 && (
            <span className={clsx('text-[10px] tabular-nums', input.length > 900 ? 'text-red-400' : 'text-gray-500')}>
              {input.length}/1000
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Format a timestamp as a short relative/absolute time label */
function formatTime(date: Date | string): string {
  const d   = new Date(date)
  const now = new Date()
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (sec < 60)    return 'just now'
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// ─── History Sidebar ──────────────────────────────────────────────

function HistorySidebar({
  sessions, currentId, onLoad, onDelete, onNew, onClose, isRTL,
}: {
  sessions:  Session[]
  currentId: string
  onLoad:    (s: Session) => void
  onDelete:  (id: string) => void
  onNew:     () => void
  onClose:   () => void
  isRTL:     boolean
}) {
  return (
    <div className="absolute inset-0 z-20 flex" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Panel */}
      <div className="w-72 bg-gray-950 border-r border-gray-700 flex flex-col h-full shadow-2xl animate-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-semibold text-white flex items-center gap-2">
            <History size={14} className="text-blue-400" />
            {isRTL ? 'المحادثات السابقة' : 'Chat History'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onNew}
              title="New chat"
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition text-xs flex items-center gap-1"
            >
              <Plus size={13} />
              {isRTL ? 'جديد' : 'New'}
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 ? (
            <div className="text-center py-10 text-gray-600 text-xs px-4">
              <History size={24} className="mx-auto mb-2 opacity-30" />
              {isRTL ? 'لا توجد محادثات محفوظة' : 'No saved conversations yet'}
            </div>
          ) : sessions.map(s => (
            <div
              key={s.id}
              className={clsx(
                'group flex items-start gap-2 px-3 py-2.5 mx-1 rounded-lg cursor-pointer transition',
                s.id === currentId
                  ? 'bg-blue-900/30 border border-blue-800/40'
                  : 'hover:bg-gray-800/60',
              )}
              onClick={() => onLoad(s)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate">{s.title}</p>
                <p className="text-[10px] text-gray-500 truncate mt-0.5">{s.preview}</p>
                <p className="text-[10px] text-gray-600 mt-1">
                  {new Date(s.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{s.messageCount} msgs
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-600 hover:text-red-400 transition rounded flex-shrink-0"
                title="Delete"
              >
                <Trash size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
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
        {isRTL ? 'اسألني عن الأسهم والشركات والأسواق' : 'Ask me about stocks, companies, and markets'}
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

// ─── Inline price chart ───────────────────────────────────────────

function fmtVol(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function InlinePriceChart({ chartData }: { chartData: ChartData; summary: string }) {
  const { symbol, points, summary: s } = chartData
  const isUp  = s.last >= s.open
  const color = isUp ? '#22c55e' : '#ef4444'
  const pMin  = Math.min(...points.map(p => p.ltp))
  const pMax  = Math.max(...points.map(p => p.ltp))
  const pad   = (pMax - pMin) * 0.08 || 0.002
  return (
    <div className="w-full">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-white font-mono">{symbol}</span>
          <span className={`text-lg font-bold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>{s.last.toFixed(3)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
          <span>O <b className="text-gray-200">{s.open.toFixed(3)}</b></span>
          <span>H <b className="text-green-300">{s.high.toFixed(3)}</b></span>
          <span>L <b className="text-red-300">{s.low.toFixed(3)}</b></span>
          <span className="ml-auto text-gray-500">🕐 {s.latestTime}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`cg_${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={50} />
          <YAxis domain={[pMin - pad, pMax + pad]} tick={{ fill: '#6b7280', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(3)} width={46} />
          <Tooltip content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs shadow-lg">
                <p className="text-gray-400">{payload[0]?.payload?.time}</p>
                <p className="font-mono font-bold" style={{ color }}>{payload[0]?.payload?.ltp?.toFixed(3)}</p>
                <p className="text-gray-500">Vol: {fmtVol(payload[0]?.payload?.shares)}</p>
              </div>
            ) : null
          } />
          <ReferenceLine y={s.open} stroke="#6b7280" strokeDasharray="3 2" label={{ value: 'O', fill: '#6b7280', fontSize: 8, position: 'insideTopRight' }} />
          <Area type="monotone" dataKey="ltp" stroke={color} strokeWidth={1.5} fill={`url(#cg_${symbol})`} dot={false} activeDot={{ r: 3, fill: color, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={50}>
        <BarChart data={points} margin={{ top: 0, right: 4, bottom: 2, left: 0 }}>
          <XAxis dataKey="time" hide /><YAxis hide />
          <Bar dataKey="shares" fill="#4b5563" radius={[1, 1, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="px-4 pb-3 pt-1 flex items-center gap-3 text-xs text-gray-500 border-t border-gray-700/50">
        <span>{s.tradesCount} trades</span>
        <span>Vol: <b className="text-gray-300">{fmtVol(s.totalShares)}</b></span>
        <span>Turnover: <b className="text-gray-300">{s.totalTurnover.toFixed(0)} OMR</b></span>
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────

function MessageBubble({
  msg, isRTL, onFeedback, onCopy, onSpeak, copiedId, ttsId, hasTTSSupport,
}: {
  msg:           Message
  isRTL:         boolean
  hasTTSSupport: boolean
  onFeedback:    (m: Message, f: 'positive' | 'negative') => void
  onCopy:        (id: string, text: string) => void
  onSpeak:       (id: string, text: string) => void
  copiedId:      string | null
  ttsId:         string | null
}) {
  const isUser = msg.role === 'user'

  return (
    <div className={clsx('flex gap-2 items-end animate-fade-in group', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && <BotAvatar />}

      <div className={clsx('max-w-[82%]', isUser ? 'items-end' : 'items-start', 'flex flex-col')}>
        <div
          className={clsx(
            'rounded-2xl text-sm overflow-hidden',
            isUser
              ? 'bg-blue-700 text-white rounded-br-sm px-3.5 py-2.5'
              : clsx('bg-gray-800 border border-gray-700 text-gray-100 rounded-bl-sm',
                  msg.isStreaming && 'streaming',
                  msg.chartData ? 'p-0' : 'px-3.5 py-2.5'),
          )}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {isUser ? (
            <span>{msg.content}</span>
          ) : msg.chartData ? (
            <InlinePriceChart chartData={msg.chartData} summary={msg.content} />
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="prose-chat"
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener" className="text-blue-400 underline">{children}</a>
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
              <a key={i} href={s.url || '#'} target="_blank" rel="noopener"
                className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:text-blue-400 transition">
                📎 {s.title?.substring(0, 25) || 'Source'}
              </a>
            ))}
          </div>
        )}

        {/* Timestamp — always visible, subtle */}
        {!msg.isStreaming && (
          <span className="text-[9px] text-gray-600 mt-0.5 px-0.5 select-none">
            {formatTime(msg.createdAt)}
          </span>
        )}

        {/* Action row */}
        {!msg.isStreaming && msg.content && (
          <div className="flex items-center gap-0.5 mt-0.5">
            {/* Copy */}
            <button
              onClick={() => onCopy(msg.id, msg.content)}
              className="p-1 rounded text-gray-600 hover:text-gray-300 transition opacity-0 group-hover:opacity-100"
              title="Copy"
            >
              {copiedId === msg.id
                ? <Check size={11} className="text-green-400" />
                : <Copy size={11} />}
            </button>

            {/* TTS (AI messages only) */}
            {!isUser && hasTTSSupport && (
              <button
                onClick={() => onSpeak(msg.id, msg.content)}
                className={clsx(
                  'p-1 rounded transition opacity-0 group-hover:opacity-100',
                  ttsId === msg.id ? 'text-blue-400 opacity-100' : 'text-gray-600 hover:text-gray-300',
                )}
                title={ttsId === msg.id ? 'Stop' : 'Read aloud'}
              >
                {ttsId === msg.id ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
            )}

            {/* Feedback (AI messages only) */}
            {!isUser && (
              <>
                <button
                  onClick={() => onFeedback(msg, 'positive')}
                  className={clsx('p-1 rounded transition', msg.feedback === 'positive' ? 'text-green-400' : 'text-gray-600 hover:text-green-400 opacity-0 group-hover:opacity-100')}
                >
                  <ThumbsUp size={11} />
                </button>
                <button
                  onClick={() => onFeedback(msg, 'negative')}
                  className={clsx('p-1 rounded transition', msg.feedback === 'negative' ? 'text-red-400' : 'text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100')}
                >
                  <ThumbsDown size={11} />
                </button>
                {msg.latencyMs && (
                  <span className="text-[10px] text-gray-600 py-1 ml-1 opacity-0 group-hover:opacity-100">{msg.latencyMs}ms</span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
