'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Building2, Search, RefreshCw, TrendingUp, TrendingDown,
  Newspaper, DollarSign, BarChart2, Users, AlertCircle,
  ChevronLeft, ChevronRight, CheckCircle, XCircle, Globe,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  getPgCompanies,
  getCompanySnapshot,
  getCompanyNews,
  getCompanyChart,
  getCompanyDividends,
  getCompanyFinancial,
  getCompanyBoard,
  getCompanyOwnership,
} from '../../../lib/api'

// ─── Tab definitions ─────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',   label: 'Overview',   icon: TrendingUp },
  { id: 'chart',      label: 'Chart',      icon: BarChart2 },
  { id: 'news',       label: 'News',       icon: Newspaper },
  { id: 'dividends',  label: 'Dividends',  icon: DollarSign },
  { id: 'financial',  label: 'Financial',  icon: BarChart2 },
  { id: 'board',      label: 'Board',      icon: Users },
]

const CHART_PERIODS = [
  { label: '1W', value: '1w' },
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: '5Y', value: '5y' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: any) {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

function isPositive(v: any) {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return !isNaN(n) && n > 0
}

function isNegative(v: any) {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return !isNaN(n) && n < 0
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw className="animate-spin text-blue-400" size={24} />
    </div>
  )
}

function ErrorBlock({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-red-400 text-sm py-8 justify-center">
      <AlertCircle size={16} /> {msg}
    </div>
  )
}

function KeyValueGrid({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!entries.length) return <p className="text-gray-500 text-sm">No data available</p>
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-gray-800 rounded-lg px-3 py-2">
          <p className="text-xs text-gray-500 mb-0.5">{k}</p>
          <p className={`text-sm font-semibold ${
            isPositive(v) ? 'text-green-400' : isNegative(v) ? 'text-red-400' : 'text-white'
          }`}>
            {fmt(v)}
          </p>
        </div>
      ))}
    </div>
  )
}

