import { useState, useRef, type ChangeEvent } from 'react'
import { parsePayslipCsv } from '../../lib/parsePayslipCsv'
import type { PayslipExtraction, PayslipLine, PayslipLineType } from '../../lib/parsePayslipCsv'
import { PAYSLIP_CSV_TEMPLATE } from '../../lib/payslipTemplate'
import { api } from '../../api/client'
import { Modal } from '../../components/Modal'
import { FormError } from '../../components/FormError'
import { inputClass } from '../../lib/styles'
import { MONTHS } from './helpers'
import { LINE_TYPE_LABELS, LINE_TYPE_SANKEY } from './payslipLineTypes'

interface PayslipImportModalProps {
  jobId: string
  jobName: string
  onClose: () => void
  onExtracted: (data: PayslipExtraction) => void
}

export function PayslipImportModal({ jobId, jobName, onClose, onExtracted }: PayslipImportModalProps) {
  const [tab, setTab] = useState<'csv' | 'manual' | 'ai'>('csv')
  const [csvError, setCsvError] = useState('')
  const csvInputRef = useRef<HTMLInputElement>(null)

  // Manual entry state
  const [manYear, setManYear] = useState(String(new Date().getFullYear()))
  const [manMonth, setManMonth] = useState(String(new Date().getMonth() + 1))
  const [manEmployer, setManEmployer] = useState('')
  const [manGross, setManGross] = useState('')
  const [manNet, setManNet] = useState('')
  const [manPensionEmployer, setManPensionEmployer] = useState('')
  const [manLines, setManLines] = useState<PayslipLine[]>([])
  const [manError, setManError] = useState('')

  // AI state
  const [aiConsent, setAiConsent] = useState(false)
  const [aiFile, setAiFile] = useState<File | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  function downloadTemplate() {
    const blob = new Blob([PAYSLIP_CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'payslip-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        const extraction = parsePayslipCsv(text)
        onExtracted(extraction)
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV')
      }
    }
    reader.readAsText(file)
  }

  function handleManualReview() {
    setManError('')
    const year = parseInt(manYear)
    const month = parseInt(manMonth)
    const gross = parseFloat(manGross)
    const net = parseFloat(manNet)
    if (isNaN(year) || year < 2000) { setManError('Invalid year'); return }
    if (isNaN(month) || month < 1 || month > 12) { setManError('Invalid month'); return }
    if (isNaN(gross) || gross <= 0) { setManError('Invalid gross amount'); return }
    if (isNaN(net) || net <= 0) { setManError('Invalid net amount'); return }
    const pensionEmployer = parseFloat(manPensionEmployer)
    onExtracted({
      period: { year, month },
      employerName: manEmployer,
      grossSalary: gross,
      netPay: net,
      currency: 'DKK',
      lines: manLines,
      pensionEmployerMonthly: isNaN(pensionEmployer) ? undefined : pensionEmployer,
      confidence: 'high',
    })
  }

  function addManualLine() {
    setManLines((prev) => [...prev, { label: '', amount: 0, type: 'post_tax', sankeyGroup: 'other_deductions', isCalculated: false }])
  }

  function updateManualLine(i: number, changes: Partial<PayslipLine>) {
    setManLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const updated = { ...l, ...changes }
      if (changes.type) updated.sankeyGroup = LINE_TYPE_SANKEY[changes.type] as PayslipLine['sankeyGroup']
      return updated
    }))
  }

  async function handleAiParse() {
    setAiLoading(true); setAiError('')
    try {
      let body: Record<string, string>
      if (aiFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            resolve(dataUrl.split(',')[1])
          }
          reader.onerror = reject
          reader.readAsDataURL(aiFile)
        })
        body = { fileBase64: base64, mimeType: aiFile.type }
      } else if (aiText.trim()) {
        body = { rawText: aiText.trim() }
      } else {
        setAiError('Please upload a file or paste payslip text'); setAiLoading(false); return
      }
      const response = await api.post<PayslipExtraction>(`/jobs/${jobId}/payslips/parse`, body)
      onExtracted(response.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Parsing failed'
      if (msg.includes('AI_NOT_CONFIGURED') || msg.includes('not enabled')) {
        setAiError('AI parsing is not enabled on this server. Set ANTHROPIC_API_KEY in your server environment.')
      } else {
        setAiError(msg)
      }
    } finally {
      setAiLoading(false)
    }
  }

  const tabCls = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-white'}`

  return (
    <Modal title={`Import payslip — ${jobName}`} onClose={onClose} size="lg">
      <div className="flex border-b border-gray-800 mb-5 -mt-1">
        <button className={tabCls('csv')} onClick={() => setTab('csv')}>CSV Template</button>
        <button className={tabCls('manual')} onClick={() => setTab('manual')}>Enter Manually</button>
        <button className={tabCls('ai')} onClick={() => setTab('ai')}>AI Parse</button>
      </div>

      {/* ── CSV tab ── */}
      {tab === 'csv' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Download the template, fill in your payslip numbers, then upload the completed file.
            No data leaves your system — the file is parsed entirely in your browser.
          </p>
          <button onClick={downloadTemplate}
            className="text-sm text-amber-400 hover:text-amber-300 border border-amber-700 px-4 py-2 rounded-lg transition-colors">
            Download template (CSV)
          </button>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Upload completed CSV</label>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFile}
              className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600 cursor-pointer" />
          </div>
          <FormError message={csvError} />
        </div>
      )}

      {/* ── Manual tab ── */}
      {tab === 'manual' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
              <input type="number" value={manYear} onChange={(e) => setManYear(e.target.value)} min="2000" max="2100" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Month</label>
              <select value={manMonth} onChange={(e) => setManMonth(e.target.value)} className={inputClass}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Employer <span className="text-gray-600">(optional)</span></label>
            <input type="text" value={manEmployer} onChange={(e) => setManEmployer(e.target.value)} placeholder="Company A/S" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Gross / month</label>
              <input type="number" value={manGross} onChange={(e) => setManGross(e.target.value)} min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Net pay (to bank)</label>
              <input type="number" value={manNet} onChange={(e) => setManNet(e.target.value)} min="0.01" step="0.01" placeholder="0.00" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Employer pension <span className="text-gray-600">(optional)</span></label>
            <input type="number" value={manPensionEmployer} onChange={(e) => setManPensionEmployer(e.target.value)} min="0" step="0.01" placeholder="0.00" className={inputClass} />
          </div>

          {/* Deduction lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-400">Deduction lines</label>
              <button type="button" onClick={addManualLine} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">+ Add line</button>
            </div>
            {manLines.length === 0 && <p className="text-xs text-gray-600">No lines added. Click &quot;+ Add line&quot; to start.</p>}
            <div className="space-y-2">
              {manLines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                  <input type="text" value={line.label} onChange={(e) => updateManualLine(i, { label: e.target.value })}
                    placeholder="Label" className={`${inputClass} text-xs`} />
                  <select value={line.type} onChange={(e) => updateManualLine(i, { type: e.target.value as PayslipLineType })}
                    className={`${inputClass} text-xs`}>
                    {(Object.keys(LINE_TYPE_LABELS) as PayslipLineType[]).map((t) => (
                      <option key={t} value={t}>{LINE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <input type="number" value={line.amount} onChange={(e) => updateManualLine(i, { amount: parseFloat(e.target.value) || 0 })}
                    min="0" step="0.01" placeholder="0.00" className={`${inputClass} text-xs w-24`} />
                  <button type="button" onClick={() => setManLines((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-red-500 hover:text-red-400 text-xs px-1 transition-colors">✕</button>
                </div>
              ))}
            </div>
          </div>

          <FormError message={manError} />
          <button type="button" onClick={handleManualReview}
            className="w-full bg-amber-400 hover:bg-amber-300 text-gray-950 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors">
            Review →
          </button>
        </div>
      )}

      {/* ── AI tab ── */}
      {tab === 'ai' && (
        <div className="space-y-4">
          <div className="bg-amber-950/50 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-300">
            <p className="font-medium mb-1">Privacy warning</p>
            <p>This will send your payslip data to Anthropic's API. Your payslip contains personal financial information including salary, tax, and pension details. Only proceed if you consent to this data leaving your system.</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)}
              className="mt-0.5 rounded border-gray-600 bg-gray-800 text-amber-400 focus:ring-amber-400" />
            <span className="text-sm text-gray-300">I understand and consent to sending my payslip data to Anthropic's API</span>
          </label>

          {aiConsent && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Upload payslip (PDF, PNG, or JPEG)</label>
                <input type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setAiFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600 cursor-pointer" />
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <div className="flex-1 h-px bg-gray-800" />
                <span>or paste text</span>
                <div className="flex-1 h-px bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Paste payslip text</label>
                <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={6}
                  placeholder="Copy and paste the text content of your payslip here..."
                  className={`${inputClass} resize-y text-xs font-mono`} />
              </div>
              <FormError message={aiError} />
              <button type="button" onClick={handleAiParse} disabled={aiLoading || (!aiFile && !aiText.trim())}
                className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors">
                {aiLoading ? 'Parsing…' : 'Parse with AI →'}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
