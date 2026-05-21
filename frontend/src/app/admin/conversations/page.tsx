'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare, Globe, Monitor, Clock,
  X, RefreshCcw, ChevronLeft, ChevronRight,
  ThumbsUp, ThumbsDown, AlertCircle,
} from 'lucide-react'
import { getConvs, getConvDetail } from '../../../lib/api'
import { Conversation, Message } from '../../../types'
import clsx from 'clsx'

function fDate(d: string) {
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ConversationsPage() {
  const [convs, setConvs]     = useState<Conversation[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pages, setPages]     = useState(1)
  const [lang, setLang]       = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected]   = useState<Conversation | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (p: number, l: string) => {
    setLoading(true)
    try {
      const res = await getConvs(p, l || undefined)
      setConvs(res.data.conversations)
      setTotal(res.data.total)
      setPages(res.data.pages)
    } catch {
      setConvs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPage(1)
    load(1, lang)
  }, [lang, load])

  useEffect(() => {
    load(page, lang)
  }, [page, load])  // lang handled above

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Conversations</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} total sessions</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={lang}
            onChange={e => setLang(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Languages</option>
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
          <button
            onClick={() => load(page, lang)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left px-5 py-3">Session ID</th>
              <th className="text-left px-5 py-3">Language</th>
              <th className="text-left px-5 py-3">Channel</th>
              <th className="text-left px-5 py-3">Msgs</th>
              <th className="text-left px-5 py-3">Last Message</th>
              <th className="text-left px-5 py-3">Date</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading && convs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-600">
                  <RefreshCcw size={18} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : convs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-600">
                  <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
                  No conversations yet
                </td>
              </tr>
            ) : convs.map(c => (
              <tr
                key={c._id}
                onClick={async () => {
                  setSelected(c)          // open modal immediately with summary
                  setDetailLoading(true)
                  try {
                    const res = await getConvDetail(c._id)
                    const full = res.data
                    // merge messages into the summary object
                    setSelected(prev => prev ? {
                      ...prev,
                      messages: full.messages ?? [],
                    } : null)
                  } catch { /* keep modal open with summary */ }
                  finally { setDetailLoading(false) }
                }}
                className="hover:bg-gray-800/50 cursor-pointer transition"
              >
                <td className="px-5 py-3 font-mono text-xs text-blue-400">
                  {c.sessionId.slice(0, 14)}…
                </td>
                <td className="px-5 py-3">
                  <LangBadge lang={c.language} />
                </td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                    <Monitor size={10} />
                    {c.channel || 'web'}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-300 font-medium">{c.messageCount}</td>
                <td className="px-5 py-3 text-gray-400 max-w-xs">
                  <span className="line-clamp-1">{c.lastMessage || '—'}</span>
                </td>
                <td className="px-5 py-3 text-gray-500 whitespace-nowrap text-xs">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={10} />
                    {fDate(c.createdAt)}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-600">
                  <ChevronRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Page {page} of {pages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              disabled={page >= pages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <ConversationModal
          conv={selected}
          loading={detailLoading}
          onClose={() => { setSelected(null); setDetailLoading(false) }}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LangBadge({ lang }: { lang?: string }) {
  const isAr = lang === 'ar'
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
      isAr ? 'bg-purple-900/40 text-purple-300' : 'bg-blue-900/40 text-blue-300',
    )}>
      <Globe size={10} />
      {lang?.toUpperCase() || 'EN'}
    </span>
  )
}

function ConversationModal({ conv, loading, onClose }: { conv: Conversation; loading?: boolean; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div>
            <p className="text-white font-semibold flex items-center gap-2">
              <MessageSquare size={16} className="text-blue-400" />
              Conversation Detail
            </p>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{conv.sessionId}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <LangBadge lang={conv.language} />
              <span className="inline-flex items-center gap-1">
                <Monitor size={10} />{conv.channel || 'web'}
              </span>
              <span>{conv.messageCount} messages</span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition p-1 rounded hover:bg-gray-800"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-6 py-4 space-y-3"
          dir={conv.language === 'ar' ? 'rtl' : 'ltr'}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCcw size={18} className="animate-spin text-blue-400 mr-2" />
              <span className="text-sm text-gray-500">Loading messages…</span>
            </div>
          ) : !conv.messages?.length ? (
            <div className="text-center py-12 text-gray-600">No messages found</div>
          ) : conv.messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800 flex-shrink-0">
          <p className="text-xs text-gray-600">
            Started {conv.createdAt ? fDate(conv.createdAt) : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === 'system') return null
  const isUser = msg.role === 'user'
  const isFailed = (msg as any).status === 'failed'

  return (
    <div className={clsx('flex gap-2 items-end', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs text-white flex-shrink-0">
          AI
        </div>
      )}
      <div className={clsx(
        'max-w-sm rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
        isUser
          ? 'bg-blue-600 text-white rounded-br-sm'
          : isFailed
          ? 'bg-red-900/40 text-red-200 border border-red-800/50 rounded-bl-sm'
          : 'bg-gray-800 text-gray-100 rounded-bl-sm',
      )}>
        {isFailed && !isUser && (
          <p className="flex items-center gap-1 text-xs text-red-400 mb-1.5">
            <AlertCircle size={10} /> Response failed
          </p>
        )}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {!isUser && (
          <div className="flex items-center gap-3 mt-2 pt-1.5 border-t border-gray-700/50">
            {msg.confidenceScore !== undefined && (
              <span className="text-xs text-gray-500">
                Conf: {(msg.confidenceScore * 100).toFixed(0)}%
              </span>
            )}
            {msg.latencyMs && (
              <span className="text-xs text-gray-500">{msg.latencyMs}ms</span>
            )}
            {msg.tokensUsed && (
              <span className="text-xs text-gray-500">{msg.tokensUsed} tok</span>
            )}
            {msg.feedback && (
              <span className={clsx('text-xs flex items-center gap-1',
                msg.feedback === 'positive' ? 'text-green-400' : 'text-red-400')}>
                {msg.feedback === 'positive'
                  ? <ThumbsUp size={10} />
                  : <ThumbsDown size={10} />
                }
                {msg.feedback}
              </span>
            )}
          </div>
        )}
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
              {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''}
            </summary>
            <div className="mt-1 space-y-1">
              {msg.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs text-blue-400 hover:underline truncate"
                >
                  {s.title || s.url}
                </a>
              ))}
            </div>
          </details>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-300 flex-shrink-0">
          U
        </div>
      )}
    </div>
  )
}
