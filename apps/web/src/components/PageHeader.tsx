interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-3xl leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {/* Wraps below the title when narrow; capped at the page width so button rows can wrap too */}
      {action && <div className="flex-shrink-0 max-w-full">{action}</div>}
    </div>
  )
}
