import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Receipt } from './types'

/** The stored receipt file (image or PDF), or the raw OCR text when no file was uploaded. */
export function ReceiptPreview({ householdId, receipt }: { householdId: string; receipt: Receipt }) {
  const previewUrl = useReceiptFileUrl(householdId, receipt)

  return (
    <aside className="min-w-0 border border-gray-800 rounded-xl overflow-hidden bg-gray-950 2xl:sticky 2xl:top-24">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Receipt</p>
          <p className="text-xs text-gray-500 truncate">{receipt.sourceFileName ?? 'No stored file'}</p>
        </div>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:text-amber-300">
            Open
          </a>
        )}
      </div>
      <div className="h-[420px] md:h-[560px] 2xl:h-[calc(100vh-190px)] bg-gray-950 flex items-center justify-center overflow-hidden">
        {!receipt.hasSourceFile ? (
          <div className="p-6 text-sm text-gray-500 text-center whitespace-pre-wrap overflow-auto max-h-full">
            {receipt.rawText || 'No original receipt file stored for this import.'}
          </div>
        ) : !previewUrl ? (
          <p className="text-sm text-gray-500">Loading receipt…</p>
        ) : receipt.sourceMimeType === 'application/pdf' ? (
          <object data={previewUrl} type="application/pdf" className="w-full h-full">
            <iframe src={previewUrl} className="w-full h-full" title="Receipt PDF" />
          </object>
        ) : (
          <img src={previewUrl} alt="Receipt" className="max-w-full max-h-full object-contain" />
        )}
      </div>
    </aside>
  )
}

/**
 * Fetches the stored receipt file with the auth header and exposes it as an
 * object URL (revoked on change/unmount). A plain <img src> cannot send the token.
 */
function useReceiptFileUrl(householdId: string, receipt: Receipt): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const { id: receiptId, hasSourceFile } = receipt

  useEffect(() => {
    if (!hasSourceFile) {
      setUrl(null)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    api.get(`/households/${householdId}/receipts/${receiptId}/file`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data)
        setUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setUrl(null) })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [householdId, receiptId, hasSourceFile])

  return url
}
