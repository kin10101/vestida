import { useMemo, useState } from 'react'
import { CirclePlus, PencilLine, ReceiptText, TrendingUp, WalletCards } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { OrderDraft, OrderStatus, PaymentDraft } from '../data'
import { Drawer, EmptyState, Field, MetricCard, PageHeader, StatusBadge } from '../ui'

const tabs = ['orders', 'payments', 'reports'] as const

type SalesTab = (typeof tabs)[number]

type SaleItemDraft = {
  id?: string
  variantId: string
  description: string
  quantity: number
  agreedPriceCents: number
  unitId?: string | null
}

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value / 100)

const getOrderTotal = (orderId: string, lines: ReturnType<typeof useAdminData>['state']['orderLines']) =>
  lines
    .filter((line) => line.orderId === orderId)
    .reduce((sum, line) => sum + line.agreedPriceCents * line.quantity, 0)

const getPaidTotal = (orderId: string, payments: ReturnType<typeof useAdminData>['state']['payments']) =>
  payments
    .filter((payment) => payment.orderId === orderId)
    .reduce((sum, payment) => sum + payment.amountCents, 0)

const getStoreName = (storeId: string, stores: ReturnType<typeof useAdminData>['state']['stores']) =>
  stores.find((store) => store.id === storeId)?.name ?? 'Unknown store'

const makeEmptyOrder = (): OrderDraft => ({
  storeId: '',
  customerName: '',
  orderType: 'ready_made',
  status: 'pending',
  reference: '',
  notes: '',
  items: [
    {
      variantId: '',
      description: '',
      quantity: 1,
      agreedPriceCents: 0,
      unitId: null,
    },
  ],
})

