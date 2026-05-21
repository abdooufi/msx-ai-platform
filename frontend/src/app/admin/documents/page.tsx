'use client'

import { useEffect, useRef, useState, useCallback, DragEvent } from 'react'
import {
  Upload, Trash2, FileText, RefreshCcw, CheckCircle,
  AlertCircle, Loader2, RotateCcw, CloudUpload,
} from 'lucide-react'
import { listDocuments, uploadDocument, deleteDocument, retryDocument } from '../../../lib/api'
import { UploadedDoc } from '../../../types'
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

const ACCEPT = '.pdf,.docx,.doc,.xlsx,.csv,.txt'
const ACCEPT_MIME = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain']

// ─── Upload queue item ────────────────────────────────────────────────────────

interface UploadItem {
  name: string
  status: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [docs,        setDocs]        = useState<UploadedDoc[]>([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [dragging,    setDragging]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load ────────────────────────────────────────────────────────────────────

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

  useEffect(() => { load() }, [load])

  // Auto-refresh while any doc is pending or processing
  useEffect(() => {
    const hasActive = docs.some(d => d.status === 'pending' || d.status === 'processing')
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(() => load(true), 3000)
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [docs, load])

  // ── Upload helpers ──────────────────────────────────────────────────────────

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return

    // Build queue
    const items: UploadItem[] = files.map(f => ({ name: f.name, status: 'queued' }))
    setUploadQueue(items)

    for (let i = 0; i < files.length; i++) {
      setUploadQueue(q => q.map((it, j) => j === i ? { ...it, status: 'uploading' } : it))
      const form = new FormData()
      form.append('file', files[i])
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
    // Clear queue after 4 s
    setTimeout(() => setUploadQueue([]), 4000)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    uploadFiles(files)
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const onDragOver  = (e: DragEvent) => { e.preventDefault(); setDragging(true)  }
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); setDragging(false) }
  const onDrop      = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(
      f => ACCEPT_MIME.includes(f.type) || ACCEPT.split(',').some(ext => f.name.endsWith(ext))
    )
    if (!files.length) { toast.error('No supported files dropped'); return }
    uploadFiles(files)
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    await deleteDocument(id)
    toast.success('Deleted')
    load()
  }

  const handleRetry = async (id: string, name: string) => {
    try {
      await retryDocument(id)
      toast.success(`Re-queued: ${name}`)
      load(true)
    } catch { toast.error('Retry failed') }
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
          <button
            onClick={() => load()}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg transition"
          >
            <RefreshCcw size={13} /> Refresh
          </button>
          <label className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-lg cursor-pointer transition disabled:opacity-50">
            {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Upload
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept={ACCEPT}
              multiple
              onChange={handleFileInput}
            />
          </label>
        </div>
      </div>

      {/* Drag & drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition ${
          dragging
            ? 'border-blue-500 bg-blue-900/20'
            : 'border-gray-700 hover:border-gray-500 bg-gray-900/30'
        }`}
      >
        <CloudUpload size={28} className={`mx-auto mb-2 ${dragging ? 'text-blue-400' : 'text-gray-600'}`} />
        <p className="text-sm text-gray-400">
          {dragging ? 'Drop files here' : 'Drag & drop files, or click to browse'}
        </p>
        <p className="text-xs text-gray-600 mt-1">PDF, DOCX, XLSX, CSV, TXT — multiple files supported</p>
      </div>

      {/* Upload queue progress */}
      {uploadQueue.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Uploading…</p>
          {uploadQueue.map((item, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              {item.status === 'queued'    && <Loader2 size={12} className="text-gray-500" />}
              {item.status === 'uploading' && <Loader2 size={12} className="animate-spin text-blue-400" />}
              {item.status === 'done'      && <CheckCircle size={12} className="text-green-400" />}
              {item.status === 'error'     && <AlertCircle size={12} className="text-red-400" />}
              <span className={`flex-1 truncate ${item.status === 'error' ? 'text-red-400' : 'text-gray-300'}`}>
                {item.name}
              </span>
              {item.error && <span className="text-red-500 truncate max-w-[200px]">{item.error}</span>}
              {item.status === 'done' && <span className="text-green-400">Indexed</span>}
            </div>
          ))}
        </div>
      )}

      {/* Documents table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No documents uploaded yet</p>
          <p className="text-xs mt-1">Upload a PDF, Word doc, or spreadsheet to start training the AI</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Active processing banner */}
          {docs.some(d => d.status === 'pending' || d.status === 'processing') && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-900/20 border-b border-blue-800/30 text-xs text-blue-300">
              <Loader2 size={12} className="animate-spin" />
              Processing documents… auto-refreshing every 3 s
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-4 py-3">File</th>
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
                    <td className="px-4 py-3 text-white font-medium max-w-[220px] truncate" title={d.originalName}>
                      {d.originalName}
                    </td>
                    <td className="px-4 py-3 text-gray-400 uppercase text-xs">{d.mimeType.split('/').pop()?.replace('vnd.openxmlformats-officedocument.','')}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtSize(d.sizeBytes)}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 ${meta.color}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{d.chunksIndexed ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {d.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(d._id, d.originalName)}
                            className="text-yellow-500 hover:text-yellow-300 transition"
                            title="Retry indexing"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(d._id, d.originalName)}
                          className="text-gray-500 hover:text-red-400 transition"
                          title="Delete"
                        >
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
