'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Mail, Lock, Loader2 } from 'lucide-react'
import { login } from '../../../lib/api'
import { useAuthStore } from '../../../lib/store'
import toast from 'react-hot-toast'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    try {
      const res = await login(email, password)
      setAuth(res.data.user, res.data.accessToken)
      router.push('/admin')
    } catch {
      toast.error('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-900/40 border border-blue-700/40 flex items-center justify-center mx-auto mb-4">
            <Bot size={28} className="text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Admin Portal</h1>
          <p className="text-gray-400 text-sm mt-1">MSX AI Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="admin@msx.om"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
