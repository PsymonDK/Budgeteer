import { useState, useEffect, type ComponentType } from 'react'
import { Tag } from 'lucide-react'
import { loadIcon, type LucideIconProps } from '../lib/lucideIcons'

interface CategoryIconProps {
  name: string | null | undefined
  className?: string
  size?: number
}

export function CategoryIcon({ name, className, size = 16 }: CategoryIconProps) {
  const [Icon, setIcon] = useState<ComponentType<LucideIconProps> | null>(null)

  useEffect(() => {
    if (!name) {
      setIcon(null)
      return
    }

    let cancelled = false

    loadIcon(name)
      .then((result) => {
        if (!cancelled) setIcon(() => result)
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
