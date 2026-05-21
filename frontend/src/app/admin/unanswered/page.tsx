'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  HelpCircle, RefreshCw, Trash2, CheckCircle, XCircle,
  Clock, Eye, CheckSquare, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { getPgUnanswered, updatePgUnanswered, deletePgUnanswered } from '../../../lib/api'

type Status = 'pending' | 'reviewed' | 'resolved'

const STATUS_TABS: { value: Status | ''; label: string; color: string }[] = [
  { value: '',          label: 'All',      color: 'text-gray-300' },
  { value: 'pending',   label: 'Pending',  color: 'text-yellow-300' },
  { value: 'reviewed',  label: 'Reviewed', color: 'text-blue-300' },
  { value: 'resolved',  label: 'Resolved', color: 'text-green-300' },
]

const STATUS_BADGE: Record<string, string> = {
  pending:  'bg-yellow-900/50 text-yellow-300 border-yellow-800',
  reviewed: 'bg-blue-900/50 text-blue-300 border-blue-800',
  resolved: 'bg-green-900/50 text-green-300 border-green-800',
}

interface UnansweredQ {
  id: string
  question: string
  language: string
  status: Status
  admin_note?: string
  created_at: string
  updated_at?: string
}

export default function UnansweredPage() {
  const [tab, setTab] = useState<Status | ''>('')
  const [items, setItems] = useState<UnansweredQ[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const PER_PAGE = 20
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getPgUnanswered(page, tab || undefined)
      setItems(r.data.data ?? r.data.items ?? [])
      setTotal(r.data.total ?? 0)
    } catch {
      showToast('Failed to load questions', false)
    } finally {
      setLoading(false)
    }
  }, [page, tab])

  useEffect(() => { load() }, [load])

  const handleTabChange = (t: Status | '') => {
    setTab(t)
    setPage(1)
  }

  const handleUpdateStatus = async (id: string, status: Status) => {
    try {
      await updatePgUnanswered(id, { status })
      showToast(`Marked as ${status}`)
      load()
    } catch {
      showToast('Update failed', false)
    }
  }

  const handleSaveNote = async (id: string) => {
    setSaving(true)
    try {
      await updatePgUnanswered(id, { admin_note: noteText })
      showToast('Note saved')
      setEditId(null)
      load()
    } catch {
      showToast('Failed to save note', false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, question: string) => {
    if (!confirm(`Delete "${question.slice(0, 60)}…"?`)) return
    try {
      await deletePgUnanswered(id)
      showToast('Deleted')
      load()
    } catch {
      showToast('Delete failed', false)
    }
  }

  const startEdit = (item: UnansweredQ) => {
    setEditId(item.id)
    setNoteText(item.admin_note ?? '')
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <HelpCircle className="text-yellow-400" size={24} />
          <div>
            <h1 className="text-xl font-bold text-white">Unanswered Questions</h1>
            <p className="text-sm text-gray-400">
              Questions the bot couldn't answer — review and resolve
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${
          toast.ok ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'
        }`}>
          {toast.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-800">
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => handleTabChange(value)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
              tab === value
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center text-xs text-gray-600 pb-2">
          {total} question{total !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <HelpCircle size={40} className="mx-auto mb-3 opacity-30" />
          <p>No questions in this status</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div
              key={item.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3"
            >
              {/* Question row */}
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-white text-sm font-medium leading-relaxed">
                    {item.question}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                      STATUS_BADGE[item.status] ?? STATUS_BADGE.pending
                    }`}>
                      {item.status === 'pending'  && <Clock size={10} />}
                      {item.status === 'reviewed' && <Eye size={10} />}
                      {item.status === 'resolved' && <CheckSquare size={10} />}
                      {item.status}
                    </span>
                    <span className="text-xs text-gray-600">
                      {item.language?.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-600">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {item.status !== 'reviewed' && (
                    <button
                      onClick={() => handleUpdateStatus(item.id, 'reviewed')}
                      title="Mark reviewed"
                      className="p-1.5 text-blue-400 hover:bg-blue-900/30 rounded transition"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  {item.status !== 'resolved' && (
                    <button
                      onClick={() => handleUpdateStatus(item.id, 'resolved')}
                      title="Mark resolved"
                      className="p-1.5 text-green-400 hover:bg-green-900/30 rounded transition"
                    >
                      <CheckSquare size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(item)}
                    title="Add / edit note"
                    className="p-1.5 text-gray-400 hover:bg-gray-800 rounded transition text-xs font-medium px-2"
                  >
                    Note
                  </button>
                  <button
                    onClick={() => handleDelete(item.id, item.question)}
                    title="Delete"
                    className="p-1.5 text-red-400 hover:bg-red-900/30 rounded transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Admin note display */}
              {item.admin_note && editId !== item.id && (
                <div className="bg-gray-800/60 rounded-lg px-3 py-2 text-xs text-gray-400 border-l-2 border-blue-700">
                  <span className="text-blue-400 font-medium">Note: </span>
                  {item.admin_note}
                </div>
              )}

              {/* Edit note inline */}
              {editId === item.id && (
                <div className="space-y-2">
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="Add admin note or resolution…"
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveNote(item.id)}
                      disabled={saving}
                      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-lg transition disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save Note'}
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-gray-400">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
