import { Link } from 'react-router-dom'
import { Anchor } from 'lucide-react'

export function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6">
      <Anchor size={56} strokeWidth={1.25} className="text-gray-600 mb-4" aria-hidden="true" />
      <p className="font-mono text-xs tracking-widest text-gray-500 mb-2">403</p>
      <h1 className="font-display text-4xl text-gray-100 mb-2">Ye lack the authority, sailor.</h1>
      <p className="text-gray-400 text-sm mb-8">Only admins can open this page.</p>
      <Link
        to="/"
        className="bg-amber-400 text-gray-950 font-semibold px-6 py-2.5 rounded-lg hover:bg-amber-300 transition-colors"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
