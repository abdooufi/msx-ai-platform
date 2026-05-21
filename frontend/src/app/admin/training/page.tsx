'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Globe, Play, RefreshCw, CheckCircle, Loader2, Clock,
  Map, Building2, Zap, ChevronDown, ChevronUp, Link,
  AlertCircle,
} from 'lucide-react'
import {
  startCrawl, startSitemapCrawl, startCompanyCrawl,
  startAllCrawl, crawlPage, getCrawlStatus,
} from '../../../lib/api'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueStats {
  waiting: number
  active:  number
  completed: number
  failed:  number
  companyUrlCount: number
}

interface CrawlResult {
  source: string
  queued?: number
  urls?: string[]
  companies?: { symbol: string; url: string }[]
  jobId?: string | number
  error?: string
}

// ─── Small components ─────────────────────────────────────────────────────────

function StatCard({
  label, value, color,
}: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function ResultPanel({
  result,
  onClose,
}: {
  result: CrawlResult
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const allUrls: string[] = [
    ...(result.urls ?? []),
    ...(result.companies?.map(c => c.url) ?? []),
  ]

  return (
    <div className="bg-gray-950 border border-blue-800/40 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
          <CheckCircle size={14} className="text-green-400" />
          <span className="text-white">{result.source}</span>
          {result.queued !== undefined && (
            <span className="text-gray-400">— {result.queued} pages queued</span>
          )}
          {result.jobId !== undefined && (
            <span className="text-gray-400">— job #{result.jobId}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allUrls.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Hide' : 'Show'} URLs
            </button>
          )}
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xs transition">
            ✕
          </button>
        </div>
      </div>

      {result.error && (
        <p className="text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">{result.error}</p>
      )}

      {expanded && allUrls.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-lg bg-gray-900 p-2 mt-1">
          {allUrls.map((url, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <Link size={10} className="text-gray-600 flex-shrink-0" />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline truncate"
              >
                {url}
              </a>
            </div>
          ))}
          {allUrls.length >= 100 && (
            <p className="text-xs text-gray-600 text-center pt-1">
              Showing all {allUrls.length} URLs
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const [stats, setStats]     = useState<QueueStats | null>(null)
  const [results, setResults] = useState<CrawlResult[]>([])
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  // Single-page crawl state
  const [singleUrl, setSingleUrl] = useState('')

  const loadStats = useCallback(async () => {
    try {
      const r = await getCrawlStatus()
      setStats(r.data)
    } catch {}
  }, [])

  useEffect(() => {
    loadStats()
    const t = setInterval(loadStats, 4000)
    return () => clearInterval(t)
  }, [loadStats])

  const setL = (key: string, v: boolean) =>
    setLoading(prev => ({ ...prev, [key]: v }))

  const addResult = (r: CrawlResult) =>
    setResults(prev => [r, ...prev].slice(0, 10))

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSitemap = async () => {
    setL('sitemap', true)
    try {
      const r = await startSitemapCrawl()
      addResult({ source: '🗺️ Sitemap', queued: r.data.queued, urls: r.data.urls ?? [] })
      toast.success(`Sitemap: ${r.data.queued} pages queued`)
      loadStats()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e.message ?? 'Failed'
      addResult({ source: '🗺️ Sitemap', error: msg })
      toast.error(`Sitemap crawl failed: ${msg}`)
    } finally {
      setL('sitemap', false)
    }
  }

  const handleCompanies = async () => {
    setL('companies', true)
    try {
      const r = await startCompanyCrawl()
      addResult({
        source: '🏢 Company Pages',
        queued: r.data.queued,
        companies: r.data.companies ?? [],
      })
      toast.success(`Companies: ${r.data.queued} pages queued`)
      loadStats()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e.message ?? 'Failed'
      addResult({ source: '🏢 Company Pages', error: msg })
      toast.error(`Company crawl failed: ${msg}`)
    } finally {
      setL('companies', false)
    }
  }

  const handleSiteCrawl = async () => {
    setL('site', true)
    try {
      const r = await startCrawl()
      addResult({ source: '🌐 Site Crawl', jobId: r.data.jobId })
      toast.success(`Site crawl started (job #${r.data.jobId})`)
      loadStats()
    } catch (e: any) {
      toast.error('Site crawl failed')
    } finally {
      setL('site', false)
    }
  }

  const handleSinglePage = async () => {
    const url = singleUrl.trim()
    if (!url) return
    setL('single', true)
    try {
      const r = await crawlPage(url)
      addResult({ source: `📄 Single Page`, jobId: r.data.jobId, urls: [url] })
      toast.success(`Page queued (job #${r.data.jobId})`)
      setSingleUrl('')
      loadStats()
    } catch (e: any) {
      toast.error('Failed to queue page')
    } finally {
      setL('single', false)
    }
  }

  const handleAll = async () => {
    setL('all', true)
    try {
      const r = await startAllCrawl()
      const d = r.data
      addResult({
        source: '🚀 All Sources',
        queued: (d.sitemap?.queued ?? 0) + (d.companies?.queued ?? 0) + 1,
        urls: [
          ...(d.sitemap?.urls ?? []),
          ...(d.companies?.companies?.map((c: any) => c.url) ?? []),
        ],
      })
      toast.success(
        `All sources queued — sitemap: ${d.sitemap?.queued ?? 0}, ` +
        `companies: ${d.companies?.queued ?? 0}, site: 1`,
      )
      loadStats()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e.message ?? 'Failed'
      toast.error(`All-sources crawl failed: ${msg}`)
    } finally {
      setL('all', false)
    }
  }

  const anyLoading = Object.values(loading).some(Boolean)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────── */}
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
        <button
          onClick={loadStats}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 bg-gray-800 rounded-lg transition"
        >
          <RefreshCw size={12} className={anyLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Queue stats ────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Waiting"   value={stats.waiting}   color="text-yellow-400" />
          <StatCard label="Active"    value={stats.active}    color="text-blue-400"   />
          <StatCard label="Completed" value={stats.completed} color="text-green-400"  />
          <StatCard label="Failed"    value={stats.failed}    color="text-red-400"    />
          <StatCard label="Co. URLs"  value={stats.companyUrlCount} color="text-teal-400" />
        </div>
      )}

      {/* ── 🚀 Crawl All ───────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-700/40 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Zap size={16} className="text-yellow-400" />
              Crawl All Sources
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

      {/* ── Individual source cards ─────────────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-4">

        {/* Sitemap */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Map size={16} className="text-purple-400" />
            <h3 className="font-semibold text-white text-sm">Sitemap</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Fetch <code className="text-purple-300 bg-purple-900/30 px-1 rounded">
              /sitemap.aspx
            </code>, extract all page URLs (XML or HTML), and queue each for indexing.
          </p>
          <button
            onClick={handleSitemap}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
          >
            {loading['sitemap'] ? <Loader2 size={13} className="animate-spin" /> : <Map size={13} />}
            Crawl Sitemap
          </button>
        </div>

        {/* Company URLs */}
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
            Crawl every company page URL stored in the{' '}
            <code className="text-teal-300 bg-teal-900/30 px-1 rounded">companies</code> table.
            Add URLs in the <a href="/admin/knowledge" className="underline">Knowledge → Companies</a> tab.
          </p>
          <button
            onClick={handleCompanies}
            disabled={anyLoading || (stats?.companyUrlCount === 0)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
          >
            {loading['companies'] ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />}
            Crawl Company Pages
          </button>
          {stats?.companyUrlCount === 0 && (
            <p className="text-xs text-yellow-600 flex items-center gap-1">
              <AlertCircle size={11} />
              No company URLs yet — add them in Knowledge → Companies
            </p>
          )}
        </div>

        {/* Full site crawl */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-400" />
            <h3 className="font-semibold text-white text-sm">Full Site Crawl</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Start a recursive crawl from a root URL, following all same-domain
            links up to 3 levels deep (max 500 pages).
          </p>
          <button
            onClick={handleSiteCrawl}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
          >
            {loading['site'] ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Crawl www.msx.om
          </button>
        </div>

        {/* Single page */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Link size={16} className="text-orange-400" />
            <h3 className="font-semibold text-white text-sm">Single Page</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Index one specific page immediately — useful for re-indexing an
            updated page or testing a URL.
          </p>
          <div className="flex gap-2">
            <input
              value={singleUrl}
              onChange={e => setSingleUrl(e.target.value)}
              placeholder="https://www.msx.om/…"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 font-mono"
              onKeyDown={e => e.key === 'Enter' && handleSinglePage()}
            />
            <button
              onClick={handleSinglePage}
              disabled={anyLoading || !singleUrl.trim()}
              className="px-3 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition"
            >
              {loading['single'] ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Recent Results
          </h2>
          {results.map((r, i) => (
            <ResultPanel
              key={i}
              result={r}
              onClose={() => setResults(prev => prev.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      {/* ── Schedule notice ─────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={15} className="text-purple-400" />
          <h2 className="font-semibold text-white text-sm">Auto-Training Schedule</h2>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          The system recrawls <code className="text-blue-400">www.msx.om</code> every{' '}
          <strong className="text-white">24 hours</strong> automatically.
          Set <code className="text-blue-400">SCRAPER_RECRAWL_HOURS</code> in .env to adjust.
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
          <CheckCircle size={12} />
          Daily recrawl active
        </div>
      </div>

    </div>
  )
}
