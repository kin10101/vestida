import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpRight, ChevronDown, MapPin, Store, TrendingUp, Trophy, Warehouse } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import { EmptyState, MetricCard, PageHeader, StatusBadge } from '../ui'

const rangeLabels = ['day', 'week', 'month'] as const

type RangeKey = (typeof rangeLabels)[number]

type SalesPoint = {
  label: string
  amount: number
}

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
  const date = new Date(value)
  const now = new Date()

  if (range === 'day') {
    return date >= startOfDay(now) && date <= now
  }

  if (range === 'week') {
    return date >= startOfWeek(now) && date <= now
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return date >= monthStart && date <= now
}

function getOrderTotal(orderId: string, lines: ReturnType<typeof useAdminData>['state']['orderLines']) {
  return lines
    .filter((line) => line.orderId === orderId)
    .reduce((sum, line) => sum + line.agreedPriceCents * line.quantity, 0)
}

function getSalesPoints(
  orders: ReturnType<typeof useAdminData>['state']['orders'],
  lines: ReturnType<typeof useAdminData>['state']['orderLines'],
  range: RangeKey,
): SalesPoint[] {
  const now = new Date()
  const points: Array<{ label: string; start: Date; end: Date }> = []

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

  return points.map(({ label, start, end }) => ({
    label,
    amount: orders
      .filter((order) => new Date(order.createdAt) >= start && new Date(order.createdAt) < end)
      .reduce((sum, order) => sum + getOrderTotal(order.id, lines), 0),
  }))
}

