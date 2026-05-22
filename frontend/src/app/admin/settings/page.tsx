'use client'

import { useEffect, useState } from 'react'
import {
  Settings, Cpu, Database, Globe, Zap, Shield,
  RefreshCcw, CheckCircle, Copy, ExternalLink, Info,
  Loader2, AlertTriangle, Sparkles, Shuffle,
  Wallet, WifiOff, Wifi,
} from 'lucide-react'
import { getStats, getAiProviderBalance } from '../../../lib/api'
import api from '../../../lib/api'
import toast from 'react-hot-toast'

interface EnvSetting {
  key: string
  value: string | number
  description: string
  sensitive?: boolean
}

type AiProvider = 'ollama' | 'deepseek' | 'claude' | 'auto'

interface ProviderBalance {
  deepseek: { available: boolean; totalBalance: string; currency: string } | null
  claude:   { available: boolean } | null
  ollama:   { available: boolean } | null
}

interface ProviderInfo {
  provider: AiProvider
  model: string
  ollamaUrl: string
  ollamaModel: string
  deepseekModel: string
  deepseekConfigured: boolean
  claudeModel: string
  claudeConfigured: boolean
  autoLastPicked?: string
}

const PROVIDER_META: Record<AiProvider, {
  emoji: string
  label: string
  badge: string
  badgeColor: string
  activeColor: string
  dotColor: string
  desc: string
}> = {
  ollama: {
    emoji: '🦙', label: 'Ollama', badge: 'Local',
    badgeColor: 'text-green-400 bg-green-900/30',
    activeColor: 'border-purple-500 bg-purple-900/20',
    dotColor: 'bg-purple-400',
    desc: 'Self-hosted model on your hardware. Free, private, no internet required.',
  },
  deepseek: {
    emoji: '🌊', label: 'DeepSeek', badge: 'Cloud API',
    badgeColor: 'text-blue-400 bg-blue-900/30',
    activeColor: 'border-blue-500 bg-blue-900/20',
    dotColor: 'bg-blue-400',
    desc: 'DeepSeek cloud API. Fast, powerful, great for code & analysis.',
  },
  claude: {
    emoji: '✦', label: 'Claude', badge: 'Anthropic',
    badgeColor: 'text-orange-400 bg-orange-900/30',
    activeColor: 'border-orange-500 bg-orange-900/20',
    dotColor: 'bg-orange-400',
    desc: 'Anthropic Claude API. Excellent multilingual support, strong reasoning.',
  },
  auto: {
    emoji: '⚡', label: 'Auto', badge: 'Smart',
    badgeColor: 'text-yellow-400 bg-yellow-900/30',
    activeColor: 'border-yellow-500 bg-yellow-900/20',
    dotColor: 'bg-yellow-400',
    desc: 'Auto-routes between Ollama and DeepSeek based on query length and live data. Claude stays manual.',
  },
}

