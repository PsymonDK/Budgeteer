import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, Dot,
} from 'recharts'
import { SankeyChart } from '../../components/SankeyChart'
import { legendInOrder } from '../../lib/charts'
import { segmentGroupPlain, segmentBtnSolid } from '../../lib/styles'
import type { IncomeSankeyData, IncomeTrend } from './types'

const JOB_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16',
]

function formatMonth(yyyymm: string): string {
  const [year, mon] = yyyymm.split('-')
  return new Date(Number(year), Number(mon) - 1, 1).toLocaleString('en-GB', { month: 'short', year: '2-digit' })
}

/** Income flow Sankey (gross → deductions → households) from the server-built graph. */
export function IncomeFlowCard({ sankeyData, baseCurrency }: { sankeyData: IncomeSankeyData | undefined; baseCurrency: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
      <h3 className="text-sm font-semibold mb-4 text-gray-200">Income flow</h3>
      {sankeyData && sankeyData.nodes.length > 0 ? (
        <>
          {(() => {
            const has3Col = sankeyData.nodes.some((n) => n.id === 'net_pay' || n.id === 'am_bidrag')
            return <SankeyChart data={sankeyData} currency={baseCurrency} height={has3Col ? 480 : 400} />
          })()}
          {sankeyData.employerPensionMonthly && parseFloat(sankeyData.employerPensionMonthly) > 0 && (
            <p className="text-xs text-gray-500 mt-3">
              ℹ Employer pension: <span className="text-gray-300">{parseFloat(sankeyData.employerPensionMonthly).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency}/month</span> (paid directly to pension fund)
            </p>
          )}
        </>
      ) : (
        <p className="text-gray-500 text-sm">No allocation data. Allocate income to households first.</p>
      )}
    </div>
  )
}

interface IncomeTrendCardProps {
  incomeTrend: IncomeTrend | undefined
  showGross: boolean
  setShowGross: (v: boolean) => void
  fmt: (v: number | string) => string
}

/** 12-month per-job income lines with bonus markers. */
export function IncomeTrendCard({ incomeTrend, showGross, setShowGross, fmt }: IncomeTrendCardProps) {
  const chartData = incomeTrend
    ? incomeTrend.months.map((m, i) => {
        const row: Record<string, unknown> = {
          month: formatMonth(m), monthKey: m,
          total: showGross ? incomeTrend.total[i] : incomeTrend.totalNet[i],
        }
        incomeTrend.jobs.forEach((j) => { row[j.name] = showGross ? j.monthly[i] : j.monthlyNet[i] })
        return row
      })
    : []

  const bonusMap = new Map<string, { jobId: string; amount: number; label: string }[]>()
  if (incomeTrend) {
    for (const b of incomeTrend.bonuses) {
      const key = `${b.jobId}::${b.month}`
      const arr = bonusMap.get(key) ?? []
      arr.push({ jobId: b.jobId, amount: showGross ? b.amount : b.amountNet, label: b.label })
      bonusMap.set(key, arr)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">12-month income trend</h3>
        <div className={segmentGroupPlain}>
          <button onClick={() => setShowGross(true)}
            className={segmentBtnSolid(showGross)}>Gross</button>
          <button onClick={() => setShowGross(false)}
            className={segmentBtnSolid(!showGross)}>Net</button>
        </div>
      </div>
      {incomeTrend && incomeTrend.jobs.length > 0 ? (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <RechartsTooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#f3f4f6' }}
              itemStyle={{ color: '#d1d5db' }}
            />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }}
              itemSorter={legendInOrder([...incomeTrend.jobs.map((job) => job.name), 'total'])} />
            {incomeTrend.jobs.map((job, i) => (
              <Line
                key={job.id}
                type="monotone"
                dataKey={job.name}
                stroke={JOB_COLORS[i % JOB_COLORS.length]}
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  const monthKey = payload.monthKey as string
                  const hasBonuses = bonusMap.has(`${job.id}::${monthKey}`)
                  if (hasBonuses) {
                    const bonuses = bonusMap.get(`${job.id}::${monthKey}`)!
                    const tipText = bonuses.map((b) => `${b.label}: ${fmt(b.amount)}`).join(', ')
                    return (
                      <g key={`dot-${job.id}-${monthKey}`}>
                        <circle cx={cx} cy={cy} r={6} fill={JOB_COLORS[i % JOB_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
                        <title>{`Bonus: ${tipText}`}</title>
                      </g>
                    )
                  }
                  // Only the circle's own props; the render props also carry data fields and a key
                  return (
                    <Dot
                      key={`dot-${job.id}-${monthKey}`}
                      cx={cx}
                      cy={cy}
                      r={3}
                      fill={props.fill}
                      stroke={props.stroke}
                      strokeWidth={props.strokeWidth}
                    />
                  )
                }}
              />
            ))}
            <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Total" />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-gray-500 text-sm">No job income data found.</p>
      )}
    </div>
  )
}
