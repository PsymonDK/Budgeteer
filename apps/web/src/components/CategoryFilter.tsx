import { CategoryIcon } from './CategoryIcon'

interface Category {
  id: string
  name: string
  icon?: string | null
}

interface CategoryFilterProps {
  categories: Category[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

export function CategoryFilter({ categories, selected, onChange }: CategoryFilterProps) {
  if (categories.length === 0) return null

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {categories.map(({ id, name, icon }) => (
        <button
          key={id}
          onClick={() => toggle(id)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
            selected.has(id)
              ? 'bg-amber-400 text-gray-950 border-amber-400'
              : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
          }`}
        >
          {icon && <CategoryIcon name={icon} size={12} />}
          {name}
        </button>
      ))}
      {selected.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-xs px-2 text-gray-600 hover:text-gray-400 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  )
}
