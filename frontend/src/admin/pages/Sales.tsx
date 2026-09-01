import { useMemo, useState } from 'react'
import { Ban, ReceiptText, TrendingUp, Undo2, WalletCards } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { PaymentMethod } from '../data'
import { Drawer, EmptyState, Field, MetricCard, PageHeader, StatusBadge } from '../ui'

const tabs = ['transactions', 'payments', 'insights'] as const
const periods = ['all', '7d', 'month'] as const

type SalesTab = (typeof tabs)[number]
type Period = (typeof periods)[number]

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value / 100)

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

const getOrderTotal = (orderId: string, lines: ReturnType<typeof useAdminData>['state']['orderLines']) =>
  lines.filter((line) => line.orderId === orderId).reduce((sum, line) => sum + line.agreedPriceCents * line.quantity, 0)

const getPaidTotal = (orderId: string, payments: ReturnType<typeof useAdminData>['state']['payments']) =>
  payments.filter((payment) => payment.orderId === orderId).reduce((sum, payment) => sum + payment.amountCents, 0)

const getStoreName = (storeId: string, stores: ReturnType<typeof useAdminData>['state']['stores']) => {
  const store = stores.find((item) => item.id === storeId)
  return store?.isDeleted ? `Deleted store (${store.name})` : store?.name ?? 'Unknown store'
}

const isWithinPeriod = (value: string, period: Period) => {
  if (period === 'all') return true
  const days = period === '7d' ? 7 : new Date().getDate() - 1
  return new Date(value).getTime() >= Date.now() - days * 86_400_000
}

