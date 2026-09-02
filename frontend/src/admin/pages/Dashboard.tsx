import { useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, MapPin, TrendingUp, Trophy, Warehouse, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAdminData } from '../AdminDataContext'
import { EmptyState, PageHeader, StatusBadge } from '../ui'
import { parseDbUtc } from '../../shared/utils/dates'
import SalesTrendChart from '../SalesTrendChart'
import type { ActivePoint, RangeKey } from '../SalesTrendChart'

const rangeLabels: RangeKey[] = ['day', 'week', 'month']

function formatPeso(valueCents: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(valueCents / 100)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

function matchesRange(value: string, range: RangeKey) {
  const date = parseDbUtc(value)
  const now = new Date()
  if (range === 'day') return date >= startOfDay(now) && date <= now
  if (range === 'week') return date >= startOfWeek(now) && date <= now
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return date >= monthStart && date <= now
}

export default function Dashboard() {
  const { state } = useAdminData()
  const navigate = useNavigate()
  const [selectedStore, setSelectedStore] = useState('all')
  const [range, setRange] = useState<RangeKey>('day')
  const [chartExpanded, setChartExpanded] = useState(false)
  const [chartActive, setChartActive] = useState<ActivePoint | null>(null)

  const activeStores = useMemo(() => state.stores.filter((store) => store.isActive), [state.stores])

  const storeOptions: Array<{ id: string; name: string }> = [
    { id: 'all', name: 'All stores' },
    ...activeStores.map((store) => ({ id: store.id, name: store.name })),
  ]
  const selectedStoreName = storeOptions.find((store) => store.id === selectedStore)?.name ?? 'Store'

  const filteredOrders = useMemo(
    () => state.orders.filter((order) =>
      (selectedStore === 'all' || order.storeId === selectedStore) && matchesRange(order.createdAt, range),
    ),
    [range, selectedStore, state.orders],
  )

  // Gross sales with cash/gcash/bank breakdown (payment-based, like the staff app).
  const grossByMethod = useMemo(() => {
    const orderStore = new Map(state.orders.map((order) => [order.id, order.storeId]))
    const totals = { gross: 0, cash: 0, gcash: 0, bank: 0 }
    state.payments.forEach((payment) => {
      if (payment.kind !== 'payment' || !matchesRange(payment.receivedAt, range)) return
      const storeId = orderStore.get(payment.orderId)
      if (selectedStore !== 'all' && storeId !== selectedStore) return
      totals.gross += payment.amountCents
      if (payment.method === 'cash') totals.cash += payment.amountCents
      else if (payment.method === 'gcash') totals.gcash += payment.amountCents
      else totals.bank += payment.amountCents
    })
    return totals
  }, [range, selectedStore, state.orders, state.payments])

  const inventoryScope = useMemo(
    () => state.inventoryUnits.filter((unit) => selectedStore === 'all' || unit.storeId === selectedStore),
    [selectedStore, state.inventoryUnits],
  )

  const stockHealth = useMemo(() => {
    const stockByVariant = new Map<string, number>()
    inventoryScope.filter((unit) => unit.status === 'in_stock').forEach((unit) => {
      stockByVariant.set(unit.variantId, (stockByVariant.get(unit.variantId) ?? 0) + 1)
    })
    const activeVariantIds = state.productVariants.filter((variant) => variant.isActive).map((variant) => variant.id)
    return {
      outOfStock: activeVariantIds.filter((id) => (stockByVariant.get(id) ?? 0) === 0).length,
      lowStock: activeVariantIds.filter((id) => {
        const count = stockByVariant.get(id) ?? 0
        return count > 0 && count <= 2
      }).length,
    }
  }, [inventoryScope, state.productVariants])

  // The 5 lowest-stock products (out of stock first, then low).
  const lowStockProducts = useMemo(() => state.productVariants
    .filter((variant) => variant.isActive)
    .map((variant) => ({
      variant,
      product: state.products.find((product) => product.id === variant.productId),
      inStockCount: inventoryScope.filter((unit) => unit.variantId === variant.id && unit.status === 'in_stock').length,
    }))
    .sort((a, b) => a.inStockCount - b.inStockCount)
    .slice(0, 5), [inventoryScope, state.productVariants, state.products])

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

  const recentSales = useMemo(
    () => [...state.orders]
      .filter((order) => selectedStore === 'all' || order.storeId === selectedStore)
      .sort((a, b) => parseDbUtc(b.createdAt).getTime() - parseDbUtc(a.createdAt).getTime())
      .slice(0, 5),
    [selectedStore, state.orders],
  )
  const storeName = (storeId: string) => state.stores.find((store) => store.id === storeId)?.name ?? 'Unknown'

  const chart = (
    <SalesTrendChart
      range={range}
      selectedStore={selectedStore}
      stores={activeStores}
      orders={state.orders}
      orderLines={state.orderLines}
      active={chartActive}
      onSelectPoint={setChartActive}
      onExpand={() => setChartExpanded(true)}
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
                {storeOptions.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
            <div className="dashboard-range-control" aria-label="Select date range">
              {rangeLabels.map((item) => (
                <button key={item} type="button" className={range === item ? 'active' : ''} onClick={() => setRange(item)}>
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <section className="admin-panel gross-sales-card">
        <div className="gross-sales-main">
          <span className="metric-card-label">Gross sales</span>
          <strong>{formatPeso(grossByMethod.gross)}</strong>
          <small>{filteredOrders.length} orders in view</small>
        </div>
        <div className="gross-breakdown">
          <div className="gross-breakdown-item"><span>Cash</span><strong>{formatPeso(grossByMethod.cash)}</strong></div>
          <div className="gross-breakdown-item"><span>GCash</span><strong>{formatPeso(grossByMethod.gcash)}</strong></div>
          <div className="gross-breakdown-item"><span>Bank</span><strong>{formatPeso(grossByMethod.bank)}</strong></div>
        </div>
      </section>

      <section className="admin-panel sales-trend-panel">
        <div className="panel-header-row">
          <div><h3>Sales trend</h3><small>{selectedStoreName} / {range} · tap a point or the chart to expand</small></div>
          <div className="mini-icon-wrap"><TrendingUp size={16} /></div>
        </div>
        {chart}
      </section>

      <div className="dashboard-grid lower">
        <section className="admin-panel dashboard-clickable" onClick={() => navigate('/admin/inventory')}>
          <div className="panel-header-row"><h3>Stock health</h3><div className="mini-icon-wrap"><Warehouse size={16} /></div></div>
          <div className="stock-health-summary">
            <div><strong>{stockHealth.outOfStock}</strong><span>Out of stock</span></div>
            <div><strong>{stockHealth.lowStock}</strong><span>Low stock</span></div>
          </div>
          <div className="stack-list">
            {lowStockProducts.length > 0 ? lowStockProducts.map((item) => <div key={item.variant.id} className="stack-item"><div><strong>{item.product?.name ?? 'Variant'}</strong><small>{item.variant.color} {item.variant.size}</small></div><StatusBadge label={`${item.inStockCount} in stock`} tone={item.inStockCount === 0 ? 'danger' : 'warning'} /></div>) : <EmptyState title="No low stock alerts" description="Inventory looks healthy for this store selection." />}
          </div>
        </section>

        <section className="admin-panel dashboard-clickable" onClick={() => navigate('/admin/sales?tab=insights')}>
          <div className="panel-header-row"><h3>Top sellers</h3><div className="mini-icon-wrap"><Trophy size={16} /></div></div>
          <div className="stack-list">{topSellers.length > 0 ? topSellers.map((item) => <div key={item.label + item.sub} className="stack-item"><div><strong>{item.label}</strong><small>{item.sub ? `${item.sub} · ` : ''}{item.quantity} units sold</small></div><strong>{formatPeso(item.revenue)}</strong></div>) : <EmptyState title="No top sellers yet" description="Product sales will appear here once orders are recorded." />}</div>
        </section>
      </div>

      <section className="admin-panel recent-activity-panel dashboard-clickable" onClick={() => navigate('/admin/sales?tab=transactions')}>
        <div className="panel-header-row"><h3>Recent activity</h3><div className="mini-icon-wrap"><ArrowUpRight size={16} /></div></div>
        <div className="timeline-list">{recentSales.length > 0 ? recentSales.map((order) => <div key={order.id} className="timeline-item"><div className="timeline-bullet" /><div className="timeline-copy"><strong>{order.customerName || 'Walk-in'}</strong><small>{order.reference}</small></div><span>{storeName(order.storeId)} · {parseDbUtc(order.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span></div>) : <EmptyState title="No recent sales" description="Sales will appear here as orders are recorded." />}</div>
      </section>

      {chartExpanded ? (
        <div className="chart-overlay" role="dialog" aria-modal="true" aria-label="Sales trend expanded" onClick={() => setChartExpanded(false)}>
          <div className="chart-overlay-card" onClick={(event) => event.stopPropagation()}>
            <div className="chart-overlay-head">
              <h3>Sales trend · {selectedStoreName}</h3>
              <button type="button" className="icon-button chart-overlay-close" aria-label="Close chart" onClick={() => setChartExpanded(false)}><X size={20} /></button>
            </div>
            {chart}
          </div>
        </div>
      ) : null}
    </div>
  )
}
