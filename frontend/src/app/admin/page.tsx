'use client'

import { useEffect, useState } from 'react'
import {
  MessageSquare, TrendingUp, AlertCircle, CheckCircle,
  Database, Zap, Globe, RefreshCcw, Clock,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { getStats } from '../../lib/api'
import { DashboardStats } from '../../types'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getStats()
      setStats(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCcw size={20} className="animate-spin text-blue-400" />
      </div>
    )
  }

  const langData = Object.entries(stats.langBreakdown || {}).map(([name, value]) => ({ name, value }))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition">
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<MessageSquare size={18} />} label="Total Conversations" value={stats.conversations} color="blue" />
        <StatCard icon={<Zap size={18} />} label="Messages Sent" value={stats.messages} color="purple" />
        <StatCard icon={<CheckCircle size={18} />} label="Success Rate" value={`${stats.successRate}%`} color="green" />
        <StatCard icon={<Clock size={18} />} label="Avg Latency" value={`${stats.avgLatencyMs}ms`} color="yellow" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<AlertCircle size={18} />} label="Failed" value={stats.failed} color="red" />
        <StatCard icon={<TrendingUp size={18} />} label="Positive Feedback" value={stats.feedback?.positive} color="green" />
        <StatCard icon={<Database size={18} />} label="Vectors Indexed" value={stats.ragStats?.qdrantVectors} color="blue" />
        <StatCard icon={<Globe size={18} />} label="KB Documents" value={stats.ragStats?.mongoDocuments} color="purple" />
      </div>

      {/* ── Charts ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily volume */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Message Volume (30 days)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.dailyMessages.map(d => ({ date: d._id.slice(5), count: d.count }))}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#d1d5db' }}
              />
              <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#grad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Language distribution */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Language Distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={langData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {langData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Feedback */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">User Feedback</h2>
        <div className="flex gap-8">
          <FeedbackBar label="Positive" value={stats.feedback?.positive || 0} total={(stats.feedback?.positive || 0) + (stats.feedback?.negative || 0)} color="#10b981" />
          <FeedbackBar label="Negative" value={stats.feedback?.negative || 0} total={(stats.feedback?.positive || 0) + (stats.feedback?.negative || 0)} color="#ef4444" />
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: any; color: string }) {
  const colors: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-900/30 border-blue-800/50',
    green: 'text-green-400 bg-green-900/30 border-green-800/50',
    purple: 'text-purple-400 bg-purple-900/30 border-purple-800/50',
    yellow: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50',
    red: 'text-red-400 bg-red-900/30 border-red-800/50',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2 opacity-80">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
    </div>
  )
}

function FeedbackBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex-1">
      <div className="flex justify-between text-xs text-gray-400 mb-1"><span>{label}</span><span>{value} ({pct}%)</span></div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