export default function Sales() {
  const { state, upsertOrder, updateOrderStatus, addPayment } = useAdminData()
  const [tab, setTab] = useState<SalesTab>('orders')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [orderFormOpen, setOrderFormOpen] = useState(false)
  const [paymentFormOpen, setPaymentFormOpen] = useState(false)
  const [orderDraft, setOrderDraft] = useState<OrderDraft>(makeEmptyOrder())
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    orderId: state.orders[0]?.id ?? '',
    amountCents: 0,
    method: 'cash',
    receivedAt: new Date().toISOString(),
    receivedBy: 'Admin',
  })

  const visibleOrders = useMemo(
    () =>
      state.orders.filter((order) => {
        const matchesStore = storeFilter === 'all' || order.storeId === storeFilter
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter
        const matchesType = typeFilter === 'all' || order.orderType === typeFilter
        const haystack = `${order.customerName} ${order.reference} ${order.notes}`.toLowerCase()
        const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())

        return matchesStore && matchesStatus && matchesType && matchesSearch
      }),
    [search, state.orders, statusFilter, storeFilter, typeFilter],
  )

  const paymentTotals = useMemo(() => {
    const totals: Record<string, number> = { cash: 0, gcash: 0, bank: 0, card: 0 }
    state.payments.forEach((payment) => {
      totals[payment.method] += payment.amountCents
    })
    return totals
  }, [state.payments])

  const storeRevenue = useMemo(
    () =>
      state.stores.map((store) => {
        const total = state.orders
          .filter((order) => order.storeId === store.id)
          .reduce((sum, order) => sum + getOrderTotal(order.id, state.orderLines), 0)
        return { name: store.name, total }
      }),
    [state.orderLines, state.orders, state.stores],
  )

  const bestSellers = useMemo(() => {
    const lineMap = new Map<string, number>()
    state.orderLines.forEach((line) => {
      const key = line.description
      lineMap.set(key, (lineMap.get(key) ?? 0) + line.quantity)
    })

    return Array.from(lineMap.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4)
  }, [state.orderLines])

  const openOrderEditor = (order?: (typeof state.orders)[number]) => {
    if (order) {
      const existingLines = state.orderLines.filter((line) => line.orderId === order.id)
      setOrderDraft({
        id: order.id,
        storeId: order.storeId,
        customerName: order.customerName,
        orderType: order.orderType,
        status: order.status,
        reference: order.reference,
        notes: order.notes,
        items: existingLines.map((line) => ({
          id: line.id,
          variantId: line.variantId ?? '',
          description: line.description,
          quantity: line.quantity,
          agreedPriceCents: line.agreedPriceCents,
          unitId: line.unitId,
        })),
      })
    } else {
      setOrderDraft(makeEmptyOrder())
    }
    setOrderFormOpen(true)
  }

  const handleAddLine = () => {
    setOrderDraft((previous) => ({
      ...previous,
      items: [
        ...previous.items,
        {
          variantId: state.productVariants[0]?.id ?? '',
          description: '',
          quantity: 1,
          agreedPriceCents: 0,
          unitId: null,
        },
      ],
    }))
  }

  const handleOrderItemChange = (index: number, field: keyof SaleItemDraft, value: string | number | null) => {
    setOrderDraft((previous) => {
      const nextItems = [...previous.items]
      const current = nextItems[index]
      if (!current) {
        return previous
      }

      if (field === 'variantId') {
        const match = state.productVariants.find((variant) => variant.id === value)
        if (match) {
          nextItems[index] = {
            ...current,
            variantId: match.id,
            description: `${match.color} ${match.size}`,
            agreedPriceCents: match.regularPriceCents,
          }
        }
        return { ...previous, items: nextItems }
      }

      nextItems[index] = {
        ...current,
        [field]: value,
      }
      return { ...previous, items: nextItems }
    })
  }

  const handleSaveOrder = () => {
    if (!orderDraft.customerName.trim() || orderDraft.items.every((item) => !item.description.trim())) {
      return
    }

    upsertOrder(orderDraft)
    setOrderFormOpen(false)
  }

  const handlePaymentSave = () => {
    if (!paymentDraft.orderId || paymentDraft.amountCents <= 0) {
      return
    }

    addPayment(paymentDraft)
    setPaymentFormOpen(false)
  }

  return (
    <div className="admin-page sales-page">
      <PageHeader
        title="Sales"
        subtitle="Orders, payments, and short performance reports."
        actions={
          <div className="segment-wrap">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                className={`segmented-tab ${tab === item ? 'active' : ''}`}
                onClick={() => setTab(item)}
              >
                {item === 'orders' ? 'Orders' : item === 'payments' ? 'Payments' : 'Reports'}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'orders' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-left">
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select">
                <option value="all">All stores</option>
                {state.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="admin-select">
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="ready">Ready</option>
                <option value="released">Released</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="admin-select">
                <option value="all">All order types</option>
                <option value="ready_made">Ready-made</option>
                <option value="made_to_order">Made to order</option>
              </select>
            </div>
            <div className="toolbar-right">
              <div className="search-box">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or ref" />
              </div>
              <button type="button" className="primary-button" onClick={() => openOrderEditor()}>
                <CirclePlus size={16} />
                Add order
              </button>
            </div>
          </div>

          <div className="record-stack compact">
            {visibleOrders.length > 0 ? (
              visibleOrders.map((order) => {
                const total = getOrderTotal(order.id, state.orderLines)
                const paid = getPaidTotal(order.id, state.payments)
                const balance = Math.max(total - paid, 0)

                return (
                  <div key={order.id} className="record-card sale-row">
                    <div className="record-main">
                      <strong>{order.customerName}</strong>
                      <small>
                        {getStoreName(order.storeId, state.stores)} · {order.reference}
                      </small>
                    </div>
                    <div className="record-side column align-end">
                      <span>{order.orderType === 'ready_made' ? 'Ready-made' : 'Made to order'}</span>
                      <StatusBadge label={order.status} tone={order.status === 'released' ? 'success' : order.status === 'pending' || order.status === 'in_progress' ? 'warning' : 'neutral'} />
                    </div>
                    <div className="record-actions compact-actions">
                      <span>{formatPeso(total)}</span>
                      <select
                        value={order.status}
                        onChange={(event) => updateOrderStatus(order.id, event.target.value as OrderStatus)}
                        className="admin-select mini"
                        aria-label={`Update order status for ${order.customerName}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In progress</option>
                        <option value="ready">Ready</option>
                        <option value="released">Released</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <button type="button" className="text-button" onClick={() => openOrderEditor(order)}>
                        <PencilLine size={14} />
                        Edit
                      </button>
                    </div>
                    <div className="balance-row">
                      <span>Balance</span>
                      <strong>{formatPeso(balance)}</strong>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No orders match" description="Try another store or status to find the order you need." />
            )}
          </div>
        </>
      ) : null}

      {tab === 'payments' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-left" />
            <div className="toolbar-right">
              <button type="button" className="primary-button" onClick={() => setPaymentFormOpen(true)}>
                <WalletCards size={16} />
                Add payment
              </button>
            </div>
          </div>

          <div className="metrics-grid four-up">
            {Object.entries(paymentTotals).map(([method, amount]) => (
              <MetricCard
                key={method}
                title={method.toUpperCase()}
                value={formatPeso(amount)}
                helper="Tender received"
                tone={method === 'cash' ? 'success' : method === 'gcash' ? 'info' : method === 'card' ? 'warning' : 'neutral'}
              />
            ))}
          </div>

          <div className="record-stack compact">
            {state.payments.length > 0 ? (
              state.payments.map((payment) => {
                const order = state.orders.find((item) => item.id === payment.orderId)
                return (
                  <div key={payment.id} className="record-card payment-row">
                    <div className="record-main">
                      <strong>{order?.customerName ?? 'Unknown order'}</strong>
                      <small>
                        {payment.method.toUpperCase()} · {new Date(payment.receivedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                      </small>
                    </div>
                    <div className="record-side column align-end">
                      <span>{payment.receivedBy}</span>
                      <StatusBadge label="Paid" tone="success" />
                    </div>
                    <div className="record-actions compact-actions">
                      <span>{formatPeso(payment.amountCents)}</span>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No payments recorded" description="Record the first payment for the current sales ledger." />
            )}
          </div>
        </>
      ) : null}

      {tab === 'reports' ? (
        <>
          <div className="metrics-grid three-up">
            <MetricCard title="Revenue by store" value={formatPeso(Math.max(...storeRevenue.map((item) => item.total), 0))} helper="Top store" tone="success" />
            <MetricCard title="Best seller" value={bestSellers[0]?.name ?? 'No items'} helper={`${bestSellers[0]?.qty ?? 0} units sold`} tone="info" />
            <MetricCard title="Order count" value={String(state.orders.length)} helper="Across all stores" tone="neutral" />
          </div>

          <div className="dashboard-grid lower">
            <section className="admin-panel compact-panel">
              <div className="panel-header-row">
                <h3>Sales by store</h3>
                <div className="mini-icon-wrap">
                  <TrendingUp size={16} />
                </div>
              </div>
              <div className="bar-stack">
                {storeRevenue.map((item) => {
                  const max = Math.max(...storeRevenue.map((entry) => entry.total), 1)
                  return (
                    <div key={item.name} className="bar-row">
                      <span>{item.name}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(item.total / max) * 100}%` }} />
                      </div>
                      <strong>{formatPeso(item.total)}</strong>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="admin-panel compact-panel">
              <div className="panel-header-row">
                <h3>Top sellers</h3>
                <div className="mini-icon-wrap">
                  <ReceiptText size={16} />
                </div>
              </div>
              <div className="stack-list">
                {bestSellers.length > 0 ? (
                  bestSellers.map((item) => (
                    <div key={item.name} className="stack-item">
                      <div>
                        <strong>{item.name}</strong>
                        <small>{item.qty} units</small>
                      </div>
                      <StatusBadge label="Leader" tone="info" />
                    </div>
                  ))
                ) : (
                  <EmptyState title="No sales history" description="Orders and payments will populate this view." />
                )}
              </div>
            </section>
          </div>
        </>
      ) : null}

      <Drawer
        open={orderFormOpen}
        size="panel"
        title={orderDraft.id ? 'Edit order' : 'Add order'}
        subtitle="Create or update a store sale all in one place."
        onClose={() => setOrderFormOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setOrderFormOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveOrder}>
              Save order
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Customer name">
            <input value={orderDraft.customerName} onChange={(event) => setOrderDraft((previous) => ({ ...previous, customerName: event.target.value }))} className="admin-input" />
          </Field>
          <Field label="Store">
            <select value={orderDraft.storeId || state.stores[0]?.id || ''} onChange={(event) => setOrderDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">
              {state.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Order type">
            <select value={orderDraft.orderType} onChange={(event) => setOrderDraft((previous) => ({ ...previous, orderType: event.target.value as 'ready_made' | 'made_to_order' }))} className="admin-select">
              <option value="ready_made">Ready-made</option>
              <option value="made_to_order">Made to order</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={orderDraft.status} onChange={(event) => setOrderDraft((previous) => ({ ...previous, status: event.target.value as OrderStatus }))} className="admin-select">
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="ready">Ready</option>
              <option value="released">Released</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Reference">
            <input value={orderDraft.reference} onChange={(event) => setOrderDraft((previous) => ({ ...previous, reference: event.target.value }))} className="admin-input" />
          </Field>
          <Field label="Notes">
            <textarea value={orderDraft.notes} onChange={(event) => setOrderDraft((previous) => ({ ...previous, notes: event.target.value }))} className="admin-textarea" rows={3} />
          </Field>

          <div className="line-item-block">
            <div className="inline-header-row">
              <strong>Line items</strong>
              <button type="button" className="text-button" onClick={handleAddLine}>
                Add line
              </button>
            </div>

            {orderDraft.items.map((item, index) => (
              <div key={`${item.description}-${index}`} className="line-item-editor">
                <select value={item.variantId ?? ''} onChange={(event) => handleOrderItemChange(index, 'variantId', event.target.value)} className="admin-select">
                  <option value="">Custom item</option>
                  {state.productVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.color} {variant.size}
                    </option>
                  ))}
                </select>
                <input
                  value={item.description}
                  onChange={(event) => handleOrderItemChange(index, 'description', event.target.value)}
                  className="admin-input"
                  placeholder="Description"
                />
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(event) => handleOrderItemChange(index, 'quantity', Number(event.target.value) || 1)}
                  className="admin-input small"
                />
                <input
                  type="number"
                  min="0"
                  value={item.agreedPriceCents / 100}
                  onChange={(event) => handleOrderItemChange(index, 'agreedPriceCents', Math.round(Number(event.target.value || 0) * 100))}
                  className="admin-input small"
                />
              </div>
            ))}
          </div>
        </div>
      </Drawer>

      <Drawer
        open={paymentFormOpen}
        size="sheet"
        title="Add payment"
        subtitle="Record a tender against an order."
        onClose={() => setPaymentFormOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setPaymentFormOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handlePaymentSave}>
              Save payment
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Order">
            <select value={paymentDraft.orderId} onChange={(event) => setPaymentDraft((previous) => ({ ...previous, orderId: event.target.value }))} className="admin-select">
              {state.orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.customerName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount">
            <input type="number" min="0" value={paymentDraft.amountCents / 100} onChange={(event) => setPaymentDraft((previous) => ({ ...previous, amountCents: Math.round(Number(event.target.value || 0) * 100) }))} className="admin-input" />
          </Field>
          <Field label="Method">
            <select value={paymentDraft.method} onChange={(event) => setPaymentDraft((previous) => ({ ...previous, method: event.target.value as PaymentDraft['method'] }))} className="admin-select">
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="bank">Bank</option>
              <option value="card">Card</option>
            </select>
          </Field>
          <Field label="Received by">
            <input value={paymentDraft.receivedBy} onChange={(event) => setPaymentDraft((previous) => ({ ...previous, receivedBy: event.target.value }))} className="admin-input" />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
