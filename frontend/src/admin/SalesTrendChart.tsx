import { useMemo } from 'react'
import type { OrderLineItem, OrderRecord, Store } from './data'
import { parseDbUtc } from '../shared/utils/dates'

export type RangeKey = 'day' | 'week' | 'month'

export interface ActivePoint {
  storeId: string
  index: number
  label: string
  amount: number
  color: string
}

interface Props {
  range: RangeKey
  selectedStore: string
  stores: Store[]
  orders: OrderRecord[]
  orderLines: OrderLineItem[]
  active: ActivePoint | null
  onSelectPoint: (point: ActivePoint | null) => void
  onExpand: () => void
  selectedComparisonIds: string[]
  onSelectedComparisonIdsChange: (ids: string[]) => void
  showTotal: boolean
  onShowTotalChange: (show: boolean) => void
}

const TOTAL_COLOR = '#8a5a44'
const COMPARISON_COLORS = ['#8c8176', '#b19b82', '#6f8178']

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value / 100)

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

interface Bucket {
  label: string
  start: Date
  end: Date
}

function getBuckets(range: RangeKey): Bucket[] {
  const now = new Date()
  const points: Bucket[] = []
  if (range === 'day') {
    for (let hour = 0; hour < 24; hour += 3) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour)
      const end = new Date(start)
      end.setHours(hour + 3)
      points.push({ label: new Intl.DateTimeFormat('en-PH', { hour: 'numeric' }).format(start), start, end })
    }
  } else if (range === 'week') {
    const weekStart = startOfWeek(now)
    for (let index = 0; index < 7; index += 1) {
      const start = new Date(weekStart)
      start.setDate(start.getDate() + index)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      points.push({ label: new Intl.DateTimeFormat('en-PH', { weekday: 'short' }).format(start), start, end })
    }
  } else {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const weeks = Math.ceil((now.getDate() - 1) / 7) + 1
    for (let index = 0; index < weeks; index += 1) {
      const start = new Date(monthStart)
      start.setDate(start.getDate() + index * 7)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      points.push({ label: `Week ${index + 1}`, start, end })
    }
  }
  return points
}

const getOrderTotal = (orderId: string, lines: OrderLineItem[]) =>
  lines.filter((line) => line.orderId === orderId).reduce((sum, line) => sum + line.agreedPriceCents * line.quantity, 0)

const PAD_L = 64
const PAD_R = 28
const PAD_T = 36
const PAD_B = 48
const W = 760
const H = 320

