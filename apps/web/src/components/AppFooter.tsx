import { BrandMark } from './BrandMark'
const VERSION = __APP_VERSION__

export function AppFooter() {
  return (
    <footer className="border-t border-gray-800 mt-16 py-6 px-6 text-center">
      <p className="text-gray-600 text-xs inline-flex items-center gap-1.5">
        <BrandMark size={14} className="text-gray-600" cutout="rgb(var(--sea-950))" />
        Budgeteer{' '}
        <span className="text-gray-600">v{VERSION}</span>
        {' · '}
        <a
          href="https://github.com/PsymonDK/Budgeteer"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-500 transition-colors"
        >
          GitHub
        </a>
      </p>
    </footer>
  )
}
