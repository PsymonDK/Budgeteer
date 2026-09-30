import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6">
      <Compass size={56} strokeWidth={1.25} className="text-gray-600 mb-4" aria-hidden="true" />
      <p className="font-mono text-xs tracking-widest text-gray-500 mb-2">404</p>
      <h1 className="font-display text-4xl text-gray-100 mb-2">Ye be lost at sea…</h1>
      <p className="text-gray-400 text-sm mb-8">This page doesn't exist, or it was moved.</p>
      <Link
        to="/"
        className="bg-amber-400 text-gray-950 font-semibold px-6 py-2.5 rounded-lg hover:bg-amber-300 transition-colors"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
