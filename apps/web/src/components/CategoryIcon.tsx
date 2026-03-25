import { useState, useEffect, type ComponentType } from 'react'
import { Tag } from 'lucide-react'

interface IconProps {
  size?: number
  className?: string
}

interface CategoryIconProps {
  name: string | null | undefined
  className?: string
  size?: number
}

// Convert PascalCase icon name to kebab-case for dynamicIconImports lookup
// e.g. "ShoppingCart" -> "shopping-cart", "RefreshCw" -> "refresh-cw"
function toKebabCase(name: string): string {
  return name
    .replace(/([A-Z])/g, (match, _, offset) => (offset > 0 ? '-' : '') + match.toLowerCase())
}

export function CategoryIcon({ name, className, size = 16 }: CategoryIconProps) {
  const [Icon, setIcon] = useState<ComponentType<IconProps> | null>(null)

  useEffect(() => {
    if (!name) {
      setIcon(null)
      return
    }

    let cancelled = false
    const kebab = toKebabCase(name)

    import('lucide-react/dynamicIconImports')
      .then((mod) => {
        const map = mod.default as Record<string, () => Promise<{ default: ComponentType<IconProps> }>>
        const loader = map[kebab]
        if (!loader) {
          if (!cancelled) setIcon(null)
          return
        }
        return loader()
      })
      .then((result) => {
        if (!cancelled && result) {
          setIcon(() => result.default)
        }
      })
      .catch(() => {
        if (!cancelled) setIcon(null)
      })

    return () => { cancelled = true }
  }, [name])

  if (!name) return null

  if (!Icon) {
    // Fallback to Tag while loading or if not found
    return <Tag size={size} className={className} />
  }

  return <Icon size={size} className={className} />
}
