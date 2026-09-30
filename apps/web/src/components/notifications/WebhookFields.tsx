import type { WebhookFormat } from '../../api/types'
import { inputClass, secondaryBtn } from '../../lib/styles'

/**
 * An ntfy topic or webhook: its format, URL, optional secret (ntfy access token or signing
 * secret; stored encrypted, never shown again) and a button to send a test to the saved one.
 */
export function WebhookFields({
  idPrefix, format, onFormat, url, onUrl, urlPlaceholder, urlHelp,
  secretSet, secret, onSecret, clearSecret, onClearSecret, disabled = false,
  onTest, testPending, dirty,
}: {
  idPrefix: string
  format: WebhookFormat
  onFormat: (format: WebhookFormat) => void
  url: string
  onUrl: (url: string) => void
  urlPlaceholder: string
  urlHelp?: string
  /** A secret is saved */
  secretSet: boolean
  /** A new secret being typed ('' keeps the saved one) */
  secret: string
  onSecret: (secret: string) => void
  /** The saved secret will be removed on save */
  clearSecret: boolean
  onClearSecret: () => void
  disabled?: boolean
  onTest: () => void
  testPending: boolean
  /** Unsaved changes: the test uses the saved settings */
  dirty: boolean
}) {
  const secretLabel = format === 'NTFY' ? 'Access token' : 'Signing secret'
  const secretHelp = format === 'NTFY'
    ? 'Only for protected topics. Sent as a Bearer token.'
    : 'Signs each request (X-Budgeteer-Signature: HMAC-SHA256 of "<timestamp>.<body>") so the receiver can verify it.'
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${idPrefix}-format`} className="block text-xs font-medium text-gray-400 mb-1">Type</label>
          <select id={`${idPrefix}-format`} value={format} onChange={(e) => onFormat(e.target.value as WebhookFormat)} disabled={disabled} className={inputClass}>
            <option value="NTFY">ntfy topic</option>
            <option value="JSON">JSON webhook</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-url`} className="block text-xs font-medium text-gray-400 mb-1">URL</label>
          <input
            id={`${idPrefix}-url`} type="url" inputMode="url"
            value={url} onChange={(e) => onUrl(e.target.value)}
            placeholder={format === 'NTFY' ? urlPlaceholder : 'https://hooks.example.com/budgeteer'}
            disabled={disabled}
            aria-describedby={urlHelp ? `${idPrefix}-url-help` : undefined}
            className={inputClass}
          />
          {urlHelp && <p id={`${idPrefix}-url-help`} className="text-xs text-gray-500 mt-1">{urlHelp}</p>}
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-secret`} className="block text-xs font-medium text-gray-400 mb-1">
          {secretLabel} <span className="text-gray-600">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-secret`} type="password" autoComplete="new-password"
          value={secret} onChange={(e) => onSecret(e.target.value)}
          placeholder={secretSet && !clearSecret ? 'Saved — type to replace' : ''}
          disabled={disabled}
          aria-describedby={`${idPrefix}-secret-help`}
          className={inputClass}
        />
        <p id={`${idPrefix}-secret-help`} className="text-xs text-gray-500 mt-1">
          {secretHelp}
          {secretSet && !clearSecret && !disabled && (
            <> <button type="button" onClick={onClearSecret} className="text-amber-400 hover:text-amber-300">Remove it</button></>
          )}
          {clearSecret && <> It will be removed when you save.</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onTest} disabled={disabled || dirty || !url || testPending} className={secondaryBtn}>
          {testPending ? 'Sending…' : 'Send a test'}
        </button>
        <span className="text-xs text-gray-500">{dirty ? 'Save first; the test uses the saved settings.' : !url ? 'Add a URL first.' : 'Sends a short test message.'}</span>
      </div>
    </div>
  )
}
