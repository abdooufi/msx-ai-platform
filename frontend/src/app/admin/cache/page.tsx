'use client'

import { useState, useEffect, useCallback } from 'react'
import { HardDrive, RefreshCw, Trash2, CheckCircle, XCircle, Wifi, WifiOff } from 'lucide-react'
import { getCacheStats, clearApiCache } from '../../../lib/api'

// TTL reference table matching backend CACHE_TTL
const TTL_REFERENCE: Record<string, { seconds: number; label: string }> = {
  trading:      { seconds: 60,    label: '1 minute' },
  company:      { seconds: 300,   label: '5 minutes' },
  chart:        { seconds: 300,   label: '5 minutes' },
  general:      { seconds: 300,   label: '5 minutes' },
  news:         { seconds: 600,   label: '10 minutes' },
  ownership:    { seconds: 3600,  label: '1 hour' },
  financial:    { seconds: 3600,  label: '1 hour' },
  dividends:    { seconds: 3600,  label: '1 hour' },
  governance:   { seconds: 86400, label: '1 day' },
  board:        { seconds: 86400, label: '1 day' },
  subsidiaries: { seconds: 86400, label: '1 day' },
}

const CATEGORY_COLORS: Record<string, string> = {
  trading:      'bg-red-900/40 text-red-300 border-red-800',
  company:      'bg-blue-900/40 text-blue-300 border-blue-800',
  chart:        'bg-purple-900/40 text-purple-300 border-purple-800',
  news:         'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  financial:    'bg-green-900/40 text-green-300 border-green-800',
  ownership:    'bg-orange-900/40 text-orange-300 border-orange-800',
  dividends:    'bg-pink-900/40 text-pink-300 border-pink-800',
  governance:   'bg-gray-700/40 text-gray-300 border-gray-600',
  board:        'bg-gray-700/40 text-gray-300 border-gray-600',
  subsidiaries: 'bg-gray-700/40 text-gray-300 border-gray-600',
  general:      'bg-gray-700/40 text-gray-300 border-gray-600',
}

interface CacheStats {
  connected: boolean
  totalKeys: number
  byCategory: Record<string, number>
  ttlReference: Record<string, number>
}

export default function CachePage() {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearSymbol, setClearSymbol] = useState('')
  const [clearing, setClearing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    try {
      const r = await getCacheStats()
      setStats(r.data)
    } catch {
      showToast('Failed to load cache stats', false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleClearAll = async () => {
    if (!confirm('Clear ALL cache entries? This will cause the next API calls to be slower.')) return
    setClearing(true)
    try {
      const r = await clearApiCache()
      showToast(`Cleared ${r.data.cleared} cache entries`)
      await load()
    } catch {
      showToast('Failed to clear cache', false)
    } finally {
      setClearing(false)
    }
  }

  const handleClearSymbol = async () => {
    const sym = clearSymbol.trim().toUpperCase()
    if (!sym) return
    setClearing(true)
    try {
      const r = await clearApiCache(sym)
      showToast(`Cleared ${r.data.cleared} entries for ${sym}`)
      setClearSymbol('')
      await load()
    } catch {
      showToast('Failed to clear symbol cache', false)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <HardDrive className="text-blue-400" size={24} />
          <div>
            <h1 className="text-xl font-bold text-white">Cache Manager</h1>
            <p className="text-sm text-gray-400">Redis API response cache — MSX.om live data</p>
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

      {loading ? (
        <div className="text-center py-20 text-gray-500">Loading cache stats…</div>
      ) : stats ? (
        <div className="space-y-6">
          {/* Status banner */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
            stats.connected
              ? 'bg-green-900/20 border-green-800 text-green-300'
              : 'bg-red-900/20 border-red-800 text-red-300'
          }`}>
            {stats.connected ? <Wifi size={18} /> : <WifiOff size={18} />}
            <span className="font-medium">
              Redis {stats.connected ? 'Connected' : 'Disconnected — caching disabled'}
            </span>
            {stats.connected && (
              <span className="ml-auto text-sm">
                {stats.totalKeys} cached key{stats.totalKeys !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Stats grid */}
          {stats.connected && stats.totalKeys > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Cache by Category
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {Object.entries(stats.byCategory).map(([cat, count]) => (
                  <div
                    key={cat}
                    className={`px-4 py-3 rounded-lg border text-sm font-medium ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general}`}
                  >
                    <div className="text-lg font-bold">{count}</div>
                    <div className="capitalize">{cat}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clear actions */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Clear by symbol */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Clear Symbol Cache</h2>
              <p className="text-xs text-gray-500 mb-3">
                Remove all cached responses for a specific company ticker.
              </p>
              <div className="flex gap-2">
                <input
                  value={clearSymbol}
                  onChange={e => setClearSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. OQEP"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  onKeyDown={e => e.key === 'Enter' && handleClearSymbol()}
                />
                <button
                  onClick={handleClearSymbol}
                  disabled={clearing || !clearSymbol.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-orange-700 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  Clear
                </button>
              </div>
            </div>

            {/* Clear all */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Clear All Cache</h2>
              <p className="text-xs text-gray-500 mb-3">
                Flush all {stats.totalKeys} cached entries. The next API call for each
                symbol will fetch fresh data from MSX.om.
              </p>
              <button
                onClick={handleClearAll}
                disabled={clearing || stats.totalKeys === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm rounded-lg transition disabled:opacity-50"
              >
                <Trash2 size={13} />
                {clearing ? 'Clearing…' : `Clear All (${stats.totalKeys})`}
              </button>
            </div>
          </div>

          {/* TTL Reference */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
              TTL Reference
            </h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="text-left px-4 py-2.5 font-medium">Category</th>
                    <th className="text-left px-4 py-2.5 font-medium">TTL</th>
                    <th className="text-left px-4 py-2.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(TTL_REFERENCE).map(([cat, { label }]) => (
                    <tr key={cat} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize border ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general}`}>
                          {cat}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{label}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">
                        {cat === 'trading' && 'Real-time trades — freshness critical'}
                        {cat === 'company' && 'Live snapshot — price changes frequently'}
                        {cat === 'chart'   && 'Historical OHLCV — updates every few minutes'}
                        {cat === 'news'    && 'Announcements — updated hourly'}
                        {cat === 'financial' && 'Quarterly results — stable'}
                        {cat === 'ownership' && 'Shareholding structure — changes infrequently'}
                        {cat === 'dividends' && 'Dividend history — semi-annual updates'}
                        {cat === 'governance' && 'Reports — annual updates'}
                        {cat === 'board'      && 'Directors — changes rarely'}
                        {cat === 'subsidiaries' && 'Group structure — changes rarely'}
                        {cat === 'general'   && 'Default TTL'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-gray-500">No data available</div>
      )}
    </div>
  )
}
