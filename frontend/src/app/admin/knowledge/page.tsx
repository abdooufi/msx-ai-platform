'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Database, RefreshCcw, Trash2, Play, CheckCircle2,
  AlertCircle, Loader2, ChevronLeft, ChevronRight,
  Search, Plus, Pencil, X, Save, BookOpen, HelpCircle,
  Globe, Building2, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getIndexStatus, indexAllTables, indexTable, clearTableIndex,
  getPgKnowledge, upsertPgKnowledge, deletePgKnowledge,
  getPgFaqs, upsertPgFaq, deletePgFaq,
  getPgCompanies, upsertPgCompany, deletePgCompany,
  getPgApiEndpoints, upsertPgApiEndpoint, deletePgApiEndpoint,
  getPgSummary,
} from '../../../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type IndexableTable = 'knowledge_base' | 'faqs' | 'api_endpoints' | 'companies'

interface TableIndexStatus {
  table: IndexableTable
  pgRows: number
  indexedChunks: number
  status: 'idle' | 'indexing' | 'done' | 'error'
  progress: number
  lastRun?: string
  error?: string
}

type ActiveTab = 'index' | 'knowledge' | 'faqs' | 'companies' | 'api_endpoints'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TABLE_META: Record<IndexableTable, { label: string; icon: React.ReactNode; color: string }> = {
  knowledge_base: { label: 'Knowledge Base', icon: <BookOpen size={18} />, color: 'blue' },
  faqs:           { label: 'FAQs',           icon: <HelpCircle size={18} />, color: 'purple' },
  api_endpoints:  { label: 'API Endpoints',  icon: <Zap size={18} />, color: 'orange' },
  companies:      { label: 'Companies',      icon: <Building2 size={18} />, color: 'teal' },
}

const colorCls = {
  blue:   { ring: 'border-blue-500/30',   badge: 'bg-blue-500/10 text-blue-300',   bar: 'bg-blue-500' },
  purple: { ring: 'border-purple-500/30', badge: 'bg-purple-500/10 text-purple-300', bar: 'bg-purple-500' },
  orange: { ring: 'border-orange-500/30', badge: 'bg-orange-500/10 text-orange-300', bar: 'bg-orange-500' },
  teal:   { ring: 'border-teal-500/30',   badge: 'bg-teal-500/10 text-teal-300',   bar: 'bg-teal-500' },
}

function StatusBadge({ status }: { status: TableIndexStatus['status'] }) {
  if (status === 'indexing') return (
    <span className="flex items-center gap-1 text-yellow-400 text-xs font-medium">
      <Loader2 size={12} className="animate-spin" /> Indexing…
    </span>
  )
  if (status === 'done') return (
    <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
      <CheckCircle2 size={12} /> Done
    </span>
  )
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
      <AlertCircle size={12} /> Error
    </span>
  )
  return <span className="text-gray-500 text-xs font-medium">Idle</span>
}

// ─── Index Status Panel ───────────────────────────────────────────────────────

