'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, Database, Trash2, RefreshCw, ChevronRight, ChevronLeft,
  ExternalLink, Filter, SlidersHorizontal, Layers, X, AlertCircle,
  Globe, FileText, HelpCircle, Building2, BookOpen,
} from 'lucide-react'
import {
  listQdrantCollections, searchQdrant, browseQdrant, deleteQdrantPoint,
} from '../../../lib/api'
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
  // ── Collections ───────────────────────────────────────────────
  const [collections, setCollections]   = useState<Collection[]>([])
  const [colLoading,  setColLoading]    = useState(true)

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

  const totalVectors = collections.reduce((s, c) => s + c.vectors, 0)

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
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                <Database size={13} className="text-blue-400" />
                Collections
              </span>
              <span className="text-xs text-gray-500">{fmtNum(totalVectors)} total</span>
            </div>

            {colLoading && (
              <div className="p-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />
                ))}
              </div>
            )}

            <div className="divide-y divide-gray-800/50 max-h-[calc(100vh-240px)] overflow-y-auto">
              {collections.map(c => {
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
                      'w-full text-left px-4 py-2.5 transition flex items-center justify-between gap-2 group',
                      isActive ? 'bg-blue-900/30' : 'hover:bg-gray-800/60',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {c.isCompany
                        ? <span className="text-[10px] font-bold text-teal-400 font-mono bg-teal-900/30 px-1.5 py-0.5 rounded border border-teal-700/40">{c.symbol}</span>
                        : <Database size={12} className="text-blue-400 flex-shrink-0" />
                      }
                      <span className="text-xs text-gray-300 truncate">{c.isCompany ? c.name : c.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono flex-shrink-0 tabular-nums">
                      {fmtNum(c.vectors)}
                    </span>
                  </button>
                )
              })}
            </div>

            {collections.length === 0 && !colLoading && (
              <div className="px-4 py-6 text-center text-xs text-gray-600">No collections found</div>
            )}
          </div>

          {/* Quick tips */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400">Tips</p>
            <ul className="text-[11px] text-gray-500 space-y-1.5 leading-relaxed">
              <li>• Click a collection to filter search to it</li>
              <li>• Lower the threshold (0.2–0.4) to find more results</li>
              <li>• Switch to Browse to see raw vectors without a query</li>
              <li>• Company collections are named <code className="text-teal-400">msx_co_*</code></li>
            </ul>
          </div>
        </aside>
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
