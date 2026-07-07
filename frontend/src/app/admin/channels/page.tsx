'use client'

import { useEffect, useState } from 'react'
import {
  Radio, Globe, Send, RefreshCw, CheckCircle, XCircle,
  Copy, CalendarClock, Play, Loader2,
} from 'lucide-react'
import { getChannelsStatus, getRecapStatus, runRecapNow } from '../../../lib/api'
import toast from 'react-hot-toast'

interface ChannelsStatus {
  web:      { enabled: boolean }
  telegram: { enabled: boolean }
}
interface RecapStatus {
  enabled: boolean
  timeUtc: string
  keepDays: number
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelsStatus | null>(null)
  const [recap,    setRecap]    = useState<RecapStatus | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [running,  setRunning]  = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [c, r] = await Promise.all([getChannelsStatus(), getRecapStatus()])
      setChannels(c.data)
      setRecap(r.data)
    } catch {
      toast.error('Failed to load channel status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const runRecap = async () => {
    setRunning(true)
    try {
      const r = await runRecapNow()
      toast.success(`Recap indexed: ${r.data.endpointsUsed} endpoints → ${r.data.chunksIndexed} chunks`)
    } catch (e: any) {
      toast.error(e?.friendlyMessage || 'Recap failed')
    } finally {
      setRunning(false)
    }
  }

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Copied!'))

  const StatusBadge = ({ on }: { on: boolean }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
      on ? 'bg-green-900/50 text-green-300 border-green-800'
         : 'bg-gray-800 text-gray-500 border-gray-700'
    }`}>
      {on ? <CheckCircle size={11} /> : <XCircle size={11} />}
      {on ? 'Enabled' : 'Not configured'}
    </span>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="text-blue-400" size={22} />
          <div>
            <h1 className="text-xl font-bold text-white">Channels &amp; Automations</h1>
            <p className="text-sm text-gray-400">Where users can reach the bot, and scheduled jobs</p>
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

      {/* Web channel */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-blue-400" />
          <h2 className="font-semibold text-white text-sm">Web (chat UI + embeddable widget)</h2>
          <span className="ml-auto"><StatusBadge on={channels?.web.enabled ?? true} /></span>
        </div>
        <p className="text-xs text-gray-500">
          Always on. Embed the widget on msx.om (or any site) with:
        </p>
        <div className="relative bg-gray-800 rounded-lg p-4">
          <button
            onClick={() => copy(`<script src="https://YOUR_SERVER/widget.js"></script>\n<script>MSXChat.init({ serverUrl: 'https://YOUR_SERVER', lang: 'ar' })</script>`)}
            className="absolute top-3 right-3 text-gray-500 hover:text-white transition"
            title="Copy"
          >
            <Copy size={14} />
          </button>
          <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{`<script src="https://YOUR_SERVER/widget.js"></script>
<script>MSXChat.init({ serverUrl: 'https://YOUR_SERVER', lang: 'ar' })</script>`}</pre>
        </div>
      </div>

      {/* Telegram channel */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-sky-400" />
          <h2 className="font-semibold text-white text-sm">Telegram Bot</h2>
          <span className="ml-auto"><StatusBadge on={channels?.telegram.enabled ?? false} /></span>
        </div>
        {channels?.telegram.enabled ? (
          <p className="text-xs text-gray-400">
            Connected. Users can chat with the MSX assistant directly in Telegram —
            answers use the same RAG pipeline, FAQ fast-path, and live market data as the web chat.
          </p>
        ) : (
          <div className="space-y-2 text-xs text-gray-400">
            <p>To enable the Telegram channel:</p>
            <ol className="list-decimal list-inside space-y-1 text-gray-500">
              <li>Create a bot with <span className="text-gray-300">@BotFather</span> and copy the token</li>
              <li>Add to <code className="bg-gray-800 px-1 rounded">.env</code>: <code className="bg-gray-800 px-1 rounded">TELEGRAM_BOT_TOKEN</code> and <code className="bg-gray-800 px-1 rounded">TELEGRAM_WEBHOOK_SECRET</code> (random string)</li>
              <li>Rebuild the backend, then register the webhook:</li>
            </ol>
            <div className="relative bg-gray-800 rounded-lg p-3 mt-1">
              <button
                onClick={() => copy('curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR_SERVER/api/channels/telegram/webhook/<SECRET>"')}
                className="absolute top-2.5 right-2.5 text-gray-500 hover:text-white transition"
                title="Copy"
              >
                <Copy size={13} />
              </button>
              <pre className="text-[11px] text-green-400 font-mono whitespace-pre-wrap">{`curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR_SERVER/api/channels/telegram/webhook/<SECRET>"`}</pre>
            </div>
          </div>
        )}
      </div>

      {/* Market recap automation */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-amber-400" />
          <h2 className="font-semibold text-white text-sm">Daily Market Recap</h2>
          <span className="ml-auto"><StatusBadge on={recap?.enabled ?? false} /></span>
        </div>
        <p className="text-xs text-gray-500">
          Every trading day (Sun–Thu) at <span className="text-gray-300">{recap?.timeUtc ?? '10:30'} UTC</span> the
          bot summarizes market-level data (index, movers) into the knowledge base, so questions like
          &ldquo;how did the market do yesterday?&rdquo; get real answers.
          Recaps are kept for {recap?.keepDays ?? 14} days.
        </p>
        <button
          onClick={runRecap}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? 'Building recap…' : 'Run recap now'}
        </button>
      </div>
    </div>
  )
}
