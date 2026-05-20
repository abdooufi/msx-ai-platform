'use client'

import { useEffect, useState } from 'react'
import { Globe, Play, RefreshCcw, CheckCircle, Loader2, Clock } from 'lucide-react'
import { startCrawl, getCrawlStatus } from '../../../lib/api'
import toast from 'react-hot-toast'

export default function TrainingPage() {
  const [url, setUrl] = useState('https://www.msx.om')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<any>(null)

  const loadStatus = async () => {
    try {
      const r = await getCrawlStatus()
      setStatus(r.data)
    } catch {}
  }

  useEffect(() => {
    loadStatus()
    const t = setInterval(loadStatus, 5000)
    return () => clearInterval(t)
  }, [])

  const handleCrawl = async () => {
    setRunning(true)
    try {
      const r = await startCrawl(url)
      toast.success(`Crawl started (job ${r.data.jobId})`)
      loadStatus()
    } catch {
      toast.error('Failed to start crawl')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-white">Training Pipeline</h1>

      {/* Website crawler */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-blue-400" />
          <h2 className="font-semibold text-white">Website Crawler</h2>
        </div>
        <p className="text-sm text-gray-400">
          Crawl MSX.om pages, extract content, chunk it, and index into Qdrant vector database.
        </p>
        <div className="flex gap-3">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="https://www.msx.om"
          />
          <button
            onClick={handleCrawl}
            disabled={running}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Start Crawl
          </button>
        </div>

        {status && (
          <div className="grid grid-cols-4 gap-3 pt-2">
            {[
              { label: 'Waiting', value: status.waiting, color: 'text-yellow-400' },
              { label: 'Active', value: status.active, color: 'text-blue-400' },
              { label: 'Completed', value: status.completed, color: 'text-green-400' },
              { label: 'Failed', value: status.failed, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="bg-gray-800 rounded-lg p-3 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={18} className="text-purple-400" />
          <h2 className="font-semibold text-white">Auto-Training Schedule</h2>
        </div>
        <p className="text-sm text-gray-400">
          The system recrawls www.msx.om every 24 hours automatically to keep the AI knowledge fresh.
          Configure <code className="text-blue-400">SCRAPER_RECRAWL_HOURS</code> in your .env to change the interval.
        </p>
        <div className="mt-4 flex items-center gap-2 text-sm text-green-400">
          <CheckCircle size={14} />
          Daily recrawl scheduled
        </div>
      </div>
    </div>
  )
}
