import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { toLocalISOMonth } from '../../lib/dates'
import { segmentGroupPlain, segmentBtnSolid } from '../../lib/styles'
import type { Granularity, HistoryBucket } from './types'

interface IncomeHistoryChartProps {
  targetUserId: string | null | undefined
  fmt: (v: number | string) => string
}

/** Income history section: period/granularity controls and the server-aggregated chart. */
export function IncomeHistoryChart({ targetUserId, fmt }: IncomeHistoryChartProps) {
  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return toLocalISOMonth(d)
  })
  const [histTo, setHistTo] = useState(() => toLocalISOMonth())
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const [showGross, setShowGross] = useState(true)

  const { data: historyData } = useQuery<{ buckets: HistoryBucket[] }>({
    queryKey: qk.incomeHistory(targetUserId, histFrom, histTo, granularity),
    queryFn: async () =>
      (await api.get(`/users/${targetUserId}/income/history`, { params: { from: histFrom, to: histTo, granularity } })).data,
    enabled: !!targetUserId,
  })

  const chartData = (historyData?.buckets ?? []).map((b) => ({
    period: b.period,
    net: parseFloat(b.net.toFixed(2)),
    gross: parseFloat(b.gross.toFixed(2)),
    bonuses: parseFloat(b.bonuses.reduce((s, x) => s + (showGross ? x.gross : x.net), 0).toFixed(2)),
  }))

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold">Income History</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">From</label>
            <input type="month" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">To</label>
            <input type="month" value={histTo} onChange={(e) => setHistTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
          </div>
          <div className={segmentGroupPlain}>
            {(['monthly', 'quarterly', 'yearly'] as Granularity[]).map((g) => (
              <button key={g} onClick={() => setGranularity(g)}
                className={segmentBtnSolid(granularity === g)}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          <div className={segmentGroupPlain}>
            <button onClick={() => setShowGross(false)}
              className={segmentBtnSolid(!showGross)}>Net</button>
            <button onClick={() => setShowGross(true)}
              className={segmentBtnSolid(showGross)}>Gross</button>
          </div>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data for selected period</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="period" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#f9fafb', fontWeight: 600 }}
              itemStyle={{ color: '#d1d5db' }}
              formatter={(value: number) => fmt(value)}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
            <Bar dataKey="bonuses" name="Bonuses" fill="#d97706" opacity={0.7} radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey={showGross ? 'gross' : 'net'} name={showGross ? 'Gross income' : 'Net income'} stroke="#fbbf24" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  )
}
