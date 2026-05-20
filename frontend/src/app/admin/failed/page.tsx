'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle, RefreshCcw, ChevronLeft, ChevronRight,
  Globe, Calendar, TrendingDown, Info,
} from 'lucide-react'
import { getFailed } from '../../../lib/api'
import clsx from 'clsx'

interface FailedItem {
  _id: string
  sessionId: string
  question: string
  score: number
  language: string
  date: string
}

function fDate(d: string) {
  return new Date(d).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

function ConfidencePill({ score }: { score: number }) {
  const pct  = Math.round((score ?? 0) * 100)
  const cls  = pct < 10 ? 'bg-red-900/40 text-red-300 border-red-800/50'
             : pct < 20 ? 'bg-orange-900/40 text-orange-300 border-orange-800/50'
             :             'bg-yellow-900/40 text-yellow-300 border-yellow-800/50'
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      <TrendingDown size={10} />
      {pct}%
    </span>
  )
}

export default function FailedPage() {
  const [items, setItems]     = useState<FailedItem[]>([])
  const [page, setPage]       = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async (p = page) => {
    setLoading(true)
    try {
      const res = await getFailed(p)
      const data: FailedItem[] = res.data
      setItems(data)
      setHasMore(data.length === 20) // backend returns up to 20
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(page) }, [page])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            Failed &amp; Low-Confidence Q&amp;A
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Responses where the AI had less than 30% confidence — useful for training improvements.
          </p>
        </div>
        <button
          onClick={() => load(page)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition"
        >
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
        <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-300">
          These questions had a RAG confidence score below 30%. To improve accuracy,{' '}
          upload relevant documents in <strong>Documents</strong> or trigger a fresh crawl
          in <strong>Training</strong>.
        </p>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left px-5 py-3 w-8">#</th>
              <th className="text-left px-5 py-3">Question / Response</th>
              <th className="text-left px-5 py-3">Confidence</th>
              <th className="text-left px-5 py-3">Language</th>
              <th className="text-left px-5 py-3">Date</th>
              <th className="text-left px-5 py-3">Session</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-gray-600">
                  <RefreshCcw size={18} className="animate-spin mx-auto" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle size={32} className="text-green-500 opacity-60" />
                    <p className="text-green-400 font-medium">No low-confidence responses!</p>
                    <p className="text-xs text-gray-600">The AI is performing well on all queries.</p>
                  </div>
                </td>
              </tr>
            ) : items.map((item, i) => (
              <tr key={item._id || i} className="hover:bg-gray-800/30 transition">
                <td className="px-5 py-3 text-gray-600 text-xs">
                  {(page - 1) * 20 + i + 1}
                </td>
                <td className="px-5 py-4 max-w-md">
                  <p className={clsx(
                    'leading-relaxed text-sm',
                    item.language === 'ar' ? 'text-right font-arabic' : '',
                    'text-gray-200',
                  )} dir={item.language === 'ar' ? 'rtl' : 'ltr'}>
                    {item.question?.length > 200
                      ? `${item.question.substring(0, 200)}…`
                      : item.question || '—'}
                  </p>
                </td>
                <td className="px-5 py-3">
                  <ConfidencePill score={item.score} />
                </td>
                <td className="px-5 py-3">
                  <span className={clsx(
                    'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
                    item.language === 'ar'
                      ? 'bg-purple-900/40 text-purple-300'
                      : 'bg-blue-900/40 text-blue-300',
                  )}>
                    <Globe size={10} />
                    {item.language?.toUpperCase() || 'EN'}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {item.date ? (
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={10} />
                      {fDate(item.date)}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-5 py-3 font-mono text-xs text-gray-600">
                  {item.sessionId ? `${item.sessionId.slice(0, 10)}…` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {items.length > 0
            ? `Showing ${(page - 1) * 20 + 1}–${(page - 1) * 20 + items.length}`
            : 'No results'}
        </span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <button
            disabled={!hasMore}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Tips */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">How to Improve AI Accuracy</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-400">
          <div className="flex gap-2">
            <span className="text-blue-400 font-bold">1.</span>
            <span>Go to <strong className="text-gray-300">Documents</strong> and upload relevant PDFs, annual reports, or FAQ documents.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400 font-bold">2.</span>
            <span>Go to <strong className="text-gray-300">Training</strong> and trigger a fresh crawl of www.msx.om to update the knowledge base.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400 font-bold">3.</span>
            <span>Increase <code className="text-blue-300">RAG_TOP_K</code> in your <code className="text-blue-300">.env</code> to retrieve more context chunks per query.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
