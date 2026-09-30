import { useId } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { ENTITY } from '../lib/charts'

interface SparklineProps {
  data: { value: number }[]
  color?: string
  height?: number
}

export function Sparkline({ data, color = ENTITY.income, height = 40 }: SparklineProps) {
  // Colours are CSS-variable strings (theme-aware), so the gradient id can't be derived from them
  const gradientId = `spark-${useId().replace(/:/g, '')}`
  if (data.length < 2) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
