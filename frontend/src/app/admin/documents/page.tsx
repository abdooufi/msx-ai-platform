'use client'

import { useEffect, useRef, useState, useCallback, DragEvent } from 'react'
import {
  Upload, Trash2, FileText, RefreshCcw, CheckCircle,
  AlertCircle, Loader2, RotateCcw, CloudUpload, Building2,
  Link2, CalendarClock, Power, PowerOff, Pencil, Plus,
  Globe, Archive,
} from 'lucide-react'
import {
  listDocuments, uploadDocument, deleteDocument, retryDocument,
  searchCompanySymbols, uploadFromUrl, listUrlSchedules,
  addUrlSchedule, deleteUrlSchedule,
} from '../../../lib/api'
import { UploadedDoc, UrlSchedule } from '../../../types'
import toast from 'react-hot-toast'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  pending:    { icon: <Loader2 size={13} className="animate-spin text-yellow-400" />,  label: 'Pending',    color: 'text-yellow-400' },
  processing: { icon: <Loader2 size={13} className="animate-spin text-blue-400"   />,  label: 'Processing', color: 'text-blue-400'   },
  indexed:    { icon: <CheckCircle size={13} className="text-green-400"            />,  label: 'Indexed',    color: 'text-green-400'  },
  failed:     { icon: <AlertCircle size={13} className="text-red-400"              />,  label: 'Failed',     color: 'text-red-400'    },
}

function fmtSize(bytes: number) {
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

/** Detect a company symbol from a filename like "2_OQEP_report.pdf" → "OQEP" */
function detectSymbol(name: string): string | null {
  const m = /(?:^|_)([A-Z]{2,8})(?:_|\.)/.exec(name.toUpperCase())
  return m ? m[1] : null
}

const ACCEPT     = '.pdf,.docx,.doc,.xlsx,.csv,.txt,.zip'
const ACCEPT_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain',
  'application/zip', 'application/x-zip-compressed',
]

const CRON_PRESETS = [
  { label: 'Every 6 h',  cron: '0 */6 * * *'  },
  { label: 'Every 12 h', cron: '0 */12 * * *' },
  { label: 'Daily 2 am', cron: '0 2 * * *'    },
  { label: 'Daily 6 am', cron: '0 6 * * *'    },
  { label: 'Weekly Sun', cron: '0 2 * * 0'    },
]

