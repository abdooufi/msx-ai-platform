'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, RefreshCcw, Search,
  Activity, BarChart2, Clock, Loader2,
} from 'lucide-react'
import api from '../../../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Snapshot {
  LTP?: number | string
  ClosePrice?: number | string
  OpenPrice?: number | string
  High?: number | string
  Low?: number | string
  PrevClose?: number | string
  Change?: number | string
  ChangeVal?: number | string
  Volume?: number | string
  Turnover?: number | string
  NoOfTrades?: number | string
  BidPrice?: number | string
  AskPrice?: number | string
  ShortNameEn?: string
  LongNameEn?: string
  Symbol?: string
  Image?: string
  // after FIELD_MAP transform the backend may return readable keys
  [key: string]: any
}

interface TradePoint {
  time: string
  price: number
  volume: number
  raw: number   // index for stable x-axis
}

const QUICK_SYMBOLS = [
  'OQEP', 'OQEB', 'BKMB', 'NBO', 'NRIC', 'GSM', 'MERI',
  'AIOM', 'OMAN', 'HBMO', 'MBSB', 'ROON', 'HSMO', 'BKDB',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

function fmt(v: any, decimals = 3): string {
  const n = num(v)
  if (n === 0) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtVol(v: any): string {
  const n = num(v)
  if (n === 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

/** Normalize raw chart-data array → TradePoint[] */
function normalizeChartData(raw: any): TradePoint[] {
  if (!raw) return []

  // MSX returns either an array of trade rows or nested under .d
  const arr: any[] = Array.isArray(raw) ? raw
    : Array.isArray(raw?.d) ? raw.d
    : []

  return arr
    .map((row: any, i: number) => {
      const price  = num(row.LTP ?? row.ltp ?? row.Price ?? row.price ?? 0)
      // MSX: Volume = shares per tick; Value = same; Turnover often 0
      const shares = num(row.Volume ?? row.Value ?? row.volume ?? 0)

      // Build time from Hour + Minute (real MSX field names)
      const h = String(row.Hour   ?? 0).padStart(2, '0')
      const m = String(row.Minute ?? 0).padStart(2, '0')
      const time = (row.Hour !== undefined || row.Minute !== undefined)
        ? `${h}:${m}`
        : String(row.Time ?? row.TradeTime ?? row.DateTime ?? i)
            .replace(/^.*T/, '').replace(/\.\d+.*$/, '')

      return { time, price, volume: shares, raw: i }
    })
    .filter(p => p.price > 0)
    .sort((a, b) => a.raw - b.raw)   // preserve original order (already time-sorted by MSX)
}

/** Extract a readable value from the snapshot (backend may or may not apply FIELD_MAP) */
function snap(s: Snapshot, ...keys: string[]): string {
  for (const k of keys) {
    const v = s[k]
    if (v !== undefined && v !== null && v !== '' && v !== '0') return String(v)
  }
  return '—'
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const { price, volume, time } = payload[0]?.payload ?? {}
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{time || label}</p>
      <p className="text-white font-mono font-bold">{fmt(price)}</p>
      <p className="text-gray-400">Vol: {fmtVol(volume)}</p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketPage() {
  const [symbol, setSymbol]     = useState('OQEB')
  const [input, setInput]       = useState('OQEB')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [chartData, setChartData] = useState<TradePoint[]>([])
  const [loading, setLoading]   = useState(false)
  const [loadingChart, setLoadingChart] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSnapshot = useCallback(async (sym: string) => {
    try {
      const { data } = await api.get(`/admin/companies/snapshot/${sym.toUpperCase()}`)
      // MSX wraps the snapshot in an array: [{LTP, OpenPrice, High, Low, ...}]
      // Extract the first element if it's an array
      const raw = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {})
      setSnapshot(raw as Snapshot)
    } catch {
      setSnapshot(null)
    }
  }, [])

  const fetchChart = useCallback(async (sym: string) => {
    setLoadingChart(true)
    try {
      const { data } = await api.get(`/admin/companies/chart/${sym.toUpperCase()}`)
      setChartData(normalizeChartData(data))
    } catch {
      setChartData([])
    } finally {
      setLoadingChart(false)
    }
  }, [])

  const load = useCallback(async (sym: string) => {
    const s = sym.trim().toUpperCase()
    if (!s) return
    setLoading(true)
    setError(null)
    setSymbol(s)
    setInput(s)
    await Promise.all([fetchSnapshot(s), fetchChart(s)])
    setLastUpdated(new Date())
    setLoading(false)
  }, [fetchSnapshot, fetchChart])

  // Initial load
  useEffect(() => { load('OQEB') }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    refreshTimer.current = setInterval(() => {
      fetchSnapshot(symbol)
      fetchChart(symbol)
      setLastUpdated(new Date())
    }, 60_000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [symbol, fetchSnapshot, fetchChart])

  // ── Derived stats ────────────────────────────────────────────────────────

  // Raw MSX field names (backend returns the unwrapped array element as-is)
  const ltp       = num(snapshot?.LTP)
  const prevClose = num(snapshot?.PrevClose)
  const change    = num(snapshot?.Change)
  const changeVal = num(snapshot?.ChangeVal)
  const isUp      = change >= 0

  const priceMin  = chartData.length ? Math.min(...chartData.map(d => d.price)) : 0
  const priceMax  = chartData.length ? Math.max(...chartData.map(d => d.price)) : 0
  const pricePad  = (priceMax - priceMin) * 0.05 || 0.01
  const openLine  = num(snapshot?.OpenPrice)

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold text-white">Market Chart</h1>
        </div>

        {/* Search bar */}
        <form
          onSubmit={e => { e.preventDefault(); load(input) }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              placeholder="Symbol (e.g. OQEB)"
              className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-40 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : 'Load'}
          </button>
          <button
            type="button"
            onClick={() => load(symbol)}
            disabled={loading}
            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-sm rounded-lg border border-gray-700 transition"
            title="Refresh"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </form>
      </div>

      {/* ── Quick symbol picks ───────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_SYMBOLS.map(s => (
          <button
            key={s}
            onClick={() => load(s)}
            className={`text-xs font-mono px-2.5 py-1 rounded-md transition ${
              symbol === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Snapshot stats strip ─────────────────────────────────────────── */}
      {snapshot && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          {/* Company name + price hero */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <p className="text-xs text-gray-500 font-mono mb-0.5">{symbol}</p>
              <p className="text-white font-semibold text-base leading-tight">
                {snap(snapshot, 'LongNameEn', 'ShortNameEn', symbol)}
              </p>
            </div>

            <div className="text-right">
              <p className="text-3xl font-bold text-white font-mono tabular-nums">
                {ltp > 0 ? fmt(ltp) : '—'}
              </p>
              <div className={`flex items-center justify-end gap-1.5 mt-1 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                <span className="text-sm font-mono">
                  {changeVal !== 0 ? (isUp ? '+' : '') + fmt(changeVal, 3) : ''}
                  {change !== 0 ? ` (${isUp ? '+' : ''}${fmt(change, 2)}%)` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-4">
            {[
              { label: 'Open',       value: fmt(snap(snapshot, 'OpenPrice')) },
              { label: 'High',       value: fmt(snap(snapshot, 'High')) },
              { label: 'Low',        value: fmt(snap(snapshot, 'Low')) },
              { label: 'Prev Close', value: fmt(snap(snapshot, 'PrevClose')) },
              { label: 'Volume',     value: fmtVol(snap(snapshot, 'Volume')) },
              { label: 'Turnover',   value: fmtVol(snap(snapshot, 'Turnover')) },
              { label: 'Trades',     value: snap(snapshot, 'NoOfTrades') },
              { label: 'Bid / Ask',  value: `${fmt(snap(snapshot, 'BidPrice'))} / ${fmt(snap(snapshot, 'AskPrice'))}` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800/60 rounded-lg px-3 py-2.5">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className="text-white text-sm font-mono font-medium">{value}</p>
              </div>
            ))}
          </div>

          {lastUpdated && (
            <div className="flex items-center gap-1 text-xs text-gray-600 mt-3">
              <Clock size={11} />
              Last updated: {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 60s
            </div>
          )}
        </div>
      )}

      {/* ── Price chart ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Intraday Price</h2>
            <span className="text-xs text-gray-600 font-mono">{symbol}</span>
          </div>
          {chartData.length > 0 && (
            <span className="text-xs text-gray-500">{chartData.length} trades</span>
          )}
        </div>

        {/* Latest trade badge */}
        {chartData.length > 0 && (() => {
          const last = chartData[chartData.length - 1]
          return (
            <div className="flex items-center gap-3 mb-3 bg-gray-800/50 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-gray-400">Latest trade</span>
              <span className="text-xs font-mono font-bold text-white">{last.time}</span>
              <span className={`text-xs font-mono font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                {last.price.toFixed(3)} OMR
              </span>
              <span className="text-xs text-gray-500">
                {fmtVol(last.volume)} shares
              </span>
            </div>
          )
        })()}

        {loadingChart ? (
          <div className="h-64 flex items-center justify-center text-gray-500 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading chart data…</span>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-600 text-sm">
            No intraday trades available for {symbol} today.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                domain={[priceMin - pricePad, priceMax + pricePad]}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => v.toFixed(3)}
                width={56}
              />
              <Tooltip content={<PriceTooltip />} />
              {openLine > 0 && (
                <ReferenceLine
                  y={openLine}
                  stroke="#6b7280"
                  strokeDasharray="4 3"
                  label={{ value: 'Open', fill: '#6b7280', fontSize: 10, position: 'insideTopRight' }}
                />
              )}
              {prevClose > 0 && (
                <ReferenceLine
                  y={prevClose}
                  stroke="#f59e0b"
                  strokeDasharray="4 3"
                  label={{ value: 'Prev', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }}
                />
              )}
              <Area
                type="monotone"
                dataKey="price"
                stroke={isUp ? '#22c55e' : '#ef4444'}
                strokeWidth={2}
                fill="url(#priceGrad)"
                dot={false}
                activeDot={{ r: 4, fill: isUp ? '#22c55e' : '#ef4444', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Volume bars ──────────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-purple-400" />
            <h2 className="text-sm font-semibold text-white">Volume</h2>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={chartData} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtVol}
                width={48}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-gray-400">{payload[0]?.payload?.time}</p>
                      <p className="text-purple-300">Vol: {fmtVol(payload[0]?.value)}</p>
                    </div>
                  ) : null
                }
              />
              <Bar dataKey="volume" fill="#7c3aed" opacity={0.7} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
