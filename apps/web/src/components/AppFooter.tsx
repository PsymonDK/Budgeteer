const VERSION = '0.32.0'

export function AppFooter() {
  return (
    <footer className="border-t border-gray-800 mt-16 py-6 px-6 text-center">
      <p className="text-gray-700 text-xs">
        ☠️ Budgeteer{' '}
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
