import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6">
      <p className="text-6xl mb-4">☠️</p>
      <h1 className="text-4xl font-bold text-amber-400 mb-2">404</h1>
      <p className="text-xl font-semibold mb-1">Ye be lost at sea…</p>
      <p className="text-gray-500 text-sm mb-8">This page doesn't exist or has been swallowed by the deep.</p>
      <Link
        to="/"
        className="bg-amber-400 text-gray-950 font-semibold px-6 py-2.5 rounded-lg hover:bg-amber-300 transition-colors"
      >
        Back to safe waters
      </Link>
    </div>
  )
}
