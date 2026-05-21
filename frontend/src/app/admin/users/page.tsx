'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, RefreshCw, Search, Edit2, Trash2, Key,
  CheckCircle, XCircle, ChevronLeft, ChevronRight, X, Shield,
} from 'lucide-react'
import { listUsers, createUser, updateUser, changeUserPassword, deleteUser } from '../../../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  _id: string
  email: string
  name: string
  role: 'super_admin' | 'admin' | 'editor' | 'viewer'
  isActive: boolean
  lastLoginAt?: string
  createdAt: string
}

const ROLES = ['super_admin', 'admin', 'editor', 'viewer'] as const

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-900/40 text-red-300',
  admin:       'bg-blue-900/40 text-blue-300',
  editor:      'bg-yellow-900/40 text-yellow-300',
  viewer:      'bg-gray-700/60 text-gray-300',
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  editor:      'Editor',
  viewer:      'Viewer',
}

// ─── Modal: Create / Edit user ────────────────────────────────────────────────

function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user?: User | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!user
  const [form, setForm] = useState({
    email:    user?.email    ?? '',
    name:     user?.name     ?? '',
    role:     user?.role     ?? 'viewer',
    password: '',
    isActive: user?.isActive ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setError('')
    if (!form.email || !form.name) { setError('Email and name are required'); return }
    if (!isEdit && !form.password)  { setError('Password is required'); return }
    if (!isEdit && form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await updateUser(user!._id, { name: form.name, role: form.role, isActive: form.isActive })
      } else {
        await createUser({ email: form.email, name: form.name, role: form.role, password: form.password })
      }
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold">{isEdit ? 'Edit User' : 'Create User'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email" value={form.email} disabled={isEdit}
              onChange={e => set('email', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 disabled:opacity-50 focus:outline-none focus:border-blue-500"
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Full Name</label>
            <input
              type="text" value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="Abdullah Al-Farsi"
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Password</label>
              <input
                type="password" value={form.password}
                onChange={e => set('password', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="min. 8 characters"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => set('role', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox" id="isActive" checked={form.isActive}
                onChange={e => set('isActive', e.target.checked)}
                className="accent-blue-500 w-4 h-4"
              />
              <label htmlFor="isActive" className="text-sm text-gray-300">Active account</label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition">Cancel</button>
          <button
            onClick={save} disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition"
          >
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create User')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Reset password ────────────────────────────────────────────────────

function PasswordModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [pw, setPw]       = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const save = async () => {
    setError('')
    if (pw.length < 8) { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await changeUserPassword(user._id, pw)
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold">Reset Password</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-400">Setting new password for <span className="text-white">{user.email}</span></p>
          {error && <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <input
            type="password" value={pw} onChange={e => setPw(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="New password (min. 8 chars)"
          />
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
            {saving ? 'Saving…' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [users,    setUsers]    = useState<User[]>([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [loading,  setLoading]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState<'create' | 'edit' | 'password' | null>(null)
  const [selected, setSelected] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const LIMIT = 20
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listUsers(page, LIMIT)
      setUsers(res.data.users ?? [])
      setTotal(res.data.total ?? 0)
    } catch {}
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { load() }, [load])

  const confirmDelete = async (u: User) => {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return
    setDeleting(u._id)
    try { await deleteUser(u._id); load() }
    catch (err: any) { alert(err?.response?.data?.message ?? 'Delete failed') }
    finally { setDeleting(null) }
  }

  const filtered = search
    ? users.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.name.toLowerCase().includes(search.toLowerCase()),
      )
    : users

  const fmtDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center">
            <Users size={18} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">User Management</h1>
            <p className="text-xs text-gray-500">{total} user{total !== 1 ? 's' : ''} total</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setSelected(null); setModal('create') }}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg font-medium transition"
          >
            <Plus size={14} /> New User
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          placeholder="Search by email or name…"
        />
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">User</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Role</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Status</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Last Login</th>
              <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Created</th>
              <th className="text-right text-xs text-gray-500 font-medium px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-gray-500 py-12 text-sm">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-500 py-12 text-sm">No users found</td></tr>
            )}
            {filtered.map(u => (
              <tr key={u._id} className="border-t border-gray-800/60 hover:bg-gray-800/30 transition">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-700/50 flex items-center justify-center text-xs text-white font-bold shrink-0">
                      {u.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <p className="text-white font-medium">{u.name}</p>
                      <p className="text-gray-500 text-xs">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] ?? 'bg-gray-700 text-gray-300'}`}>
                    <Shield size={10} />{ROLE_LABELS[u.role] ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.isActive
                    ? <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle size={12} />Active</span>
                    : <span className="flex items-center gap-1 text-gray-500 text-xs"><XCircle size={12} />Inactive</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(u.lastLoginAt)}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(u.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => { setSelected(u); setModal('edit') }}
                      className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-900/20 rounded-lg transition"
                      title="Edit user"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => { setSelected(u); setModal('password') }}
                      className="p-1.5 text-gray-500 hover:text-amber-400 hover:bg-amber-900/20 rounded-lg transition"
                      title="Reset password"
                    >
                      <Key size={13} />
                    </button>
                    <button
                      onClick={() => confirmDelete(u)}
                      disabled={deleting === u._id}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                      title="Delete user"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">Page {page} of {pages} · {total} total</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === 'create' && (
        <UserModal onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />
      )}
      {modal === 'edit' && selected && (
        <UserModal user={selected} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />
      )}
      {modal === 'password' && selected && (
        <PasswordModal user={selected} onClose={() => setModal(null)} onSaved={() => { setModal(null) }} />
      )}
    </div>
  )
}