function NewsList({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-gray-500 text-sm">No news available</p>
  return (
    <div className="space-y-3">
      {data.slice(0, 20).map((item, i) => (
        <div key={i} className="bg-gray-800 rounded-lg p-3">
          <p className="text-sm text-white font-medium leading-snug">
            {item.TitleEn ?? item.TitleAr ?? item.Title ?? item.title ?? 'Announcement'}
          </p>
          {(item.DateEn ?? item.Date ?? item.date) && (
            <p className="text-xs text-gray-500 mt-1">
              {item.DateEn ?? item.Date ?? item.date}
            </p>
          )}
          {(item.DescriptionEn ?? item.Description) && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">
              {item.DescriptionEn ?? item.Description}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function DividendsList({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-gray-500 text-sm">No dividend data available</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[500px]">
        <thead>
          <tr className="border-b border-gray-700 text-gray-500">
            {Object.keys(data[0] ?? {}).slice(0, 6).map(k => (
              <th key={k} className="text-left py-2 px-3 font-medium text-xs">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 20).map((row, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              {Object.values(row).slice(0, 6).map((v: any, j) => (
                <td key={j} className="py-2 px-3 text-gray-300 text-xs">{fmt(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoardList({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-gray-500 text-sm">No board data available</p>
  return (
    <div className="space-y-2">
      {data.slice(0, 20).map((member, i) => (
        <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-blue-800 flex items-center justify-center text-sm font-bold text-blue-300">
            {String(member.NameEn ?? member.Name ?? member.name ?? '?')[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-sm text-white font-medium">
              {member.NameEn ?? member.Name ?? member.name}
            </p>
            <p className="text-xs text-gray-500">
              {member.RoleEn ?? member.Role ?? member.role ?? member.Position}
            </p>
          </div>
          {(member.Type ?? member.MemberType) && (
            <span className="ml-auto text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
              {member.Type ?? member.MemberType}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Chart panel with period selector ────────────────────────────────────────

function ChartPanel({ symbol }: { symbol: string }) {
  const [period, setPeriod] = useState('1m')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await getCompanyChart(symbol, period)
      const raw = Array.isArray(r.data) ? r.data : (r.data?.data ?? [])
      // Normalize: we expect {date/Date, close/Close/LTP, ...}
      const normalized = raw.map((item: any) => ({
        date: item.Date ?? item.date ?? item.TradeDate,
        price: parseFloat(item.Close ?? item.close ?? item.LTP ?? item.ClosePrice ?? 0),
        volume: parseInt(item.Volume ?? item.volume ?? 0, 10),
      })).filter((d: any) => d.date && !isNaN(d.price) && d.price > 0)
      setData(normalized)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e.message ?? 'Failed to load chart')
    } finally {
      setLoading(false)
    }
  }, [symbol, period])

  useEffect(() => { load() }, [load])

  const minPrice = data.length ? Math.min(...data.map(d => d.price)) : 0
  const maxPrice = data.length ? Math.max(...data.map(d => d.price)) : 0
  const firstPrice = data[0]?.price ?? 0
  const lastPrice = data[data.length - 1]?.price ?? 0
  const changeVal = lastPrice - firstPrice
  const changePct = firstPrice ? ((changeVal / firstPrice) * 100).toFixed(2) : '0'
  const isUp = changeVal >= 0

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex gap-1">
        {CHART_PERIODS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setPeriod(value)}
            className={`px-3 py-1 text-xs rounded font-medium transition ${
              period === value
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorBlock msg={error} />
      ) : !data.length ? (
        <p className="text-gray-500 text-sm py-8 text-center">No chart data for this period</p>
      ) : (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 px-1">
            <span className="text-2xl font-bold text-white">{lastPrice.toFixed(3)}</span>
            <span className={`flex items-center gap-1 text-sm font-medium ${isUp ? 'text-green-400' : 'text-red-400'}`}>
              {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {isUp ? '+' : ''}{changeVal.toFixed(3)} ({isUp ? '+' : ''}{changePct}%)
            </span>
            <span className="text-xs text-gray-500 ml-auto">
              Range: {minPrice.toFixed(3)} – {maxPrice.toFixed(3)}
            </span>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={(v: string) => v?.slice(0, 5) ?? ''}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={(v: number) => v.toFixed(2)}
                width={50}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                itemStyle={{ color: isUp ? '#22c55e' : '#ef4444', fontSize: 12 }}
                formatter={(v: number) => [v.toFixed(3), 'Price']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={isUp ? '#22c55e' : '#ef4444'}
                strokeWidth={2}
                fill="url(#priceGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

// ─── Overview panel ───────────────────────────────────────────────────────────

function OverviewPanel({ symbol }: { symbol: string }) {
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null)
  const [ownership, setOwnership] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getCompanySnapshot(symbol).catch(() => null),
      getCompanyOwnership(symbol).catch(() => null),
    ]).then(([snap, own]) => {
      const s = Array.isArray(snap?.data) ? snap.data[0] : snap?.data
      setSnapshot(s ?? null)
      setOwnership(own?.data ?? null)
    }).catch(() => setError('Failed to load snapshot'))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorBlock msg={error} />
  if (!snapshot) return <p className="text-gray-500 text-sm py-8">No snapshot data</p>

  // Key price fields
  const priceFields: Record<string, any> = {}
  const PRICE_LABELS: Record<string, string> = {
    LTP: 'Last Price', ClosePrice: 'Close', OpenPrice: 'Open',
    High: 'High', Low: 'Low', PrevClose: 'Prev Close',
    Change: 'Change %', ChangeVal: 'Change Value',
    Volume: 'Volume', Turnover: 'Turnover', NoOfTrades: 'Trades',
  }
  for (const [k, label] of Object.entries(PRICE_LABELS)) {
    if (snapshot[k] !== undefined && snapshot[k] !== null && snapshot[k] !== '') {
      priceFields[label] = snapshot[k]
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-white">
          {fmt(snapshot.LTP ?? snapshot.ClosePrice)}
        </span>
        <span className={`text-lg font-semibold ${
          isNegative(snapshot.Change) ? 'text-red-400' : 'text-green-400'
        }`}>
          {snapshot.Change ? `${parseFloat(snapshot.Change) >= 0 ? '+' : ''}${snapshot.Change}%` : ''}
        </span>
      </div>

      <KeyValueGrid data={priceFields} />

      {/* Company info */}
      {(snapshot.LongNameEn || snapshot.ShortNameEn) && (
        <div className="bg-gray-800/50 rounded-lg p-3 text-sm">
          <p className="text-white font-medium">{snapshot.LongNameEn ?? snapshot.ShortNameEn}</p>
          {snapshot.LongNameAr && (
            <p className="text-gray-400 text-right mt-0.5" dir="rtl">{snapshot.LongNameAr}</p>
          )}
          {snapshot.GroupEn && <p className="text-gray-500 text-xs mt-1">{snapshot.GroupEn}</p>}
        </div>
      )}

      {/* Ownership quick view */}
      {ownership && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Ownership</p>
          <KeyValueGrid data={
            Array.isArray(ownership) ? (ownership[0] ?? {}) : ownership
          } />
        </div>
      )}
    </div>
  )
}

// ─── Generic data panel ───────────────────────────────────────────────────────

function DataPanel({
  symbol,
  fetcher,
  renderer,
}: {
  symbol: string
  fetcher: (sym: string) => Promise<any>
  renderer: (data: any) => React.ReactNode
}) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetcher(symbol)
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message ?? e.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [symbol, fetcher])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorBlock msg={error} />
  return <>{renderer(data)}</>
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [totalCo, setTotalCo] = useState(0)
  const [coPage, setCoPage] = useState(1)
  const [coSearch, setCoSearch] = useState('')
  const [coLoading, setCoLoading] = useState(true)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [tab, setTab] = useState('overview')
  const [symbolInput, setSymbolInput] = useState('')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const PER_PAGE = 20
  const totalPages = Math.max(1, Math.ceil(totalCo / PER_PAGE))

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const loadCompanies = useCallback(async () => {
    setCoLoading(true)
    try {
      const r = await getPgCompanies(coPage, PER_PAGE, coSearch || undefined)
      setCompanies(r.data.data ?? r.data.items ?? [])
      setTotalCo(r.data.total ?? 0)
    } catch {
      showToast('Failed to load companies', false)
    } finally {
      setCoLoading(false)
    }
  }, [coPage, coSearch])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCoPage(1)
    loadCompanies()
  }

  const handleSelectCompany = (co: any) => {
    const sym = co.symbol
    if (sym) { setSelectedSymbol(sym); setTab('overview') }
  }

  const handleManualSymbol = (e: React.FormEvent) => {
    e.preventDefault()
    const sym = symbolInput.trim().toUpperCase()
    if (sym) { setSelectedSymbol(sym); setTab('overview'); setSymbolInput('') }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Building2 className="text-blue-400" size={24} />
        <div>
          <h1 className="text-xl font-bold text-white">Company Manager</h1>
          <p className="text-sm text-gray-400">Live MSX.om company data — snapshot, chart, news, financials</p>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Left panel: company list ─────────────────────── */}
        <div className="lg:col-span-1 space-y-3">
          {/* Manual symbol lookup */}
          <form onSubmit={handleManualSymbol} className="flex gap-2">
            <input
              value={symbolInput}
              onChange={e => setSymbolInput(e.target.value.toUpperCase())}
              placeholder="Enter ticker (e.g. OQEP)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg transition"
            >
              Go
            </button>
          </form>

          {/* Search companies DB */}
          <form onSubmit={handleSearch} className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={coSearch}
              onChange={e => setCoSearch(e.target.value)}
              placeholder="Search company name…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </form>

          {/* Company list */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 flex items-center justify-between">
              <span>{totalCo} companies</span>
              <button onClick={loadCompanies} className="text-gray-600 hover:text-gray-400 transition">
                <RefreshCw size={12} className={coLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {coLoading ? (
              <div className="py-8 text-center text-gray-600 text-sm">Loading…</div>
            ) : companies.length === 0 ? (
              <div className="py-8 text-center text-gray-600 text-sm">No companies</div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-800/50">
                {companies.map((co, i) => {
                  const sym = co.symbol ?? '?'
                  const name = co.long_name_en ?? co.short_name_en ?? sym
                  const isActive = selectedSymbol === sym
                  return (
                    <button
                      key={co.id ?? i}
                      onClick={() => handleSelectCompany(co)}
                      className={`w-full text-left px-3 py-2.5 transition hover:bg-gray-800/60 ${
                        isActive ? 'bg-blue-900/30 border-l-2 border-blue-500' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-blue-300">{sym}</span>
                        <div className="flex items-center gap-1.5">
                          {co.market_id && (
                            <span className="text-xs text-gray-600">{co.market_id}</span>
                          )}
                          {co.url && (
                            <a
                              href={co.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-gray-600 hover:text-blue-400 transition"
                              title={co.url}
                            >
                              <Globe size={11} />
                            </a>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{name}</p>
                      {co.clone_name && (
                        <p className="text-xs text-gray-600 truncate leading-tight">
                          {co.clone_name}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-800">
                <button
                  onClick={() => setCoPage(p => Math.max(1, p - 1))}
                  disabled={coPage === 1}
                  className="text-gray-500 hover:text-gray-300 disabled:opacity-30 transition"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-gray-500">{coPage}/{totalPages}</span>
                <button
                  onClick={() => setCoPage(p => Math.min(totalPages, p + 1))}
                  disabled={coPage === totalPages}
                  className="text-gray-500 hover:text-gray-300 disabled:opacity-30 transition"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right panel: detail view ─────────────────────── */}
        <div className="lg:col-span-2">
          {!selectedSymbol ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-600">
              <Building2 size={48} className="mb-3 opacity-20" />
              <p className="text-sm">Select a company or enter a ticker symbol</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Company header */}
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">{selectedSymbol}</h2>
                  <p className="text-xs text-gray-500">
                    {companies.find(c => c.symbol === selectedSymbol)?.long_name_en
                      ?? companies.find(c => c.symbol === selectedSymbol)?.short_name_en
                      ?? 'Live data from MSX.om'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedSymbol(null)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition px-2 py-1 bg-gray-800 rounded"
                >
                  Close
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-0 border-b border-gray-800 overflow-x-auto">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition border-b-2 -mb-px ${
                      tab === id
                        ? 'border-blue-500 text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-5">
                {tab === 'overview' && (
                  <OverviewPanel symbol={selectedSymbol} />
                )}

                {tab === 'chart' && (
                  <ChartPanel symbol={selectedSymbol} />
                )}

                {tab === 'news' && (
                  <DataPanel
                    symbol={selectedSymbol}
                    fetcher={getCompanyNews}
                    renderer={data => (
                      <NewsList data={Array.isArray(data) ? data : (data?.data ?? [])} />
                    )}
                  />
                )}

                {tab === 'dividends' && (
                  <DataPanel
                    symbol={selectedSymbol}
                    fetcher={getCompanyDividends}
                    renderer={data => (
                      <DividendsList data={Array.isArray(data) ? data : (data?.data ?? [])} />
                    )}
                  />
                )}

                {tab === 'financial' && (
                  <DataPanel
                    symbol={selectedSymbol}
                    fetcher={getCompanyFinancial}
                    renderer={data => {
                      const obj = Array.isArray(data) ? data[0] : data
                      return obj
                        ? <KeyValueGrid data={typeof obj === 'object' ? obj : {}} />
                        : <p className="text-gray-500 text-sm">No financial data</p>
                    }}
                  />
                )}

                {tab === 'board' && (
                  <DataPanel
                    symbol={selectedSymbol}
                    fetcher={getCompanyBoard}
                    renderer={data => (
                      <BoardList data={Array.isArray(data) ? data : (data?.data ?? [])} />
                    )}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
