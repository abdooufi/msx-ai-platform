'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Globe, Play, RefreshCw, CheckCircle, Loader2,
  Map, Building2, Zap, ChevronDown, ChevronUp, Link,
  AlertCircle, CalendarClock, Power, PowerOff, Pencil,
  Database, Layers, Search, X,
} from 'lucide-react'
import {
  startCrawl, startSitemapCrawl, startCompanyCrawl,
  startAllCrawl, crawlPage, getCrawlStatus,
  getCrawlSchedule, setCrawlSchedule, cancelCrawlSchedule,
  getStats, getPgCompanies,
} from '../../../lib/api'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueStats {
  waiting:        number
  active:         number
  completed:      number
  failed:         number
  companyUrlCount: number
}

interface CompanyStat {
  symbol:     string
  collection: string
  vectors:    number
}

interface ScheduleInfo {
  active:     boolean
  cron?:      string
  nextRunAt?: string
  key?:       string
}

interface CrawlResult {
  source:     string
  queued?:    number
  urls?:      string[]
  companies?: { symbol: string; url: string }[]
  jobId?:     string | number
  error?:     string
}

// ─── Preset schedules ─────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Every 6 h',   cron: '0 */6 * * *'  },
  { label: 'Every 12 h',  cron: '0 */12 * * *' },
  { label: 'Daily 2 am',  cron: '0 2 * * *'    },
  { label: 'Daily 6 am',  cron: '0 6 * * *'    },
  { label: 'Weekly Sun',  cron: '0 2 * * 0'    },
]

