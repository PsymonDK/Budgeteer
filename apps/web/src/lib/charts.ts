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
