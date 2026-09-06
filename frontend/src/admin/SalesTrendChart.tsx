import { useMemo, useState } from 'react'
import type { OrderLineItem, OrderRecord, Store } from './data'
import { parseDbUtc } from '../shared/utils/dates'
import {
  bucketTitle,
  buildBuckets,
  defaultGranularity,
  granularityOptions,
  GRAN_LABEL,
  windowShortLabel,
} from './trendRange'
import type { TrendGranularity, TrendPeriod } from './trendRange'

export interface ActivePoint {
  storeId: string
  index: number
  label: string
  amount: number
  color: string
}

interface SeriesItem {
  id: string
  label: string
  color: string
  amounts: number[]
}

interface Props {
  range: TrendPeriod
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

// Y-axis money labels are in PESOS: convert cents→pesos first, then scale by k.
const formatAxisCents = (value: number) => {
  const pesos = value / 100
  if (Math.abs(pesos) >= 1000) {
    const k = pesos / 1000
    const rounded = Math.round(k * 10) / 10
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    return `₱${text}k`
  }
  return `₱${Math.round(pesos)}`
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
  const { unit, offset } = range

  // Granularity is chart-local: months group by day or week, years by month or
  // week. It falls back to the unit default whenever the unit changes.
  const [wantedGranularity, setWantedGranularity] = useState<TrendGranularity>(
    () => defaultGranularity(unit),
  )
  const granOptions = granularityOptions(unit)
  const granularity = granOptions.includes(wantedGranularity)
    ? wantedGranularity
    : defaultGranularity(unit)

  const buckets = useMemo(
    () => buildBuckets({ unit, offset }, granularity),
    [granularity, offset, unit],
  )

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

  const codeById = useMemo(() => new Map(stores.map((store) => [store.id, store.code])), [stores])
  const totalLabel = selectedStore === 'all'
    ? 'All stores'
    : (codeById.get(selectedStore) ?? 'Store')

  const scopedStoreIds = selectedStore === 'all' ? stores.map((store) => store.id) : [selectedStore]
  const totalAmounts = buckets.map((_, index) =>
    scopedStoreIds.reduce((sum, storeId) => sum + (storeAmounts.get(storeId)?.[index] ?? 0), 0))
  const comparisonStores: SeriesItem[] = activeStores
    .filter(({ store }) => scopedStoreIds.includes(store.id) && selectedComparisonIds.includes(store.id))
    .map(({ store }) => ({
      id: store.id,
      label: store.code,
      color: COMPARISON_COLORS[selectedComparisonIds.indexOf(store.id) % COMPARISON_COLORS.length],
      amounts: storeAmounts.get(store.id) ?? [],
    }))
  const totalSeries: SeriesItem = {
    id: 'all',
    label: totalLabel,
    color: TOTAL_COLOR,
    amounts: totalAmounts,
  }
  const series = showTotal ? [totalSeries, ...comparisonStores] : comparisonStores

  const largestAmount = Math.max(0, ...series.flatMap((s) => s.amounts))
  const yMax = Math.max(10000, Math.ceil(largestAmount / 10000) * 10000)
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const xFor = (index: number) =>
    buckets.length === 1 ? PAD_L + plotW / 2 : PAD_L + (index / (buckets.length - 1)) * plotW
  const yFor = (amount: number) => PAD_T + plotH - (amount / yMax) * plotH

  // Straight line segments — no bezier overshoot, so peaks/valleys sit exactly
  // on the real bucket values (a smooth curve looked nicer but read inaccurately).
  const pathFor = (amounts: number[]) => {
    if (amounts.length < 2) return ''
    return amounts
      .map((amount, index) => {
        const x = xFor(index).toFixed(1)
        const y = yFor(amount).toFixed(1)
        return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
      })
      .join(' ')
  }
  const areaPathFor = (amounts: number[]) => {
    const line = pathFor(amounts)
    if (!line) return ''
    const lastX = xFor(amounts.length - 1).toFixed(1)
    const firstX = xFor(0).toFixed(1)
    const baseline = yFor(0).toFixed(1)
    return `${line} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`
  }

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12))
  const activePoint = active && active.index < buckets.length ? active : null
  const activeSeries = activePoint ? series.find((s) => s.id === activePoint.storeId) : undefined
  const activeBucket = activePoint ? buckets[activePoint.index] : undefined
  const tooltipX = activePoint ? xFor(activePoint.index) : 0
  const tooltipY = activePoint ? yFor(activePoint.amount) : 0
  const tipW = 210
  const tipH = 66
  const title = activeSeries?.label ?? ''

  return (
    <div className="sales-trend-chart">
      <div className="chart-meta-row">
        <span className="chart-range-caption">{windowShortLabel({ unit, offset })}</span>
        {granOptions.length > 1 ? (
          <div className="chart-gran" role="group" aria-label="Group sales by">
            <span className="chart-gran-label">Group by</span>
            {granOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={granularity === option ? 'active' : ''}
                onClick={() => setWantedGranularity(option)}
              >
                {GRAN_LABEL[option]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

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
          aria-label={`Sales trend ${windowShortLabel({ unit, offset })}`}
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
                  {amount === 0 ? '₱0' : formatAxisCents(amount)}
                </text>
              </g>
            )
          })}
          {buckets.map((b, index) => {
            const show = index % labelEvery === 0 || index === buckets.length - 1
            return show ? (
              <text key={`${b.start.getTime()}-${b.label}`} x={xFor(index)} y={H - PAD_B + 22} textAnchor="middle" className="chart-axis-label">
                {b.label}
              </text>
            ) : null
          })}

          {showTotal ? <path d={areaPathFor(totalSeries.amounts)} fill={TOTAL_COLOR} className="chart-area-total" /> : null}

          {series.map((s) => (
            <path
              key={s.id}
              d={pathFor(s.amounts)}
              fill="none"
              stroke={s.color}
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="chart-line"
            />
          ))}

          {series.map((s) =>
            s.amounts.map((amount, index) => {
              const isActive = Boolean(activePoint && activePoint.storeId === s.id && activePoint.index === index)
              return (
                <circle
                  key={`${s.id}-${index}`}
                  cx={xFor(index)}
                  cy={yFor(amount)}
                  r={isActive ? 5.5 : 2.4}
                  fill={s.color}
                  className="chart-point"
                  style={{ pointerEvents: 'none' }}
                />
              )
            }),
          )}

          {series.map((s) =>
            s.amounts.map((amount, index) => (
              <circle
                key={`hit-${s.id}-${index}`}
                cx={xFor(index)}
                cy={yFor(amount)}
                r={11}
                fill="transparent"
                className="chart-point-hit"
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectPoint({ storeId: s.id, index, label: buckets[index]?.label ?? '', amount, color: s.color })
                  onExpand()
                }}
              />
            )),
          )}

          {activePoint && activeBucket && activeSeries ? (
            <g
              transform={`translate(${Math.max(PAD_L, Math.min(tooltipX - tipW / 2, W - PAD_R - tipW))}, ${Math.max(PAD_T, tooltipY - tipH - 12)})`}
              className="chart-tooltip"
            >
              <rect width={tipW} height={tipH} rx={9} className="chart-tooltip-bg" />
              <text x={12} y={22} className="chart-tooltip-title">
                {title}
              </text>
              <text x={12} y={45} className="chart-tooltip-sub">
                {bucketTitle(activeBucket, granularity)}
              </text>
              <text x={tipW - 12} y={45} textAnchor="end" className="chart-tooltip-amount">
                {formatPeso(activePoint.amount)}
              </text>
            </g>
          ) : null}
        </svg>
      </div>

      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.id} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
