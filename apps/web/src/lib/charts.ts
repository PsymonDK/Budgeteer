import type { LegendPayload } from 'recharts'

/**
 * Legend `itemSorter` that keeps series in the given order. Recharts 3 sorts
 * legend items alphabetically by default, and `null` (no sorting) doesn't
 * guarantee a stable order between renders.
 */
export function legendInOrder(dataKeys: string[]) {
  return (item: LegendPayload) => {
    const i = dataKeys.indexOf(String(item.dataKey))
    return i === -1 ? dataKeys.length : i
  }
}

// ── Chart & Ledger chart colours (dark theme) ─────────────────────────────────

/**
 * Categorical palette: brass, slate, coral, teal, plum, sage. Checked for lightness, chroma,
 * contrast against the card surface and colour-vision-deficiency separation in this order
 * (neighbours stay apart in deuteranopia simulation), so assign it in order and never cycle.
 */
export const SERIES = ['#BD871C', '#547ECD', '#C8664E', '#00A596', '#A5538C', '#7BA143'] as const

/** Colour for everything past the sixth series ("the rest"); pair it with a label. */
export const SERIES_REST = '#4F6575'

/** The series colour for position `i`: the palette in order, then the neutral. */
export const seriesColor = (i: number) => SERIES[i] ?? SERIES_REST

/** The same thing keeps its colour on every chart. */
export const ENTITY = {
  income: SERIES[3],   // teal
  expenses: SERIES[0], // brass
  savings: SERIES[1],  // slate
  surplus: SERIES[5],  // sage — a series, not the "good" status colour
  bonuses: SERIES[4],  // plum
} as const

/** People (members, jobs): starts away from the entity colours so a member isn't mistaken for "savings". */
export const PEOPLE = [SERIES[3], SERIES[4], SERIES[2], SERIES[5], SERIES[1], SERIES[0]] as const
export const personColor = (i: number) => PEOPLE[i] ?? SERIES_REST

/** Chart chrome, from the sea neutrals: recessive grid and axes, readable text. */
export const CHART = {
  grid: '#1F3140',        // sea-800
  axis: '#97AAB7',        // sea-400
  text: '#D6E0E6',        // sea-200
  muted: '#97AAB7',       // sea-400
  tooltipBg: '#131F28',   // sea-900
  tooltipBorder: '#34495A', // sea-700
} as const

/** Shared Recharts props so every chart has the same chrome. */
export const chartChrome = {
  grid: { strokeDasharray: '3 3', stroke: CHART.grid },
  tick: { fill: CHART.axis, fontSize: 11 },
  tooltip: {
    contentStyle: { backgroundColor: CHART.tooltipBg, border: `1px solid ${CHART.tooltipBorder}`, borderRadius: 8 },
    labelStyle: { color: CHART.text, fontWeight: 600 },
    itemStyle: { color: CHART.text },
  },
  legend: { color: CHART.muted, fontSize: 12 },
} as const
