import { useState, useEffect, type ComponentType } from 'react'
import { Tag } from 'lucide-react'

interface IconProps {
  size?: number
  className?: string
}

// Convert PascalCase to kebab-case for dynamicIconImports lookup
function toKebabCase(name: string): string {
  return name
    .replace(/([A-Z])/g, (match, _, offset) => (offset > 0 ? '-' : '') + match.toLowerCase())
}

// Convert kebab-case to PascalCase for display/storage
function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

interface PreviewIconProps {
  kebabName: string
  size?: number
  className?: string
}

function PreviewIcon({ kebabName, size = 16, className }: PreviewIconProps) {
  const [Icon, setIcon] = useState<ComponentType<IconProps> | null>(null)

  useEffect(() => {
    let cancelled = false
    import('lucide-react/dynamicIconImports')
      .then((mod) => {
        const map = mod.default as Record<string, () => Promise<{ default: ComponentType<IconProps> }>>
        const loader = map[kebabName]
        if (!loader) return undefined
        return loader()
      })
      .then((result) => {
        if (!cancelled && result) setIcon(() => result.default)
      })
      .catch(() => {
        if (!cancelled) setIcon(null)
      })
    return () => { cancelled = true }
  }, [kebabName])

  if (!Icon) return <Tag size={size} className={className} />
  return <Icon size={size} className={className} />
}

interface IconPickerProps {
  value: string | null
  onChange: (iconName: string | null) => void
  onClose: () => void
}

export function IconPicker({ value, onChange, onClose }: IconPickerProps) {
  const [search, setSearch] = useState('')
  const [allNames, setAllNames] = useState<string[]>([])

  useEffect(() => {
    import('lucide-react/dynamicIconImports').then((mod) => {
      setAllNames(Object.keys(mod.default as Record<string, unknown>))
    })
  }, [])

  const filtered = search.trim()
    ? allNames.filter((n) => n.includes(search.toLowerCase().trim()))
    : allNames

  const currentKebab = value ? toKebabCase(value) : null

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-900 p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400">Choose an icon</span>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-600 hover:text-gray-400 text-sm leading-none"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search icons…"
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-400 mb-2"
        autoFocus
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mb-2 text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Clear icon
        </button>
      )}
      <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto">
        {filtered.slice(0, 120).map((kebab) => {
          const pascal = toPascalCase(kebab)
          const isSelected = currentKebab === kebab
          return (
            <button
              key={kebab}
              type="button"
              title={pascal}
              onClick={() => { onChange(pascal); onClose() }}
              className={`flex flex-col items-center gap-0.5 p-1.5 rounded text-xs transition-colors ${
                isSelected
                  ? 'bg-amber-400 text-gray-950'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <PreviewIcon kebabName={kebab} size={16} />
              <span className="text-[9px] leading-tight truncate w-full text-center">{kebab}</span>
            </button>
          )
        })}
      </div>
      {filtered.length > 120 && (
        <p className="text-xs text-gray-600 mt-2 text-center">
          {filtered.length - 120} more — refine your search
        </p>
      )}
    </div>
  )
}
