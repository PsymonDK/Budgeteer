import type { ComponentType } from 'react'

// Category icons are stored as PascalCase lucide names ("ShoppingCart", "Trash2") and
// loaded lazily through lucide-react/dynamicIconImports, which is keyed by kebab-case
// ("shopping-cart", "trash-2").

export interface LucideIconProps {
  size?: number
  className?: string
}

type IconLoader = () => Promise<{ default: ComponentType<LucideIconProps> }>

interface IconIndex {
  keys: string[]
  loaders: Record<string, IconLoader>
  keyByName: Map<string, string>
}

// Convert a dynamicIconImports key to the PascalCase name that is stored,
// e.g. "shopping-cart" -> "ShoppingCart", "trash-2" -> "Trash2"
export function toPascalCase(key: string): string {
  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

// Naive reverse: only splits before capitals, so "Trash2" -> "trash2".
// Used as a fallback for names that aren't the PascalCase form of any key.
function toKebabCase(name: string): string {
  return name.replace(/([A-Z])/g, (match, _, offset) => (offset > 0 ? '-' : '') + match.toLowerCase())
}

let indexPromise: Promise<IconIndex> | null = null

// The icon map is large, so it's imported on first use and shared by all callers.
// Stored names are resolved through a PascalCase -> key lookup rather than by reversing
// toPascalCase, which loses the '-' before digits. A few keys collide ("arrow-down-0-1"
// and "arrow-down-01" are both "ArrowDown01"); those are aliases of the same icon.
function loadIconIndex(): Promise<IconIndex> {
  indexPromise ??= import('lucide-react/dynamicIconImports').then((mod) => {
    const loaders = mod.default as Record<string, IconLoader>
    const keys = Object.keys(loaders)
    const keyByName = new Map<string, string>()
    for (const key of keys) {
      const name = toPascalCase(key)
      if (!keyByName.has(name)) keyByName.set(name, key)
    }
    return { keys, loaders, keyByName }
  })
  indexPromise.catch(() => { indexPromise = null })
  return indexPromise
}

export async function loadIconKeys(): Promise<string[]> {
  return (await loadIconIndex()).keys
}

// Load the component for a stored icon name, or null if lucide has no such icon.
export async function loadIcon(name: string): Promise<ComponentType<LucideIconProps> | null> {
  const { loaders, keyByName } = await loadIconIndex()
  const kebab = toKebabCase(name)
  const key = keyByName.get(name) ?? (Object.prototype.hasOwnProperty.call(loaders, kebab) ? kebab : undefined)
  if (!key) return null
  return (await loaders[key]()).default
}
