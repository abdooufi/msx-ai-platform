'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight,
  Filter, Calendar, User, Activity, Search,
} from 'lucide-react'
import { getAuditLogs, getAuditStats } from '../../../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditLog {
  _id: string
  userEmail: string
  userRole: string
  action: string
  resource: string
  resourceId?: string
  details: string
  ip: string
  userAgent: string
  createdAt: string
  changes?: { before?: any; after?: any }
}

interface Stats {
  total: number
  today: number
  byAction: { _id: string; count: number }[]
}

// ─── Action colour map ────────────────────────────────────────────────────────

const ACTION_COLOR: Record<string, string> = {
  login:           'bg-green-900/40 text-green-300',
  login_failed:    'bg-red-900/40 text-red-300',
  logout:          'bg-gray-700/60 text-gray-300',
  user_create:     'bg-blue-900/40 text-blue-300',
  user_update:     'bg-blue-900/40 text-blue-300',
  user_delete:     'bg-red-900/40 text-red-300',
  password_change: 'bg-amber-900/40 text-amber-300',
  kb_create:       'bg-purple-900/40 text-purple-300',
  kb_update:       'bg-purple-900/40 text-purple-300',
  kb_delete:       'bg-red-900/40 text-red-300',
  faq_create:      'bg-indigo-900/40 text-indigo-300',
  faq_update:      'bg-indigo-900/40 text-indigo-300',
  faq_delete:      'bg-red-900/40 text-red-300',
  company_create:  'bg-teal-900/40 text-teal-300',
  company_update:  'bg-teal-900/40 text-teal-300',
  company_delete:  'bg-red-900/40 text-red-300',
  endpoint_create: 'bg-cyan-900/40 text-cyan-300',
  endpoint_update: 'bg-cyan-900/40 text-cyan-300',
  endpoint_delete: 'bg-red-900/40 text-red-300',
  settings_update: 'bg-yellow-900/40 text-yellow-300',
  ai_provider_change: 'bg-pink-900/40 text-pink-300',
  cache_clear:     'bg-orange-900/40 text-orange-300',
  crawl_start:     'bg-lime-900/40 text-lime-300',
  crawl_schedule:  'bg-lime-900/40 text-lime-300',
  doc_upload:      'bg-sky-900/40 text-sky-300',
  doc_delete:      'bg-red-900/40 text-red-300',
}

const RESOURCE_ICONS: Record<string, string> = {
  auth:          '🔐',
  user:          '👤',
  knowledge_base:'📚',
  faq:           '❓',
  company:       '🏢',
  api_endpoint:  '🔗',
  settings:      '⚙️',
  cache:         '🗄️',
  document:      '📄',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLOR[action] ?? 'bg-gray-700/60 text-gray-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {action.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const [logs,    setLogs]    = useState<AuditLog[]>([])
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Filters
  const [action,   setAction]   = useState('')
  const [resource, setResource] = useState('')
  const [email,    setEmail]    = useState('')
  const [from,     setFrom]     = useState('')
  const [to,       setTo]       = useState('')

  const LIMIT = 50
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [logsRes, statsRes] = await Promise.all([
        getAuditLogs({ page, limit: LIMIT, action: action || undefined, resource: resource || undefined,
                       email: email || undefined, from: from || undefined, to: to || undefined }),
        getAuditStats(),
      ])
      setLogs(logsRes.data.logs ?? [])
      setTotal(logsRes.data.total ?? 0)
      setStats(statsRes.data)
    } catch {}
    finally { setLoading(false) }
  }, [page, action, resource, email, from, to])

  useEffect(() => { load() }, [load])

  const applyFilter = () => { setPage(1); load() }
  const clearFilter = () => {
    setAction(''); setResource(''); setEmail(''); setFrom(''); setTo('')
    setPage(1)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-600/20 border border-purple-600/30 flex items-center justify-center">
            <ClipboardList size={18} className="text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Audit Logs</h1>
            <p className="text-xs text-gray-500">{total.toLocaleString()} events recorded</p>
          </div>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total Events" value={stats.total.toLocaleString()} icon={<Activity size={14} className="text-purple-400" />} />
          <StatCard label="Today" value={stats.today.toLocaleString()} icon={<Calendar size={14} className="text-blue-400" />} />
          {stats.byAction.slice(0, 2).map(a => (
            <StatCard key={a._id} label={a._id.replace(/_/g, ' ')} value={a.count.toLocaleString()} icon={<Activity size={14} className="text-gray-400" />} />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-gray-500" />
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Filters</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input
            type="text" value={action} onChange={e => setAction(e.target.value)} placeholder="Action (e.g. login)"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text" value={resource} onChange={e => setResource(e.target.value)} placeholder="Resource (e.g. user)"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="User email"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
          <input
            type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={applyFilter} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg font-medium transition flex items-center gap-1">
            <Search size={11} />Apply
          </button>
          <button onClick={clearFilter} className="px-3 py-1.5 text-gray-400 hover:text-gray-200 text-xs transition">
            Clear filters
          </button>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Time</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">User</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Action</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Resource</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Details</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-gray-500 py-12 text-sm">Loading…</td></tr>
            )}
            {!loading && logs.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-500 py-12 text-sm">No audit logs found</td></tr>
            )}
            {logs.map(log => (
              <>
                <tr
                  key={log._id}
                  onClick={() => setExpanded(expanded === log._id ? null : log._id)}
                  className="border-t border-gray-800/60 hover:bg-gray-800/30 transition cursor-pointer"
                >
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <User size={11} className="text-gray-500 shrink-0" />
                      <div>
                        <p className="text-xs text-white">{log.userEmail}</p>
                        <p className="text-xs text-gray-500">{log.userRole}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><ActionBadge action={log.action} /></td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-gray-300">
                      {RESOURCE_ICONS[log.resource] ?? '📋'} {log.resource}
                      {log.resourceId && <span className="text-gray-500 ml-1">#{log.resourceId.slice(-6)}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-300 max-w-xs truncate">{log.details}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{log.ip || '—'}</td>
                </tr>
                {expanded === log._id && log.changes && (
                  <tr key={`${log._id}-exp`} className="bg-gray-800/30">
                    <td colSpan={6} className="px-6 py-3">
                      <div className="grid grid-cols-2 gap-4">
                        {log.changes.before && (
                          <div>
                            <p className="text-xs text-red-400 font-medium mb-1">Before</p>
                            <pre className="text-xs text-gray-400 bg-gray-900 p-2 rounded-lg overflow-auto max-h-32">
                              {JSON.stringify(log.changes.before, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.changes.after && (
                          <div>
                            <p className="text-xs text-green-400 font-medium mb-1">After</p>
                            <pre className="text-xs text-gray-400 bg-gray-900 p-2 rounded-lg overflow-auto max-h-32">
                              {JSON.stringify(log.changes.after, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-gray-500">Page {page} of {pages} · {total.toLocaleString()} total</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-xs text-gray-400 min-w-[3rem] text-center">{page} / {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
            className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-gray-800 flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-white font-semibold text-sm">{value}</p>
        <p className="text-gray-500 text-xs capitalize">{label}</p>
      </div>
    </div>
  )
}
