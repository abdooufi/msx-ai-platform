'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload, Trash2, FileText, RefreshCcw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { listDocuments, uploadDocument, deleteDocument } from '../../../lib/api'
import { UploadedDoc } from '../../../types'
import toast from 'react-hot-toast'

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending:    <Loader2 size={13} className="animate-spin text-yellow-400" />,
  processing: <Loader2 size={13} className="animate-spin text-blue-400" />,
  indexed:    <CheckCircle size={13} className="text-green-400" />,
  failed:     <AlertCircle size={13} className="text-red-400" />,
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<UploadedDoc[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await listDocuments()
      setDocs(res.data.docs || [])
      setTotal(res.data.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      await uploadDocument(form)
      toast.success(`Uploaded: ${file.name}`)
      load()
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    await deleteDocument(id)
    toast.success('Deleted')
    load()
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Documents ({total})</h1>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg transition">
            <RefreshCcw size={13} /> Refresh
          </button>
          <label className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-lg cursor-pointer transition">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Upload
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.csv,.txt" onChange={handleUpload} />
          </label>
        </div>
      </div>

      <div className="text-xs text-gray-500">Supported: PDF, DOCX, XLSX, CSV, TXT</div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No documents uploaded yet</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
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
              {docs.map(d => (
                <tr key={d._id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                  <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate">{d.originalName}</td>
                  <td className="px-4 py-3 text-gray-400 uppercase text-xs">{d.mimeType.split('/').pop()}</td>
                  <td className="px-4 py-3 text-gray-400">{(d.sizeBytes / 1024).toFixed(0)} KB</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">{STATUS_ICONS[d.status]} <span className="text-gray-400 capitalize">{d.status}</span></span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{d.chunksIndexed}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(d._id, d.originalName)} className="text-gray-500 hover:text-red-400 transition">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
