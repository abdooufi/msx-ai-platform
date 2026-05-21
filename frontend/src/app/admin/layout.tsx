'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, MessageSquare, FileText, TrendingUp,
  Settings, Globe, Bot, LogOut, AlertCircle, Database,
  HardDrive, Building2, HelpCircle, LineChart, Users, ClipboardList,
} from 'lucide-react'
import { useAuthStore } from '../../lib/store'
import clsx from 'clsx'

const navItems = [
  { href: '/admin',                label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/admin/conversations',  label: 'Conversations',  icon: MessageSquare },
  { href: '/admin/documents',      label: 'Documents',      icon: FileText },
  { href: '/admin/training',       label: 'Training',       icon: Globe },
  { href: '/admin/knowledge',      label: 'Knowledge',      icon: Database },
  { href: '/admin/companies',      label: 'Companies',      icon: Building2 },
  { href: '/admin/unanswered',     label: 'Unanswered',     icon: HelpCircle },
  { href: '/admin/market',         label: 'Market Chart',   icon: LineChart },
  { href: '/admin/analytics',      label: 'Analytics',      icon: TrendingUp },
  { href: '/admin/failed',         label: 'Failed Q&A',     icon: AlertCircle },
  { href: '/admin/cache',          label: 'Cache',          icon: HardDrive },
  { href: '/admin/users',          label: 'Users',          icon: Users },
  { href: '/admin/logs',           label: 'Audit Logs',     icon: ClipboardList },
  { href: '/admin/settings',       label: 'Settings',       icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, clearAuth, user } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname.endsWith('/login') && !isAuthenticated()) {
      router.push('/admin/login')
    }
  }, [pathname])

  if (pathname.endsWith('/login')) return <>{children}</>

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Bot size={16} color="white" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm">MSX AI</p>
              <p className="text-gray-500 text-xs">Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
                pathname === href
                  ? 'bg-blue-900/50 text-blue-300 font-medium'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs text-white font-bold">
              {user?.name?.[0] || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={() => { clearAuth(); router.push('/admin/login') }}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition w-full py-1"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