export default function Dashboard() {
  const { state } = useAdminData()
  const [selectedStore, setSelectedStore] = useState('all')
  const [range, setRange] = useState<RangeKey>('day')

  const storeOptions: Array<{ id: string; name: string }> = [
    { id: 'all', name: 'All stores' },
    ...state.stores.filter((store) => store.isActive).map((store) => ({ id: store.id, name: store.name })),
  ]
  const selectedStoreName = storeOptions.find((store) => store.id === selectedStore)?.name ?? 'Store'

  const filteredOrders = useMemo(
    () => state.orders.filter((order) =>
      (selectedStore === 'all' || order.storeId === selectedStore) && matchesRange(order.createdAt, range),
    ),
    [range, selectedStore, state.orders],
  )

  const totalRevenue = useMemo(
    () => filteredOrders.reduce((sum, order) => sum + getOrderTotal(order.id, state.orderLines), 0),
    [filteredOrders, state.orderLines],
  )
  const salesTrend = useMemo(
    () => getSalesPoints(filteredOrders, state.orderLines, range),
    [filteredOrders, range, state.orderLines],
  )

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
      inTransit: inventoryScope.filter((unit) => unit.status === 'in_transit').length,
    }
  }, [inventoryScope, state.productVariants])

  const slowStock = useMemo(() => state.productVariants
    .filter((variant) => variant.isActive)
    .map((variant) => ({
      variant,
      product: state.products.find((product) => product.id === variant.productId),
      inStockCount: inventoryScope.filter((unit) => unit.variantId === variant.id && unit.status === 'in_stock').length,
    }))
    .filter((item) => item.inStockCount <= 2)
    .slice(0, 4), [inventoryScope, state.productVariants, state.products])

  const topSellers = useMemo(() => {
    const orderIds = new Set(filteredOrders.map((order) => order.id))
    const sales = new Map<string, { label: string; quantity: number; revenue: number }>()
    state.orderLines.filter((line) => orderIds.has(line.orderId)).forEach((line) => {
      const current = sales.get(line.variantId ?? line.description) ?? { label: line.description, quantity: 0, revenue: 0 }
      sales.set(line.variantId ?? line.description, {
        label: current.label,
        quantity: current.quantity + line.quantity,
        revenue: current.revenue + line.quantity * line.agreedPriceCents,
      })
    })
    return [...sales.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 4)
  }, [filteredOrders, state.orderLines])
  const topSeller = topSellers[0]

  const activityFeed = useMemo(() => {
    const orderEvents = filteredOrders.map((order) => ({
      id: order.id,
      type: 'Order',
      label: `${order.customerName} ${order.status}`,
      timestamp: order.updatedAt,
      meta: `${order.reference} / ${order.storeId}`,
    }))
    const movementEvents = state.stockMovements
      .filter((movement) => selectedStore === 'all' || movement.storeId === selectedStore)
      .map((movement) => ({
        id: movement.id,
        type: movement.kind,
        label: `${movement.note} for ${movement.reference}`,
        timestamp: movement.createdAt,
        meta: movement.staffName,
      }))
    return [...orderEvents, ...movementEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8)
  }, [filteredOrders, selectedStore, state.stockMovements])

  const storeSales = useMemo(() => state.stores.filter((store) => store.isActive).map((store) => ({
    store,
    revenue: state.orders
      .filter((order) => order.storeId === store.id && matchesRange(order.createdAt, range))
      .reduce((sum, order) => sum + getOrderTotal(order.id, state.orderLines), 0),
  })), [range, state.orderLines, state.orders, state.stores])
  const maxTrend = Math.max(...salesTrend.map((point) => point.amount), 1)
  const maxStoreSales = Math.max(...storeSales.map((entry) => entry.revenue), 1)

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

      <div className="metrics-grid four-up">
        <MetricCard title="Gross sales" value={formatPeso(totalRevenue)} helper={`${filteredOrders.length} orders in view`} tone="success" />
        <MetricCard title="Orders received" value={String(filteredOrders.length)} helper="Placed in the selected period" tone="neutral" />
        <MetricCard title="Stock health" value={`${stockHealth.outOfStock} out`} helper={`${stockHealth.lowStock} low / ${stockHealth.inTransit} in transit`} tone={stockHealth.outOfStock > 0 ? 'warning' : 'success'} />
        <MetricCard title="Top seller" value={topSeller?.label ?? 'No sales'} helper={topSeller ? `${topSeller.quantity} units sold` : 'No orders in this period'} tone="info" />
      </div>

      <div className="dashboard-grid dashboard-primary">
        <section className="admin-panel sales-trend-panel">
          <div className="panel-header-row">
            <div><h3>Sales trend</h3><small>{selectedStoreName} / {range}</small></div>
            <div className="mini-icon-wrap"><TrendingUp size={16} /></div>
          </div>
          {totalRevenue > 0 ? (
            <div className="sales-chart-scroll">
              <div className="sales-chart" role="img" aria-label={`Sales trend for ${range}`} style={{ '--chart-columns': salesTrend.length } as CSSProperties}>
                {salesTrend.map((point) => <div key={point.label} className="sales-chart-column"><strong>{formatPeso(point.amount)}</strong><div className="sales-chart-bar-wrap"><div className="sales-chart-bar" style={{ height: `${Math.max((point.amount / maxTrend) * 100, point.amount > 0 ? 6 : 0)}%` }} /></div><span>{point.label}</span></div>)}
              </div>
            </div>
          ) : <EmptyState title="No sales in this period" description="Sales will appear here as orders are recorded." />}
        </section>

        <section className="admin-panel">
          <div className="panel-header-row"><h3>Stock health</h3><div className="mini-icon-wrap"><Warehouse size={16} /></div></div>
          <div className="stock-health-summary">
            <div><strong>{stockHealth.outOfStock}</strong><span>Out of stock</span></div>
            <div><strong>{stockHealth.lowStock}</strong><span>Low stock</span></div>
            <div><strong>{stockHealth.inTransit}</strong><span>In transit</span></div>
          </div>
          <div className="stack-list">
            {slowStock.length > 0 ? slowStock.map((item) => <div key={item.variant.id} className="stack-item"><div><strong>{item.product?.name ?? 'Variant'}</strong><small>{item.variant.color} {item.variant.size}</small></div><StatusBadge label={`${item.inStockCount} in stock`} tone={item.inStockCount === 0 ? 'danger' : 'warning'} /></div>) : <EmptyState title="No low stock alerts" description="Inventory looks healthy for this store selection." />}
          </div>
        </section>
      </div>

      <div className="dashboard-grid lower">
        <section className="admin-panel compact-panel">
          <div className="panel-header-row"><h3>{selectedStore === 'all' ? 'Sales by store' : `${selectedStoreName} sales`}</h3><div className="mini-icon-wrap"><Store size={16} /></div></div>
          {selectedStore === 'all' ? <div className="bar-stack">{storeSales.map(({ store, revenue }) => <div key={store.id} className="bar-row"><span>{store.name}</span><strong>{formatPeso(revenue)}</strong><div className="bar-track"><div className="bar-fill" style={{ width: `${(revenue / maxStoreSales) * 100}%` }} /></div></div>)}</div> : <div className="sales-chart mini" role="img" aria-label={`${selectedStoreName} sales trend`}>{salesTrend.map((point) => <div key={point.label} className="sales-chart-column"><div className="sales-chart-bar-wrap"><div className="sales-chart-bar" style={{ height: `${Math.max((point.amount / maxTrend) * 100, point.amount > 0 ? 6 : 0)}%` }} /></div><span>{point.label}</span></div>)}</div>}
        </section>

        <section className="admin-panel compact-panel">
          <div className="panel-header-row"><h3>Top sellers</h3><div className="mini-icon-wrap"><Trophy size={16} /></div></div>
          <div className="stack-list">{topSellers.length > 0 ? topSellers.map((item) => <div key={item.label} className="stack-item"><div><strong>{item.label}</strong><small>{item.quantity} units sold</small></div><strong>{formatPeso(item.revenue)}</strong></div>) : <EmptyState title="No top sellers yet" description="Product sales will appear here once orders are recorded." />}</div>
        </section>
      </div>

      <section className="admin-panel recent-activity-panel">
        <div className="panel-header-row"><h3>Recent activity</h3><div className="mini-icon-wrap"><ArrowUpRight size={16} /></div></div>
        <div className="timeline-list">{activityFeed.length > 0 ? activityFeed.map((item) => <div key={item.id} className="timeline-item"><div className="timeline-bullet" /><div className="timeline-copy"><strong>{item.label}</strong><small>{item.type} / {new Date(item.timestamp).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</small></div><span>{item.meta}</span></div>) : <EmptyState title="No recent activity" description="Activity will appear as orders and inventory changes are recorded." />}</div>
      </section>
    </div>
  )
}
