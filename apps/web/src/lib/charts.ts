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

// ── Chart & Ledger chart colours ──────────────────────────────────────────────
// CSS-variable colours (defined per theme in index.css), so charts follow the light / dark theme.
// They work as SVG fill/stroke and inline styles; don't append hex alpha to them.

/**
 * Categorical palette: brass, slate, coral, teal, plum, sage. Checked for lightness, chroma,
 * contrast against the card surface and colour-vision-deficiency separation in this order
 * (neighbours stay apart in deuteranopia simulation), so assign it in order and never cycle.
 */
export const SERIES = [1, 2, 3, 4, 5, 6].map((i) => `rgb(var(--series-${i}))`) as [string, string, string, string, string, string]

/** Colour for everything past the sixth series ("the rest"); pair it with a label. */
export const SERIES_REST = 'rgb(var(--series-rest))'

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
  grid: 'rgb(var(--sea-800))',
  axis: 'rgb(var(--sea-400))',
  text: 'rgb(var(--sea-200))',
  muted: 'rgb(var(--sea-400))',
  tooltipBg: 'rgb(var(--sea-900))',
  tooltipBorder: 'rgb(var(--sea-700))',
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
