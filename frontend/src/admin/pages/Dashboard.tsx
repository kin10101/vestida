import { useMemo, useState } from 'react'
import { ArrowUpRight, Boxes, CreditCard, Store } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import { EmptyState, MetricCard, PageHeader, StatusBadge } from '../ui'

const rangeLabels = ['today', 'week', 'month'] as const

type RangeKey = (typeof rangeLabels)[number]

function formatPeso(valueCents: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(valueCents / 100)
}

function matchesRange(value: string, range: RangeKey) {
  const date = new Date(value)
  const now = new Date()

  if (range === 'today') {
    return date.toDateString() === now.toDateString()
  }

  if (range === 'week') {
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    return now.getTime() - date.getTime() <= sevenDays
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return date >= monthStart
}

function getOrderTotal(orderId: string, lines: ReturnType<typeof useAdminData>['state']['orderLines']) {
  return lines
    .filter((line) => line.orderId === orderId)
    .reduce((sum, line) => sum + line.agreedPriceCents * line.quantity, 0)
}

function countInStock(variantId: string, inventoryUnits: ReturnType<typeof useAdminData>['state']['inventoryUnits']) {
  return inventoryUnits.filter(
    (unit) => unit.variantId === variantId && unit.status === 'in_stock',
  ).length
}

export default function Dashboard() {
  const { state } = useAdminData()
  const [selectedStore, setSelectedStore] = useState('all')
  const [range, setRange] = useState<RangeKey>('today')

  const storeOptions: Array<{ id: string; name: string }> = [
    { id: 'all', name: 'All stores' },
    ...state.stores.filter((store) => store.isActive).map((store) => ({ id: store.id, name: store.name })),
  ]

  const filteredOrders = useMemo(
    () =>
      state.orders.filter((order) => {
        if (selectedStore !== 'all' && order.storeId !== selectedStore) {
          return false
        }

        return matchesRange(order.createdAt, range)
      }),
    [range, selectedStore, state.orders],
  )

  const totalRevenue = filteredOrders.reduce(
    (sum, order) => sum + getOrderTotal(order.id, state.orderLines),
    0,
  )
  const orderCount = filteredOrders.length
  const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0

  const paymentMix = useMemo(() => {
    const totals = {
      cash: 0,
      gcash: 0,
      bank: 0,
      card: 0,
    }

    filteredOrders.forEach((order) => {
      const orderPayments = state.payments.filter((payment) => payment.orderId === order.id)
      orderPayments.forEach((payment) => {
        totals[payment.method] += payment.amountCents
      })
    })

    return Object.entries(totals).map(([method, amount]) => ({
      method,
      amount,
      share: totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0,
    }))
  }, [filteredOrders, state.payments, totalRevenue])

  const slowStock = useMemo(() => {
    return state.productVariants
      .map((variant) => {
        const inStockCount = countInStock(variant.id, state.inventoryUnits)
        const product = state.products.find((item) => item.id === variant.productId)
        return {
          variant,
          product,
          inStockCount,
        }
      })
      .filter((item) => item.inStockCount <= 2)
      .slice(0, 4)
  }, [state.inventoryUnits, state.productVariants, state.products])

  const inTransitItems = useMemo(
    () =>
      state.inventoryUnits.filter((unit) => unit.status === 'in_transit').slice(0, 4),
    [state.inventoryUnits],
  )

  const mtoWatchlist = useMemo(
    () =>
      state.orders
        .filter((order) => order.orderType === 'made_to_order' && ['pending', 'in_progress'].includes(order.status))
        .slice(0, 4),
    [state.orders],
  )

  const activityFeed = useMemo(() => {
    const orderEvents = filteredOrders.map((order) => ({
      id: order.id,
      type: 'Order',
      label: `${order.customerName} ${order.status}`,
      timestamp: order.updatedAt,
      meta: `${order.reference} / ${order.storeId}`,
    }))

    const movementEvents = state.stockMovements.map((movement) => ({
      id: movement.id,
      type: movement.kind,
      label: `${movement.note} for ${movement.reference}`,
      timestamp: movement.createdAt,
      meta: movement.staffName,
    }))

    return [...orderEvents, ...movementEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8)
  }, [filteredOrders, state.stockMovements])

  return (
    <div className="admin-page dashboard-page">
      <PageHeader
        title="Dashboard"
        subtitle="Store health and sales momentum across the boutique network."
        actions={
          <div className="header-controls">
            <select
              value={selectedStore}
              onChange={(event) => setSelectedStore(event.target.value)}
              className="admin-select"
              aria-label="Filter by store"
            >
              {storeOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
            <div className="segmented-toggle compact" aria-label="Select date range">
              {rangeLabels.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={range === item ? 'active' : ''}
                  onClick={() => setRange(item)}
                >
                  <span>{item === 'today' ? 'Today' : item === 'week' ? 'This week' : 'This month'}</span>
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="metrics-grid four-up">
        <MetricCard
          title="Gross sales"
          value={formatPeso(totalRevenue)}
          helper={`${filteredOrders.length} orders in view`}
          tone="success"
        />
        <MetricCard
          title="Orders"
          value={String(orderCount)}
          helper="Across the selected period"
          tone="neutral"
        />
        <MetricCard
          title="Average order"
          value={formatPeso(averageOrderValue)}
          helper="Value per order"
          tone="info"
        />
        <MetricCard
          title="Payment mix"
          value={paymentMix[0] ? `${paymentMix[0].method.toUpperCase()} ${Math.round(paymentMix[0].share)}%` : '0%'}
          helper={paymentMix.map((item) => `${item.method} ${Math.round(item.share)}%`).join(' / ')}
          tone="warning"
        />
      </div>

      <div className="dashboard-grid">
        <section className="admin-panel">
          <div className="panel-header-row">
            <h3>Attention list</h3>
            <div className="mini-icon-wrap">
              <Boxes size={16} />
            </div>
          </div>

          <div className="stack-list">
            {slowStock.length > 0 ? (
              slowStock.map((item) => (
                <div key={item.variant.id} className="stack-item">
                  <div>
                    <strong>{item.product?.name ?? 'Variant'}</strong>
                    <small>
                      {item.variant.color} {item.variant.size}
                    </small>
                  </div>
                  <StatusBadge label={`${item.inStockCount} in stock`} tone={item.inStockCount === 0 ? 'danger' : 'warning'} />
                </div>
              ))
            ) : (
              <EmptyState title="No low stock alerts" description="Inventory looks healthy across the filtered stores." />
            )}

            {inTransitItems.length > 0 ? (
              <div className="stack-divider" />
            ) : null}

            {inTransitItems.length > 0 ? (
              inTransitItems.map((item) => (
                <div key={item.id} className="stack-item">
                  <div>
                    <strong>{item.unitCode}</strong>
                    <small>{item.status}</small>
                  </div>
                  <StatusBadge label="In transit" tone="info" />
                </div>
              ))
            ) : null}

            {mtoWatchlist.length > 0 ? (
              <div className="stack-divider" />
            ) : null}

            {mtoWatchlist.length > 0 ? (
              mtoWatchlist.map((order) => (
                <div key={order.id} className="stack-item">
                  <div>
                    <strong>{order.customerName}</strong>
                    <small>{order.reference}</small>
                  </div>
                  <StatusBadge label={order.status} tone="warning" />
                </div>
              ))
            ) : null}
          </div>
        </section>

        <section className="admin-panel">
          <div className="panel-header-row">
            <h3>Recent activity</h3>
            <div className="mini-icon-wrap">
              <ArrowUpRight size={16} />
            </div>
          </div>

          <div className="timeline-list">
            {activityFeed.map((item) => (
              <div key={item.id} className="timeline-item">
                <div className="timeline-bullet" />
                <div className="timeline-copy">
                  <strong>{item.label}</strong>
                  <small>
                    {item.type} · {new Date(item.timestamp).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                  </small>
                </div>
                <span>{item.meta}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="dashboard-grid lower">
        <section className="admin-panel compact-panel">
          <div className="panel-header-row">
            <h3>Sales by store</h3>
            <div className="mini-icon-wrap">
              <Store size={16} />
            </div>
          </div>

          <div className="bar-stack">
            {state.stores.map((store) => {
              const storeRevenue = state.orders
                .filter((order) => order.storeId === store.id)
                .reduce((sum, order) => sum + getOrderTotal(order.id, state.orderLines), 0)
              const max = Math.max(...state.stores.map((entry) => state.orders.filter((order) => order.storeId === entry.id).reduce((sum, order) => sum + getOrderTotal(order.id, state.orderLines), 0)), 1)
              return (
                <div key={store.id} className="bar-row">
                  <span>{store.name}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(storeRevenue / max) * 100}%` }} />
                  </div>
                  <strong>{formatPeso(storeRevenue)}</strong>
                </div>
              )
            })}
          </div>
        </section>

        <section className="admin-panel compact-panel">
          <div className="panel-header-row">
            <h3>Payment snapshot</h3>
            <div className="mini-icon-wrap">
              <CreditCard size={16} />
            </div>
          </div>

          <div className="stack-list">
            {paymentMix.length > 0 ? (
              paymentMix.map((item) => (
                <div key={item.method} className="stack-item">
                  <div>
                    <strong>{item.method.toUpperCase()}</strong>
                    <small>{Math.round(item.share)}% of revenue</small>
                  </div>
                  <strong>{formatPeso(item.amount)}</strong>
                </div>
              ))
            ) : (
              <EmptyState title="No payments" description="Payments will show here as orders are recorded." />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
