'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, Database, Trash2, RefreshCw, ChevronRight, ChevronLeft,
  ExternalLink, SlidersHorizontal, Layers, X, AlertCircle,
  Globe, FileText, HelpCircle, Building2, BookOpen,
  Camera, Clock, CalendarClock, Check, ChevronDown, ChevronUp,
  ShieldAlert, FlaskConical, CheckCircle2, XCircle, Zap,
} from 'lucide-react'
import {
  listQdrantCollections, searchQdrant, browseQdrant, deleteQdrantPoint,
  createQdrantSnapshot, listQdrantSnapshots, deleteQdrantSnapshot,
  getQdrantSnapshotSchedule, setQdrantSnapshotSchedule, cancelQdrantSnapshotSchedule,
  deleteAllQdrantData, testRagQuery,
} from '../../../lib/api'
import { useAuthStore } from '../../../lib/store'
import clsx from 'clsx'

// ─── Types ───────────────────────────────────────────────────────

interface Collection {
  name: string; vectors: number; isCompany: boolean; symbol: string | null; status: string
}

interface QdrantResult {
  id: string; score: number; collection: string
  payload: {
    title?: string; content?: string; url?: string; type?: string
    language?: string; companySymbol?: string; crawledAt?: string
    chunkIndex?: number; sourceId?: string; [key: string]: any
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  website:        'bg-blue-900/40 text-blue-300 border-blue-700/40',
  document:       'bg-purple-900/40 text-purple-300 border-purple-700/40',
  faq:            'bg-green-900/40 text-green-300 border-green-700/40',
  knowledge_base: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40',
  api:            'bg-pink-900/40 text-pink-300 border-pink-700/40',
}
const TYPE_ICONS: Record<string, any> = {
  website: Globe, document: FileText, faq: HelpCircle,
  knowledge_base: BookOpen, api: Building2,
}

function TypeBadge({ type }: { type?: string }) {
  const t    = type || 'website'
  const cls  = TYPE_COLORS[t] ?? 'bg-gray-800 text-gray-400 border-gray-700'
  const Icon = TYPE_ICONS[t] ?? Globe
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border font-medium', cls)}>
      <Icon size={9} />
      {t}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const cls = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-orange-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-orange-500')}
          style={{ width: `${pct}%` }} />
      </div>
      <span className={clsx('text-xs font-mono font-bold tabular-nums', cls)}>{score.toFixed(3)}</span>
    </div>
  )
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

// ─── Main Page ───────────────────────────────────────────────────

export default function QdrantPage() {
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'super_admin'

  // ── Collections ───────────────────────────────────────────────
  const [collections, setCollections]   = useState<Collection[]>([])
  const [colLoading,  setColLoading]    = useState(true)
  const [colSearch,   setColSearch]     = useState('')
  const [showAllCols, setShowAllCols]   = useState(false)

  // ── Delete all (super_admin) ──────────────────────────────────
  const [deleteAllOpen,      setDeleteAllOpen]      = useState(false)
  const [deleteAllConfirm,   setDeleteAllConfirm]   = useState('')
  const [deletingAll,        setDeletingAll]        = useState(false)
  const [deleteAllMsg,       setDeleteAllMsg]       = useState('')

  // ── Search mode ───────────────────────────────────────────────
  const [mode,        setMode]          = useState<'search' | 'browse'>('search')
  const [query,       setQuery]         = useState('')
  const [collection,  setCollection]    = useState('')    // '' = all
  const [topK,        setTopK]          = useState(10)
  const [threshold,   setThreshold]     = useState(0.2)
  const [filterType,  setFilterType]    = useState('')
  const [filterLang,  setFilterLang]    = useState('')
  const [showFilters, setShowFilters]   = useState(false)

  // ── Results ───────────────────────────────────────────────────
  const [results,     setResults]       = useState<QdrantResult[]>([])
  const [total,       setTotal]         = useState(0)
  const [queryMs,     setQueryMs]       = useState(0)
  const [loading,     setLoading]       = useState(false)
  const [error,       setError]         = useState('')

  // ── Browse mode ───────────────────────────────────────────────
  const [browseCol,   setBrowseCol]     = useState('')
  const [browseItems, setBrowseItems]   = useState<any[]>([])
  const [browseOffset,setBrowseOffset]  = useState<string | undefined>()
  const [browsePrev,  setBrowsePrev]    = useState<string[]>([])
  const [browseLoad,  setBrowseLoad]    = useState(false)

  // ── Expanded result ───────────────────────────────────────────
  const [expanded,    setExpanded]      = useState<string | null>(null)
  const [deleting,    setDeleting]      = useState<string | null>(null)

  // ── Snapshots ─────────────────────────────────────────────────
  const [snapshotOpen,      setSnapshotOpen]      = useState(false)
  const [snapshotTarget,    setSnapshotTarget]    = useState('')   // '' = all
  const [snapshotting,      setSnapshotting]      = useState(false)
  const [snapshotMsg,       setSnapshotMsg]       = useState('')
  const [snapList,          setSnapList]          = useState<any[]>([])
  const [snapListCol,       setSnapListCol]       = useState('')
  const [snapListLoading,   setSnapListLoading]   = useState(false)
  const [deletingSnap,      setDeletingSnap]      = useState<string | null>(null)

  // Schedule
  const [schedOpen,         setSchedOpen]         = useState(false)
  const [schedInfo,         setSchedInfo]         = useState<{ active: boolean; cron?: string; nextRunAt?: string } | null>(null)
  const [schedLoading,      setSchedLoading]      = useState(false)
  const [customCron,        setCustomCron]        = useState('')
  const [schedSaving,       setSchedSaving]       = useState(false)
  const [schedMsg,          setSchedMsg]          = useState('')

  // ── RAG Test Query (Feature #9) ──────────────────────────────
  const [testOpen,        setTestOpen]       = useState(false)
  const [testQuery,       setTestQuery]      = useState('')
  const [testLang,        setTestLang]       = useState('en')
  const [testSymbol,      setTestSymbol]     = useState('')
  const [testLoading,     setTestLoading]    = useState(false)
  const [testResult,      setTestResult]     = useState<any>(null)
  const [testError,       setTestError]      = useState('')

  const handleTestQuery = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!testQuery.trim()) return
    setTestLoading(true); setTestError(''); setTestResult(null)
    try {
      const r = await testRagQuery({
        query:          testQuery.trim(),
        language:       testLang,
        companySymbol:  testSymbol.trim() || undefined,
      })
      setTestResult(r.data)
    } catch (err: any) {
      setTestError(err.friendlyMessage || err.message || 'Test query failed')
    } finally {
      setTestLoading(false)
    }
  }

  // ── Load collections ──────────────────────────────────────────
  const loadCollections = useCallback(async () => {
    setColLoading(true)
    try {
      const r = await listQdrantCollections()
      setCollections(r.data)
    } catch { setCollections([]) }
    finally { setColLoading(false) }
  }, [])

  useEffect(() => { loadCollections() }, [loadCollections])

  // ── Semantic search ───────────────────────────────────────────
  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true); setError(''); setResults([])
    try {
      const r = await searchQdrant({
        query:          query.trim(),
        collection:     collection || undefined,
        topK,
        scoreThreshold: threshold,
        filterType:     filterType || undefined,
        filterLanguage: filterLang || undefined,
      })
      setResults(r.data.results)
      setTotal(r.data.total)
      setQueryMs(r.data.queryMs)
      if (r.data.error) setError(r.data.error)
    } catch (err: any) {
      setError(err.friendlyMessage || err.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, collection, topK, threshold, filterType, filterLang])

  // ── Browse ────────────────────────────────────────────────────
  const loadBrowse = useCallback(async (col: string, offset?: string, pushHistory = true) => {
    setBrowseLoad(true)
    try {
      const r = await browseQdrant(col || undefined, 20, offset)
      setBrowseItems(r.data.points)
      setBrowseOffset(r.data.nextOffset ?? undefined)
      if (pushHistory && offset) setBrowsePrev(prev => [...prev, offset])
    } catch { setBrowseItems([]) }
    finally { setBrowseLoad(false) }
  }, [])

  useEffect(() => {
    if (mode === 'browse') {
      setBrowsePrev([]); setBrowseOffset(undefined)
      loadBrowse(browseCol)
    }
  }, [mode, browseCol, loadBrowse])

  // ── Delete point ──────────────────────────────────────────────
  const handleDelete = async (id: string, col: string) => {
    if (!confirm('Delete this vector? This cannot be undone.')) return
    setDeleting(id)
    try {
      await deleteQdrantPoint(id, col)
      setResults(prev => prev.filter(r => r.id !== id))
      setBrowseItems(prev => prev.filter(p => p.id !== id))
      await loadCollections()
    } catch (err: any) {
      alert(err.friendlyMessage || 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  // ── Snapshot handlers ─────────────────────────────────────────
  const handleCreateSnapshot = useCallback(async () => {
    setSnapshotting(true); setSnapshotMsg('')
    try {
      const r = await createQdrantSnapshot(snapshotTarget || undefined)
      const { total, snapshots } = r.data
      const failed = (snapshots as any[]).filter(s => s.error).length
      setSnapshotMsg(failed
        ? `⚠️ ${total - failed}/${total} snapshot(s) created — ${failed} failed`
        : `✅ ${total} snapshot(s) created successfully`)
      // Refresh list if we're viewing that collection
      if (snapListCol) loadSnapList(snapListCol)
    } catch (e: any) {
      setSnapshotMsg(`❌ ${e.friendlyMessage || e.message || 'Snapshot failed'}`)
    } finally {
      setSnapshotting(false)
    }
  }, [snapshotTarget, snapListCol])

  const loadSnapList = useCallback(async (col: string) => {
    if (!col) return
    setSnapListLoading(true); setSnapList([])
    try {
      const r = await listQdrantSnapshots(col)
      setSnapList(r.data.snapshots || [])
    } catch { setSnapList([]) }
    finally { setSnapListLoading(false) }
  }, [])

  useEffect(() => {
    if (snapshotOpen && snapListCol) loadSnapList(snapListCol)
  }, [snapshotOpen, snapListCol, loadSnapList])

  const handleDeleteSnap = async (col: string, name: string) => {
    if (!confirm(`Delete snapshot "${name}"?`)) return
    setDeletingSnap(name)
    try {
      await deleteQdrantSnapshot(col, name)
      setSnapList(prev => prev.filter(s => s.name !== name))
    } catch (e: any) {
      alert(e.friendlyMessage || 'Delete failed')
    } finally {
      setDeletingSnap(null)
    }
  }

  const loadSchedule = useCallback(async () => {
    setSchedLoading(true)
    try {
      const r = await getQdrantSnapshotSchedule()
      setSchedInfo(r.data)
      if (r.data?.cron) setCustomCron(r.data.cron)
    } catch { setSchedInfo({ active: false }) }
    finally { setSchedLoading(false) }
  }, [])

  useEffect(() => {
    if (schedOpen) loadSchedule()
  }, [schedOpen, loadSchedule])

  const handleSetSchedule = async (cron: string) => {
    setSchedSaving(true); setSchedMsg('')
    try {
      const r = await setQdrantSnapshotSchedule(cron)
      setSchedInfo(r.data)
      setCustomCron(r.data.cron || cron)
      setSchedMsg('✅ Schedule saved')
    } catch (e: any) {
      setSchedMsg(`❌ ${e.friendlyMessage || 'Failed to save schedule'}`)
    } finally {
      setSchedSaving(false)
    }
  }

  const handleCancelSchedule = async () => {
    setSchedSaving(true); setSchedMsg('')
    try {
      await cancelQdrantSnapshotSchedule()
      setSchedInfo({ active: false })
      setSchedMsg('✅ Schedule cancelled')
    } catch (e: any) {
      setSchedMsg(`❌ ${e.friendlyMessage || 'Failed to cancel'}`)
    } finally {
      setSchedSaving(false)
    }
  }

  const handleDeleteAll = async () => {
    if (deleteAllConfirm !== 'DELETE') return
    setDeletingAll(true); setDeleteAllMsg('')
    try {
      const r = await deleteAllQdrantData()
      const { deleted, failed, total } = r.data
      setDeleteAllMsg(failed
        ? `⚠️ ${deleted}/${total} collections deleted — ${failed} failed`
        : `✅ All ${deleted} collections deleted`)
      setDeleteAllConfirm('')
      await loadCollections()
    } catch (e: any) {
      setDeleteAllMsg(`❌ ${e.friendlyMessage || e.message || 'Delete failed'}`)
    } finally {
      setDeletingAll(false)
    }
  }

  const totalVectors = collections.reduce((s, c) => s + c.vectors, 0)

  const TOP_N = 5
  const sortedCollections   = [...collections].sort((a, b) => b.vectors - a.vectors)
  const filteredCollections = colSearch.trim()
    ? sortedCollections.filter(c =>
        c.name.toLowerCase().includes(colSearch.toLowerCase()) ||
        (c.symbol ?? '').toLowerCase().includes(colSearch.toLowerCase()),
      )
    : sortedCollections
  const visibleCollections  = (!colSearch.trim() && !showAllCols)
    ? filteredCollections.slice(0, TOP_N)
    : filteredCollections

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Database size={20} className="text-blue-400" />
            Vector Search
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Semantic search and browse across all Qdrant collections
          </p>
        </div>
        <button onClick={loadCollections} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition">
          <RefreshCw size={14} className={clsx(colLoading && 'animate-spin')} />
        </button>
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-6">
        {/* ── Left: search / browse ──────────────────────────── */}
        <div className="space-y-4">

          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-gray-900 rounded-xl w-fit border border-gray-800">
            {(['search', 'browse'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  'px-4 py-1.5 rounded-lg text-sm font-medium transition capitalize',
                  mode === m ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200',
                )}
              >{m === 'search' ? '🔍 Semantic Search' : '📋 Browse Vectors'}</button>
            ))}
          </div>

          {/* ── Search form ─────────────────────────────── */}
          {mode === 'search' && (
            <form onSubmit={handleSearch} className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Enter a natural language query to search the vector database…"
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl text-sm font-medium transition"
                >
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilters(v => !v)}
                  className={clsx('p-2.5 rounded-xl border transition', showFilters ? 'border-blue-500 bg-blue-900/30 text-blue-300' : 'border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200')}
                  title="Filters"
                >
                  <SlidersHorizontal size={15} />
                </button>
              </div>

              {/* Filters panel */}
              {showFilters && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Collection</label>
                    <select
                      value={collection}
                      onChange={e => setCollection(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">All collections</option>
                      {collections.map(c => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({fmtNum(c.vectors)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Content type</label>
                    <select
                      value={filterType}
                      onChange={e => setFilterType(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Any type</option>
                      {['website', 'document', 'faq', 'knowledge_base', 'api'].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Language</label>
                    <select
                      value={filterLang}
                      onChange={e => setFilterLang(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Any language</option>
                      <option value="en">English</option>
                      <option value="ar">Arabic</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Score threshold: <span className="text-white font-mono">{threshold.toFixed(2)}</span>
                    </label>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={threshold}
                      onChange={e => setThreshold(parseFloat(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Top K: <span className="text-white font-mono">{topK}</span>
                    </label>
                    <input
                      type="range" min="1" max="50" step="1"
                      value={topK}
                      onChange={e => setTopK(parseInt(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>
              )}
            </form>
          )}

          {/* ── Browse form ──────────────────────────────── */}
          {mode === 'browse' && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Layers size={14} className="text-gray-500" />
                <select
                  value={browseCol}
                  onChange={e => { setBrowseCol(e.target.value); setBrowsePrev([]); setBrowseOffset(undefined) }}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">msx_knowledge (default)</option>
                  {collections.map(c => (
                    <option key={c.name} value={c.name}>
                      {c.name} — {fmtNum(c.vectors)} vectors
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1">
                <button
                  disabled={browsePrev.length === 0}
                  onClick={() => {
                    const prev = [...browsePrev]
                    const last = prev.pop()
                    setBrowsePrev(prev)
                    loadBrowse(browseCol, last, false)
                  }}
                  className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-400 transition"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  disabled={!browseOffset}
                  onClick={() => loadBrowse(browseCol, browseOffset)}
                  className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-400 transition"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ── Error ────────────────────────────────────── */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg text-red-300 text-sm">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* ── Search results ───────────────────────────── */}
          {mode === 'search' && (
            <>
              {results.length > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500 border-b border-gray-800 pb-2">
                  <span>
                    <span className="text-white font-medium">{total}</span> results
                    {queryMs > 0 && <> · <span className="text-gray-400">{queryMs}ms</span></>}
                  </span>
                  <button onClick={() => setResults([])} className="flex items-center gap-1 hover:text-gray-300 transition">
                    <X size={11} /> Clear
                  </button>
                </div>
              )}

              {loading && (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-28 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {results.map((r, i) => (
                  <ResultCard
                    key={`${r.id}-${i}`}
                    result={r}
                    expanded={expanded === r.id}
                    onExpand={() => setExpanded(v => v === r.id ? null : r.id)}
                    onDelete={() => handleDelete(r.id, r.collection)}
                    deleting={deleting === r.id}
                  />
                ))}
              </div>

              {!loading && results.length === 0 && query && (
                <div className="text-center py-16 text-gray-600">
                  <Search size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No results above threshold {threshold.toFixed(2)}</p>
                  <p className="text-xs mt-1">Try lowering the score threshold or rephrasing the query</p>
                </div>
              )}

              {!loading && !query && results.length === 0 && (
                <div className="text-center py-16 text-gray-700">
                  <Database size={40} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Enter a query to semantically search the vector database</p>
                  <p className="text-xs mt-1 text-gray-600">Results are ranked by cosine similarity score</p>
                </div>
              )}
            </>
          )}

          {/* ── Browse results ───────────────────────────── */}
          {mode === 'browse' && (
            <div className="space-y-2">
              {browseLoad && Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
              ))}
              {!browseLoad && browseItems.map((p, i) => (
                <ResultCard
                  key={`${p.id}-${i}`}
                  result={{ id: p.id, score: 1, collection: browseCol || 'msx_knowledge', payload: p.payload }}
                  expanded={expanded === p.id}
                  onExpand={() => setExpanded(v => v === p.id ? null : p.id)}
                  onDelete={() => handleDelete(p.id, browseCol || 'msx_knowledge')}
                  deleting={deleting === p.id}
                  hideSore
                />
              ))}
              {!browseLoad && browseItems.length === 0 && (
                <div className="text-center py-16 text-gray-700">
                  <Layers size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No vectors in this collection yet</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: collections sidebar ────────────────────── */}
        <aside className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                <Database size={13} className="text-blue-400" />
                Collections
              </span>
              <span className="text-xs text-gray-500">
                {fmtNum(totalVectors)} vectors · {collections.length} cols
              </span>
            </div>

            {/* Search box */}
            <div className="px-3 py-2 border-b border-gray-800/60">
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                <input
                  value={colSearch}
                  onChange={e => { setColSearch(e.target.value); setShowAllCols(false) }}
                  placeholder="Search collections…"
                  className="w-full bg-gray-800 border border-gray-700/50 rounded-lg pl-7 pr-7 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
                />
                {colSearch && (
                  <button
                    onClick={() => setColSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>

            {/* Loading skeletons */}
            {colLoading && (
              <div className="p-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />
                ))}
              </div>
            )}

            {/* Collection list */}
            <div className="divide-y divide-gray-800/50">
              {visibleCollections.map(c => {
                const isActive = (mode === 'search' && collection === c.name) ||
                                 (mode === 'browse' && (browseCol === c.name || (!browseCol && c.name === 'msx_knowledge')))
                return (
                  <button
                    key={c.name}
                    onClick={() => {
                      if (mode === 'search') setCollection(v => v === c.name ? '' : c.name)
                      else { setBrowseCol(c.name); setBrowsePrev([]); setBrowseOffset(undefined) }
                    }}
                    className={clsx(
                      'w-full text-left px-4 py-2.5 transition flex items-center justify-between gap-2',
                      isActive ? 'bg-blue-900/30' : 'hover:bg-gray-800/60',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {c.isCompany
                        ? <span className="text-[10px] font-bold text-teal-400 font-mono bg-teal-900/30 px-1.5 py-0.5 rounded border border-teal-700/40 flex-shrink-0">
                            {c.symbol}
                          </span>
                        : <Database size={12} className="text-blue-400 flex-shrink-0" />
                      }
                      <span className="text-xs text-gray-300 truncate">{c.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono flex-shrink-0 tabular-nums">
                      {fmtNum(c.vectors)}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Show more / less */}
            {!colSearch.trim() && filteredCollections.length > TOP_N && (
              <button
                onClick={() => setShowAllCols(v => !v)}
                className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-300 border-t border-gray-800/50 transition flex items-center justify-center gap-1.5"
              >
                {showAllCols
                  ? <><ChevronLeft size={11} className="rotate-90" /> Show top {TOP_N} only</>
                  : <>Show {filteredCollections.length - TOP_N} more collections</>
                }
              </button>
            )}

            {/* Search no-results */}
            {colSearch.trim() && filteredCollections.length === 0 && !colLoading && (
              <div className="px-4 py-5 text-center text-xs text-gray-600">
                No collections matching &ldquo;{colSearch}&rdquo;
              </div>
            )}

            {/* Empty state */}
            {collections.length === 0 && !colLoading && (
              <div className="px-4 py-6 text-center text-xs text-gray-600">No collections found</div>
            )}
          </div>

          {/* Quick tips */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400">Tips</p>
            <ul className="text-[11px] text-gray-500 space-y-1.5 leading-relaxed">
              <li>• Top 5 by vector count shown — search to find others</li>
              <li>• Click a collection to filter search to it</li>
              <li>• Lower threshold (0.2–0.4) to find more results</li>
              <li>• Company collections are named <code className="text-teal-400">msx_co_*</code></li>
            </ul>
          </div>

          {/* ── Snapshots card ───────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Header / toggle */}
            <button
              onClick={() => setSnapshotOpen(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition"
            >
              <span className="text-sm font-semibold flex items-center gap-2">
                <Camera size={13} className="text-purple-400" />
                Snapshots
              </span>
              {snapshotOpen ? <ChevronUp size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
            </button>

            {snapshotOpen && (
              <div className="border-t border-gray-800 p-4 space-y-4">
                {/* Create snapshot */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Create Snapshot</p>
                  <select
                    value={snapshotTarget}
                    onChange={e => setSnapshotTarget(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-500/60"
                  >
                    <option value="">All collections</option>
                    {collections.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleCreateSnapshot}
                    disabled={snapshotting}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded-lg font-medium transition"
                  >
                    {snapshotting
                      ? <><RefreshCw size={12} className="animate-spin" /> Creating…</>
                      : <><Camera size={12} /> Snapshot Now</>
                    }
                  </button>
                  {snapshotMsg && (
                    <p className="text-[11px] text-gray-400 leading-relaxed">{snapshotMsg}</p>
                  )}
                </div>

                {/* List snapshots for a collection */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Browse Snapshots</p>
                  <select
                    value={snapListCol}
                    onChange={e => { setSnapListCol(e.target.value); if (e.target.value) loadSnapList(e.target.value) }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-500/60"
                  >
                    <option value="">— pick a collection —</option>
                    {collections.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>

                  {snapListLoading && (
                    <div className="space-y-1.5">
                      {[1, 2].map(i => <div key={i} className="h-8 bg-gray-800 rounded animate-pulse" />)}
                    </div>
                  )}

                  {!snapListLoading && snapListCol && snapList.length === 0 && (
                    <p className="text-[11px] text-gray-600 text-center py-2">No snapshots yet</p>
                  )}

                  {snapList.map(s => (
                    <div key={s.name} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2 gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] text-gray-300 font-mono truncate">{s.name}</p>
                        {s.creation_time && (
                          <p className="text-[10px] text-gray-600 mt-0.5">
                            {new Date(s.creation_time).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteSnap(snapListCol, s.name)}
                        disabled={deletingSnap === s.name}
                        className="flex-shrink-0 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition"
                        title="Delete snapshot"
                      >
                        {deletingSnap === s.name
                          ? <RefreshCw size={11} className="animate-spin" />
                          : <Trash2 size={11} />
                        }
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Auto-schedule card ───────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Header / toggle */}
            <button
              onClick={() => setSchedOpen(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition"
            >
              <span className="text-sm font-semibold flex items-center gap-2">
                <CalendarClock size={13} className={schedInfo?.active ? 'text-green-400' : 'text-gray-500'} />
                Auto-Snapshot
                {schedInfo?.active && (
                  <span className="px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-700/40 rounded text-[9px] font-bold uppercase">On</span>
                )}
              </span>
              {schedOpen ? <ChevronUp size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
            </button>

            {schedOpen && (
              <div className="border-t border-gray-800 p-4 space-y-3">
                {schedLoading ? (
                  <div className="h-8 bg-gray-800 rounded animate-pulse" />
                ) : (
                  <>
                    {/* Current status */}
                    {schedInfo?.active ? (
                      <div className="flex items-start gap-2 bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2">
                        <Check size={12} className="text-green-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs text-green-300 font-mono">{schedInfo.cron}</p>
                          {schedInfo.nextRunAt && (
                            <p className="text-[10px] text-green-600 mt-0.5">
                              Next: {new Date(schedInfo.nextRunAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-gray-600 italic">No schedule active</p>
                    )}

                    {/* Presets */}
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">Quick presets</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { label: 'Daily 3am',   cron: '0 3 * * *'   },
                          { label: 'Weekly Sun',  cron: '0 3 * * 0'   },
                          { label: 'Every 12h',   cron: '0 */12 * * *' },
                          { label: 'Monthly 1st', cron: '0 3 1 * *'   },
                        ].map(p => (
                          <button
                            key={p.cron}
                            onClick={() => { setCustomCron(p.cron); handleSetSchedule(p.cron) }}
                            disabled={schedSaving}
                            className={clsx(
                              'px-2 py-1.5 rounded-lg text-[11px] border transition text-left',
                              schedInfo?.cron === p.cron
                                ? 'border-green-600/60 bg-green-900/30 text-green-300'
                                : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600',
                            )}
                          >
                            <span className="block font-medium">{p.label}</span>
                            <span className="font-mono text-[9px] text-gray-600">{p.cron}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom cron */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">Custom cron</p>
                      <div className="flex gap-1.5">
                        <input
                          value={customCron}
                          onChange={e => setCustomCron(e.target.value)}
                          placeholder="0 3 * * *"
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-purple-500/60 placeholder-gray-700"
                        />
                        <button
                          onClick={() => handleSetSchedule(customCron)}
                          disabled={schedSaving || !customCron.trim()}
                          className="px-2.5 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded-lg transition"
                        >
                          {schedSaving ? <RefreshCw size={11} className="animate-spin" /> : 'Set'}
                        </button>
                      </div>
                    </div>

                    {/* Cancel button */}
                    {schedInfo?.active && (
                      <button
                        onClick={handleCancelSchedule}
                        disabled={schedSaving}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-red-400 border border-red-900/40 hover:bg-red-900/20 rounded-lg transition"
                      >
                        <X size={11} /> Cancel Schedule
                      </button>
                    )}

                    {schedMsg && (
                      <p className="text-[11px] text-gray-400">{schedMsg}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {/* ── Danger Zone (super_admin only) ───────────────── */}
          {isSuperAdmin && (
            <div className="bg-red-950/30 border border-red-800/50 rounded-xl overflow-hidden">
              {/* Header / toggle */}
              <button
                onClick={() => { setDeleteAllOpen(v => !v); setDeleteAllMsg(''); setDeleteAllConfirm('') }}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-red-900/20 transition"
              >
                <span className="text-sm font-semibold flex items-center gap-2 text-red-400">
                  <ShieldAlert size={13} />
                  Danger Zone
                </span>
                {deleteAllOpen ? <ChevronUp size={13} className="text-red-600" /> : <ChevronDown size={13} className="text-red-600" />}
              </button>

              {deleteAllOpen && (
                <div className="border-t border-red-800/40 p-4 space-y-3">
                  <p className="text-[11px] text-red-300/80 leading-relaxed">
                    Permanently delete <span className="font-bold text-red-300">all {collections.length} collections</span> and
                    every vector inside them. This cannot be undone.
                  </p>

                  <div className="space-y-1.5">
                    <p className="text-[10px] text-red-500 uppercase tracking-wide font-semibold">
                      Type <span className="font-mono text-red-300">DELETE</span> to confirm
                    </p>
                    <input
                      value={deleteAllConfirm}
                      onChange={e => setDeleteAllConfirm(e.target.value)}
                      placeholder="DELETE"
                      className="w-full bg-red-950/40 border border-red-800/60 rounded-lg px-3 py-2 text-sm font-mono text-red-200 placeholder-red-900 focus:outline-none focus:border-red-500"
                    />
                  </div>

                  <button
                    onClick={handleDeleteAll}
                    disabled={deletingAll || deleteAllConfirm !== 'DELETE'}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-700 hover:bg-red-600 disabled:bg-red-950 disabled:text-red-800 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition"
                  >
                    {deletingAll
                      ? <><RefreshCw size={12} className="animate-spin" /> Deleting…</>
                      : <><Trash2 size={12} /> Delete All Collections</>
                    }
                  </button>

                  {deleteAllMsg && (
                    <p className="text-[11px] text-red-300 leading-relaxed">{deleteAllMsg}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* ── RAG Debug / Test Query Panel ──────────────────────── */}
      <div className="mt-6 border border-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setTestOpen(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-gray-900 hover:bg-gray-800/60 transition text-left"
        >
          <FlaskConical size={14} className="text-violet-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-200">RAG Debug — Test Query</span>
          <span className="text-xs text-gray-500 ml-1">Run a query against your knowledge base and inspect what the AI would retrieve</span>
          <span className="ml-auto text-gray-600">{testOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
        </button>

        {testOpen && (
          <div className="bg-gray-950 p-4 space-y-4">
            {/* Query form */}
            <form onSubmit={handleTestQuery} className="flex gap-2 flex-wrap">
              <input
                value={testQuery}
                onChange={e => setTestQuery(e.target.value)}
                placeholder="Test query, e.g. What is the dividend of BKMB?"
                className="flex-1 min-w-64 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500"
              />
              <select
                value={testLang}
                onChange={e => setTestLang(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-300 focus:outline-none"
              >
                <option value="en">EN</option>
                <option value="ar">AR</option>
                <option value="mixed">Mixed</option>
              </select>
              <input
                value={testSymbol}
                onChange={e => setTestSymbol(e.target.value.toUpperCase())}
                placeholder="Symbol (opt.)"
                className="w-28 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500 font-mono uppercase"
              />
              <button
                type="submit"
                disabled={testLoading || !testQuery.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium rounded-lg transition"
              >
                {testLoading
                  ? <><RefreshCw size={13} className="animate-spin" /> Testing…</>
                  : <><Zap size={13} /> Run Test</>}
              </button>
            </form>

            {testError && (
              <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{testError}</p>
            )}

            {/* Test results */}
            {testResult && (
              <div className="space-y-3">
                {/* Summary row */}
                <div className="flex flex-wrap gap-3 items-center">
                  {/* Verdict */}
                  <div className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border',
                    testResult.wouldRefuse
                      ? 'bg-red-900/30 border-red-700/40 text-red-300'
                      : 'bg-green-900/30 border-green-700/40 text-green-300',
                  )}>
                    {testResult.wouldRefuse
                      ? <><XCircle size={14} /> Would Refuse</>
                      : <><CheckCircle2 size={14} /> Would Answer</>}
                  </div>
                  {testResult.refuseReason && (
                    <span className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-800/40">
                      Reason: {testResult.refuseReason === 'no_results' ? 'No matching vectors' : `Low confidence (${Math.round(testResult.topScore * 100)}% < ${Math.round(testResult.hardThreshold * 100)}% threshold)`}
                    </span>
                  )}
                  {/* Stats */}
                  <div className="flex items-center gap-3 ml-auto text-xs text-gray-500 font-mono">
                    <span>top_score: <span className={clsx('font-bold', testResult.topScore >= testResult.hardThreshold ? 'text-green-400' : 'text-orange-400')}>{testResult.topScore.toFixed(3)}</span></span>
                    <span>threshold: <span className="text-gray-400">{testResult.hardThreshold.toFixed(2)}</span></span>
                    <span>sources: <span className="text-gray-300">{testResult.sourceCount}</span></span>
                    <span>latency: <span className="text-blue-400">{testResult.latencyMs}ms</span></span>
                  </div>
                </div>

                {/* Score bar */}
                {testResult.hadResults && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-600 w-20 flex-shrink-0">Confidence</span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all', testResult.topScore >= testResult.hardThreshold ? 'bg-green-500' : 'bg-orange-500')}
                        style={{ width: `${Math.min(100, testResult.topScore * 100)}%` }}
                      />
                    </div>
                    <div className="h-2 w-px bg-yellow-500/60 relative -ml-px flex-shrink-0" style={{ marginLeft: `calc(${testResult.hardThreshold * 100}% - 1px)` }} title={`Hard threshold: ${testResult.hardThreshold}`} />
                    <span className="text-[10px] text-gray-500">{Math.round(testResult.topScore * 100)}%</span>
                  </div>
                )}

                {/* Sources */}
                {testResult.sources?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">Retrieved Sources</p>
                    {testResult.sources.map((src: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
                        <span className="text-[10px] text-gray-600 font-mono w-5 flex-shrink-0 mt-0.5">[{i+1}]</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 font-medium truncate">{src.title || src.url || 'Untitled'}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{src.content}</p>
                          {src.url && (
                            <a href={src.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:text-blue-400 flex items-center gap-0.5 mt-1">
                              <ExternalLink size={9} />{src.url.slice(0, 60)}{src.url.length > 60 ? '…' : ''}
                            </a>
                          )}
                        </div>
                        <ScoreBadge score={src.score} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Context preview */}
                {testResult.contextPreview && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-600 mb-1 font-semibold">Context Preview (first 800 chars sent to LLM)</p>
                    <pre className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-400 whitespace-pre-wrap overflow-auto max-h-48 leading-relaxed">
                      {testResult.contextPreview}
                    </pre>
                  </div>
                )}

                {!testResult.hadResults && (
                  <div className="flex items-center gap-2 text-yellow-400 text-xs bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-2">
                    <AlertCircle size={13} />
                    No vectors matched this query above the retrieval threshold ({testResult.hardThreshold.toFixed(2)}). Try indexing more content or lowering RAG_SCORE_THRESHOLD.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Result Card ──────────────────────────────────────────────────

function ResultCard({
  result, expanded, onExpand, onDelete, deleting, hideSore = false,
}: {
  result:   QdrantResult
  expanded: boolean
  onExpand: () => void
  onDelete: () => void
  deleting: boolean
  hideSore?: boolean
}) {
  const { payload, score, collection } = result
  const title   = payload.title   || payload.sourceId || result.id
  const content = payload.content || ''
  const isCompany = collection.startsWith('msx_co_')
  const symbol    = isCompany ? collection.replace('msx_co_', '').toUpperCase() : payload.companySymbol

  return (
    <div className={clsx(
      'bg-gray-900 border rounded-xl overflow-hidden transition-all',
      expanded ? 'border-blue-700/60' : 'border-gray-800 hover:border-gray-700',
    )}>
      {/* Card header */}
      <div className="px-4 py-3 flex items-start gap-3 cursor-pointer" onClick={onExpand}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <TypeBadge type={payload.type} />
            {symbol && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border bg-teal-900/40 text-teal-300 border-teal-700/40 font-bold font-mono">
                {symbol}
              </span>
            )}
            {payload.language && payload.language !== 'en' && (
              <span className="text-[10px] text-gray-500 border border-gray-700 px-1.5 py-0.5 rounded-full">
                {payload.language}
              </span>
            )}
            <span className="text-[10px] text-gray-600 font-mono truncate ml-auto">{collection}</span>
          </div>
          <p className="text-sm font-medium text-gray-200 truncate leading-snug">{title}</p>
          {!expanded && content && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{content}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!hideSore && <ScoreBadge score={score} />}
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            disabled={deleting}
            className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition"
            title="Delete vector"
          >
            {deleting
              ? <RefreshCw size={12} className="animate-spin" />
              : <Trash2 size={12} />}
          </button>
          <ChevronRight size={13} className={clsx('text-gray-600 transition-transform', expanded && 'rotate-90')} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-3 space-y-3">
          {/* Full content */}
          {content && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-600 mb-1 font-semibold">Content</p>
              <p className="text-xs text-gray-300 leading-relaxed bg-gray-800/50 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{content}</p>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              ['ID',        result.id],
              ['Source',    payload.sourceId],
              ['Chunk',     payload.chunkIndex !== undefined ? `#${payload.chunkIndex}` : undefined],
              ['Crawled',   payload.crawledAt ? new Date(payload.crawledAt).toLocaleDateString() : undefined],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k as string}>
                <p className="text-[9px] uppercase tracking-wide text-gray-600 font-semibold">{k}</p>
                <p className="text-[11px] text-gray-400 font-mono truncate">{v as string}</p>
              </div>
            ))}
          </div>

          {/* URL */}
          {payload.url && (
            <a href={payload.url} target="_blank" rel="noopener"
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
            >
              <ExternalLink size={10} /> {payload.url.length > 60 ? payload.url.slice(0, 60) + '…' : payload.url}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
