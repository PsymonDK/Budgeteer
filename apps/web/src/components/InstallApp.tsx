import { Download, Share, X } from 'lucide-react'
import { toast } from 'sonner'
import { dismissInstallHint, promptInstall, useInstallState } from '../lib/install'
import { primaryBtnSm, secondaryBtn } from '../lib/styles'

async function install() {
  const outcome = await promptInstall()
  if (outcome === 'accepted') toast.success('Budgeteer is being installed')
}

function IosSteps() {
  return (
    <>
      Tap <Share size={14} aria-label="Share" className="inline -mt-0.5 text-gray-200" /> Share, then <span className="text-gray-200">Add to Home Screen</span>.
    </>
  )
}

/** "Install app" in the sidebar and the phone menu, shown only while the browser can install it. */
export function InstallAppButton({ className, labelClassName = '', showTitle }: {
  className: string
  labelClassName?: string
  showTitle: boolean
}) {
  const { canPrompt } = useInstallState()
  if (!canPrompt) return null
  return (
    <button type="button" onClick={install} title={showTitle ? 'Install app' : undefined} className={className}>
      <Download size={16} className="flex-shrink-0 text-gray-500" />
      <span className={`${labelClassName} truncate`}>Install app</span>
    </button>
  )
}

/** One-time hint above the page on phones; dismissing it is remembered on the device. */
export function InstallAppHint() {
  const { canPrompt, showIosSteps, hintDismissed } = useInstallState()
  if (hintDismissed || (!canPrompt && !showIosSteps)) return null
  return (
    <div className="sm:hidden mx-4 mt-4 flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-gray-100">Install Budgeteer on your phone</p>
        <p className="mt-0.5 text-gray-400">
          {showIosSteps ? <IosSteps /> : 'Open it from your home screen, in its own window.'}
        </p>
        {canPrompt && (
          <button type="button" onClick={install} className={`${primaryBtnSm} mt-3`}>Install app</button>
        )}
      </div>
      <button type="button" onClick={dismissInstallHint} aria-label="Dismiss" className="-mr-1 p-1 text-gray-500 hover:text-white transition-colors">
        <X size={16} />
      </button>
    </div>
  )
}

/** Profile → Preferences: install status for this device. */
export function InstallAppSetting() {
  const { installed, canPrompt, showIosSteps } = useInstallState()
  return (
    <div>
      <p className="block text-xs font-medium text-gray-400 mb-1">App</p>
      {installed ? (
        <p className="text-sm text-gray-300">You're using the installed app on this device.</p>
      ) : canPrompt ? (
        <>
          <button type="button" onClick={install} className={`${secondaryBtn} inline-flex items-center gap-2`}>
            <Download size={16} /> Install app
          </button>
          <p className="text-xs text-gray-500 mt-1.5">Adds Budgeteer to your home screen or app list, opening in its own window.</p>
        </>
      ) : showIosSteps ? (
        <p className="text-sm text-gray-400"><IosSteps /></p>
      ) : (
        <p className="text-xs text-gray-500">
          Your browser isn't offering to install Budgeteer here. It may already be installed, or the browser doesn't support it; installing also needs HTTPS. Look for <span className="text-gray-300">Install app</span> or <span className="text-gray-300">Add to Home Screen</span> in the browser's menu.
        </p>
      )}
    </div>
  )
}