export default function SalesTrendChart({
  range,
  selectedStore,
  stores,
  orders,
  orderLines,
  active,
  onSelectPoint,
  onExpand,
  selectedComparisonIds,
  onSelectedComparisonIdsChange,
  showTotal,
  onShowTotalChange,
}: Props) {
  const buckets = useMemo(() => getBuckets(range), [range])

  const storeAmounts = useMemo(() => new Map(
    stores.map((store) => [store.id, buckets.map((b) => orders
      .filter((o) => {
        const createdAt = parseDbUtc(o.createdAt)
        return o.storeId === store.id && createdAt >= b.start && createdAt < b.end
      })
      .reduce((sum, o) => sum + getOrderTotal(o.id, orderLines), 0))]),
  ), [buckets, orderLines, orders, stores])

  const activeStores = useMemo(() => stores
    .map((store) => ({ store, total: (storeAmounts.get(store.id) ?? []).reduce((sum, amount) => sum + amount, 0) }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.total - a.total), [storeAmounts, stores])

  const scopedStoreIds = selectedStore === 'all' ? stores.map((store) => store.id) : [selectedStore]
  const totalAmounts = buckets.map((_, index) => scopedStoreIds.reduce((sum, storeId) => sum + (storeAmounts.get(storeId)?.[index] ?? 0), 0))
  const comparisonStores = activeStores
    .filter(({ store }) => scopedStoreIds.includes(store.id) && selectedComparisonIds.includes(store.id))
    .map(({ store }) => ({ store, color: COMPARISON_COLORS[selectedComparisonIds.indexOf(store.id) % COMPARISON_COLORS.length], amounts: storeAmounts.get(store.id) ?? [] }))
  const totalSeries = { store: { id: 'all', name: selectedStore === 'all' ? 'All stores' : stores.find((store) => store.id === selectedStore)?.name ?? 'Store', code: 'All' }, color: TOTAL_COLOR, amounts: totalAmounts }
  const series = showTotal ? [totalSeries, ...comparisonStores] : comparisonStores

  const largestAmount = Math.max(0, ...series.flatMap((s) => s.amounts))
  const yMax = Math.max(10000, Math.ceil(largestAmount / 10000) * 10000)
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const xFor = (index: number) =>
    buckets.length === 1 ? PAD_L + plotW / 2 : PAD_L + (index / (buckets.length - 1)) * plotW
  const yFor = (amount: number) => PAD_T + plotH - (amount / yMax) * plotH
  const pathFor = (amounts: number[]) => {
    if (amounts.length < 2) return ''
    const points = amounts.map((amount, index) => ({ x: xFor(index), y: yFor(amount) }))
    return points.map((point, index) => {
      if (index === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
      const previous = points[index - 1]
      const midpoint = (previous.x + point.x) / 2
      return `C ${midpoint.toFixed(1)} ${previous.y.toFixed(1)}, ${midpoint.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    }).join(' ')
  }
  const areaPathFor = (amounts: number[]) => {
    const line = pathFor(amounts)
    if (!line) return ''
    const lastX = xFor(amounts.length - 1)
    const firstX = xFor(0)
    const baseline = yFor(0)
    return `${line} L ${lastX.toFixed(1)} ${baseline.toFixed(1)} L ${firstX.toFixed(1)} ${baseline.toFixed(1)} Z`
  }

  const activeStoreName = active?.storeId === 'all' ? series[0].store.name : (series.find((s) => s.store.id === active?.storeId)?.store.name ?? '')
  const tooltipX = active ? xFor(active.index) : 0
  const tooltipY = active ? yFor(active.amount) : 0
  const tipW = 200
  const tipH = 66
  const title = activeStoreName.length > 24 ? `${activeStoreName.slice(0, 23)}…` : activeStoreName

  return (
    <div className="sales-trend-chart">
      <div className="chart-filter-row" role="group" aria-label="Sales trend stores">
        <button type="button" className={`chart-filter-chip ${showTotal ? 'active' : ''}`} onClick={() => onShowTotalChange(!showTotal)} aria-pressed={showTotal}>
          <span className="chart-filter-swatch total" /> All stores
        </button>
        {activeStores.map(({ store }) => {
          const selected = selectedComparisonIds.includes(store.id)
          return (
            <button key={store.id} type="button" className={`chart-filter-chip ${selected ? 'active' : ''}`} onClick={() => onSelectedComparisonIdsChange(selected ? selectedComparisonIds.filter((id) => id !== store.id) : [...selectedComparisonIds, store.id])}>
              <span className="chart-filter-swatch" style={{ background: COMPARISON_COLORS[selectedComparisonIds.indexOf(store.id) % COMPARISON_COLORS.length] }} /> {store.code}
            </button>
          )
        })}
      </div>
      <div className="sales-trend-graph-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="sales-trend-svg"
          role="img"
          aria-label={`Sales trend by ${range}`}
          onClick={() => {
            onSelectPoint(null)
            onExpand()
          }}
        >
        {Array.from({ length: 5 }, (_, step) => {
          const amount = (yMax * step) / 4
          const y = yFor(amount)
          return (
            <g key={step}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} className="chart-grid" />
              <text x={PAD_L - 10} y={y + 4} textAnchor="end" className="chart-axis-label">
                {amount === 0 ? '₱0' : `₱${Math.round(amount / 1000)}k`}
              </text>
            </g>
          )
        })}
        {buckets.map((b, index) => (
          <text key={b.label} x={xFor(index)} y={H - PAD_B + 22} textAnchor="middle" className="chart-axis-label">
            {b.label}
          </text>
        ))}

        {showTotal ? <path d={areaPathFor(totalSeries.amounts)} fill={TOTAL_COLOR} className="chart-area-total" /> : null}

        {series.map((s) => (
          <path
            key={s.store.id}
            d={pathFor(s.amounts)}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="chart-line"
          />
        ))}

        {series.map((s) =>
          s.amounts.map((amount, index) => (
            <circle
              key={`${s.store.id}-${index}`}
              cx={xFor(index)}
              cy={yFor(amount)}
              r={active && active.storeId === s.store.id && active.index === index ? 6 : 0}
              fill={s.color}
              className="chart-point"
              style={{ pointerEvents: 'none' }}
            />
          )),
        )}

        {series.map((s) =>
          s.amounts.map((amount, index) => (
            <circle
              key={`hit-${s.store.id}-${index}`}
              cx={xFor(index)}
              cy={yFor(amount)}
              r={16}
              fill="transparent"
              className="chart-point-hit"
              onClick={(event) => {
                event.stopPropagation()
                onSelectPoint({ storeId: s.store.id, index, label: buckets[index].label, amount, color: s.color })
                onExpand()
              }}
            />
          )),
        )}

        {active ? (
          <g
            transform={`translate(${Math.max(PAD_L, Math.min(tooltipX - tipW / 2, W - PAD_R - tipW))}, ${Math.max(PAD_T, tooltipY - tipH - 12)})`}
            className="chart-tooltip"
          >
            <rect width={tipW} height={tipH} rx={9} className="chart-tooltip-bg" />
            <text x={12} y={22} className="chart-tooltip-title">
              {title}
            </text>
            <text x={12} y={45} className="chart-tooltip-sub">
              {active.label}
            </text>
            <text x={tipW - 12} y={45} textAnchor="end" className="chart-tooltip-amount">
              {formatPeso(active.amount)}
            </text>
          </g>
        ) : null}
        </svg>
      </div>

      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.store.id} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: s.color }} />
            {s.store.name}
          </span>
        ))}
      </div>
    </div>
  )
}