// ─── Small components ─────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function ResultPanel({ result, onClose }: { result: CrawlResult; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const allUrls = [...(result.urls ?? []), ...(result.companies?.map(c => c.url) ?? [])]
  return (
    <div className="bg-gray-950 border border-blue-800/40 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle size={14} className="text-green-400" />
          <span className="text-white">{result.source}</span>
          {result.queued !== undefined && <span className="text-gray-400">— {result.queued} pages queued</span>}
          {result.jobId  !== undefined && <span className="text-gray-400">— job #{result.jobId}</span>}
        </div>
        <div className="flex items-center gap-2">
          {allUrls.length > 0 && (
            <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Hide' : 'Show'} URLs
            </button>
          )}
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xs transition">✕</button>
        </div>
      </div>
      {result.error && <p className="text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">{result.error}</p>}
      {expanded && allUrls.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-lg bg-gray-900 p-2 mt-1">
          {allUrls.map((url, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <Link size={10} className="text-gray-600 flex-shrink-0" />
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate">{url}</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Schedule card ────────────────────────────────────────────────────────────

function ScheduleCard() {
  const [info,       setInfo]       = useState<ScheduleInfo | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [customCron, setCustomCron] = useState('')

  const load = useCallback(async () => {
    try { setInfo((await getCrawlSchedule()).data) } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const apply = async (cron: string) => {
    setLoading(true)
    try {
      const r = await setCrawlSchedule(cron)
      setInfo(r.data)
      setEditing(false)
      setCustomCron('')
      toast.success(`Schedule set: ${cron}`)
    } catch { toast.error('Failed to set schedule') }
    finally { setLoading(false) }
  }

  const cancel = async () => {
    if (!confirm('Stop the auto-crawl schedule?')) return
    setLoading(true)
    try {
      await cancelCrawlSchedule()
      setInfo({ active: false })
      toast.success('Schedule cancelled')
    } catch { toast.error('Failed to cancel') }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-purple-400" />
          <h2 className="font-semibold text-white text-sm">Auto-Crawl Schedule</h2>
        </div>
        {info?.active ? (
          <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-900/30 border border-green-800/50 px-2 py-0.5 rounded-full">
            <Power size={10} /> Active
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
            <PowerOff size={10} /> Off
          </span>
        )}
      </div>

      {/* Current schedule info */}
      {info?.active && (
        <div className="bg-gray-800/60 rounded-lg px-3 py-2.5 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Cron expression</span>
            <code className="text-purple-300 font-mono">{info.cron}</code>
          </div>
          {info.nextRunAt && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Next run</span>
              <span className="text-white">{new Date(info.nextRunAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {!info?.active && !editing && (
        <p className="text-xs text-gray-500 leading-relaxed">
          No schedule active. The website will only be crawled when you click a button manually.
          Set a schedule to keep the AI knowledge base fresh automatically.
        </p>
      )}

      {/* Preset buttons */}
      {!editing ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Quick presets:</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button
                key={p.cron}
                onClick={() => apply(p.cron)}
                disabled={loading || info?.cron === p.cron}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                  info?.cron === p.cron
                    ? 'bg-purple-700/40 border-purple-600 text-purple-200 cursor-default'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-purple-600 hover:text-white'
                } disabled:opacity-50`}
              >
                {loading ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition flex items-center gap-1"
            >
              <Pencil size={10} /> Custom
            </button>
          </div>

          {info?.active && (
            <button
              onClick={cancel}
              disabled={loading}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 mt-1 transition"
            >
              <PowerOff size={11} /> Turn off auto-crawl
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Enter a cron expression (5 fields):</p>
          <div className="flex gap-2">
            <input
              value={customCron}
              onChange={e => setCustomCron(e.target.value)}
              placeholder="e.g.  0 2 * * *"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 font-mono focus:outline-none focus:border-purple-500"
              onKeyDown={e => e.key === 'Enter' && customCron.trim() && apply(customCron.trim())}
            />
            <button
              onClick={() => customCron.trim() && apply(customCron.trim())}
              disabled={loading || !customCron.trim()}
              className="px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-xs transition"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : 'Set'}
            </button>
            <button onClick={() => { setEditing(false); setCustomCron('') }} className="text-gray-500 hover:text-gray-300 text-xs transition">
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Format: minute hour day-of-month month day-of-week · e.g. <code className="text-gray-400">0 3 * * 1-5</code> = weekdays 3 am
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const [stats,        setStats]        = useState<QueueStats | null>(null)
  const [companyStats, setCompanyStats] = useState<CompanyStat[]>([])
  const [allCompanies, setAllCompanies] = useState<any[]>([])
  const [coSearch,     setCoSearch]     = useState('')
  const [showAllCo,    setShowAllCo]    = useState(false)
  const [results,      setResults]      = useState<CrawlResult[]>([])
  const [loading,      setLoading]      = useState<Record<string, boolean>>({})
  const [singleUrl,    setSingleUrl]    = useState('')

  const loadStats = useCallback(async () => {
    try { setStats((await getCrawlStatus()).data) } catch {}
  }, [])

  const loadCompanyStats = useCallback(async () => {
    try {
      const [statsRes, companiesRes] = await Promise.all([
        getStats(),
        getPgCompanies(1, 500),
      ])
      setCompanyStats(statsRes.data?.ragStats?.companyStats ?? [])
      setAllCompanies(companiesRes.data?.data ?? companiesRes.data?.items ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    loadStats()
    loadCompanyStats()
    const t = setInterval(loadStats, 4000)
    return () => clearInterval(t)
  }, [loadStats, loadCompanyStats])

  const setL = (k: string, v: boolean) => setLoading(p => ({ ...p, [k]: v }))
  const addResult = (r: CrawlResult)   => setResults(p => [r, ...p].slice(0, 10))
  const anyLoading = Object.values(loading).some(Boolean)

  // ── Merged company list (DB companies + Qdrant stats) ────────────────
  const qdrantBySymbol: Record<string, CompanyStat> = {}
  companyStats.forEach(c => { qdrantBySymbol[c.symbol.toUpperCase()] = c })

  type MergedCo = { symbol: string; name: string; collection: string; vectors: number; indexed: boolean }
  const mergedCompanies: MergedCo[] = allCompanies.map((co: any) => {
    const sym  = (co.symbol ?? '').toUpperCase()
    const stat = qdrantBySymbol[sym]
    return {
      symbol:     sym,
      name:       co.long_name_en ?? co.short_name_en ?? sym,
      collection: stat ? stat.collection : `msx_co_${sym.toLowerCase()}`,
      vectors:    stat ? stat.vectors : 0,
      indexed:    !!stat,
    }
  })
  companyStats.forEach(c => {
    if (!mergedCompanies.some(m => m.symbol === c.symbol.toUpperCase())) {
      mergedCompanies.push({ symbol: c.symbol, name: c.symbol, collection: c.collection, vectors: c.vectors, indexed: true })
    }
  })
  const CO_PAGE_SIZE  = 10
  const maxVec        = mergedCompanies.reduce((m, c) => c.vectors > m ? c.vectors : m, 1)
  const indexedCount  = mergedCompanies.filter(c => c.indexed).length
  const coSearchLower = coSearch.trim().toLowerCase()
  const filteredCompanies = coSearchLower
    ? mergedCompanies.filter(c => c.symbol.toLowerCase().includes(coSearchLower) || c.name.toLowerCase().includes(coSearchLower))
    : mergedCompanies
  const visibleCompanies = (!coSearchLower && !showAllCo)
    ? filteredCompanies.slice(0, CO_PAGE_SIZE)
    : filteredCompanies

  const handleSitemap = async () => {
    setL('sitemap', true)
    try {
      const r = await startSitemapCrawl()
      addResult({ source: '🗺️ Sitemap', queued: r.data.queued, urls: r.data.urls ?? [] })
      toast.success(`Sitemap: ${r.data.queued} pages queued`)
      loadStats()
    } catch (e: any) {
      addResult({ source: '🗺️ Sitemap', error: e?.response?.data?.message ?? e.message })
      toast.error('Sitemap crawl failed')
    } finally { setL('sitemap', false) }
  }

  const handleCompanies = async () => {
    setL('companies', true)
    try {
      const r = await startCompanyCrawl()
      addResult({ source: '🏢 Company Pages', queued: r.data.queued, companies: r.data.companies ?? [] })
      toast.success(`Companies: ${r.data.queued} pages queued`)
      loadStats()
    } catch (e: any) {
      addResult({ source: '🏢 Company Pages', error: e?.response?.data?.message ?? e.message })
      toast.error('Company crawl failed')
    } finally { setL('companies', false) }
  }

  const handleSiteCrawl = async () => {
    setL('site', true)
    try {
      const r = await startCrawl()
      addResult({ source: '🌐 Site Crawl', jobId: r.data.jobId })
      toast.success(`Site crawl started (job #${r.data.jobId})`)
      loadStats()
    } catch { toast.error('Site crawl failed') }
    finally { setL('site', false) }
  }

  const handleSinglePage = async () => {
    const url = singleUrl.trim()
    if (!url) return
    setL('single', true)
    try {
      const r = await crawlPage(url)
      addResult({ source: '📄 Single Page', jobId: r.data.jobId, urls: [url] })
      toast.success(`Page queued (job #${r.data.jobId})`)
      setSingleUrl('')
      loadStats()
    } catch { toast.error('Failed to queue page') }
    finally { setL('single', false) }
  }

  const handleAll = async () => {
    setL('all', true)
    try {
      const r = await startAllCrawl()
      const d = r.data
      addResult({
        source: '🚀 All Sources',
        queued: (d.sitemap?.queued ?? 0) + (d.companies?.queued ?? 0) + 1,
        urls: [...(d.sitemap?.urls ?? []), ...(d.companies?.companies?.map((c: any) => c.url) ?? [])],
      })
      toast.success(`All sources queued — sitemap: ${d.sitemap?.queued ?? 0}, companies: ${d.companies?.queued ?? 0}`)
      loadStats()
    } catch (e: any) {
      toast.error(`All-sources crawl failed: ${e?.response?.data?.message ?? e.message}`)
    } finally { setL('all', false) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Globe className="text-blue-400" size={22} />
            Training Pipeline
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Crawl MSX.om pages, extract content, and index into Qdrant for AI search
          </p>
        </div>
        <button onClick={() => { loadStats(); loadCompanyStats() }} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 bg-gray-800 rounded-lg transition">
          <RefreshCw size={12} className={anyLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Queue stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Waiting"   value={stats.waiting}        color="text-yellow-400" />
          <StatCard label="Active"    value={stats.active}         color="text-blue-400"   />
          <StatCard label="Completed" value={stats.completed}      color="text-green-400"  />
          <StatCard label="Failed"    value={stats.failed}         color="text-red-400"    />
          <StatCard label="Co. URLs"  value={stats.companyUrlCount} color="text-teal-400"  />
        </div>
      )}

      {/* Per-company Qdrant collections */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-teal-400" />
            <h2 className="font-semibold text-white text-sm">Per-Company Qdrant Collections</h2>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-gray-500">
              <span className="text-teal-400 font-medium">{indexedCount}</span> indexed
              {' / '}
              <span className="text-white font-medium">{mergedCompanies.length}</span> total
            </span>
            {/* Search */}
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
              <input
                value={coSearch}
                onChange={e => { setCoSearch(e.target.value); setShowAllCo(false) }}
                placeholder="Search…"
                className="bg-gray-800 border border-gray-700/50 rounded-lg pl-7 pr-7 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-teal-500/60 w-36"
              />
              {coSearch && (
                <button onClick={() => setCoSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>
        </div>

        {filteredCompanies.length === 0 ? (
          <div className="text-center py-6 text-gray-600">
            <Layers size={28} className="mx-auto mb-2 opacity-30" />
            {coSearch
              ? <p className="text-xs">No companies matching &ldquo;{coSearch}&rdquo;</p>
              : <><p className="text-xs">No companies found.</p><p className="text-xs mt-0.5">Add companies in the Companies page first.</p></>
            }
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {visibleCompanies.map(c => (
                <div
                  key={c.symbol}
                  className={`border rounded-lg p-3 space-y-1 ${
                    c.indexed
                      ? 'bg-gray-800/60 border-gray-700/50'
                      : 'bg-gray-800/20 border-gray-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-bold font-mono ${c.indexed ? 'text-teal-300' : 'text-gray-500'}`}>
                      {c.symbol}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${
                      c.indexed ? 'text-gray-400 bg-gray-700/60' : 'text-gray-600 bg-gray-800'
                    }`}>
                      {c.vectors > 0 ? c.vectors.toLocaleString() : '—'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate leading-tight" title={c.name}>{c.name}</p>
                  <div className="w-full bg-gray-700 rounded-full h-0.5 mt-1">
                    <div
                      className={`h-0.5 rounded-full transition-all ${c.indexed ? 'bg-teal-500' : 'bg-gray-600'}`}
                      style={{ width: c.vectors > 0 ? `${Math.min(100, (c.vectors / maxVec) * 100)}%` : '0%' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Show more / less */}
            {!coSearchLower && filteredCompanies.length > CO_PAGE_SIZE && (
              <button
                onClick={() => setShowAllCo(v => !v)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-500 hover:text-gray-300 border-t border-gray-800/50 transition"
              >
                {showAllCo
                  ? <><ChevronUp size={11} /> Show top {CO_PAGE_SIZE} only</>
                  : <><ChevronDown size={11} /> Show {filteredCompanies.length - CO_PAGE_SIZE} more companies</>
                }
              </button>
            )}
          </>
        )}
      </div>

      {/* Auto-crawl schedule card */}
      <ScheduleCard />

      {/* Crawl All button */}
      <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-700/40 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Zap size={16} className="text-yellow-400" /> Crawl All Sources
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Sitemap · Company pages · Full site crawl — all at once
            </p>
          </div>
          <button
            onClick={handleAll}
            disabled={anyLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
          >
            {loading['all'] ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            Crawl Everything
          </button>
        </div>
      </div>

      {/* Individual source cards */}
      <div className="grid sm:grid-cols-2 gap-4">

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Map size={16} className="text-purple-400" />
            <h3 className="font-semibold text-white text-sm">Sitemap</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Fetch <code className="text-purple-300 bg-purple-900/30 px-1 rounded">/sitemap.aspx</code>,
            extract all page URLs and queue each for indexing.
          </p>
          <button onClick={handleSitemap} disabled={anyLoading} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition">
            {loading['sitemap'] ? <Loader2 size={13} className="animate-spin" /> : <Map size={13} />}
            Crawl Sitemap
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-teal-400" />
              <h3 className="font-semibold text-white text-sm">Company Pages</h3>
            </div>
            {stats && (
              <span className="text-xs bg-teal-900/40 text-teal-300 border border-teal-800 px-2 py-0.5 rounded-full">
                {stats.companyUrlCount} URLs
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Crawl every company page URL in the <code className="text-teal-300 bg-teal-900/30 px-1 rounded">companies</code> table.
          </p>
          <button onClick={handleCompanies} disabled={anyLoading || stats?.companyUrlCount === 0} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition">
            {loading['companies'] ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />}
            Crawl Company Pages
          </button>
          {stats?.companyUrlCount === 0 && (
            <p className="text-xs text-yellow-600 flex items-center gap-1">
              <AlertCircle size={11} /> No company URLs yet
            </p>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-400" />
            <h3 className="font-semibold text-white text-sm">Full Site Crawl</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Recursive crawl from root, following same-domain links up to 3 levels deep.
          </p>
          <button onClick={handleSiteCrawl} disabled={anyLoading} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition">
            {loading['site'] ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Crawl www.msx.om
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Link size={16} className="text-orange-400" />
            <h3 className="font-semibold text-white text-sm">Single Page</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Index one specific page immediately — useful for re-indexing an updated page.
          </p>
          <div className="flex gap-2">
            <input
              value={singleUrl}
              onChange={e => setSingleUrl(e.target.value)}
              placeholder="https://www.msx.om/…"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 font-mono"
              onKeyDown={e => e.key === 'Enter' && handleSinglePage()}
            />
            <button onClick={handleSinglePage} disabled={anyLoading || !singleUrl.trim()} className="px-3 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition">
              {loading['single'] ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            </button>
          </div>
        </div>

      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Results</h2>
          {results.map((r, i) => (
            <ResultPanel key={i} result={r} onClose={() => setResults(p => p.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

    </div>
  )
}