interface UploadItem { name: string; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string }
interface CompanyOption { symbol: string; nameEn: string; nameAr: string }

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'files' | 'url'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [tab,            setTab]            = useState<Tab>('files')
  const [docs,           setDocs]           = useState<UploadedDoc[]>([])
  const [total,          setTotal]          = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [uploadQueue,    setUploadQueue]    = useState<UploadItem[]>([])
  const [dragging,       setDragging]       = useState(false)
  const [companySymbol,  setCompanySymbol]  = useState('')
  const [companySuggest, setCompanySuggest] = useState<CompanyOption[]>([])
  const [showSuggest,    setShowSuggest]    = useState(false)

  // URL tab
  const [urlInput,       setUrlInput]       = useState('')
  const [urlSymbol,      setUrlSymbol]      = useState('')
  const [urlLoading,     setUrlLoading]     = useState(false)
  const [schedules,      setSchedules]      = useState<UrlSchedule[]>([])
  const [schedLoading,   setSchedLoading]   = useState(false)
  const [addingSchedule, setAddingSchedule] = useState(false)
  const [schedUrl,       setSchedUrl]       = useState('')
  const [schedCron,      setSchedCron]      = useState('')
  const [schedSymbol,    setSchedSymbol]    = useState('')
  const [customCron,     setCustomCron]     = useState(false)

  const fileRef   = useRef<HTMLInputElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load docs ───────────────────────────────────────────────────────────────

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await listDocuments()
      setDocs(res.data.docs || [])
      setTotal(res.data.total || 0)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const loadSchedules = useCallback(async () => {
    try {
      const res = await listUrlSchedules()
      setSchedules(res.data || [])
    } catch {}
  }, [])

  useEffect(() => { load(); loadSchedules() }, [load, loadSchedules])

  useEffect(() => {
    const hasActive = docs.some(d => d.status === 'pending' || d.status === 'processing')
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(() => load(true), 3000)
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [docs, load])

  // ── Symbol autocomplete ─────────────────────────────────────────────────────

  const onSymbolChange = async (val: string, setter: (v: string) => void) => {
    setter(val)
    if (val.trim().length < 1) { setCompanySuggest([]); setShowSuggest(false); return }
    try {
      const res = await searchCompanySymbols(val.trim())
      setCompanySuggest(res.data.slice(0, 8))
      setShowSuggest(res.data.length > 0)
    } catch { setCompanySuggest([]); setShowSuggest(false) }
  }

  const pickSymbol = (sym: string, setter: (v: string) => void) => {
    setter(sym); setShowSuggest(false); setCompanySuggest([])
  }

  // ── Upload files ────────────────────────────────────────────────────────────

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    const sym   = companySymbol.trim().toUpperCase()
    const items: UploadItem[] = files.map(f => ({ name: f.name, status: 'queued' }))
    setUploadQueue(items)

    for (let i = 0; i < files.length; i++) {
      setUploadQueue(q => q.map((it, j) => j === i ? { ...it, status: 'uploading' } : it))
      const form = new FormData()
      form.append('file', files[i])
      // Only send symbol if explicitly set; backend auto-detects otherwise
      if (sym) form.append('companySymbol', sym)
      try {
        await uploadDocument(form)
        setUploadQueue(q => q.map((it, j) => j === i ? { ...it, status: 'done' } : it))
      } catch (e: any) {
        const msg = e?.response?.data?.message ?? e.message ?? 'Upload failed'
        setUploadQueue(q => q.map((it, j) => j === i ? { ...it, status: 'error', error: msg } : it))
        toast.error(`${files[i].name}: ${msg}`)
      }
    }

    await load()
    setTimeout(() => setUploadQueue([]), 4000)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // Auto-detect symbol from the first file name if no symbol set
    if (!companySymbol && files.length > 0) {
      const detected = detectSymbol(files[0].name)
      if (detected) setCompanySymbol(detected)
    }
    uploadFiles(files)
  }

  const onDragOver  = (e: DragEvent) => { e.preventDefault(); setDragging(true)  }
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); setDragging(false) }
  const onDrop      = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(
      f => ACCEPT_MIME.includes(f.type) || ACCEPT.split(',').some(ext => f.name.endsWith(ext))
    )
    if (!files.length) { toast.error('No supported files dropped'); return }
    if (!companySymbol && files.length > 0) {
      const detected = detectSymbol(files[0].name)
      if (detected) setCompanySymbol(detected)
    }
    uploadFiles(files)
  }

  // ── Doc actions ─────────────────────────────────────────────────────────────

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    await deleteDocument(id); toast.success('Deleted'); load()
  }

  const handleRetry = async (id: string, name: string) => {
    try { await retryDocument(id); toast.success(`Re-queued: ${name}`); load(true) }
    catch { toast.error('Retry failed') }
  }

  // ── URL ingestion ────────────────────────────────────────────────────────────

  const handleFromUrl = async () => {
    const url = urlInput.trim()
    if (!url) return
    setUrlLoading(true)
    try {
      const res = await uploadFromUrl(url, urlSymbol.trim().toUpperCase() || undefined)
      toast.success(`Queued ${res.data.queued} document(s) from URL`)
      setUrlInput('')
      setTimeout(() => load(true), 2000)
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? e.message ?? 'Failed')
    } finally { setUrlLoading(false) }
  }

  // ── URL schedules ────────────────────────────────────────────────────────────

  const handleAddSchedule = async () => {
    if (!schedUrl.trim() || !schedCron.trim()) {
      toast.error('URL and cron expression are required')
      return
    }
    setSchedLoading(true)
    try {
      await addUrlSchedule(
        schedUrl.trim(),
        schedCron.trim(),
        schedSymbol.trim().toUpperCase() || undefined,
      )
      toast.success('Schedule added')
      setAddingSchedule(false)
      setSchedUrl(''); setSchedCron(''); setSchedSymbol(''); setCustomCron(false)
      loadSchedules()
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to add schedule')
    } finally { setSchedLoading(false) }
  }

  const handleDeleteSchedule = async (id: string, url: string) => {
    if (!confirm(`Cancel schedule for "${url}"?`)) return
    try {
      await deleteUrlSchedule(id)
      toast.success('Schedule cancelled')
      loadSchedules()
    } catch { toast.error('Failed to cancel') }
  }

  const isUploading = uploadQueue.some(q => q.status === 'queued' || q.status === 'uploading')

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText size={20} className="text-blue-400" />
          Documents
          <span className="text-sm font-normal text-gray-500">({total})</span>
        </h1>
        <div className="flex gap-2">
          <button onClick={() => load()} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg transition">
            <RefreshCcw size={13} /> Refresh
          </button>
          <label className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-lg cursor-pointer transition">
            {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Upload
            <input ref={fileRef} type="file" className="hidden" accept={ACCEPT} multiple onChange={handleFileInput} />
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        <button
          onClick={() => setTab('files')}
          className={`flex-1 flex items-center justify-center gap-2 text-sm py-2 rounded-lg transition ${
            tab === 'files' ? 'bg-gray-700 text-white font-medium' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Upload size={14} /> Upload Files
        </button>
        <button
          onClick={() => setTab('url')}
          className={`flex-1 flex items-center justify-center gap-2 text-sm py-2 rounded-lg transition ${
            tab === 'url' ? 'bg-gray-700 text-white font-medium' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Globe size={14} /> From URL {schedules.length > 0 && (
            <span className="text-xs bg-teal-900/60 text-teal-300 border border-teal-800 px-1.5 py-0.5 rounded-full">
              {schedules.length}
            </span>
          )}
        </button>
      </div>

      {/* ── FILE UPLOAD TAB ──────────────────────────────────────────────────── */}
      {tab === 'files' && (
        <>
          {/* Company symbol selector */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={15} className="text-teal-400" />
              <span className="text-sm font-medium text-white">Company</span>
              <span className="text-xs text-gray-500">(optional — auto-detected from filename, or choose manually)</span>
            </div>
            <div className="relative max-w-xs">
              <input
                value={companySymbol}
                onChange={e => onSymbolChange(e.target.value, setCompanySymbol)}
                onFocus={() => companySuggest.length > 0 && setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                placeholder="e.g. OQEP — or leave blank to auto-detect"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 uppercase tracking-wide font-mono focus:outline-none focus:border-teal-500 transition"
              />
              {companySymbol && (
                <button onClick={() => { setCompanySymbol(''); setCompanySuggest([]); setShowSuggest(false) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">✕</button>
              )}
              {showSuggest && companySuggest.length > 0 && (
                <div className="absolute z-20 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                  {companySuggest.map(c => (
                    <button key={c.symbol} onMouseDown={() => pickSymbol(c.symbol, setCompanySymbol)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-700 transition text-left">
                      <span className="text-xs font-mono font-bold text-teal-300 w-16 shrink-0">{c.symbol}</span>
                      <span className="text-xs text-gray-300 truncate">{c.nameEn}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {companySymbol && (
              <p className="text-xs text-teal-400 mt-2 flex items-center gap-1">
                <Building2 size={11} />
                Files → <code className="bg-teal-900/30 px-1 rounded font-mono">msx_co_{companySymbol.toLowerCase()}</code>
              </p>
            )}
            {!companySymbol && (
              <p className="text-xs text-gray-600 mt-2">
                Filename like <code className="text-gray-500">2_OQEP_report.pdf</code> → symbol auto-detected as <strong className="text-gray-400">OQEP</strong>
              </p>
            )}
          </div>

          {/* Drag & drop */}
          <div
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition ${
              dragging ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 hover:border-gray-500 bg-gray-900/30'
            }`}
          >
            <CloudUpload size={28} className={`mx-auto mb-2 ${dragging ? 'text-blue-400' : 'text-gray-600'}`} />
            <p className="text-sm text-gray-400">{dragging ? 'Drop files here' : 'Drag & drop files, or click to browse'}</p>
            <p className="text-xs text-gray-600 mt-1">PDF · DOCX · XLSX · CSV · TXT · <Archive size={11} className="inline" /> ZIP</p>
            {companySymbol && <p className="text-xs text-teal-500 mt-2">→ Tagged to <strong>{companySymbol.toUpperCase()}</strong></p>}
          </div>

          {/* Upload queue */}
          {uploadQueue.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Uploading…</p>
              {uploadQueue.map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  {item.status === 'queued'    && <Loader2 size={12} className="text-gray-500" />}
                  {item.status === 'uploading' && <Loader2 size={12} className="animate-spin text-blue-400" />}
                  {item.status === 'done'      && <CheckCircle size={12} className="text-green-400" />}
                  {item.status === 'error'     && <AlertCircle size={12} className="text-red-400" />}
                  <span className={`flex-1 truncate ${item.status === 'error' ? 'text-red-400' : 'text-gray-300'}`}>{item.name}</span>
                  {item.error && <span className="text-red-500 truncate max-w-[200px]">{item.error}</span>}
                  {item.status === 'done' && <span className="text-green-400">Queued</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── URL TAB ──────────────────────────────────────────────────────────── */}
      {tab === 'url' && (
        <div className="space-y-4">

          {/* One-shot URL fetch */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="text-blue-400" />
              <h2 className="font-semibold text-white text-sm">Import from URL</h2>
              <span className="text-xs text-gray-500">Scan a web page and download all documents found on it</span>
            </div>
            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com/reports/"
                onKeyDown={e => e.key === 'Enter' && handleFromUrl()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500 transition"
              />
              <div className="relative w-32">
                <input
                  value={urlSymbol}
                  onChange={e => onSymbolChange(e.target.value, setUrlSymbol)}
                  onFocus={() => companySuggest.length > 0 && setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  placeholder="Symbol"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono uppercase focus:outline-none focus:border-teal-500 transition"
                />
                {showSuggest && companySuggest.length > 0 && (
                  <div className="absolute z-20 bottom-full mb-1 left-0 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                    {companySuggest.map(c => (
                      <button key={c.symbol} onMouseDown={() => pickSymbol(c.symbol, setUrlSymbol)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-700 transition text-left">
                        <span className="text-xs font-mono font-bold text-teal-300">{c.symbol}</span>
                        <span className="text-xs text-gray-400 truncate">{c.nameEn}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleFromUrl}
                disabled={urlLoading || !urlInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {urlLoading ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                Scan
              </button>
            </div>
            <p className="text-xs text-gray-600">
              The system will find all PDF, DOCX, XLSX, CSV, TXT and ZIP links on the page, download new ones (skipping already-indexed files), and queue them for processing.
            </p>
          </div>

          {/* Scheduled URL watch */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock size={15} className="text-purple-400" />
                <h2 className="font-semibold text-white text-sm">Scheduled URL Watch</h2>
                <span className="text-xs text-gray-500">Auto-check URLs on a schedule, index new files only</span>
              </div>
              <button
                onClick={() => setAddingSchedule(v => !v)}
                className="flex items-center gap-1.5 text-xs text-white bg-purple-700 hover:bg-purple-600 px-3 py-1.5 rounded-lg transition"
              >
                <Plus size={12} /> Add Schedule
              </button>
            </div>

            {/* Add schedule form */}
            {addingSchedule && (
              <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    value={schedUrl}
                    onChange={e => setSchedUrl(e.target.value)}
                    placeholder="https://example.com/reports/"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-purple-500 transition"
                  />
                  <input
                    value={schedSymbol}
                    onChange={e => setSchedSymbol(e.target.value.toUpperCase())}
                    placeholder="Symbol"
                    className="w-28 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono uppercase focus:outline-none focus:border-teal-500 transition"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Frequency:</p>
                  <div className="flex flex-wrap gap-2">
                    {CRON_PRESETS.map(p => (
                      <button
                        key={p.cron}
                        onClick={() => { setSchedCron(p.cron); setCustomCron(false) }}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                          schedCron === p.cron && !customCron
                            ? 'bg-purple-700/60 border-purple-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-600 hover:text-white'
                        }`}
                      >{p.label}</button>
                    ))}
                    <button
                      onClick={() => setCustomCron(v => !v)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition flex items-center gap-1 ${
                        customCron ? 'bg-gray-700 border-gray-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    ><Pencil size={10} /> Custom</button>
                  </div>
                  {customCron && (
                    <input
                      value={schedCron}
                      onChange={e => setSchedCron(e.target.value)}
                      placeholder="e.g. 0 2 * * *"
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 font-mono focus:outline-none focus:border-purple-500 transition"
                    />
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setAddingSchedule(false); setSchedUrl(''); setSchedCron(''); setSchedSymbol(''); setCustomCron(false) }}
                    className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 transition">Cancel</button>
                  <button
                    onClick={handleAddSchedule}
                    disabled={schedLoading || !schedUrl.trim() || !schedCron.trim()}
                    className="flex items-center gap-1.5 text-xs text-white bg-purple-700 hover:bg-purple-600 disabled:opacity-50 px-4 py-1.5 rounded-lg transition"
                  >
                    {schedLoading ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                    Activate
                  </button>
                </div>
              </div>
            )}

            {/* Schedule list */}
            {schedules.length === 0 ? (
              <div className="text-center py-6 text-gray-600">
                <CalendarClock size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">No URL schedules yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map(s => (
                  <div key={s.id} className="flex items-start gap-3 bg-gray-800/60 border border-gray-700/50 rounded-lg px-4 py-3">
                    <Power size={12} className="text-green-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate font-mono" title={s.url}>{s.url}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-purple-300 font-mono">{s.cron}</span>
                        {s.companySymbol && (
                          <span className="text-xs font-mono font-bold text-teal-300 bg-teal-900/30 border border-teal-800/50 px-1.5 py-0.5 rounded">{s.companySymbol}</span>
                        )}
                        {s.lastRunAt && (
                          <span className="text-xs text-gray-500">Last: {new Date(s.lastRunAt).toLocaleString()}</span>
                        )}
                        {s.filesFound > 0 && (
                          <span className="text-xs text-gray-400">{s.filesFound} files found</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteSchedule(s.id, s.url)}
                      className="text-gray-600 hover:text-red-400 transition flex-shrink-0"
                      title="Cancel schedule"
                    >
                      <PowerOff size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DOCUMENTS TABLE ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No documents uploaded yet</p>
          <p className="text-xs mt-1">Upload a file or import from a URL above</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {docs.some(d => d.status === 'pending' || d.status === 'processing') && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-900/20 border-b border-blue-800/30 text-xs text-blue-300">
              <Loader2 size={12} className="animate-spin" /> Processing… auto-refreshing every 3 s
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-4 py-3">File</th>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Size</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Chunks</th>
                <th className="text-left px-4 py-3">Uploaded</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {docs.map(d => {
                const meta = STATUS_META[d.status] ?? STATUS_META['pending']
                return (
                  <tr key={d._id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                    <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate" title={d.originalName}>
                      {d.originalName}
                    </td>
                    <td className="px-4 py-3">
                      {d.companySymbol
                        ? <span className="inline-flex items-center text-xs font-mono font-bold text-teal-300 bg-teal-900/30 border border-teal-800/50 px-1.5 py-0.5 rounded">{d.companySymbol}</span>
                        : <span className="text-gray-600 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400 uppercase text-xs">{d.mimeType.split('/').pop()?.replace('vnd.openxmlformats-officedocument.', '')}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtSize(d.sizeBytes)}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 ${meta.color}`}>{meta.icon} {meta.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{d.chunksIndexed ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(d.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {d.status === 'failed' && (
                          <button onClick={() => handleRetry(d._id, d.originalName)}
                            className="text-yellow-500 hover:text-yellow-300 transition" title="Retry">
                            <RotateCcw size={13} />
                          </button>
                        )}
                        <button onClick={() => handleDelete(d._id, d.originalName)}
                          className="text-gray-500 hover:text-red-400 transition" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