export default function Sales() {
  const { state, voidSale, refundSale } = useAdminData()
  const [tab, setTab] = useState<SalesTab>('transactions')
  const [period, setPeriod] = useState<Period>('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [refundAmountCents, setRefundAmountCents] = useState(0)

  const selectedOrder = state.orders.find((order) => order.id === selectedOrderId) ?? null
  const selectedLines = useMemo(
    () => state.orderLines.filter((line) => line.orderId === selectedOrderId),
    [selectedOrderId, state.orderLines],
  )
  const selectedPayments = useMemo(
    () => state.payments.filter((payment) => payment.orderId === selectedOrderId),
    [selectedOrderId, state.payments],
  )
  const selectedExceptions = useMemo(
    () => state.salesExceptions.filter((exception) => exception.orderId === selectedOrderId),
    [selectedOrderId, state.salesExceptions],
  )

  const visibleOrders = useMemo(
    () => state.orders.filter((order) => {
      const matchesStore = storeFilter === 'all' || order.storeId === storeFilter
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter
      const haystack = `${order.customerName} ${order.reference} ${order.notes}`.toLowerCase()
      const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())
      return matchesStore && matchesStatus && matchesSearch && isWithinPeriod(order.createdAt, period)
    }),
    [period, search, state.orders, statusFilter, storeFilter],
  )

  const visiblePayments = useMemo(
    () => state.payments.filter((payment) => isWithinPeriod(payment.receivedAt, period)),
    [period, state.payments],
  )

  const paymentTotals = useMemo(() => {
    const totals: Record<PaymentMethod, number> = { cash: 0, gcash: 0, bank_transfer: 0 }
    visiblePayments.forEach((payment) => { totals[payment.method] += payment.amountCents })
    return totals
  }, [visiblePayments])

  const storeRevenue = useMemo(
    () => state.stores.map((store) => ({
      name: store.name,
      total: visibleOrders
        .filter((order) => order.storeId === store.id && order.status !== 'cancelled')
        .reduce((sum, order) => sum + getOrderTotal(order.id, state.orderLines), 0),
    })),
    [state.orderLines, state.stores, visibleOrders],
  )

  const bestSellers = useMemo(() => {
    const quantities = new Map<string, number>()
    state.orderLines
      .filter((line) => visibleOrders.some((order) => order.id === line.orderId && order.status !== 'cancelled'))
      .forEach((line) => quantities.set(line.description, (quantities.get(line.description) ?? 0) + line.quantity))
    return Array.from(quantities.entries()).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 4)
  }, [state.orderLines, visibleOrders])

  const selectedPaid = selectedOrder ? getPaidTotal(selectedOrder.id, state.payments) : 0
  const selectedTotal = selectedOrder ? getOrderTotal(selectedOrder.id, state.orderLines) : 0
  const canVoid = Boolean(selectedOrder && selectedOrder.status !== 'released' && selectedOrder.status !== 'cancelled')
  const canRefund = Boolean(selectedOrder && selectedOrder.status !== 'cancelled' && selectedPaid > 0)

  const openOrder = (id: string) => {
    setSelectedOrderId(id)
    setReason('')
  }

  const openRefund = () => {
    if (!selectedOrder) return
    setReason('')
    setRefundMethod('cash')
    setRefundAmountCents(Math.max(selectedPaid, 0))
    setRefundOpen(true)
  }

  const submitVoid = () => {
    if (!selectedOrder || !reason.trim()) return
    voidSale({ orderId: selectedOrder.id, reason, processedBy: 'Admin' })
    setVoidOpen(false)
    setReason('')
  }

  const submitRefund = () => {
    if (!selectedOrder || !reason.trim() || refundAmountCents <= 0) return
    refundSale({
      orderId: selectedOrder.id,
      reason,
      amountCents: refundAmountCents,
      method: refundMethod,
      processedBy: 'Admin',
    })
    setRefundOpen(false)
    setReason('')
  }

  return (
    <div className="admin-page sales-page">
      <PageHeader
        title="Sales"
        subtitle="Read-only store transactions with controlled void and refund actions."
        actions={<div className="segment-wrap">{tabs.map((item) => <button key={item} type="button" className={`segmented-tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item === 'transactions' ? 'Transactions' : item === 'payments' ? 'Payments' : 'Insights'}</button>)}</div>}
      />

      <div className="manager-toolbar sales-toolbar">
        <div className="toolbar-left">
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="admin-select" aria-label="Reporting period">
            <option value="all">All time</option><option value="7d">Last 7 days</option><option value="month">This month</option>
          </select>
          <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select" aria-label="Store">
            <option value="all">All stores</option>{state.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
          {tab === 'transactions' ? <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="admin-select" aria-label="Transaction status"><option value="all">All statuses</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="ready">Ready</option><option value="released">Released</option><option value="cancelled">Voided</option></select> : null}
        </div>
        {tab === 'transactions' ? <div className="toolbar-right"><div className="search-box"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or reference" aria-label="Search transactions" /></div></div> : null}
      </div>

      {tab === 'transactions' ? <div className="sales-ledger">
        <div className="sales-ledger-head"><span>Transaction</span><span>Store</span><span>Payment</span><span>Fulfillment</span><span>Total</span><span /></div>
        <div className="record-stack compact">
          {visibleOrders.length ? visibleOrders.map((order) => {
            const total = getOrderTotal(order.id, state.orderLines)
            const paid = getPaidTotal(order.id, state.payments)
            const paymentLabel = order.status === 'cancelled' ? 'Voided' : paid >= total ? 'Paid' : paid > 0 ? 'Part paid' : 'Unpaid'
            return <article key={order.id} className="record-card sale-row">
              <div className="record-main"><strong>{order.customerName}</strong><small>{order.reference} · {formatDate(order.createdAt)}</small></div>
              <span className="sale-store">{getStoreName(order.storeId, state.stores)}</span>
              <StatusBadge label={paymentLabel} tone={order.status === 'cancelled' ? 'danger' : paid >= total ? 'success' : paid > 0 ? 'warning' : 'neutral'} />
              <StatusBadge label={order.status === 'cancelled' ? 'Voided' : order.status} tone={order.status === 'released' ? 'success' : order.status === 'cancelled' ? 'danger' : order.status === 'pending' || order.status === 'in_progress' ? 'warning' : 'neutral'} />
              <strong className="sale-total">{formatPeso(total)}</strong>
              <button type="button" className="text-button" onClick={() => openOrder(order.id)}>Review</button>
            </article>
          }) : <EmptyState title="No transactions match" description="Try another period, store, or status." />}
        </div>
      </div> : null}

      {tab === 'payments' ? <>
        <div className="metrics-grid three-up">
          {Object.entries(paymentTotals).map(([method, amount]) => <MetricCard key={method} title={method === 'gcash' ? 'GCash' : method === 'bank_transfer' ? 'Bank transfer' : 'Cash'} value={formatPeso(amount)} helper="Net tender recorded" tone={method === 'cash' ? 'success' : method === 'gcash' ? 'info' : 'neutral'} />)}
        </div>
        <section className="admin-panel compact-panel"><div className="panel-header-row"><h3>Payment ledger</h3><WalletCards size={18} /></div><div className="record-stack compact">
          {visiblePayments.length ? visiblePayments.map((payment) => { const order = state.orders.find((item) => item.id === payment.orderId); const isReversal = payment.amountCents < 0; return <div key={payment.id} className="record-card payment-row"><div className="record-main"><strong>{order?.reference ?? 'Unknown transaction'}</strong><small>{order?.customerName ?? 'Unknown customer'} · {formatDate(payment.receivedAt)}</small></div><StatusBadge label={payment.kind === 'payment' ? payment.method : payment.kind === 'refund' ? 'Refund' : 'Void reversal'} tone={isReversal ? 'danger' : 'success'} /><span>{payment.receivedBy}</span><strong className={isReversal ? 'amount-negative' : ''}>{formatPeso(payment.amountCents)}</strong></div> }) : <EmptyState title="No payments recorded" description="Staff checkout activity will appear here." />}
        </div></section>
      </> : null}

      {tab === 'insights' ? <>
        <div className="metrics-grid three-up"><MetricCard title="Revenue by store" value={formatPeso(Math.max(...storeRevenue.map((item) => item.total), 0))} helper="Highest store total" tone="success" /><MetricCard title="Best seller" value={bestSellers[0]?.name ?? 'No items'} helper={`${bestSellers[0]?.quantity ?? 0} units sold`} tone="info" /><MetricCard title="Transactions" value={String(visibleOrders.length)} helper="For the selected period" tone="neutral" /></div>
        <div className="dashboard-grid lower"><section className="admin-panel compact-panel"><div className="panel-header-row"><h3>Sales by store</h3><TrendingUp size={18} /></div><div className="bar-stack">{storeRevenue.map((item) => { const max = Math.max(...storeRevenue.map((entry) => entry.total), 1); return <div key={item.name} className="bar-row"><span>{item.name}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${item.total / max * 100}%` }} /></div><strong>{formatPeso(item.total)}</strong></div> })}</div></section><section className="admin-panel compact-panel"><div className="panel-header-row"><h3>Top sellers</h3><ReceiptText size={18} /></div><div className="stack-list">{bestSellers.length ? bestSellers.map((item) => <div key={item.name} className="stack-item"><div><strong>{item.name}</strong><small>{item.quantity} units</small></div></div>) : <EmptyState title="No sales history" description="Staff transactions will populate this view." />}</div></section></div>
      </> : null}

      <Drawer open={Boolean(selectedOrder)} size="panel" title={selectedOrder ? `Transaction ${selectedOrder.reference}` : 'Transaction'} subtitle="Staff-created record. Details cannot be edited from admin." onClose={() => setSelectedOrderId(null)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setSelectedOrderId(null)}>Close</button>{canVoid ? <button type="button" className="secondary-button exception-button" onClick={() => { setReason(''); setVoidOpen(true) }}><Ban size={16} />Void sale</button> : null}{canRefund ? <button type="button" className="primary-button" onClick={openRefund}><Undo2 size={16} />Refund</button> : null}</div>}>
        {selectedOrder ? <div className="transaction-detail"><div className="transaction-summary"><div><span>Customer</span><strong>{selectedOrder.customerName}</strong></div><div><span>Store</span><strong>{getStoreName(selectedOrder.storeId, state.stores)}</strong></div><div><span>Total</span><strong>{formatPeso(selectedTotal)}</strong></div><div><span>Net paid</span><strong>{formatPeso(selectedPaid)}</strong></div></div><section className="detail-section"><h4>Items</h4>{selectedLines.map((line) => <div key={line.id} className="detail-line"><span>{line.description} × {line.quantity}</span><strong>{formatPeso(line.agreedPriceCents * line.quantity)}</strong></div>)}</section><section className="detail-section"><h4>Payment activity</h4>{selectedPayments.map((payment) => <div key={payment.id} className="detail-line"><span>{payment.kind === 'payment' ? payment.method.toUpperCase() : payment.kind === 'refund' ? 'Refund' : 'Void reversal'} · {formatDate(payment.receivedAt)}</span><strong className={payment.amountCents < 0 ? 'amount-negative' : ''}>{formatPeso(payment.amountCents)}</strong></div>)}</section><section className="detail-section"><h4>Exception history</h4>{selectedExceptions.length ? selectedExceptions.map((exception) => <div key={exception.id} className="exception-history"><StatusBadge label={exception.kind} tone="danger" /><div><strong>{exception.processedBy}</strong><small>{formatDate(exception.createdAt)} · {exception.reason}</small></div><span>{formatPeso(exception.amountCents)}</span></div>) : <p className="detail-empty">No exceptions recorded.</p>}</section></div> : null}
      </Drawer>

      <Drawer open={voidOpen} size="sheet" title="Void sale" subtitle="This cancels the transaction, reverses its tender, and restores tracked stock." onClose={() => setVoidOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setVoidOpen(false)}>Cancel</button><button type="button" className="primary-button danger-button" onClick={submitVoid} disabled={!reason.trim()}>Void sale</button></div>}><Field label="Reason" hint="This will be kept in the transaction audit history."><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="admin-textarea" rows={4} /></Field></Drawer>

      <Drawer open={refundOpen} size="sheet" title="Refund sale" subtitle="Record a monetary refund without changing stock." onClose={() => setRefundOpen(false)} footer={<div className="modal-footer-actions"><button type="button" className="secondary-button" onClick={() => setRefundOpen(false)}>Cancel</button><button type="button" className="primary-button" onClick={submitRefund} disabled={!reason.trim() || refundAmountCents <= 0}>Record refund</button></div>}><div className="form-grid"><Field label="Refund amount"><input type="number" min="0" max={Math.max(selectedPaid, 0) / 100} value={refundAmountCents / 100} onChange={(event) => setRefundAmountCents(Math.round(Math.max(Number(event.target.value) || 0, 0) * 100))} className="admin-input" /></Field><Field label="Refund method"><select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as PaymentMethod)} className="admin-select"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank transfer</option></select></Field><Field label="Reason" hint="This will be kept in the transaction audit history."><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="admin-textarea" rows={3} /></Field></div></Drawer>
    </div>
  )
}
