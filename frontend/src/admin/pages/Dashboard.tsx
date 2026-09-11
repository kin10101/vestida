import { useMemo, useState } from 'react'
import { ArrowUpRight, Building2, ChevronDown, HeartPulse, MapPin, TrendingUp, Trophy, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAdminData } from '../AdminDataContext'
import { EmptyState, PageHeader, StatusBadge } from '../ui'
import { parseDbUtc } from '../../shared/utils/dates'
import SalesTrendChart from '../SalesTrendChart'
import type { ActivePoint } from '../SalesTrendChart'
import RangePicker from '../RangePicker'
import { inWindow, windowShortLabel } from '../trendRange'
import type { TrendPeriod } from '../trendRange'

function formatPeso(valueCents: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(valueCents / 100)
}

// "Sep 3 · 2:35 PM" — timestamped activity entries.
function formatActivityTime(value: string) {
  const date = parseDbUtc(value)
  const day = date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

// A variation is "low" once its in-stock count at a store falls to this point,
// and stays flagged until it is restocked above it. Zero is tracked separately
// as "out". The tile counts and the "reorder at N" line both read this one
// constant, so the alert and its explanation can never drift apart.
const LOW_STOCK_THRESHOLD = 2

type StockSeverity = 'out' | 'low'

/** One (variation · store) cell that needs attention. Health is counted per
 *  store location rather than per variant because "low" is a location problem —
 *  2 pieces in 6F is a restock signal even when 7F happens to hold 30. */
interface StockHealthRow {
  key: string
  productName: string
  detail: string
  storeCode: string
  storeName: string
  inStock: number
  severity: StockSeverity
}

export default function Dashboard() {
  const { state } = useAdminData()
  const navigate = useNavigate()
  const [selectedStore, setSelectedStore] = useState('all')
  const [period, setPeriod] = useState<TrendPeriod>({ unit: 'week', offset: 0 })
  const [chartExpanded, setChartExpanded] = useState(false)
  const [chartActive, setChartActive] = useState<ActivePoint | null>(null)
  const [chartComparisonIds, setChartComparisonIds] = useState<string[]>([])
  const [chartShowTotal, setChartShowTotal] = useState(true)
  const [stockTab, setStockTab] = useState<StockSeverity>('out')

  const activeStores = useMemo(() => state.stores.filter((store) => store.isActive), [state.stores])

  const storeOptions: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All stores' },
    ...activeStores.map((store) => ({ id: store.id, label: store.code })),
  ]
  const selectedStoreLabel = storeOptions.find((store) => store.id === selectedStore)?.label ?? 'Store'

  const filteredOrders = useMemo(
    () => state.orders.filter((order) =>
      (selectedStore === 'all' || order.storeId === selectedStore) && inWindow(order.createdAt, period),
    ),
    [period, selectedStore, state.orders],
  )

  // Gross sales with cash/gcash/bank breakdown (payment-based, like the staff app).
  const grossByMethod = useMemo(() => {
    const orderStore = new Map(state.orders.map((order) => [order.id, order.storeId]))
    const totals = { gross: 0, cash: 0, gcash: 0, bank: 0 }
    state.payments.forEach((payment) => {
      if (payment.kind !== 'payment' || !inWindow(payment.receivedAt, period)) return
      const storeId = orderStore.get(payment.orderId)
      if (selectedStore !== 'all' && storeId !== selectedStore) return
      totals.gross += payment.amountCents
      if (payment.method === 'cash') totals.cash += payment.amountCents
      else if (payment.method === 'gcash') totals.gcash += payment.amountCents
      else totals.bank += payment.amountCents
    })
    return totals
  }, [period, selectedStore, state.orders, state.payments])

  // Revenue + transaction count per store for the selected range, shown in the
  // "Sales by store" card (same style as Sales > Insights). Revenue is
  // payment-based so the rows add up to the Gross sales figure above; count
  // mirrors the "orders in view" number. With a single store selected, only
  // that store is listed.
  const storeSales = useMemo(() => {
    const orderStore = new Map(state.orders.map((order) => [order.id, order.storeId]))
    const totals = new Map<string, { revenue: number; count: number }>()
    state.payments.forEach((payment) => {
      if (payment.kind !== 'payment' || !inWindow(payment.receivedAt, period)) return
      const storeId = orderStore.get(payment.orderId)
      if (!storeId) return
      const entry = totals.get(storeId) ?? { revenue: 0, count: 0 }
      entry.revenue += payment.amountCents
      totals.set(storeId, entry)
    })
    state.orders.forEach((order) => {
      if (!inWindow(order.createdAt, period)) return
      const entry = totals.get(order.storeId) ?? { revenue: 0, count: 0 }
      entry.count += 1
      totals.set(order.storeId, entry)
    })
    const rows = activeStores.map((store) => ({ store, ...(totals.get(store.id) ?? { revenue: 0, count: 0 }) }))
    return (selectedStore === 'all' ? rows : rows.filter((row) => row.store.id === selectedStore))
      .sort((a, b) => b.revenue - a.revenue || b.count - a.count)
  }, [activeStores, period, selectedStore, state.orders, state.payments])

  const inventoryScope = useMemo(
    () => state.inventoryUnits.filter((unit) => selectedStore === 'all' || unit.storeId === selectedStore),
    [selectedStore, state.inventoryUnits],
  )

  // Stock health rows. A (variation · store) cell only qualifies once it has had
  // inventory there — a store that never carried a variation is not "out of
  // stock", it simply does not stock it. Ghost variations (defined in the
  // catalog but never stocked anywhere) are excluded for the same reason.
  const stockHealthRows = useMemo<StockHealthRow[]>(() => {
    const productById = new Map(state.products.map((product) => [product.id, product]))
    const variantById = new Map(state.productVariants.map((variant) => [variant.id, variant]))
    const storeById = new Map(state.stores.map((store) => [store.id, store]))

    const cells = new Map<string, { variantId: string; storeId: string; inStock: number }>()
    for (const unit of inventoryScope) {
      const key = `${unit.variantId}|${unit.storeId}`
      const cell = cells.get(key) ?? { variantId: unit.variantId, storeId: unit.storeId, inStock: 0 }
      if (unit.status === 'in_stock') {
        cell.inStock += 1
      }
      cells.set(key, cell)
    }

    const rows: StockHealthRow[] = []
    for (const cell of cells.values()) {
      const variant = variantById.get(cell.variantId)
      if (!variant || !variant.isActive) {
        continue
      }
      const severity: StockSeverity | null =
        cell.inStock === 0 ? 'out' : cell.inStock <= LOW_STOCK_THRESHOLD ? 'low' : null
      if (!severity) {
        continue
      }
      const product = productById.get(variant.productId)
      const store = storeById.get(cell.storeId)
      rows.push({
        key: `${cell.variantId}|${cell.storeId}`,
        productName: product?.name ?? 'Variant',
        detail: [variant.color, variant.size].filter(Boolean).join(' '),
        storeCode: store?.code ?? '—',
        storeName: store?.name ?? 'Unknown store',
        inStock: cell.inStock,
        severity,
      })
    }

    // Worst first, then the thinnest counts, then a stable alphabetical order.
    return rows.sort(
      (a, b) =>
        Number(b.severity === 'out') - Number(a.severity === 'out') ||
        a.inStock - b.inStock ||
        a.productName.localeCompare(b.productName) ||
        a.storeCode.localeCompare(b.storeCode),
    )
  }, [inventoryScope, state.products, state.productVariants, state.stores])

  const outOfStockRows = useMemo(() => stockHealthRows.filter((row) => row.severity === 'out'), [stockHealthRows])
  const lowStockRows = useMemo(() => stockHealthRows.filter((row) => row.severity === 'low'), [stockHealthRows])

  // The tiles ARE the tab control, so an empty tab defers to the other one —
  // except when both are empty, where there is nothing to defer to.
  const activeStockTab: StockSeverity =
    (stockTab === 'out' ? outOfStockRows.length : lowStockRows.length) > 0 ||
    outOfStockRows.length + lowStockRows.length === 0
      ? stockTab
      : stockTab === 'out'
        ? 'low'
        : 'out'
  const visibleStockRows = activeStockTab === 'out' ? outOfStockRows : lowStockRows

  const topSellers = useMemo(() => {
    const orderIds = new Set(filteredOrders.map((order) => order.id))
    const variantById = new Map(state.productVariants.map((variant) => [variant.id, variant]))
    const productById = new Map(state.products.map((product) => [product.id, product]))
    const sales = new Map<string, { label: string; sub: string; quantity: number; revenue: number }>()
    state.orderLines.filter((line) => orderIds.has(line.orderId)).forEach((line) => {
      const variant = line.variantId ? variantById.get(line.variantId) : undefined
      const product = variant ? productById.get(variant.productId) : undefined
      const label = product?.name ?? (variant ? 'Variant' : (line.description.trim() || 'Made-to-Order'))
      const sub = variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : ''
      const key = line.variantId ?? line.description
      const current = sales.get(key)
      sales.set(key, {
        label,
        sub,
        quantity: (current?.quantity ?? 0) + line.quantity,
        revenue: (current?.revenue ?? 0) + line.quantity * line.agreedPriceCents,
      })
    })
    return [...sales.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 5)
  }, [filteredOrders, state.orderLines, state.productVariants, state.products])

  // Combined activity feed: sales (orders) plus stock operations (intakes,
  // transfers, adjustments) rebuilt from the per-unit stock_movement ledger.
  // Each row = badge (type) | main info | result + time. The result column is
  // the outcome of the activity — a ₱ total for sales, a +/- pcs for stock ops.
  const activityEvents = useMemo(() => {
    type ActivityKind = 'sale' | 'stock' | 'transfer' | 'adjust'
    interface ActivityItem {
      key: string
      pill: string
      kind: ActivityKind
      time: string
      title: string
      lead: string
      refText?: string
      result: string
      resultTone: 'money' | 'count'
      storeIds: string[]
    }

    const productById = new Map(state.products.map((p) => [p.id, p]))
    const variantById = new Map(state.productVariants.map((v) => [v.id, v]))
    const unitById = new Map(state.inventoryUnits.map((u) => [u.id, u]))
    const storeById = new Map(state.stores.map((s) => [s.id, s]))
    const storeLabel = (id: string | null | undefined) => (id && storeById.get(id)?.name) || 'Unknown'
    const pushStore = (list: string[], id: string | null | undefined) => {
      if (id) list.push(id)
    }
    const pcs = (n: number) => `${n} pc${n === 1 ? '' : 's'}`
    const unitName = (unitId: string) => {
      const unit = unitById.get(unitId)
      const variant = unit ? variantById.get(unit.variantId) : undefined
      const product = variant ? productById.get(variant.productId) : undefined
      return {
        name: product?.name ?? 'Variant',
        detail: variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : '',
      }
    }

    // Sales: one event per order.
    const lineByOrder = new Map<string, { qty: number; amount: number }>()
    state.orderLines.forEach((line) => {
      const s = lineByOrder.get(line.orderId) ?? { qty: 0, amount: 0 }
      s.qty += line.quantity
      s.amount += line.quantity * line.agreedPriceCents
      lineByOrder.set(line.orderId, s)
    })
    const events: ActivityItem[] = state.orders.map((order) => {
      const s = lineByOrder.get(order.id)
      const qty = s?.qty ?? 0
      return {
        key: `sale-${order.id}`,
        pill: 'Sale',
        kind: 'sale',
        time: order.createdAt,
        title: order.customerName || 'Walk-in',
        lead: `${qty} item${qty === 1 ? '' : 's'}`,
        refText: order.reference || undefined,
        result: s ? formatPeso(s.amount) : '',
        resultTone: 'money',
        storeIds: [order.storeId],
      }
    })

    // Stock operations: collapse per-unit ledger rows into one event. Units
    // written by a single DB call (intake / transfer / adjustment) share the
    // same created_at, so grouping by kind + created_at rebuilds the operation.
    const ops = new Map<string, {
      kind: string
      time: string
      from: string | null
      to: string | null
      store: string | null
      count: number
      names: { name: string; detail: string }[]
      storeIds: string[]
    }>()
    state.stockMovements.forEach((m) => {
      if (m.kind === 'sold') return // sales already represented by orders
      const key = `${m.kind}|${m.fromStoreId ?? ''}|${m.toStoreId ?? ''}|${m.createdAt}`
      let op = ops.get(key)
      if (!op) {
        const storeIds: string[] = []
        pushStore(storeIds, m.storeId)
        pushStore(storeIds, m.fromStoreId)
        pushStore(storeIds, m.toStoreId)
        op = {
          kind: m.kind,
          time: m.createdAt,
          from: m.fromStoreId,
          to: m.toStoreId,
          store: m.storeId,
          count: 0,
          names: [],
          storeIds,
        }
        ops.set(key, op)
      }
      op.count += 1
      const n = unitName(m.unitId)
      if (!op.names.some((x) => x.name === n.name && x.detail === n.detail)) op.names.push(n)
    })

    ops.forEach((op) => {
      const title = op.names.map((x) => x.name).join(', ') || 'Stock'
      const variantText = [...new Set(op.names.map((x) => x.detail).filter(Boolean))].join(', ')
      const meta = (extra: string) => [variantText, extra].filter(Boolean).join(' · ')
      if (op.kind === 'received') {
        events.push({
          key: `op-${op.time}-received`,
          pill: 'Add stock',
          kind: 'stock',
          time: op.time,
          title,
          lead: meta(storeLabel(op.store)),
          result: `+${pcs(op.count)}`,
          resultTone: 'count',
          storeIds: op.storeIds,
        })
      } else if (op.kind === 'transferred_out') {
        events.push({
          key: `op-${op.time}-out`,
          pill: 'Transfer',
          kind: 'transfer',
          time: op.time,
          title,
          lead: meta(`${storeLabel(op.from)} → ${storeLabel(op.to)}`),
          result: pcs(op.count),
          resultTone: 'count',
          storeIds: op.storeIds,
        })
      } else if (op.kind === 'transferred_in') {
        events.push({
          key: `op-${op.time}-in`,
          pill: 'Transfer received',
          kind: 'transfer',
          time: op.time,
          title,
          lead: meta(`from ${storeLabel(op.from)}`),
          result: `+${pcs(op.count)}`,
          resultTone: 'count',
          storeIds: op.storeIds,
        })
      } else if (op.kind === 'adjustment') {
        events.push({
          key: `op-${op.time}-adjust`,
          pill: 'Adjustment',
          kind: 'adjust',
          time: op.time,
          title,
          lead: meta(storeLabel(op.store)),
          result: pcs(op.count),
          resultTone: 'count',
          storeIds: op.storeIds,
        })
      }
    })

    return events
      .filter((ev) => selectedStore === 'all' || ev.storeIds.includes(selectedStore))
      .sort((a, b) => parseDbUtc(b.time).getTime() - parseDbUtc(a.time).getTime())
      .slice(0, 6)
  }, [
    selectedStore,
    state.orders,
    state.orderLines,
    state.productVariants,
    state.products,
    state.inventoryUnits,
    state.stockMovements,
    state.stores,
  ])

  const chart = (
    <SalesTrendChart
      range={period}
      selectedStore={selectedStore}
      stores={activeStores}
      orders={state.orders}
      orderLines={state.orderLines}
      active={chartActive}
      onSelectPoint={setChartActive}
      onExpand={() => setChartExpanded(true)}
      selectedComparisonIds={chartComparisonIds}
      onSelectedComparisonIdsChange={setChartComparisonIds}
      showTotal={chartShowTotal}
      onShowTotalChange={setChartShowTotal}
    />
  )

  return (
    <div className="admin-page dashboard-page">
      <PageHeader
        title="Dashboard"
        subtitle="Store health and sales momentum across the boutique network."
        actions={
          <div className="header-controls dashboard-controls">
            <div className="dashboard-store-filter">
              <MapPin size={16} aria-hidden="true" />
              <select id="dashboard-store-filter" value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)} aria-label="Filter by store">
                {storeOptions.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
            <RangePicker value={period} onChange={setPeriod} variant="page" />
          </div>
        }
      />

      <section className="admin-panel gross-sales-card">
        <div className="gross-sales-main">
          <span className="metric-card-label">Gross sales</span>
          <strong>{formatPeso(grossByMethod.gross)}</strong>
          <small>{windowShortLabel(period)} · {filteredOrders.length} orders in view</small>
        </div>
        <div className="gross-breakdown">
          <div className="gross-breakdown-item"><span>Cash</span><strong>{formatPeso(grossByMethod.cash)}</strong></div>
          <div className="gross-breakdown-item"><span>GCash</span><strong>{formatPeso(grossByMethod.gcash)}</strong></div>
          <div className="gross-breakdown-item"><span>Bank</span><strong>{formatPeso(grossByMethod.bank)}</strong></div>
        </div>
      </section>

      <section className="admin-panel sales-trend-panel">
        <div className="panel-header-row">
          <div><h3>Sales trend</h3><small>{selectedStoreLabel} · {windowShortLabel(period)} · tap a point or the chart to expand</small></div>
          <div className="mini-icon-wrap"><TrendingUp size={16} /></div>
        </div>
        {chart}
      </section>

      <div className="dashboard-grid lower">
        <section className="admin-panel dashboard-clickable" onClick={() => navigate('/admin/sales?tab=insights')}>
          <div className="panel-header-row"><h3>Sales by store</h3><div className="mini-icon-wrap"><Building2 size={16} /></div></div>
          <div className="store-perf-list">
            {storeSales.length > 0 ? storeSales.map((item) => (
              <div key={item.store.id} className="store-perf-row">
                <span className="store-perf-name">{item.store.code} - {item.store.name}</span>
                <div className="store-perf-track">
                  <div className="store-perf-fill" style={{ width: `${storeSales[0].revenue > 0 ? (item.revenue / storeSales[0].revenue) * 100 : 0}%` }} />
                </div>
                <span className="store-perf-rev">{formatPeso(item.revenue)}</span>
                <span className="store-perf-count">{item.count} tx</span>
              </div>
            )) : <EmptyState title="No store sales" description="No active stores to compare." />}
          </div>
        </section>

        <section className="admin-panel dashboard-clickable" onClick={() => navigate('/admin/sales?tab=insights')}>
          <div className="panel-header-row"><h3>Top sellers</h3><div className="mini-icon-wrap"><Trophy size={16} /></div></div>
          <div className="stack-list">{topSellers.length > 0 ? topSellers.map((item) => <div key={item.label + item.sub} className="stack-item"><div><strong>{item.label}</strong><small>{item.sub ? `${item.sub} · ` : ''}{item.quantity} units sold</small></div><strong>{formatPeso(item.revenue)}</strong></div>) : <EmptyState title="No top sellers yet" description="Product sales will appear here once orders are recorded." />}</div>
        </section>
      </div>

      <div className="dashboard-grid lower">
        <section className="admin-panel dashboard-clickable" onClick={() => navigate('/admin/inventory')}>
          <div className="panel-header-row">
            <h3>Stock health</h3>
            <div className="mini-icon-wrap"><HeartPulse size={16} /></div>
          </div>
          <div className="stock-health-summary" role="tablist" aria-label="Stock health severity">
            <button
              type="button"
              role="tab"
              aria-selected={activeStockTab === 'out'}
              className={`stock-health-tile is-out ${activeStockTab === 'out' ? 'active' : ''}`}
              onClick={(event) => { event.stopPropagation(); setStockTab('out') }}
            >
              <strong>{outOfStockRows.length}</strong>
              <span>Out of stock</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeStockTab === 'low'}
              className={`stock-health-tile is-low ${activeStockTab === 'low' ? 'active' : ''}`}
              onClick={(event) => { event.stopPropagation(); setStockTab('low') }}
            >
              <strong>{lowStockRows.length}</strong>
              <span>Low stock</span>
            </button>
          </div>
          <div className="stack-list stock-health-list" role="tabpanel">
            {visibleStockRows.length > 0 ? visibleStockRows.map((row) => (
              <div key={row.key} className="stack-item stock-health-row">
                <div>
                  <strong>{row.productName}</strong>
                  <small className="stock-health-meta">
                    {row.detail ? `${row.detail} · ` : ''}{row.storeCode} – {row.storeName}
                  </small>
                </div>
                {row.severity === 'out'
                  ? <StatusBadge label="0 in stock" tone="danger" />
                  : <span className="stock-health-reorder">{row.inStock} in stock · reorder at {LOW_STOCK_THRESHOLD}</span>}
              </div>
            )) : (
              <EmptyState
                title={activeStockTab === 'out' ? 'Nothing out of stock' : 'No low stock alerts'}
                description={activeStockTab === 'out'
                  ? 'Every tracked variation in this scope has at least one piece on hand.'
                  : 'Nothing is sitting at or below the reorder point.'}
              />
            )}
          </div>
        </section>

        <section className="admin-panel recent-activity-panel dashboard-clickable" onClick={() => navigate('/admin/sales?tab=transactions')}>
          <div className="panel-header-row recent-activity-head">
            <h3>Recent activity</h3>
            <span className="panel-view-all">View all <ArrowUpRight size={14} aria-hidden="true" /></span>
          </div>
          <div className="timeline-list">
            {activityEvents.length > 0 ? activityEvents.map((ev) => (
              <div key={ev.key} className="timeline-item">
                <span className={`activity-badge badge-${ev.kind}`}>{ev.pill}</span>
                <div className="activity-main">
                  <strong className="activity-title">{ev.title}</strong>
                  <div className="activity-sub">
                    <span>{ev.lead}</span>
                    {ev.refText ? <span className="activity-ref">{ev.refText}</span> : null}
                  </div>
                </div>
                <div className="activity-side">
                  <span className={`activity-result is-${ev.resultTone}`}>{ev.result}</span>
                  <span className="activity-time">{formatActivityTime(ev.time)}</span>
                </div>
              </div>
            )) : <EmptyState title="No recent activity" description="Sales, transfers, and stock adds will appear here." />}
          </div>
        </section>
      </div>

      {chartExpanded ? (
        <div className="chart-overlay" role="dialog" aria-modal="true" aria-label="Sales trend expanded" onClick={() => setChartExpanded(false)}>
          <div className="chart-overlay-card" onClick={(event) => event.stopPropagation()}>
            <div className="chart-overlay-head">
              <h3>Sales trend · {selectedStoreLabel}</h3>
              <button type="button" className="icon-button chart-overlay-close" aria-label="Close chart" onClick={() => setChartExpanded(false)}><X size={20} /></button>
            </div>
            {chart}
          </div>
        </div>
      ) : null}
    </div>
  )
}
