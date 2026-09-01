import { useMemo } from 'react'
import type { OrderLineItem, OrderRecord, Store } from './data'

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
}

const STORE_COLORS = ['#8a5a44', '#3b6ea5', '#5a8f6a', '#a5683b', '#7a5a8a', '#c0533c', '#4a7a8a', '#9a7a4a']

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
    for (let hour = 9; hour <= 18; hour += 3) {
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
const PAD_T = 26
const PAD_B = 40
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
}: Props) {
  const buckets = useMemo(() => getBuckets(range), [range])

  const series = useMemo(() => {
    const targets = selectedStore === 'all' ? stores : stores.filter((store) => store.id === selectedStore)
    return targets.map((store, idx) => ({
      store,
      color: STORE_COLORS[idx % STORE_COLORS.length],
      amounts: buckets.map((b) =>
        orders
          .filter((o) => o.storeId === store.id && new Date(o.createdAt) >= b.start && new Date(o.createdAt) < b.end)
          .reduce((sum, o) => sum + getOrderTotal(o.id, orderLines), 0),
      ),
    }))
  }, [buckets, orderLines, orders, selectedStore, stores])

  const yMax = useMemo(() => Math.max(1, ...series.flatMap((s) => s.amounts)), [series])
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const xFor = (index: number) =>
    buckets.length === 1 ? PAD_L + plotW / 2 : PAD_L + (index / (buckets.length - 1)) * plotW
  const yFor = (amount: number) => PAD_T + plotH - (amount / yMax) * plotH
  const pathFor = (amounts: number[]) =>
    amounts.map((amount, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(amount).toFixed(1)}`).join(' ')

  const activeStoreName = active ? series.find((s) => s.store.id === active.storeId)?.store.name : ''
  const tooltipX = active ? xFor(active.index) : 0
  const tooltipY = active ? yFor(active.amount) : 0
  const tipW = 172
  const tipH = 60

  return (
    <div className="sales-trend-chart">
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
                {formatPeso(amount)}
              </text>
            </g>
          )
        })}
        {buckets.map((b, index) => (
          <text key={b.label} x={xFor(index)} y={H - PAD_B + 22} textAnchor="middle" className="chart-axis-label">
            {b.label}
          </text>
        ))}

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
              r={active && active.storeId === s.store.id && active.index === index ? 6 : amount > 0 ? 4 : 2.5}
              fill={s.color}
              className="chart-point"
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
              {activeStoreName}
            </text>
            <text x={12} y={42} className="chart-tooltip-sub">
              {active.label}
            </text>
            <text x={tipW - 12} y={22} textAnchor="end" className="chart-tooltip-amount">
              {formatPeso(active.amount)}
            </text>
          </g>
        ) : null}
      </svg>

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