export default function SettingsPage() {
  const [stats,          setStats]          = useState<any>(null)
  const [loading,        setLoading]        = useState(false)
  const [provider,       setProvider]       = useState<ProviderInfo | null>(null)
  const [switching,      setSwitching]      = useState(false)
  const [balance,        setBalance]        = useState<ProviderBalance | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

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

  const loadBalance = async () => {
    setBalanceLoading(true)
    try {
      const res = await getAiProviderBalance()
      setBalance(res.data)
    } catch {}
    finally { setBalanceLoading(false) }
  }

  useEffect(() => { load(); loadBalance() }, [])

  const switchProvider = async (target: AiProvider) => {
    if (!provider || provider.provider === target || switching) return
    setSwitching(true)
    try {
      const res = await api.post('/admin/ai-provider', { provider: target })
      setProvider(res.data)
      const labels: Record<AiProvider, string> = {
        ollama: 'Ollama (local)', deepseek: 'DeepSeek API',
        claude: 'Claude API', auto: 'Auto (smart routing)',
      }
      toast.success(`Switched to ${labels[target]}`)
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

  const isAvailable = (p: AiProvider, info: ProviderInfo) => {
    if (p === 'deepseek') return info.deepseekConfigured
    if (p === 'claude')   return info.claudeConfigured
    return true // ollama and auto are always available
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
            {/* 2×2 provider card grid */}
            <div className="grid grid-cols-2 gap-3">
              {(['ollama', 'deepseek', 'claude', 'auto'] as AiProvider[]).map(p => {
                const meta      = PROVIDER_META[p]
                const available = isAvailable(p, provider)
                const active    = provider.provider === p

                // Model label per card
                const modelLabel = p === 'ollama'   ? provider.ollamaModel
                                 : p === 'deepseek' ? provider.deepseekModel
                                 : p === 'claude'   ? provider.claudeModel
                                 : `routes to: ${provider.autoLastPicked || 'best match'}`

                return (
                  <button
                    key={p}
                    onClick={() => switchProvider(p)}
                    disabled={switching || active || !available}
                    className={`relative rounded-xl border p-4 text-left transition-all ${
                      active
                        ? `${meta.activeColor} cursor-default`
                        : available
                        ? 'border-gray-700 bg-gray-800/40 hover:border-gray-500 cursor-pointer'
                        : 'border-gray-800 bg-gray-800/20 cursor-not-allowed opacity-50'
                    }`}
                  >
                    {/* Active badge */}
                    {active && (
                      <span className={`absolute top-2.5 right-2.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full
                        ${p === 'ollama'   ? 'text-purple-400 bg-purple-900/60' :
                          p === 'deepseek' ? 'text-blue-400 bg-blue-900/60'     :
                          p === 'claude'   ? 'text-orange-400 bg-orange-900/60' :
                                            'text-yellow-400 bg-yellow-900/60'}`}>
                        ACTIVE
                      </span>
                    )}

                    {/* Not-configured badge */}
                    {!available && !active && (
                      <span className="absolute top-2.5 right-2.5 text-[10px] font-bold text-yellow-500 bg-yellow-900/40 px-1.5 py-0.5 rounded-full">
                        NOT SET
                      </span>
                    )}

                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{meta.emoji}</span>
                      <span className="font-semibold text-white text-sm">{meta.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.badgeColor}`}>
                        {meta.badge}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{meta.desc}</p>
                    <p className="text-xs text-gray-500 mt-2 font-mono truncate">{modelLabel}</p>
                  </button>
                )
              })}
            </div>

            {/* Current status bar */}
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-2.5">
              {switching ? (
                <Loader2 size={14} className="text-blue-400 animate-spin" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${PROVIDER_META[provider.provider].dotColor} animate-pulse`} />
              )}
              <span className="text-xs text-gray-400">
                {switching ? 'Switching provider…' : (
                  <>
                    Using{' '}
                    <span className={`font-medium ${
                      provider.provider === 'ollama'   ? 'text-purple-400' :
                      provider.provider === 'deepseek' ? 'text-blue-400'   :
                      provider.provider === 'claude'   ? 'text-orange-400' :
                                                         'text-yellow-400'
                    }`}>
                      {PROVIDER_META[provider.provider].label}
                    </span>
                    {provider.provider === 'auto' && provider.autoLastPicked
                      ? ` → last picked: ${provider.autoLastPicked}`
                      : ` — ${provider.model}`
                    }
                  </>
                )}
              </span>
              <span className="ml-auto text-[11px] text-gray-600">
                Embeddings always use Ollama (nomic-embed-text)
              </span>
            </div>

            {/* ── Balance Panel ──────────────────────────────────────────────────── */}
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Wallet size={14} className="text-yellow-400" />
                  <span className="text-xs font-semibold text-white">API Balance &amp; Status</span>
                </div>
                <button
                  onClick={loadBalance}
                  disabled={balanceLoading}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 bg-gray-700 rounded-lg transition"
                >
                  <RefreshCcw size={11} className={balanceLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>

              {balanceLoading && !balance ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
                  <Loader2 size={12} className="animate-spin" /> Checking balances…
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">

                  {/* Ollama */}
                  <div className="bg-gray-900/60 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">🦙</span>
                      <span className="text-xs font-medium text-white">Ollama</span>
                    </div>
                    {balance?.ollama ? (
                      balance.ollama.available ? (
                        <div className="flex items-center gap-1.5 text-xs text-green-400">
                          <Wifi size={11} /> Running
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-red-400">
                          <WifiOff size={11} /> Offline
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                    <p className="text-[10px] text-gray-600">Local · Free · No billing</p>
                  </div>

                  {/* DeepSeek */}
                  <div className="bg-gray-900/60 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">🌊</span>
                      <span className="text-xs font-medium text-white">DeepSeek</span>
                    </div>
                    {balance?.deepseek ? (
                      <>
                        <div className={`flex items-center gap-1.5 text-xs ${balance.deepseek.available ? 'text-green-400' : 'text-red-400'}`}>
                          {balance.deepseek.available ? <Wifi size={11} /> : <WifiOff size={11} />}
                          {balance.deepseek.available ? 'Available' : 'Unavailable'}
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-lg font-bold text-white leading-none">
                            {balance.deepseek.totalBalance}
                          </span>
                          <span className="text-[10px] text-gray-500">{balance.deepseek.currency}</span>
                        </div>
                        <p className="text-[10px] text-gray-600">Remaining balance</p>
                      </>
                    ) : !provider.deepseekConfigured ? (
                      <p className="text-xs text-gray-600">Not configured</p>
                    ) : (
                      <p className="text-xs text-gray-500">—</p>
                    )}
                    {provider.deepseekConfigured && (
                      <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
                        className="text-[10px] text-blue-500 hover:text-blue-400 flex items-center gap-0.5 transition">
                        <ExternalLink size={9} /> platform.deepseek.com
                      </a>
                    )}
                  </div>

                  {/* Claude */}
                  <div className="bg-gray-900/60 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">✦</span>
                      <span className="text-xs font-medium text-white">Claude</span>
                    </div>
                    {balance?.claude ? (
                      <div className={`flex items-center gap-1.5 text-xs ${balance.claude.available ? 'text-green-400' : 'text-red-400'}`}>
                        {balance.claude.available ? <Wifi size={11} /> : <WifiOff size={11} />}
                        {balance.claude.available ? 'Key valid' : 'Key invalid'}
                      </div>
                    ) : !provider.claudeConfigured ? (
                      <p className="text-xs text-gray-600">Not configured</p>
                    ) : (
                      <p className="text-xs text-gray-500">—</p>
                    )}
                    <p className="text-[10px] text-gray-600">Anthropic has no public balance API</p>
                    <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer"
                      className="text-[10px] text-orange-500 hover:text-orange-400 flex items-center gap-0.5 transition">
                      <ExternalLink size={9} /> View billing
                    </a>
                  </div>

                </div>
              )}
            </div>

            {/* Auto mode explanation */}
            {provider.provider === 'auto' && (
              <div className="flex items-start gap-3 bg-yellow-900/10 border border-yellow-800/30 rounded-lg p-4">
                <Shuffle size={15} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-yellow-400">Auto-routing rules (Ollama ↔ DeepSeek only)</p>
                  <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
                    <li>Live data + short price query → <span className="text-purple-300">Ollama</span> (fast, data already injected)</li>
                    <li>Short query (≤5 words) → <span className="text-purple-300">Ollama</span> (fast local)</li>
                    <li>Longer / complex question → <span className="text-blue-300">DeepSeek</span> (if configured)</li>
                    <li>Fallback → <span className="text-purple-300">Ollama</span></li>
                  </ul>
                  <p className="text-xs text-gray-500 pt-1">Claude is always a manual choice — select it above to use it.</p>
                </div>
              </div>
            )}

            {/* Setup tips for unconfigured providers */}
            {!provider.deepseekConfigured && (
              <SetupTip
                icon={<AlertTriangle size={15} className="text-yellow-500 mt-0.5 flex-shrink-0" />}
                title="DeepSeek API key not configured"
                borderColor="border-yellow-800/30"
                bgColor="bg-yellow-900/10"
                titleColor="text-yellow-400"
              >
                <p className="text-xs text-gray-400">
                  Get a free key at{' '}
                  <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
                    className="text-blue-400 hover:underline">platform.deepseek.com</a>, then add to <code className="bg-gray-800 px-1 rounded">.env</code>:
                </p>
                <pre className="text-xs text-green-400 font-mono bg-gray-900/60 rounded px-3 py-2">
{`DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_MODEL=deepseek-chat`}
                </pre>
              </SetupTip>
            )}

            {!provider.claudeConfigured && (
              <SetupTip
                icon={<Sparkles size={15} className="text-orange-400 mt-0.5 flex-shrink-0" />}
                title="Claude API key not configured"
                borderColor="border-orange-800/30"
                bgColor="bg-orange-900/10"
                titleColor="text-orange-400"
              >
                <p className="text-xs text-gray-400">
                  Get an API key at{' '}
                  <a href="https://console.anthropic.com" target="_blank" rel="noreferrer"
                    className="text-blue-400 hover:underline">console.anthropic.com</a>, then add to <code className="bg-gray-800 px-1 rounded">.env</code>:
                </p>
                <pre className="text-xs text-green-400 font-mono bg-gray-900/60 rounded px-3 py-2">
{`CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxxxxxxx
CLAUDE_MODEL=claude-3-5-haiku-20241022`}
                </pre>
                <p className="text-xs text-gray-500">
                  Then rebuild: <code className="bg-gray-800 px-1 rounded">docker compose up -d --build backend</code>
                </p>
              </SetupTip>
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
        description="Ollama, DeepSeek and Claude model configuration"
      >
        <EnvTable settings={[
          { key: 'AI_PROVIDER',    value: 'ollama',              description: 'Active provider: ollama | deepseek | claude | auto. Switchable live above.' },
          { key: 'LLM_MODEL',      value: 'qwen2.5:7b',          description: 'Ollama model used when AI_PROVIDER=ollama.' },
          { key: 'DEEPSEEK_MODEL', value: 'deepseek-chat',        description: 'DeepSeek model used when AI_PROVIDER=deepseek.' },
          { key: 'DEEPSEEK_API_KEY', value: '••••••••••••••••',  description: 'DeepSeek API key from platform.deepseek.com.', sensitive: true },
          { key: 'CLAUDE_MODEL',   value: 'claude-3-5-haiku-20241022', description: 'Claude model used when AI_PROVIDER=claude or auto.' },
          { key: 'CLAUDE_API_KEY', value: '••••••••••••••••',    description: 'Anthropic API key from console.anthropic.com.', sensitive: true },
          { key: 'EMBEDDING_MODEL', value: 'nomic-embed-text',   description: 'Always uses Ollama — vector embeddings are local.' },
          { key: 'OLLAMA_URL',     value: 'http://…:11434',       description: 'Ollama API host (LLM + embeddings when active).' },
        ]} onCopy={copyToClipboard} />
      </Section>

      {/* RAG Configuration */}
      <Section
        icon={<Database size={16} className="text-blue-400" />}
        title="RAG Pipeline"
        description="Retrieval-Augmented Generation settings"
      >
        <EnvTable settings={[
          { key: 'RAG_TOP_K',              value: '5',                  description: 'Knowledge chunks retrieved per query.' },
          { key: 'RAG_SCORE_THRESHOLD',    value: '0.5',                description: 'Minimum similarity score to include a chunk.' },
          { key: 'QDRANT_COLLECTION_SIZE', value: '768',                description: 'Vector dimensions — must match embedding model.' },
          { key: 'QDRANT_URL',             value: 'http://qdrant:6333', description: 'Qdrant vector database URL.' },
        ]} onCopy={copyToClipboard} />

        {stats?.ragStats && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatBox label="Vectors indexed"     value={stats.ragStats.qdrantVectors?.toLocaleString() ?? '—'} color="blue" />
            <StatBox label="Knowledge documents" value={stats.ragStats.pgDocuments?.toLocaleString() ?? '—'} color="purple" />
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
          { key: 'JWT_SECRET',     value: '••••••••••••••••', description: 'JWT signing secret — use 64 random chars in production.', sensitive: true },
          { key: 'ADMIN_EMAIL',    value: 'admin@msx.om',    description: 'Default admin account email.' },
          { key: 'ADMIN_PASSWORD', value: '••••••••••',      description: 'Default admin password — change before going to production!', sensitive: true },
          { key: 'JWT_EXPIRES_IN', value: '8h',              description: 'Token expiry duration.' },
        ]} onCopy={copyToClipboard} />

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-gray-400">Production Security Checklist</p>
          {[
            'Change JWT_SECRET to a 64-char random string',
            'Change ADMIN_PASSWORD to a strong password',
            'Set MONGO_PASS to a strong password',
            'Add DEEPSEEK_API_KEY or CLAUDE_API_KEY for cloud AI',
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
        <a href="https://console.anthropic.com" target="_blank" rel="noreferrer"
          className="flex items-center gap-1 hover:text-blue-400 transition">
          <ExternalLink size={11} /> Anthropic Console
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

function SetupTip({
  icon, title, borderColor, bgColor, titleColor, children,
}: {
  icon: React.ReactNode
  title: string
  borderColor: string
  bgColor: string
  titleColor: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex items-start gap-3 border rounded-lg p-4 ${bgColor} ${borderColor}`}>
      {icon}
      <div className="space-y-2 min-w-0">
        <p className={`text-xs font-medium ${titleColor}`}>{title}</p>
        {children}
      </div>
    </div>
  )
}

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