function IndexPanel() {
  const [statuses, setStatuses] = useState<TableIndexStatus[]>([])
  const [polling, setPolling] = useState(false)
  const [triggering, setTriggering] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data } = await getIndexStatus()
      setStatuses(data)
    } catch { /* silent */ }
  }, [])

  // Auto-poll while any table is indexing
  useEffect(() => {
    load()
    const id = setInterval(() => {
      if (statuses.some(s => s.status === 'indexing')) load()
    }, 2000)
    return () => clearInterval(id)
  }, [load, statuses])

  const handleIndexAll = async () => {
    setTriggering('all')
    try {
      await indexAllTables()
      toast.success('Full re-index started')
      setTimeout(load, 500)
    } catch {
      toast.error('Failed to start indexing')
    } finally {
      setTriggering(null)
    }
  }

  const handleIndexOne = async (table: IndexableTable) => {
    setTriggering(table)
    try {
      await indexTable(table)
      toast.success(`Indexing started: ${TABLE_META[table].label}`)
      setTimeout(load, 500)
    } catch {
      toast.error('Failed to start indexing')
    } finally {
      setTriggering(null)
    }
  }

  const handleClear = async (table: IndexableTable) => {
    if (!confirm(`Clear all Qdrant vectors for "${TABLE_META[table].label}"?`)) return
    try {
      await clearTableIndex(table)
      toast.success(`Cleared: ${TABLE_META[table].label}`)
      load()
    } catch {
      toast.error('Failed to clear index')
    }
  }

  const anyIndexing = statuses.some(s => s.status === 'indexing')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Qdrant Vector Index</h2>
          <p className="text-sm text-gray-400 mt-0.5">Sync PostgreSQL data into Qdrant for AI search</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCcw size={15} />
          </button>
          <button
            onClick={handleIndexAll}
            disabled={!!triggering || anyIndexing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {triggering === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Index All Tables
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {((['knowledge_base', 'faqs', 'api_endpoints', 'companies'] as IndexableTable[]).map(table => {
          const meta = TABLE_META[table]
          const st = statuses.find(s => s.table === table)
          const clr = colorCls[meta.color as keyof typeof colorCls]

          return (
            <div key={table} className={`bg-white/5 border ${clr.ring} rounded-xl p-4 space-y-3`}>
              {/* Title row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`p-1.5 rounded-lg ${clr.badge}`}>{meta.icon}</span>
                  <span className="font-medium text-white text-sm">{meta.label}</span>
                </div>
                {st && <StatusBadge status={st.status} />}
              </div>

              {/* Stats */}
              {st && (
                <div className="flex gap-4 text-xs text-gray-400">
                  <span><span className="text-white font-medium">{st.pgRows.toLocaleString()}</span> PG rows</span>
                  <span><span className="text-white font-medium">{st.indexedChunks.toLocaleString()}</span> vectors</span>
                  {st.lastRun && (
                    <span className="ml-auto">
                      Last: {new Date(st.lastRun).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              )}

              {/* Progress bar */}
              {st && (
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${clr.bar} transition-all duration-500`}
                    style={{ width: `${st.progress}%` }}
                  />
                </div>
              )}

              {/* Error */}
              {st?.error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{st.error}</p>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleIndexOne(table)}
                  disabled={!!triggering || anyIndexing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {triggering === table ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  Index
                </button>
                <button
                  onClick={() => handleClear(table)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg text-xs font-medium transition-colors"
                >
                  <Trash2 size={12} /> Clear
                </button>
              </div>
            </div>
          )
        }))}
      </div>
    </div>
  )
}

// ─── Knowledge Base Panel ─────────────────────────────────────────────────────

function KnowledgePanel() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const LIMIT = 10

  const load = async (p = page, q = search) => {
    setLoading(true)
    try {
      const { data } = await getPgKnowledge(p, LIMIT, undefined, q || undefined)
      setRows(data.data || [])
      setTotal(data.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1, search) }, []) // eslint-disable-line

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    load(1, search)
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await upsertPgKnowledge(editing)
      toast.success(editing.id ? 'Updated' : 'Created')
      setEditing(null)
      load()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this knowledge entry?')) return
    try {
      await deletePgKnowledge(id)
      toast.success('Deleted')
      load()
    } catch {
      toast.error('Delete failed')
    }
  }

  const pages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search knowledge base…"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
            Search
          </button>
        </form>
        <button
          onClick={() => setEditing({ title: '', content: '', category: '', source: '', tags: [] })}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Title</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Category</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Preview</th>
                <th className="px-4 py-3 text-gray-400 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white font-medium max-w-[180px] truncate">{row.title}</td>
                  <td className="px-4 py-3">
                    {row.category && (
                      <span className="text-xs bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded-full">{row.category}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-[300px] truncate text-xs">{row.content}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => setEditing({ ...row })} className="text-blue-400 hover:text-blue-300">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(row.id)} className="text-red-400 hover:text-red-300">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={4} className="text-center text-gray-500 py-8">No entries found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{total.toLocaleString()} entries</span>
          <div className="flex gap-2">
            <button onClick={() => { setPage(p => Math.max(1, p - 1)); load(Math.max(1, page - 1), search) }}
              disabled={page <= 1} className="p-1 disabled:opacity-40 hover:text-white">
              <ChevronLeft size={16} />
            </button>
            <span className="text-white">Page {page} / {pages}</span>
            <button onClick={() => { setPage(p => Math.min(pages, p + 1)); load(Math.min(pages, page + 1), search) }}
              disabled={page >= pages} className="p-1 disabled:opacity-40 hover:text-white">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">{editing.id ? 'Edit Entry' : 'New Entry'}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Title *</label>
                <input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Category</label>
                <input value={editing.category || ''} onChange={e => setEditing({ ...editing, category: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Content *</label>
                <textarea rows={8} value={editing.content || ''} onChange={e => setEditing({ ...editing, content: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Source URL</label>
                  <input value={editing.source || ''} onChange={e => setEditing({ ...editing, source: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tags (comma separated)</label>
                  <input
                    value={Array.isArray(editing.tags) ? editing.tags.join(', ') : (editing.tags || '')}
                    onChange={e => setEditing({ ...editing, tags: e.target.value.split(',').map((t: string) => t.trim()).filter(Boolean) })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FAQs Panel ───────────────────────────────────────────────────────────────

function FaqsPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const LIMIT = 10

  const load = async (p = page) => {
    setLoading(true)
    try {
      const { data } = await getPgFaqs(p, LIMIT)
      setRows(data.data || [])
      setTotal(data.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1) }, []) // eslint-disable-line

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await upsertPgFaq(editing)
      toast.success(editing.id ? 'Updated' : 'Created')
      setEditing(null)
      load()
    } catch { toast.error('Save failed') } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this FAQ?')) return
    try { await deletePgFaq(id); toast.success('Deleted'); load() }
    catch { toast.error('Delete failed') }
  }

  const pages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setEditing({ question: '', answer: '', category: '', is_active: true })}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">
          <Plus size={14} /> Add FAQ
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Question</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Answer</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Category</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Active</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white max-w-[220px] truncate">{row.question}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-[280px] truncate">{row.answer}</td>
                  <td className="px-4 py-3">
                    {row.category && <span className="text-xs bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded-full">{row.category}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${row.is_active ? 'bg-green-500/10 text-green-300' : 'bg-gray-500/10 text-gray-400'}`}>
                      {row.is_active ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => setEditing({ ...row })} className="text-blue-400 hover:text-blue-300"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(row.id)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="text-center text-gray-500 py-8">No FAQs found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{total} FAQs</span>
          <div className="flex gap-2">
            <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); load(p) }} disabled={page <= 1} className="p-1 disabled:opacity-40 hover:text-white"><ChevronLeft size={16} /></button>
            <span className="text-white">Page {page} / {pages}</span>
            <button onClick={() => { const p = Math.min(pages, page + 1); setPage(p); load(p) }} disabled={page >= pages} className="p-1 disabled:opacity-40 hover:text-white"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">{editing.id ? 'Edit FAQ' : 'New FAQ'}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Question *</label>
                <input value={editing.question || ''} onChange={e => setEditing({ ...editing, question: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Answer *</label>
                <textarea rows={5} value={editing.answer || ''} onChange={e => setEditing({ ...editing, answer: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Category</label>
                  <input value={editing.category || ''} onChange={e => setEditing({ ...editing, category: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })}
                      className="w-4 h-4 rounded accent-purple-500" />
                    <span className="text-sm text-gray-300">Active</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Companies Panel ──────────────────────────────────────────────────────────

function CompaniesPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const LIMIT = 20

  const load = async (p = page, q = search) => {
    setLoading(true)
    try {
      const { data } = await getPgCompanies(p, LIMIT, q || undefined)
      setRows(data.data || [])
      setTotal(data.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1, '') }, []) // eslint-disable-line

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await upsertPgCompany(editing)
      toast.success(editing.id ? 'Updated' : 'Created')
      setEditing(null); load()
    } catch { toast.error('Save failed') } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this company?')) return
    try { await deletePgCompany(id); toast.success('Deleted'); load() }
    catch { toast.error('Delete failed') }
  }

  const pages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <form onSubmit={e => { e.preventDefault(); setPage(1); load(1, search) }} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies…"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-500" />
          </div>
          <button type="submit" className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm">Search</button>
        </form>
        <button onClick={() => setEditing({ name: '', symbol: '', description: '', sector: '', website: '' })}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">
          <Plus size={14} /> Add
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Symbol</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Sector</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Website</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{row.name}</td>
                  <td className="px-4 py-3"><span className="text-xs font-mono bg-teal-500/10 text-teal-300 px-2 py-0.5 rounded">{row.symbol}</span></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{row.sector}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.website && <a href={row.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1"><Globe size={11} />{row.website.replace(/^https?:\/\//, '')}</a>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => setEditing({ ...row })} className="text-blue-400 hover:text-blue-300"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(row.id)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="text-center text-gray-500 py-8">No companies found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{total.toLocaleString()} companies</span>
          <div className="flex gap-2">
            <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); load(p, search) }} disabled={page <= 1} className="p-1 disabled:opacity-40 hover:text-white"><ChevronLeft size={16} /></button>
            <span className="text-white">Page {page} / {pages}</span>
            <button onClick={() => { const p = Math.min(pages, page + 1); setPage(p); load(p, search) }} disabled={page >= pages} className="p-1 disabled:opacity-40 hover:text-white"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">{editing.id ? 'Edit Company' : 'New Company'}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {[
                { k: 'name',        label: 'Company Name *', col: 2 },
                { k: 'symbol',      label: 'Ticker Symbol', col: 1 },
                { k: 'sector',      label: 'Sector', col: 1 },
                { k: 'website',     label: 'Website URL', col: 2 },
                { k: 'founded',     label: 'Founded Year', col: 1 },
              ].map(({ k, label, col }) => (
                <div key={k} className={col === 2 ? 'col-span-2' : ''}>
                  <label className="block text-xs text-gray-400 mb-1">{label}</label>
                  <input value={(editing as any)[k] || ''} onChange={e => setEditing({ ...editing, [k]: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea rows={4} value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── API Endpoints Panel ──────────────────────────────────────────────────────

function ApiEndpointsPanel() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const LIMIT = 15

  const load = async (p = page) => {
    setLoading(true)
    try {
      const { data } = await getPgApiEndpoints(p, LIMIT)
      setRows(data.data || [])
      setTotal(data.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) }, []) // eslint-disable-line

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await upsertPgApiEndpoint(editing)
      toast.success(editing.id ? 'Updated' : 'Created')
      setEditing(null); load()
    } catch { toast.error('Save failed') } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this API endpoint?')) return
    try { await deletePgApiEndpoint(id); toast.success('Deleted'); load() }
    catch { toast.error('Delete failed') }
  }

  const pages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setEditing({ name: '', url: '', method: 'GET', description: '', category: '', keywords_en: [], keywords_ar: [], is_active: true })}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">
          <Plus size={14} /> Add Endpoint
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Method</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">URL</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Category</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                      row.method === 'GET' ? 'bg-green-500/10 text-green-300' :
                      row.method === 'POST' ? 'bg-blue-500/10 text-blue-300' :
                      row.method === 'PUT' ? 'bg-yellow-500/10 text-yellow-300' :
                      'bg-red-500/10 text-red-300'
                    }`}>{row.method || 'GET'}</span>
                  </td>
                  <td className="px-4 py-3 text-white font-medium max-w-[160px] truncate">{row.name}</td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs max-w-[220px] truncate">{row.url}</td>
                  <td className="px-4 py-3">
                    {row.category && <span className="text-xs bg-orange-500/10 text-orange-300 px-2 py-0.5 rounded-full">{row.category}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => setEditing({ ...row })} className="text-blue-400 hover:text-blue-300"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(row.id)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="text-center text-gray-500 py-8">No endpoints found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{total} endpoints</span>
          <div className="flex gap-2">
            <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); load(p) }} disabled={page <= 1} className="p-1 disabled:opacity-40 hover:text-white"><ChevronLeft size={16} /></button>
            <span className="text-white">Page {page} / {pages}</span>
            <button onClick={() => { const p = Math.min(pages, page + 1); setPage(p); load(p) }} disabled={page >= pages} className="p-1 disabled:opacity-40 hover:text-white"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-semibold text-white">{editing.id ? 'Edit Endpoint' : 'New Endpoint'}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Name *</label>
                  <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Method</label>
                  <select value={editing.method || 'GET'} onChange={e => setEditing({ ...editing, method: e.target.value })}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500">
                    {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">URL *</label>
                <input value={editing.url || ''} onChange={e => setEditing({ ...editing, url: e.target.value })}
                  placeholder="https://api.example.com/endpoint"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea rows={3} value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Category</label>
                  <input value={editing.category || ''} onChange={e => setEditing({ ...editing, category: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Keywords EN</label>
                  <input
                    value={Array.isArray(editing.keywords_en) ? editing.keywords_en.join(', ') : ''}
                    onChange={e => setEditing({ ...editing, keywords_en: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
  { id: 'index',        label: 'Vector Index',   icon: <Database size={15} /> },
  { id: 'knowledge',    label: 'Knowledge Base',  icon: <BookOpen size={15} /> },
  { id: 'faqs',         label: 'FAQs',            icon: <HelpCircle size={15} /> },
  { id: 'companies',    label: 'Companies',       icon: <Building2 size={15} /> },
  { id: 'api_endpoints', label: 'API Endpoints',  icon: <Zap size={15} /> },
]

export default function KnowledgePage() {
  const [tab, setTab] = useState<ActiveTab>('index')
  const [summary, setSummary] = useState<Record<string, number>>({})

  useEffect(() => {
    getPgSummary().then(r => setSummary(r.data || {})).catch(() => {})
  }, [])

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Database size={24} className="text-blue-400" />
          Knowledge Management
        </h1>
        <p className="text-gray-400 mt-1 text-sm">
          Manage PostgreSQL data and control Qdrant vector indexing for AI search
        </p>
      </div>

      {/* Summary Pills */}
      {Object.keys(summary).length > 0 && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(summary).map(([table, count]) => (
            <div key={table} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2 text-sm">
              <span className="text-gray-400 capitalize">{table.replace(/_/g, ' ')}</span>
              <span className="text-white font-semibold">{(count as number).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        {tab === 'index'        && <IndexPanel />}
        {tab === 'knowledge'    && <KnowledgePanel />}
        {tab === 'faqs'         && <FaqsPanel />}
        {tab === 'companies'    && <CompaniesPanel />}
        {tab === 'api_endpoints' && <ApiEndpointsPanel />}
      </div>
    </div>
  )
}
