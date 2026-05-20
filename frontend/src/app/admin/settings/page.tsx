'use client'

import { useEffect, useState } from 'react'
import {
  Settings, Cpu, Database, Globe, Zap, Shield,
  RefreshCcw, CheckCircle, Copy, ExternalLink, Info,
} from 'lucide-react'
import { getStats } from '../../../lib/api'
import toast from 'react-hot-toast'

interface EnvSetting {
  key: string
  value: string | number
  description: string
  editable?: boolean
  sensitive?: boolean
}

export default function SettingsPage() {
  const [stats, setStats]   = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await getStats()
      setStats(r.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

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

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
        <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-300">
          Settings are configured via the <code className="bg-blue-900/40 px-1 rounded">.env</code> file
          and Docker environment variables. Edit the <code className="bg-blue-900/40 px-1 rounded">.env</code> file
          and restart the backend container to apply changes:{' '}
          <code className="bg-blue-900/40 px-1 rounded">docker compose restart backend</code>
        </p>
      </div>

      {/* LLM Configuration */}
      <Section
        icon={<Cpu size={16} className="text-purple-400" />}
        title="Language Model"
        description="Ollama LLM and embedding model configuration"
      >
        <EnvTable settings={[
          {
            key: 'LLM_MODEL',
            value: 'qwen2.5:7b',
            description: 'The Ollama model used for generating responses.',
          },
          {
            key: 'EMBEDDING_MODEL',
            value: 'nomic-embed-text',
            description: 'Model used to create vector embeddings for RAG.',
          },
          {
            key: 'OLLAMA_BASE_URL',
            value: 'http://ollama:11434',
            description: 'Ollama API endpoint (internal Docker service name).',
          },
        ]} onCopy={copyToClipboard} />

        <div className="mt-4 p-4 bg-gray-800/50 rounded-lg">
          <p className="text-xs text-gray-400 mb-2 font-medium">To switch models:</p>
          <pre className="text-xs text-green-400 font-mono leading-relaxed whitespace-pre-wrap">{`# Pull a new model
docker exec msx-ai-platform-ollama-1 ollama pull deepseek-r1:7b

# Update .env
LLM_MODEL=deepseek-r1:7b

# Restart backend
docker compose restart backend`}</pre>
        </div>
      </Section>

      {/* RAG Configuration */}
      <Section
        icon={<Database size={16} className="text-blue-400" />}
        title="RAG Pipeline"
        description="Retrieval-Augmented Generation settings"
      >
        <EnvTable settings={[
          {
            key: 'RAG_TOP_K',
            value: '5',
            description: 'Number of knowledge chunks retrieved per query. Higher = more context, slower.',
          },
          {
            key: 'QDRANT_COLLECTION_SIZE',
            value: '768',
            description: 'Vector dimensions — must match your embedding model output size.',
          },
          {
            key: 'QDRANT_URL',
            value: 'http://qdrant:6333',
            description: 'Qdrant vector database URL (internal Docker service).',
          },
        ]} onCopy={copyToClipboard} />

        {stats?.ragStats && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatBox
              label="Vectors indexed"
              value={stats.ragStats.qdrantVectors?.toLocaleString() ?? '—'}
              color="blue"
            />
            <StatBox
              label="Knowledge documents"
              value={stats.ragStats.mongoDocuments?.toLocaleString() ?? '—'}
              color="purple"
            />
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
          {
            key: 'SCRAPER_TARGET_URL',
            value: 'https://www.msx.om',
            description: 'Website to crawl for knowledge base training.',
          },
          {
            key: 'SCRAPER_RECRAWL_HOURS',
            value: '24',
            description: 'How often (in hours) to automatically recrawl the target website.',
          },
          {
            key: 'SCRAPER_MAX_PAGES',
            value: '500',
            description: 'Maximum pages to crawl per job to prevent runaway crawls.',
          },
        ]} onCopy={copyToClipboard} />
      </Section>

      {/* Auth & Security */}
      <Section
        icon={<Shield size={16} className="text-red-400" />}
        title="Authentication &amp; Security"
        description="JWT, admin credentials, and rate limits"
      >
        <EnvTable settings={[
          {
            key: 'JWT_SECRET',
            value: '••••••••••••••••',
            description: 'JWT signing secret. Use a 64-character random string in production.',
            sensitive: true,
          },
          {
            key: 'ADMIN_EMAIL',
            value: 'admin@msx.om',
            description: 'Default admin account email.',
          },
          {
            key: 'ADMIN_PASSWORD',
            value: '••••••••••',
            description: 'Default admin password — change before going to production!',
            sensitive: true,
          },
          {
            key: 'JWT_EXPIRES_IN',
            value: '7d',
            description: 'Token expiry duration.',
          },
        ]} onCopy={copyToClipboard} />

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-gray-400">Production Security Checklist</p>
          {[
            'Change JWT_SECRET to a 64-char random string',
            'Change ADMIN_PASSWORD to a strong password',
            'Set MONGO_PASS to a strong password',
            'Enable SSL in nginx/nginx.conf',
            'Review rate limits in nginx.conf (currently 30r/m API, 10r/m chat)',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
              <CheckCircle size={12} className="text-gray-600 flex-shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </Section>

      {/* API & Integrations */}
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
            <p className="text-xs font-medium text-gray-400 mb-2">Widget options</p>
            <div className="bg-gray-800 rounded-lg p-4">
              <pre className="text-xs text-blue-300 font-mono whitespace-pre-wrap">{`MSXChat.init({
  lang:        'en',      // 'en' | 'ar'
  position:    'right',   // 'left' | 'right'
  primaryColor: '#003d7a',
  serverUrl:   'https://your-server',
})`}</pre>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">API endpoints</p>
            <div className="space-y-1">
              {[
                { method: 'POST', path: '/api/chat', desc: 'Streaming chat (SSE)' },
                { method: 'POST', path: '/api/auth/login', desc: 'Admin login → JWT' },
                { method: 'GET',  path: '/api/admin/stats', desc: 'Dashboard statistics' },
                { method: 'GET',  path: '/api/admin/conversations', desc: 'All conversations' },
                { method: 'POST', path: '/api/upload', desc: 'Upload PDF/DOCX/XLSX' },
                { method: 'POST', path: '/api/train/website', desc: 'Trigger web crawl' },
                { method: 'GET',  path: '/api/analytics', desc: 'Analytics summary' },
              ].map(({ method, path, desc }) => (
                <div key={path} className="flex items-center gap-3 text-xs">
                  <span className={`font-mono font-bold w-10 ${
                    method === 'GET' ? 'text-green-400' : 'text-blue-400'
                  }`}>
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

      {/* Links */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <a
          href="http://localhost:6333/dashboard"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 hover:text-blue-400 transition"
        >
          <ExternalLink size={11} /> Qdrant Dashboard
        </a>
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 hover:text-blue-400 transition"
        >
          <ExternalLink size={11} /> Swagger API Docs
        </a>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  icon, title, description, children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
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

function EnvTable({
  settings,
  onCopy,
}: {
  settings: EnvSetting[]
  onCopy: (text: string) => void
}) {
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
                    <button
                      onClick={() => onCopy(s.key)}
                      className="text-gray-600 hover:text-gray-400 transition"
                      title="Copy key name"
                    >
                      <Copy size={10} />
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <code className={s.sensitive ? 'text-gray-600' : 'text-green-400 font-mono'}>
                  {s.value}
                </code>
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
