'use client'

import { useEffect, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { TrendingUp, RefreshCcw, MessageSquare, Globe, Monitor, Star } from 'lucide-react'
import { getAnalytics } from '../../../lib/api'

const LANG_COLORS: Record<string, string> = {
  en: '#3b82f6', ar: '#8b5cf6', other: '#6b7280',
}
const CHANNEL_COLORS: Record<string, string> = {
  web: '#3b82f6', widget: '#10b981', whatsapp: '#25d366', telegram: '#0088cc', other: '#6b7280',
}
const FALLBACK_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

export default function AnalyticsPage() {
  const [data, setData]       = useState<any>(null)
  const [days, setDays]       = useState(7)
  const [loading, setLoading] = useState(false)

  const load = async (d = days) => {
    setLoading(true)
    try {
      const res = await getAnalytics(d)
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(days) }, [days])

  // Derived datasets
  const volumeData = (data?.volume || []).map((d: any) => ({
    date:  String(d._id || '').slice(5) || d._id,
    count: d.count,
  }))

  const langData = Object.entries(data?.languages || {}).map(([name, value]) => ({
    name: name.toUpperCase(),
    value: value as number,
    color: LANG_COLORS[name] || FALLBACK_COLORS[0],
  }))

  const channelData = Object.entries(data?.channels || {}).map(([name, value], i) => ({
    name,
    value: value as number,
    color: CHANNEL_COLORS[name] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }))

  const totalMessages = volumeData.reduce((s: number, d: any) => s + d.count, 0)
  const avgConf       = data?.avgConfidence ?? 0
  const topLang       = langData.sort((a, b) => b.value - a.value)[0]?.name || '—'
  const topChannel    = channelData.sort((a, b) => b.value - a.value)[0]?.name || '—'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold text-white">Analytics</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-md text-sm transition font-medium ${
                  days === d ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => load(days)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition"
          >
            <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCcw size={20} className="animate-spin text-blue-400" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              icon={<MessageSquare size={16} />}
              label={`Messages (${days}d)`}
              value={totalMessages.toLocaleString()}
              color="blue"
            />
            <KPICard
              icon={<Star size={16} />}
              label="Avg Confidence"
              value={`${(avgConf * 100).toFixed(1)}%`}
              color="green"
            />
            <KPICard
              icon={<Globe size={16} />}
              label="Top Language"
              value={topLang}
              color="purple"
            />
            <KPICard
              icon={<Monitor size={16} />}
              label="Top Channel"
              value={topChannel}
              color="yellow"
            />
          </div>

          {/* Volume bar chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">
              Message Volume — last {days} days
            </h2>
            {volumeData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volumeData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#d1d5db' }}
                  />
                  <Bar dataKey="count" name="Messages" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Two columns: language + channel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Language distribution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4">Language Distribution</h2>
              {langData.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={langData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {langData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: '#9ca3af' }}
                      formatter={(v) => v}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel distribution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4">Channel Distribution</h2>
              {channelData.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={channelData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {channelData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: '#9ca3af' }}
                      formatter={(v) => v}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Confidence area chart */}
          {volumeData.length > 1 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-1">Daily Message Volume Trend</h2>
              <p className="text-xs text-gray-500 mb-4">Cumulative messages per day</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={volumeData}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#d1d5db' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Messages"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#volGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Avg confidence card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Average RAG Confidence</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(avgConf * 100).toFixed(1)}%`,
                      background: avgConf >= 0.7
                        ? '#10b981'
                        : avgConf >= 0.4
                        ? '#f59e0b'
                        : '#ef4444',
                    }}
                  />
                </div>
              </div>
              <span className={`text-2xl font-bold ${
                avgConf >= 0.7 ? 'text-green-400' : avgConf >= 0.4 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {(avgConf * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {avgConf >= 0.7
                ? '✅ High confidence — RAG is finding relevant context consistently.'
                : avgConf >= 0.4
                ? '⚠️ Moderate confidence — consider adding more documents or recrawling.'
                : '❌ Low confidence — the knowledge base may need more content.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
      No data for this period
    </div>
  )
}

function KPICard({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
}) {
  const c: Record<string, string> = {
    blue:   'text-blue-400   bg-blue-900/30   border-blue-800/50',
    green:  'text-green-400  bg-green-900/30  border-green-800/50',
    purple: 'text-purple-400 bg-purple-900/30 border-purple-800/50',
    yellow: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50',
    red:    'text-red-400    bg-red-900/30    border-red-800/50',
  }
  return (
    <div className={`rounded-xl border p-4 ${c[color] ?? c.blue}`}>
      <div className="flex items-center gap-2 mb-2 opacity-80">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white truncate">{value}</p>
    </div>
  )
}
