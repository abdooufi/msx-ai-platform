'use client'

import { useEffect, useState } from 'react'
import {
  Settings, Cpu, Database, Globe, Zap, Shield,
  RefreshCcw, CheckCircle, Copy, ExternalLink, Info,
  Loader2, AlertTriangle,
} from 'lucide-react'
import { getStats } from '../../../lib/api'
import api from '../../../lib/api'
import toast from 'react-hot-toast'

interface EnvSetting {
  key: string
  value: string | number
  description: string
  sensitive?: boolean
}

interface ProviderInfo {
  provider: 'ollama' | 'deepseek'
  model: string
  ollamaUrl: string
  ollamaModel: string
  deepseekModel: string
  deepseekConfigured: boolean
}

export default function SettingsPage() {
  const [stats, setStats]             = useState<any>(null)
  const [loading, setLoading]         = useState(false)
  const [provider, setProvider]       = useState<ProviderInfo | null>(null)
  const [switching, setSwitching]     = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [statsRes, providerRes] = await Promise.all([
        getStats(),
        api.get('/admin/ai-provider'),
      ])
      setStats(statsRes.data)
      setProvider(providerRes.data)
    } catch {
      // stats failure is non-fatal
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const switchProvider = async (target: 'ollama' | 'deepseek') => {
    if (!provider || provider.provider === target || switching) return
    setSwitching(true)
    try {
      const res = await api.post('/admin/ai-provider', { provider: target })
      setProvider(res.data)
      toast.success(`Switched to ${target === 'deepseek' ? 'DeepSeek API' : 'Ollama (local)'}`)
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message
      toast.error(msg)
    } finally {
      setSwitching(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied!'))
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold text-white">Settings</h1>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition"
        >
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── AI Provider Toggle ─────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Cpu size={16} className="text-purple-400" />
          <h2 className="font-semibold text-white text-sm">AI Provider</h2>
          <span className="ml-auto text-xs text-gray-500">Switch without restarting the server</span>
        </div>

        {provider ? (
          <div className="space-y-4">
            {/* Toggle row */}
            <div className="grid grid-cols-2 gap-3">
              {/* Ollama card */}
              <button
                onClick={() => switchProvider('ollama')}
                disabled={switching || provider.provider === 'ollama'}
                className={`relative rounded-xl border p-4 text-left transition-all ${
                  provider.provider === 'ollama'
                    ? 'border-purple-500 bg-purple-900/20 cursor-default'
                    : 'border-gray-700 bg-gray-800/40 hover:border-gray-500 cursor-pointer'
                }`}
              >
                {provider.provider === 'ollama' && (
                  <span className="absolute top-2.5 right-2.5 text-[10px] font-bold text-purple-400 bg-purple-900/60 px-1.5 py-0.5 rounded-full">
                    ACTIVE
                  </span>
                )}
                <div className="flex items-center gap-2 mb-2">
                  {/* Ollama flame icon */}
                  <span className="text-lg">🦙</span>
                  <span className="font-semibold text-white text-sm">Ollama</span>
                  <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded-full">Local</span>
                </div>
                <p className="text-xs text-gray-400">Self-hosted model on your hardware. Free, private, no internet required.</p>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  {provider.ollamaModel}
                </p>
              </button>

              {/* DeepSeek card */}
              <button
                onClick={() => switchProvider('deepseek')}
                disabled={switching || provider.provider === 'deepseek' || !provider.deepseekConfigured}
                className={`relative rounded-xl border p-4 text-left transition-all ${
                  provider.provider === 'deepseek'
                    ? 'border-blue-500 bg-blue-900/20 cursor-default'
                    : provider.deepseekConfigured
                    ? 'border-gray-700 bg-gray-800/40 hover:border-gray-500 cursor-pointer'
                    : 'border-gray-800 bg-gray-800/20 cursor-not-allowed opacity-60'
                }`}
              >
                {provider.provider === 'deepseek' && (
                  <span className="absolute top-2.5 right-2.5 text-[10px] font-bold text-blue-400 bg-blue-900/60 px-1.5 py-0.5 rounded-full">
                    ACTIVE
                  </span>
                )}
                {!provider.deepseekConfigured && (
                  <span className="absolute top-2.5 right-2.5 text-[10px] font-bold text-yellow-500 bg-yellow-900/40 px-1.5 py-0.5 rounded-full">
                    NOT SET
                  </span>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🌊</span>
                  <span className="font-semibold text-white text-sm">DeepSeek</span>
                  <span className="text-[10px] text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded-full">Cloud API</span>
                </div>
                <p className="text-xs text-gray-400">DeepSeek cloud API. Fast, powerful, requires API key & internet.</p>
                <p className="text-xs text-gray-500 mt-2 font-mono">
                  {provider.deepseekModel}
                </p>
              </button>
            </div>

            {/* Current status bar */}
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-2.5">
              {switching ? (
                <Loader2 size={14} className="text-blue-400 animate-spin" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${
                  provider.provider === 'deepseek' ? 'bg-blue-400' : 'bg-purple-400'
                } animate-pulse`} />
              )}
              <span className="text-xs text-gray-400">
                {switching ? 'Switching provider…' : (
                  <>
                    Currently using <span className="text-white font-medium">{provider.model}</span>
                    {' '}via <span className={`font-medium ${provider.provider === 'deepseek' ? 'text-blue-400' : 'text-purple-400'}`}>
                      {provider.provider === 'deepseek' ? 'DeepSeek API' : 'Ollama (local)'}
                    </span>
                  </>
                )}
              </span>
              <span className="ml-auto text-[11px] text-gray-600">
                Embeddings always use Ollama (nomic-embed-text)
              </span>
            </div>

            {/* DeepSeek setup instructions when not configured */}
            {!provider.deepseekConfigured && (
              <div className="flex items-start gap-3 bg-yellow-900/10 border border-yellow-800/30 rounded-lg p-4">
                <AlertTriangle size={15} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-yellow-400">DeepSeek API key not configured</p>
                  <p className="text-xs text-gray-400">
                    Get a free API key at{' '}
                    <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
                      className="text-blue-400 hover:underline">
                      platform.deepseek.com
                    </a>
                    , then add it to your <code className="bg-gray-800 px-1 rounded">.env</code> file:
                  </p>
                  <pre className="text-xs text-green-400 font-mono bg-gray-900/60 rounded px-3 py-2">
{`DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_MODEL=deepseek-chat`}
                  </pre>
                  <p className="text-xs text-gray-500">
                    Then run: <code className="bg-gray-800 px-1 rounded">docker compose up -d --build backend</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 size={14} className="animate-spin" /> Loading provider info…
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
        <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-300">
          Settings below are read-only references. Edit the{' '}
          <code className="bg-blue-900/40 px-1 rounded">.env</code> file and rebuild to change them.
          Only the <span className="text-white font-medium">AI Provider</span> above can be switched live.
        </p>
      </div>

      {/* LLM Configuration */}
      <Section
        icon={<Cpu size={16} className="text-purple-400" />}
        title="Language Model"
        description="Ollama and DeepSeek model configuration"
      >
        <EnvTable settings={[
          { key: 'AI_PROVIDER',      value: 'ollama',           description: 'Active provider: ollama | deepseek. Can be toggled above without rebuild.' },
          { key: 'LLM_MODEL',        value: 'qwen2.5:7b',       description: 'Ollama model used when AI_PROVIDER=ollama.' },
          { key: 'DEEPSEEK_MODEL',   value: 'deepseek-chat',    description: 'DeepSeek model used when AI_PROVIDER=deepseek.' },
          { key: 'DEEPSEEK_API_KEY', value: '••••••••••••••••', description: 'DeepSeek API key from platform.deepseek.com.', sensitive: true },
          { key: 'EMBEDDING_MODEL',  value: 'nomic-embed-text', description: 'Always uses Ollama — DeepSeek has no embedding API.' },
          { key: 'OLLAMA_URL',       value: 'http://…:11434',   description: 'Ollama API host (used for both LLM and embeddings when active).' },
        ]} onCopy={copyToClipboard} />
      </Section>

      {/* RAG Configuration */}
      <Section
        icon={<Database size={16} className="text-blue-400" />}
        title="RAG Pipeline"
        description="Retrieval-Augmented Generation settings"
      >
        <EnvTable settings={[
          { key: 'RAG_TOP_K',              value: '5',                description: 'Knowledge chunks retrieved per query.' },
          { key: 'RAG_SCORE_THRESHOLD',    value: '0.5',              description: 'Minimum similarity score to include a chunk.' },
          { key: 'QDRANT_COLLECTION_SIZE', value: '768',              description: 'Vector dimensions — must match embedding model.' },
          { key: 'QDRANT_URL',             value: 'http://qdrant:6333', description: 'Qdrant vector database URL.' },
        ]} onCopy={copyToClipboard} />

        {stats?.ragStats && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatBox label="Vectors indexed"      value={stats.ragStats.qdrantVectors?.toLocaleString() ?? '—'} color="blue" />
            <StatBox label="Knowledge documents"  value={stats.ragStats.mongoDocuments?.toLocaleString() ?? '—'} color="purple" />
          </div>
        )}
      </Section>

      {/* Scraper Configuration */}
      <Section
        icon={<Globe size={16} className="text-green-400" />}
        title="Web Crawler"
        description="Automatic website crawling and indexing schedule"
      >
        <EnvTable settings={[
          { key: 'SCRAPER_TARGET_URL',    value: 'https://www.msx.om', description: 'Website to crawl for knowledge base training.' },
          { key: 'SCRAPER_RECRAWL_HOURS', value: '24',                 description: 'Hours between automatic recrawls.' },
          { key: 'SCRAPER_MAX_PAGES',     value: '500',                description: 'Maximum pages per crawl job.' },
        ]} onCopy={copyToClipboard} />
      </Section>

      {/* Auth & Security */}
      <Section
        icon={<Shield size={16} className="text-red-400" />}
        title="Authentication &amp; Security"
        description="JWT, admin credentials, and rate limits"
      >
        <EnvTable settings={[
          { key: 'JWT_SECRET',      value: '••••••••••••••••', description: 'JWT signing secret — use 64 random chars in production.', sensitive: true },
          { key: 'ADMIN_EMAIL',     value: 'admin@msx.om',    description: 'Default admin account email.' },
          { key: 'ADMIN_PASSWORD',  value: '••••••••••',      description: 'Default admin password — change before going to production!', sensitive: true },
          { key: 'JWT_EXPIRES_IN',  value: '8h',              description: 'Token expiry duration.' },
        ]} onCopy={copyToClipboard} />

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-gray-400">Production Security Checklist</p>
          {[
            'Change JWT_SECRET to a 64-char random string',
            'Change ADMIN_PASSWORD to a strong password',
            'Set MONGO_PASS to a strong password',
            'Add DEEPSEEK_API_KEY if using DeepSeek provider',
            'Enable SSL in nginx/nginx.conf',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
              <CheckCircle size={12} className="text-gray-600 flex-shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* API & Widget */}
      <Section
        icon={<Zap size={16} className="text-yellow-400" />}
        title="API &amp; Widget Integration"
        description="Embedding the chat widget on external pages"
      >
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Embed on any webpage</p>
            <div className="relative bg-gray-800 rounded-lg p-4">
              <button
                onClick={() => copyToClipboard(`<script src="https://your-server/widget.js"></script>\n<div id="msx-chat"></div>\n<script>MSXChat.init({ lang: 'en' })</script>`)}
                className="absolute top-3 right-3 text-gray-500 hover:text-white transition"
                title="Copy"
              >
                <Copy size={14} />
              </button>
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{`<script src="https://your-server/widget.js"></script>
<div id="msx-chat"></div>
<script>MSXChat.init({ lang: 'en' })</script>`}</pre>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Key API endpoints</p>
            <div className="space-y-1">
              {[
                { method: 'POST', path: '/api/chat',                  desc: 'Streaming chat (SSE)' },
                { method: 'GET',  path: '/api/admin/ai-provider',     desc: 'Current AI provider' },
                { method: 'POST', path: '/api/admin/ai-provider',     desc: 'Switch provider (body: {provider})' },
                { method: 'GET',  path: '/api/admin/stats',           desc: 'Dashboard statistics' },
                { method: 'GET',  path: '/api/admin/pg/summary',      desc: 'Chatboot DB row counts' },
                { method: 'POST', path: '/api/upload',                desc: 'Upload PDF/DOCX/XLSX' },
                { method: 'POST', path: '/api/train/website',         desc: 'Trigger web crawl' },
              ].map(({ method, path, desc }) => (
                <div key={path} className="flex items-center gap-3 text-xs">
                  <span className={`font-mono font-bold w-10 ${method === 'GET' ? 'text-green-400' : 'text-blue-400'}`}>
                    {method}
                  </span>
                  <code className="text-gray-300 font-mono flex-1">{path}</code>
                  <span className="text-gray-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* External links */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <a href="http://localhost:6333/dashboard" target="_blank" rel="noreferrer"
          className="flex items-center gap-1 hover:text-blue-400 transition">
          <ExternalLink size={11} /> Qdrant Dashboard
        </a>
        <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
          className="flex items-center gap-1 hover:text-blue-400 transition">
          <ExternalLink size={11} /> DeepSeek Platform
        </a>
        <a href="/docs" target="_blank" rel="noreferrer"
          className="flex items-center gap-1 hover:text-blue-400 transition">
          <ExternalLink size={11} /> Swagger API Docs
        </a>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ icon, title, description, children }: {
  icon: React.ReactNode; title: string; description: string; children: React.ReactNode
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <h2 className="font-semibold text-white text-sm" dangerouslySetInnerHTML={{ __html: title }} />
        </div>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      {children}
    </div>
  )
}

function EnvTable({ settings, onCopy }: { settings: EnvSetting[]; onCopy: (t: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-800/50 text-gray-500 uppercase tracking-wide">
            <th className="text-left px-4 py-2">Variable</th>
            <th className="text-left px-4 py-2">Value</th>
            <th className="text-left px-4 py-2">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {settings.map(s => (
            <tr key={s.key} className="hover:bg-gray-800/30 transition">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <code className="text-blue-300 font-mono">{s.key}</code>
                  {!s.sensitive && (
                    <button onClick={() => onCopy(s.key)}
                      className="text-gray-600 hover:text-gray-400 transition" title="Copy key">
                      <Copy size={10} />
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <code className={s.sensitive ? 'text-gray-600' : 'text-green-400 font-mono'}>{s.value}</code>
              </td>
              <td className="px-4 py-2.5 text-gray-500">{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  const c: Record<string, string> = {
    blue:   'border-blue-800/50 bg-blue-900/20',
    purple: 'border-purple-800/50 bg-purple-900/20',
  }
  return (
    <div className={`rounded-lg border p-3 ${c[color] ?? c.blue}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  )
}
