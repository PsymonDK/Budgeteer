import { useState, useEffect, useRef, useCallback } from 'react'
import { sankey, sankeyLinkHorizontal, SankeyNode, SankeyLink } from 'd3-sankey'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SankeyNodeDef {
  id: string
  name: string
  color?: string
}

export interface SankeyLinkDef {
  source: string
  target: string
  value: number
}

interface SankeyExtNode extends SankeyNodeDef {
  x0?: number; x1?: number; y0?: number; y1?: number; index?: number
}

interface SankeyExtLink {
  source: SankeyExtNode
  target: SankeyExtNode
  value: number
  width?: number
  y0?: number; y1?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FALLBACK_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16',
]

// ── Component ─────────────────────────────────────────────────────────────────

export function SankeyChart({ data, currency = '' }: { data: { nodes: SankeyNodeDef[]; links: SankeyLinkDef[] }; currency?: string }) {
  function fmt(v: number | string) {
    const n = Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return currency ? `${n} ${currency}` : n
  }
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgContent, setSvgContent] = useState<{
    nodes: SankeyExtNode[]
    links: SankeyExtLink[]
    width: number
    height: number
  } | null>(null)

  const compute = useCallback(() => {
    const width = containerRef.current?.clientWidth ?? 800
    const height = 400
    const nodeIndexMap = new Map(data.nodes.map((n, i) => [n.id, i]))
    const sankeyNodes: SankeyExtNode[] = data.nodes.map((n) => ({ ...n }))
    const sankeyLinks = data.links
      .filter((l) => nodeIndexMap.has(l.source) && nodeIndexMap.has(l.target) && l.value > 0)
      .map((l) => ({
        source: nodeIndexMap.get(l.source)!,
        target: nodeIndexMap.get(l.target)!,
        value: l.value,
      }))

    if (sankeyNodes.length === 0 || sankeyLinks.length === 0) { setSvgContent(null); return }

    try {
      const layout = sankey<SankeyExtNode, { source: number; target: number; value: number }>()
        .nodeId((d) => d.index ?? 0)
        .nodeWidth(18)
        .nodePadding(12)
        .extent([[1, 1], [width - 1, height - 6]])

      const graph = layout({
        nodes: sankeyNodes.map((d, i) => ({ ...d, index: i })),
        links: sankeyLinks,
      })

      setSvgContent({
        nodes: graph.nodes as unknown as SankeyExtNode[],
        links: graph.links as unknown as SankeyExtLink[],
        width,
        height,
      })
    } catch {
      setSvgContent(null)
    }
  }, [data])

  useEffect(() => {
    compute()
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
  }, [compute])

  const colorMap = new Map(data.nodes.map((n, i) => [n.id, n.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]]))

  const { nodes, links, width, height } = svgContent ?? { nodes: [], links: [], width: 0, height: 400 }
  const linkPath = sankeyLinkHorizontal()

  return (
    <div ref={containerRef}>
      {!svgContent ? (
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2 pr-4">Flow</th>
                <th className="text-right py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map((l, i) => {
                const srcName = data.nodes.find((n) => n.id === l.source)?.name ?? l.source
                const tgtName = data.nodes.find((n) => n.id === l.target)?.name ?? l.target
                return (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-4 text-gray-300">{srcName} → {tgtName}</td>
                    <td className="py-1.5 text-right text-white">{fmt(l.value)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <svg width={width} height={height} style={{ fontFamily: 'inherit' }}>
          {links.map((link, i) => {
            const srcId = (link.source as unknown as SankeyExtNode).id
            const color = colorMap.get(srcId) ?? '#6b7280'
            const d = linkPath(link as unknown as SankeyLink<SankeyNode<SankeyExtNode, SankeyExtLink>, SankeyExtLink>)
            return (
              <path key={i} d={d ?? ''} fill="none" stroke={color} strokeOpacity={0.35}
                strokeWidth={Math.max(1, link.width ?? 1)} style={{ cursor: 'default' }}>
                <title>{`${(link.source as unknown as SankeyExtNode).name} → ${(link.target as unknown as SankeyExtNode).name}: ${fmt(link.value)}`}</title>
              </path>
            )
          })}
          {nodes.map((node, i) => {
            const x0 = node.x0 ?? 0; const x1 = node.x1 ?? 0
            const y0 = node.y0 ?? 0; const y1 = node.y1 ?? 0
            const color = colorMap.get(node.id) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
            const isLeft = x0 < width / 2
            return (
              <g key={node.id}>
                <rect x={x0} y={y0} height={Math.max(1, y1 - y0)} width={x1 - x0} fill={color} fillOpacity={0.9} rx={2}>
                  <title>{`${node.name}: ${fmt((node as unknown as { value?: number }).value ?? 0)}`}</title>
                </rect>
                <text x={isLeft ? x1 + 6 : x0 - 6} y={(y0 + y1) / 2}
                  textAnchor={isLeft ? 'start' : 'end'} dominantBaseline="middle" fontSize={11} fill="#d1d5db">
                  {node.name}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
