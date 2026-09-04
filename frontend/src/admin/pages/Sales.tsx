import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Building2, RefreshCw, TrendingUp, Undo2, WalletCards } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAdminData } from '../AdminDataContext'
import { parseDbUtc } from '../../shared/utils/dates'
import type { OrderStatus, PaymentKind, PaymentMethod } from '../data'
import type { StatusTone } from '../ui'
import { Drawer, EmptyState, Field, MetricCard, PageHeader, StatusBadge } from '../ui'
import SalesTrendChart from '../SalesTrendChart'
import type { ActivePoint, RangeKey } from '../SalesTrendChart'
import ExportMenu from '../ExportMenu'
import type { ExportRow } from '../ExportMenu'

const tabs = ['payments', 'transactions', 'insights'] as const
type SalesTab = (typeof tabs)[number]
const TAB_LABEL: Record<SalesTab, string> = {
  transactions: 'Transactions',
  payments: 'Payments',
  insights: 'Insights',
}

const TAB_BLURB: Record<SalesTab, string> = {
  transactions: 'What was sold — every order with its payment and fulfillment state.',
  payments: 'Where the money went — tenders, refunds, and what is still owed.',
  insights: 'How sales are performing — trends, mix, and top movers.',
}

const dateFilters = ['all', 'today', '7d', 'month'] as const
type DateFilter = (typeof dateFilters)[number]
const DATE_LABEL: Record<DateFilter, string> = {
  all: 'All time',
  today: 'Today',
  '7d': 'Last 7 days',
  month: 'This month',
}

const rangeLabels: RangeKey[] = ['day', 'week', 'month']

type PayFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'voided'
type FulfillFilter = 'all' | OrderStatus
type PayKindFilter = 'all' | PaymentKind

const FULFILL_OPTIONS: Array<{ value: FulfillFilter; label: string }> = [
  { value: 'all', label: 'All fulfillment' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'ready', label: 'Ready' },
  { value: 'released', label: 'Released' },
  { value: 'cancelled', label: 'Voided' },
]

const METHOD_ORDER: PaymentMethod[] = ['cash', 'gcash', 'bank_transfer']
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  bank_transfer: 'Bank transfer',
}

// ---- formatting -----------------------------------------------------------

const formatPeso = (cents: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(cents / 100)

const formatCount = (value: number) => new Intl.NumberFormat('en-PH').format(value)

const formatDate = (value: string) => {
  const d = parseDbUtc(value)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatDateTime = (value: string) => {
  const d = parseDbUtc(value)
  const date = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

// ---- status helpers -------------------------------------------------------

function payMeta(cancelled: boolean, retained: number, total: number): { label: string; key: PayFilter; tone: StatusTone } {
  if (cancelled) return { label: 'Voided', key: 'voided', tone: 'danger' }
  if (retained >= total && total > 0) return { label: 'Paid', key: 'paid', tone: 'neutral' }
  if (retained > 0) return { label: 'Part paid', key: 'partial', tone: 'warning' }
  return { label: 'Unpaid', key: 'unpaid', tone: 'danger' }
}

function fulfillMeta(status: OrderStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'released': return { label: 'Released', tone: 'neutral' }
    case 'ready': return { label: 'Ready', tone: 'neutral' }
    case 'in_progress': return { label: 'In progress', tone: 'warning' }
    case 'pending': return { label: 'Pending', tone: 'warning' }
    default: return { label: 'Voided', tone: 'danger' }
  }
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  ready_made: 'Ready-made',
  made_to_order: 'Made-to-order',
}

// ---- date scoping ---------------------------------------------------------

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function withinDateFilter(value: string, filter: DateFilter) {
  if (filter === 'all') return true
  const date = parseDbUtc(value)
  const now = new Date()
  if (filter === 'today') return sameLocalDay(date, now)
  if (filter === '7d') return date.getTime() >= now.getTime() - 7 * 86_400_000
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
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

function withinRange(value: string, range: RangeKey) {
  const date = parseDbUtc(value)
  const now = new Date()
  if (range === 'day') return date >= startOfDay(now) && date <= now
  if (range === 'week') return date >= startOfWeek(now) && date <= now
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return date >= monthStart && date <= now
}

// ---- money per order ------------------------------------------------------

interface OrderMoney {
  total: number
  itemCount: number
  collected: number
  reversed: number
  retained: number
  refunded: number
  outstanding: number
}

function computeMoney(
  total: number,
  itemCount: number,
  payments: Array<{ kind: PaymentKind; amountCents: number }>,
): OrderMoney {
  let collected = 0
  let reversed = 0
  let refunded = 0
  payments.forEach((payment) => {
    if (payment.kind === 'payment') collected += payment.amountCents
    else if (payment.kind === 'refund') { reversed += -payment.amountCents; refunded += -payment.amountCents }
    else reversed += -payment.amountCents // void_reversal
  })
  const retained = collected - reversed
  return {
    total,
    itemCount,
    collected,
    reversed,
    retained,
    refunded,
    outstanding: Math.max(total - retained, 0),
  }
}

// ---- module scope shared across tabs --------------------------------------

export default function Sales() {
  const { state, voidSale, refundSale } = useAdminData()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<SalesTab>((searchParams.get('tab') as SalesTab | null) ?? 'payments')

  // Shared filters
  const [storeFilter, setStoreFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')

  // Transactions filters
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [fulfillFilter, setFulfillFilter] = useState<FulfillFilter>('all')
  const [search, setSearch] = useState('')
  const [txPage, setTxPage] = useState(1)
  const txPageSize = 20
  const [transferPage, setTransferPage] = useState(1)
  const transferPageSize = 20

  // Payments filters
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all')
  const [kindFilter, setKindFilter] = useState<PayKindFilter>('all')
  const [payPage, setPayPage] = useState(1)
  const payPageSize = 20

  // Insights filters
  const [insightRange, setInsightRange] = useState<RangeKey>('day')

  // Drawer / modals
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [refundAmountCents, setRefundAmountCents] = useState(0)
  const [chartActive, setChartActive] = useState<ActivePoint | null>(null)

  const storeById = useMemo(() => new Map(state.stores.map((store) => [store.id, store])), [state.stores])
  const orderById = useMemo(() => new Map(state.orders.map((order) => [order.id, order])), [state.orders])
  const variantById = useMemo(() => new Map(state.productVariants.map((v) => [v.id, v])), [state.productVariants])
  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products])
  const activeStores = useMemo(() => state.stores.filter((store) => store.isActive && !store.isDeleted), [state.stores])
  const txItemByOrder = useMemo(() => {
    const labels = new Map<string, string>()
    state.orderLines.forEach((line) => {
      if (labels.has(line.orderId)) return
      const variant = line.variantId ? variantById.get(line.variantId) : undefined
      const product = variant ? productById.get(variant.productId) : undefined
      const detail = variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : ''
      labels.set(line.orderId, product ? `${product.name}${detail ? ` · ${detail}` : ''}` : (line.description || 'Made-to-Order'))
    })
    return labels
  }, [productById, state.orderLines, variantById])

  const storeName = useCallback((storeId: string | null | undefined) => {
    if (!storeId) return 'Unknown store'
    const store = storeById.get(storeId)
    if (!store) return 'Unknown store'
    return store.isDeleted ? `${store.name} (deleted)` : store.name
  }, [storeById])

  // Enrich every order with its money + pill state (not date-scoped).
  const summaries = useMemo(() => {
    const paymentsByOrder = new Map<string, Array<{ kind: PaymentKind; amountCents: number }>>()
    state.payments.forEach((payment) => {
      const list = paymentsByOrder.get(payment.orderId) ?? []
      list.push({ kind: payment.kind, amountCents: payment.amountCents })
      paymentsByOrder.set(payment.orderId, list)
    })
    const linesByOrder = new Map<string, { total: number; itemCount: number }>()
    state.orderLines.forEach((line) => {
      const current = linesByOrder.get(line.orderId) ?? { total: 0, itemCount: 0 }
      current.total += line.agreedPriceCents * line.quantity
      current.itemCount += line.quantity
      linesByOrder.set(line.orderId, current)
    })
    return new Map(state.orders.map((order) => {
      const money = computeMoney(
        linesByOrder.get(order.id)?.total ?? 0,
        linesByOrder.get(order.id)?.itemCount ?? 0,
        paymentsByOrder.get(order.id) ?? [],
      )
      const cancelled = order.status === 'cancelled'
      return [order.id, {
        order,
        storeName: storeName(order.storeId),
        money,
        pay: payMeta(cancelled, money.retained, money.total),
        fulfill: fulfillMeta(order.status),
      }]
    }))
  }, [state.orders, state.orderLines, state.payments, storeName])

  // ---------- Transactions tab ----------
  const txBase = useMemo(
    () => Array.from(summaries.values()).filter((s) => {
      if (storeFilter !== 'all' && s.order.storeId !== storeFilter) return false
      return withinDateFilter(s.order.createdAt, dateFilter)
    }),
    [summaries, storeFilter, dateFilter],
  )

  const txRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return txBase.filter((s) => {
      if (payFilter !== 'all' && s.pay.key !== payFilter) return false
      if (fulfillFilter !== 'all' && s.order.status !== fulfillFilter) return false
      if (q) {
        const haystack = `${s.order.customerName} ${s.order.reference} ${s.order.notes} ${s.storeName}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [txBase, payFilter, fulfillFilter, search])

  useEffect(() => {
    setTxPage(1)
  }, [dateFilter, storeFilter, payFilter, fulfillFilter, search])

  const txPageCount = Math.max(1, Math.ceil(txRows.length / txPageSize))
  useEffect(() => {
    setTxPage((page) => Math.min(page, txPageCount))
  }, [txPageCount])

  const visibleTxRows = useMemo(
    () => txRows.slice((txPage - 1) * txPageSize, txPage * txPageSize),
    [txRows, txPage, txPageSize],
  )

  const transferRows = useMemo(() => {
    const unitById = new Map(state.inventoryUnits.map((unit) => [unit.id, unit]))
    const variantById = new Map(state.productVariants.map((variant) => [variant.id, variant]))
    const productById = new Map(state.products.map((product) => [product.id, product]))
    const storeById = new Map(state.stores.map((store) => [store.id, store]))

    return state.stockMovements
      .filter((movement) => {
        if (movement.kind !== 'transferred_in' && movement.kind !== 'transferred_out') return false
        if (storeFilter !== 'all' && movement.fromStoreId !== storeFilter && movement.toStoreId !== storeFilter) return false
        return withinDateFilter(movement.createdAt, dateFilter)
      })
      .sort((a, b) => parseDbUtc(b.createdAt).getTime() - parseDbUtc(a.createdAt).getTime())
      .map((movement) => {
        const variant = variantById.get(unitById.get(movement.unitId)?.variantId ?? '')
        const product = variant ? productById.get(variant.productId) : undefined
        return {
          movement,
          item: product?.name ?? 'Variant',
          detail: variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : '',
          from: storeById.get(movement.fromStoreId ?? '')?.code ?? '—',
          to: storeById.get(movement.toStoreId ?? '')?.code ?? '—',
          status: movement.kind === 'transferred_in' ? 'Received' : 'Sent',
        }
      })
  }, [dateFilter, state.inventoryUnits, state.productVariants, state.products, state.stockMovements, state.stores, storeFilter])

  useEffect(() => {
    setTransferPage(1)
  }, [dateFilter, storeFilter])

  const transferPageCount = Math.max(1, Math.ceil(transferRows.length / transferPageSize))
  useEffect(() => {
    setTransferPage((page) => Math.min(page, transferPageCount))
  }, [transferPageCount])

  const visibleTransferRows = useMemo(
    () => transferRows.slice((transferPage - 1) * transferPageSize, transferPage * transferPageSize),
    [transferPage, transferPageSize, transferRows],
  )

  const txKpis = useMemo(() => {
    const active = txBase.filter((s) => s.order.status !== 'cancelled')
    let gross = 0
    let refunded = 0
    let items = 0
    let outstanding = 0
    let mto = 0
    let rdy = 0
    let voids = 0
    active.forEach((s) => {
      gross += s.money.total
      refunded += s.money.refunded
      items += s.money.itemCount
      outstanding += s.money.outstanding
      if (s.order.orderType === 'made_to_order') mto += 1
      else rdy += 1
    })
    txBase.forEach((s) => { if (s.order.status === 'cancelled') voids += 1 })
    return {
      gross,
      net: gross - refunded,
      refunded,
      transactions: active.length,
      items,
      outstanding,
      mto,
      rdy,
      voids,
    }
  }, [txBase])

  // ---------- Payments tab ----------
  const payRows = useMemo(() => state.payments
    .filter((payment) => {
      const order = orderById.get(payment.orderId)
      if (!order) return false
      if (storeFilter !== 'all' && order.storeId !== storeFilter) return false
      if (!withinDateFilter(payment.receivedAt, dateFilter)) return false
      if (methodFilter !== 'all' && payment.method !== methodFilter) return false
      if (kindFilter !== 'all' && payment.kind !== kindFilter) return false
      return true
    })
    .sort((a, b) => parseDbUtc(b.receivedAt).getTime() - parseDbUtc(a.receivedAt).getTime()),
    [state.payments, orderById, storeFilter, dateFilter, methodFilter, kindFilter])

  useEffect(() => {
    setPayPage(1)
  }, [dateFilter, storeFilter, methodFilter, kindFilter])

  const payPageCount = Math.max(1, Math.ceil(payRows.length / payPageSize))
  useEffect(() => {
    setPayPage((page) => Math.min(page, payPageCount))
  }, [payPageCount])

  const visiblePayRows = useMemo(
    () => payRows.slice((payPage - 1) * payPageSize, payPage * payPageSize),
    [payRows, payPage, payPageSize],
  )

  const payKpis = useMemo(() => {
    let collected = 0
    let refunded = 0
    const byMethod: Record<PaymentMethod, number> = { cash: 0, gcash: 0, bank_transfer: 0 }
    payRows.forEach((payment) => {
      collected += payment.amountCents // signed: refunds & reversals are negative
      byMethod[payment.method] += payment.amountCents
      if (payment.kind === 'refund') refunded += -payment.amountCents
    })
    // Outstanding is a point-in-time balance: open orders across the store(s),
    // not bucketed by when a payment landed.
    let outstanding = 0
    summaries.forEach((s) => {
      if (s.order.status === 'cancelled') return
      if (storeFilter !== 'all' && s.order.storeId !== storeFilter) return
      outstanding += s.money.outstanding
    })
    return { collected, refunded, outstanding, byMethod }
  }, [payRows, summaries, storeFilter])

  // ---------- Insights tab ----------
  const scopeOrders = useMemo(() => Array.from(summaries.values())
    .filter((s) => {
      if (s.order.status === 'cancelled') return false
      if (storeFilter !== 'all' && s.order.storeId !== storeFilter) return false
      return withinRange(s.order.createdAt, insightRange)
    }),
    [summaries, storeFilter, insightRange])

  const insightKpis = useMemo(() => {
    let gross = 0
    let refunded = 0
    let items = 0
    scopeOrders.forEach((s) => {
      gross += s.money.total
      refunded += s.money.refunded
      items += s.money.itemCount
    })
    const net = gross - refunded
    return {
      net,
      gross,
      refunded,
      transactions: scopeOrders.length,
      items,
      avg: scopeOrders.length ? Math.round(net / scopeOrders.length) : 0,
    }
  }, [scopeOrders])

  const storePerformance = useMemo(() => {
    if (storeFilter !== 'all') return null
    const scopeIds = new Set(scopeOrders.map((s) => s.order.id))
    return activeStores.map((store) => {
      let revenue = 0
      let count = 0
      scopeOrders.forEach((s) => {
        if (s.order.storeId !== store.id) return
        revenue += s.money.total
        count += 1
      })
      return { store, revenue, count, present: scopeIds.size > 0 }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [scopeOrders, activeStores, storeFilter])

  const topProducts = useMemo(() => {
    const scopeIds = new Set(scopeOrders.map((s) => s.order.id))
    const buckets = new Map<string, { name: string; detail: string; units: number; revenue: number }>()
    state.orderLines
      .filter((line) => scopeIds.has(line.orderId))
      .forEach((line) => {
        const variant = line.variantId ? variantById.get(line.variantId) : undefined
        const product = variant ? productById.get(variant.productId) : undefined
        const name = product?.name ?? (line.description.trim() || 'Made-to-Order')
        const detail = variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : ''
        const key = line.variantId ?? line.description
        const current = buckets.get(key)
        buckets.set(key, {
          name,
          detail,
          units: (current?.units ?? 0) + line.quantity,
          revenue: (current?.revenue ?? 0) + line.quantity * line.agreedPriceCents,
        })
      })
    return Array.from(buckets.values())
      .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
      .slice(0, 6)
  }, [scopeOrders, state.orderLines, variantById, productById])

  const paymentMix = useMemo(() => {
    const scopeOrderIds = new Set(scopeOrders.map((s) => s.order.id))
    const totals: Record<PaymentMethod, number> = { cash: 0, gcash: 0, bank_transfer: 0 }
    state.payments.forEach((payment) => {
      if (!scopeOrderIds.has(payment.orderId)) return
      if (payment.kind !== 'payment') return
      totals[payment.method] += payment.amountCents
    })
    const sum = METHOD_ORDER.reduce((acc, method) => acc + totals[method], 0)
    return METHOD_ORDER.map((method) => ({
      method,
      amount: totals[method],
      pct: sum > 0 ? (totals[method] / sum) * 100 : 0,
    }))
  }, [scopeOrders, state.payments])

  const adjustments = useMemo(() => {
    const scopeOrderIds = new Set(scopeOrders.map((s) => s.order.id))
    return state.salesExceptions
      .filter((exception) => scopeOrderIds.has(exception.orderId))
      .map((exception) => {
        const order = orderById.get(exception.orderId)
        const cancelled = order?.status === 'cancelled'
        return {
          exception,
          label: exception.kind === 'void' ? (cancelled ? 'Void' : 'Void') : 'Refund',
          amount: exception.kind === 'void' ? 0 : exception.amountCents,
          reference: order?.reference ?? '—',
          store: order ? storeName(order.storeId) : '—',
          customer: order?.customerName ?? '—',
        }
      })
      .sort((a, b) => parseDbUtc(b.exception.createdAt).getTime() - parseDbUtc(a.exception.createdAt).getTime())
      .slice(0, 6)
  }, [scopeOrders, state.salesExceptions, orderById, storeName])

  // ---------- Selected order / drawer ----------
  const selectedSummary = selectedOrderId ? summaries.get(selectedOrderId) ?? null : null
  const selectedOrder = selectedSummary?.order ?? null
  const selectedMoney = selectedSummary?.money
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

  const canVoid = Boolean(selectedOrder && selectedOrder.status !== 'released' && selectedOrder.status !== 'cancelled')
  const canRefund = Boolean(selectedOrder && selectedOrder.status !== 'cancelled' && (selectedMoney?.retained ?? 0) > 0)

  const openOrder = (id: string) => {
    setSelectedOrderId(id)
    setReason('')
  }

  const onRowKeyDown = (event: React.KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openOrder(id)
    }
  }

  const openRefund = () => {
    if (!selectedOrder) return
    setReason('')
    setRefundMethod('cash')
    setRefundAmountCents(Math.max(selectedMoney?.retained ?? 0, 0))
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

  // =========================================================================
  // Export datasets (respect current store / status / search filters)
  // =========================================================================
  const exportTxRows = useMemo<ExportRow[]>(() => txRows.map((s) => ({
    date: s.order.createdAt,
    values: [
      s.order.reference || '',
      s.order.customerName || 'Walk-in',
      txItemByOrder.get(s.order.id) || '',
      s.money.itemCount,
      formatDate(s.order.createdAt),
      s.storeName,
      s.fulfill.label,
      s.order.status,
      s.money.total / 100,
    ],
  })), [txRows, txItemByOrder])

  const exportTransferRows = useMemo<ExportRow[]>(() => transferRows.map((t) => ({
    date: t.movement.createdAt,
    values: [
      formatDate(t.movement.createdAt),
      t.item,
      t.detail,
      t.from,
      t.to,
      t.movement.staffName || '',
      t.status,
    ],
  })), [transferRows])

  const exportPayRows = useMemo<ExportRow[]>(() => payRows.map((payment) => {
    const order = orderById.get(payment.orderId)
    const statusLabel = payment.kind === 'payment'
      ? 'Payment'
      : payment.kind === 'refund'
        ? 'Refund'
        : 'Void reversal'
    return {
      date: payment.receivedAt,
      values: [
        formatDate(payment.receivedAt),
        order?.reference ?? '',
        order?.customerName || '',
        order ? storeName(order.storeId) : '',
        METHOD_LABEL[payment.method],
        payment.amountCents / 100,
        statusLabel,
      ],
    }
  }), [payRows, orderById, storeName])

  const TX_EXPORT_COLUMNS = ['Reference', 'Customer', 'Item', 'Items', 'Date', 'Store', 'Fulfillment', 'Status', 'Total (PHP)']
  const TRANSFER_EXPORT_COLUMNS = ['Date', 'Item', 'Detail', 'From', 'To', 'Staff', 'Status']
  const PAY_EXPORT_COLUMNS = ['Date', 'Transaction', 'Customer', 'Store', 'Method', 'Amount (PHP)', 'Status']

  // =========================================================================
  // Render
  // =========================================================================
  const storeOptions = (
    <>
      <option value="all">All stores</option>
      {state.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
    </>
  )

  return (
    <div className="admin-page sales-page">
      <PageHeader
        title="Sales"
        subtitle={TAB_BLURB[tab]}
        actions={(
          <div className="segment-wrap">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                className={`segmented-tab ${tab === item ? 'active' : ''}`}
                onClick={() => { setTab(item); setSearchParams({ tab: item }) }}
              >
                {TAB_LABEL[item]}
              </button>
            ))}
          </div>
        )}
      />

      <div className={`manager-toolbar sales-toolbar ${tab}-toolbar`}>
        {tab === 'insights' ? (
          <>
            <div className="toolbar-left">
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select" aria-label="Store">
                {storeOptions}
              </select>
            </div>
            <div className="toolbar-right">
              <div className="segmented-toggle compact sales-range" aria-label="Trend period">
                {rangeLabels.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={insightRange === item ? 'active' : ''}
                    onClick={() => setInsightRange(item)}
                  >
                    {item[0].toUpperCase() + item.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="toolbar-left">
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)} className="admin-select" aria-label="Date">
                {dateFilters.map((item) => <option key={item} value={item}>{DATE_LABEL[item]}</option>)}
              </select>
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select" aria-label="Store">
                {storeOptions}
              </select>
              {tab === 'transactions' ? (
                <select value={payFilter} onChange={(event) => setPayFilter(event.target.value as PayFilter)} className="admin-select" aria-label="Payment status">
                  <option value="all">All payment</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Part paid</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="voided">Voided</option>
                </select>
              ) : null}
              {tab === 'transactions' ? (
                <select value={fulfillFilter} onChange={(event) => setFulfillFilter(event.target.value as FulfillFilter)} className="admin-select" aria-label="Fulfillment status">
                  {FULFILL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : null}
              {tab === 'payments' ? (
                <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value as 'all' | PaymentMethod)} className="admin-select" aria-label="Method">
                  <option value="all">All methods</option>
                  {METHOD_ORDER.map((method) => <option key={method} value={method}>{METHOD_LABEL[method]}</option>)}
                </select>
              ) : null}
              {tab === 'payments' ? (
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as PayKindFilter)} className="admin-select" aria-label="Payment kind">
                  <option value="all">All activity</option>
                  <option value="payment">Payments</option>
                  <option value="refund">Refunds</option>
                  <option value="void_reversal">Void reversals</option>
                </select>
              ) : null}
            </div>
            {tab === 'transactions' ? (
              <div className="toolbar-right">
                <div className="search-box">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, reference, store" aria-label="Search transactions" />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ===================== TRANSACTIONS ===================== */}
      {tab === 'transactions' ? (
        <div className="sales-tab-content">
          <section className="admin-panel compact-panel ledger-panel tx-history-panel">
            <div className="panel-header-row">
              <h3>Transactions</h3>
              <div className="panel-head-actions">
                <span className="ledger-count">{formatCount(txRows.length)} results</span>
                <ExportMenu label="transactions" columns={TX_EXPORT_COLUMNS} rows={exportTxRows} showLabel />
              </div>
            </div>
            <div className="tx-table" role="table" aria-label="Transactions">
              <div className="tx-head" role="row">
                <span role="columnheader">Transaction</span>
                <span role="columnheader">Customer</span>
                <span role="columnheader">Item</span>
                <span role="columnheader">Date / time</span>
                <span role="columnheader">Store</span>
                <span role="columnheader">Fulfillment</span>
                <span role="columnheader" className="num">Total</span>
              </div>
              <div className="tx-body">
                {visibleTxRows.length ? visibleTxRows.map((s) => (
                  <div
                    key={s.order.id}
                    role="row"
                    tabIndex={0}
                    className={`tx-row clickable ${s.order.status === 'cancelled' ? 'is-void' : ''}`}
                    onClick={() => openOrder(s.order.id)}
                    onKeyDown={(event) => onRowKeyDown(event, s.order.id)}
                    aria-label={`Open transaction ${s.order.reference}`}
                  >
                    <span className="tx-ref" role="cell">{s.order.reference || '—'}</span>
                    <span className="tx-customer" role="cell">{s.order.customerName || 'Walk-in'}</span>
                    <span className="tx-item" role="cell"><strong>{txItemByOrder.get(s.order.id) || 'No item details'}</strong><small>{formatCount(s.money.itemCount)} item{s.money.itemCount === 1 ? '' : 's'}</small></span>
                    <span className="tx-time" role="cell">{formatDateTime(s.order.createdAt)}</span>
                    <span className="tx-store" role="cell">{s.storeName}</span>
                    <span role="cell"><StatusBadge label={s.fulfill.label} tone={s.fulfill.tone} /></span>
                    <span className="num tx-total" role="cell">{formatPeso(s.money.total)}</span>
                  </div>
                )) : <EmptyState title="No transactions match" description="Try another date, store, or status." />}
              </div>
            </div>
            {txRows.length > 0 ? (
              <div className="ledger-pagination">
                <span>Showing {(txPage - 1) * txPageSize + 1}-{Math.min(txPage * txPageSize, txRows.length)} of {formatCount(txRows.length)} transactions</span>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" disabled={txPage === 1} onClick={() => setTxPage((page) => Math.max(1, page - 1))}>‹ Previous</button>
                  <div className="pagination-pages" aria-label="Transaction pages">
                    {Array.from({ length: Math.min(txPageCount, 5) }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" className={`pagination-page ${txPage === page ? 'active' : ''}`} aria-current={txPage === page ? 'page' : undefined} onClick={() => setTxPage(page)}>
                        {page}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" disabled={txPage === txPageCount} onClick={() => setTxPage((page) => Math.min(txPageCount, page + 1))}>Next ›</button>
                </div>
                <label className="pagination-size">20 per page</label>
              </div>
            ) : null}
          </section>

          <section className="admin-panel compact-panel ledger-panel transfer-history-panel">
            <div className="panel-header-row">
              <h3>Transfer history</h3>
              <div className="panel-head-actions">
                <span className="ledger-count">{formatCount(transferRows.length)} entries</span>
                <ExportMenu label="transfer-history" columns={TRANSFER_EXPORT_COLUMNS} rows={exportTransferRows} showLabel />
              </div>
            </div>
            <div className="transfer-table" role="table" aria-label="Transfer history">
              <div className="transfer-head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Item</span>
                <span role="columnheader">From</span>
                <span role="columnheader">To</span>
                <span role="columnheader">Staff</span>
                <span role="columnheader">Status</span>
              </div>
              <div className="transfer-body">
                {visibleTransferRows.length ? visibleTransferRows.map(({ movement, item, detail, from, to, status }) => (
                  <div className={`transfer-row ${movement.kind === 'transferred_in' ? 'is-inbound' : 'is-outbound'}`} role="row" key={movement.id}>
                    <span role="cell">{formatDateTime(movement.createdAt)}</span>
                    <span role="cell"><strong>{item}</strong><small>{detail || 'Variant'}</small></span>
                    <span role="cell">{from}</span>
                    <span role="cell">{to}</span>
                    <span role="cell">{movement.staffName || '—'}</span>
                    <span role="cell"><StatusBadge label={status} tone={movement.kind === 'transferred_in' ? 'success' : 'info'} /></span>
                  </div>
                )) : <EmptyState title="No transfers recorded" description="Transfers between stores will appear here." />}
              </div>
            </div>
            {transferRows.length > 0 ? (
              <div className="ledger-pagination">
                <span>Showing {(transferPage - 1) * transferPageSize + 1}-{Math.min(transferPage * transferPageSize, transferRows.length)} of {formatCount(transferRows.length)} entries</span>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" disabled={transferPage === 1} onClick={() => setTransferPage((page) => Math.max(1, page - 1))}>‹ Previous</button>
                  <div className="pagination-pages" aria-label="Transfer history pages">
                    {Array.from({ length: Math.min(transferPageCount, 5) }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" className={`pagination-page ${transferPage === page ? 'active' : ''}`} aria-current={transferPage === page ? 'page' : undefined} onClick={() => setTransferPage(page)}>
                        {page}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" disabled={transferPage === transferPageCount} onClick={() => setTransferPage((page) => Math.min(transferPageCount, page + 1))}>Next ›</button>
                </div>
                <span className="pagination-size">{transferPageSize} per page</span>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {/* ===================== PAYMENTS ===================== */}
      {tab === 'payments' ? (
        <div className="sales-tab-content">
          <div className="payment-summary-row">
            <MetricCard title="Total collected" value={formatPeso(payKpis.collected)} helper="net money in hand after refunds & voids" tone="success" />
            <section className="admin-panel compact-panel method-panel">
              <div className="panel-header-row"><h3>Payment methods</h3><WalletCards size={18} /></div>
              <div className="method-breakdown">
                {METHOD_ORDER.map((method) => {
                  const total = payKpis.collected
                  const amount = payKpis.byMethod[method]
                  const pct = total > 0 ? Math.max((amount / total) * 100, 0) : 0
                  return (
                    <div key={method} className="method-row">
                      <div className="method-meta">
                        <span className="method-name">{METHOD_LABEL[method]}</span>
                        <span className="method-amount">{formatPeso(amount)}</span>
                      </div>
                      <div className="method-track"><div className={`method-fill method-${method}`} style={{ width: `${pct}%` }} /></div>
                      <span className="method-pct">{pct.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <section className="admin-panel compact-panel ledger-panel">
            <div className="panel-header-row">
              <h3>Financial ledger</h3>
              <div className="panel-head-actions">
                <span className="ledger-count">{formatCount(payRows.length)} entries</span>
                <ExportMenu label="payments" columns={PAY_EXPORT_COLUMNS} rows={exportPayRows} showLabel />
              </div>
            </div>
            <div className="pay-table" role="table" aria-label="Payments ledger">
              <div className="pay-head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Transaction</span>
                <span role="columnheader">Customer</span>
                <span role="columnheader">Store</span>
                <span role="columnheader">Method</span>
                <span role="columnheader" className="num">Amount</span>
                <span role="columnheader">Status</span>
              </div>
              <div className="pay-body">
                {visiblePayRows.length ? visiblePayRows.map((payment) => {
                  const order = orderById.get(payment.orderId)
                  const negative = payment.amountCents < 0
                  const statusLabel = payment.kind === 'payment'
                    ? 'Payment'
                    : payment.kind === 'refund'
                      ? 'Refund'
                      : 'Void reversal'
                  const statusTone: StatusTone = payment.kind === 'payment'
                    ? 'neutral'
                    : payment.kind === 'refund'
                      ? 'warning'
                      : 'danger'
                  return (
                    <div
                      key={payment.id}
                      className="pay-row clickable"
                      role="row"
                      tabIndex={0}
                      onClick={() => order && openOrder(order.id)}
                      onKeyDown={(event) => order && onRowKeyDown(event, order.id)}
                      aria-label={order ? `Open payment for transaction ${order.reference}` : 'Payment details unavailable'}
                    >
                      <span className="pay-date" role="cell">{formatDate(payment.receivedAt)}</span>
                      <span className="pay-ref" role="cell">{order?.reference ?? '—'}</span>
                      <span className="pay-customer" role="cell">{order?.customerName || '—'}</span>
                      <span className="pay-store" role="cell">{order ? storeName(order.storeId) : '—'}</span>
                      <span className="pay-method" role="cell">{METHOD_LABEL[payment.method]}</span>
                      <span className={`num ${negative ? 'amount-negative' : ''}`} role="cell">{formatPeso(payment.amountCents)}</span>
                      <span role="cell"><StatusBadge label={statusLabel} tone={statusTone} /></span>
                    </div>
                  )
                }) : <EmptyState title="No payments recorded" description="Try another date, store, method, or activity." />}
              </div>
            </div>
            {payRows.length > 0 ? (
              <div className="ledger-pagination">
                <span>Showing {(payPage - 1) * payPageSize + 1}-{Math.min(payPage * payPageSize, payRows.length)} of {formatCount(payRows.length)} entries</span>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" disabled={payPage === 1} onClick={() => setPayPage((page) => Math.max(1, page - 1))}>‹ Previous</button>
                  <div className="pagination-pages" aria-label="Financial ledger pages">
                    {Array.from({ length: Math.min(payPageCount, 5) }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" className={`pagination-page ${payPage === page ? 'active' : ''}`} aria-current={payPage === page ? 'page' : undefined} onClick={() => setPayPage(page)}>
                        {page}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" disabled={payPage === payPageCount} onClick={() => setPayPage((page) => Math.min(payPageCount, page + 1))}>Next ›</button>
                </div>
                <span className="pagination-size">{payPageSize} per page</span>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {/* ===================== INSIGHTS ===================== */}
      {tab === 'insights' ? (
        <div className="sales-tab-content">
          <div className="metrics-grid kpi-two">
            <MetricCard title="Net sales" value={formatPeso(insightKpis.net)} helper={`Gross ${formatPeso(insightKpis.gross)} · ${formatPeso(insightKpis.refunded)} refunded`} tone="neutral" />
            <MetricCard title="Outstanding balance" value={formatPeso(txKpis.outstanding)} helper="open unpaid or partial orders" tone={txKpis.outstanding > 0 ? 'warning' : 'neutral'} />
          </div>

          <section className="admin-panel compact-panel sales-trend-panel">
            <div className="panel-header-row">
              <h3>Sales trend</h3>
              <div className="mini-icon-wrap"><TrendingUp size={16} /></div>
            </div>
            <SalesTrendChart
              range={insightRange}
              selectedStore={storeFilter}
              stores={activeStores}
              orders={state.orders}
              orderLines={state.orderLines}
              active={chartActive}
              onSelectPoint={setChartActive}
              onExpand={() => undefined}
            />
          </section>

          <div className="insight-grid two-up">
            {storePerformance ? (
              <section className="admin-panel compact-panel">
                <div className="panel-header-row"><h3>Sales by store</h3><Building2 size={18} /></div>
                <div className="store-perf-list">
                  {storePerformance.length ? storePerformance.map((item) => (
                    <div key={item.store.id} className="store-perf-row">
                      <span className="store-perf-name">{item.store.name}</span>
                      <div className="store-perf-track">
                        <div className="store-perf-fill" style={{ width: `${storePerformance[0] && storePerformance[0].revenue > 0 ? (item.revenue / storePerformance[0].revenue) * 100 : 0}%` }} />
                      </div>
                      <span className="store-perf-rev">{formatPeso(item.revenue)}</span>
                      <span className="store-perf-count">{item.count} tx</span>
                    </div>
                  )) : <EmptyState title="No store sales" description="No active stores to compare." />}
                </div>
              </section>
            ) : null}

            <section className="admin-panel compact-panel">
              <div className="panel-header-row"><h3>Top products</h3><RefreshCw size={18} /></div>
              <div className="stack-list">
                {topProducts.length ? topProducts.map((item) => (
                  <div key={`${item.name}-${item.detail}`} className="stack-item">
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.detail ? `${item.detail} · ` : ''}{item.units} units sold</small>
                    </div>
                    <strong>{formatPeso(item.revenue)}</strong>
                  </div>
                )) : <EmptyState title="No product sales" description="Product lines will appear once orders are recorded." />}
              </div>
            </section>
          </div>

          <div className="insight-grid two-up">
            <section className="admin-panel compact-panel">
              <div className="panel-header-row"><h3>Payment mix</h3><WalletCards size={18} /></div>
              <div className="method-breakdown">
                {paymentMix.map(({ method, amount, pct }) => (
                  <div key={method} className="method-row">
                    <div className="method-meta">
                      <span className="method-name">{METHOD_LABEL[method]}</span>
                      <span className="method-amount">{formatPeso(amount)}</span>
                    </div>
                    <div className="method-track"><div className={`method-fill method-${method}`} style={{ width: `${pct}%` }} /></div>
                    <span className="method-pct">{pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-panel compact-panel">
              <div className="panel-header-row"><h3>Refunds & voids</h3><Undo2 size={18} /></div>
              <div className="adjust-list">
                {adjustments.length ? adjustments.map((adj) => (
                  <div key={adj.exception.id} className="adjust-row">
                    <StatusBadge label={adj.label} tone={adj.exception.kind === 'void' ? 'danger' : 'warning'} />
                    <div className="adjust-main">
                      <strong>{adj.reference}</strong>
                      <small>{adj.customer} · {adj.store}</small>
                    </div>
                    <span className={adj.exception.kind === 'void' ? 'amount-negative' : ''}>{adj.amount ? formatPeso(adj.amount) : '—'}</span>
                  </div>
                )) : <EmptyState title="No refunds or voids" description="Adjustment activity will appear here." />}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {/* ---------- Transaction detail drawer ---------- */}
      <Drawer
        open={Boolean(selectedOrder)}
        size="panel"
        title={selectedOrder ? `Transaction ${selectedOrder.reference}` : 'Transaction'}
        subtitle="Staff-created record. Details cannot be edited from admin."
        onClose={() => setSelectedOrderId(null)}
        footer={(
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setSelectedOrderId(null)}>Close</button>
            {canVoid ? (
              <button type="button" className="secondary-button exception-button" onClick={() => { setReason(''); setVoidOpen(true) }}><Ban size={16} />Void sale</button>
            ) : null}
            {canRefund ? (
              <button type="button" className="primary-button" onClick={openRefund}><Undo2 size={16} />Refund</button>
            ) : null}
          </div>
        )}
      >
        {selectedOrder && selectedSummary && selectedMoney ? (
          <div className="transaction-detail">
            <div className="transaction-status-row">
              <StatusBadge label={selectedSummary.pay.label} tone={selectedSummary.pay.tone} />
              <StatusBadge label={selectedSummary.fulfill.label} tone={selectedSummary.fulfill.tone} />
              <span className="transaction-type">{ORDER_TYPE_LABEL[selectedOrder.orderType] ?? selectedOrder.orderType}</span>
            </div>

            <div className="transaction-summary">
              <div><span>Customer</span><strong>{selectedOrder.customerName || 'Walk-in'}</strong></div>
              <div><span>Store</span><strong>{selectedSummary.storeName}</strong></div>
              <div><span>Total</span><strong>{formatPeso(selectedMoney.total)}</strong></div>
              <div><span>Paid</span><strong>{formatPeso(selectedMoney.retained)}</strong></div>
              <div><span>Balance due</span><strong className={selectedMoney.outstanding > 0 ? 'amount-negative' : ''}>{formatPeso(selectedMoney.outstanding)}</strong></div>
              <div><span>Items</span><strong>{formatCount(selectedMoney.itemCount)}</strong></div>
            </div>

            <section className="detail-section"><h4>Items</h4>
              {selectedLines.length ? selectedLines.map((line) => (
                (() => {
                  const variant = line.variantId ? variantById.get(line.variantId) : undefined
                  const product = variant ? productById.get(variant.productId) : undefined
                  const detail = variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : ''
                  const label = product
                    ? `${product.name}${detail ? ` · ${detail}` : ''}`
                    : line.description || 'Made-to-Order'
                  return (
                    <div key={line.id} className="detail-line">
                      <span>{label} × {line.quantity}</span>
                      <strong>{formatPeso(line.agreedPriceCents * line.quantity)}</strong>
                    </div>
                  )
                })()
              )) : <p className="detail-empty">No line items recorded.</p>}
            </section>

            <section className="detail-section"><h4>Payment activity</h4>
              {selectedPayments.length ? selectedPayments.map((payment) => (
                <div key={payment.id} className="detail-line">
                  <span>{payment.kind === 'payment' ? `${METHOD_LABEL[payment.method]} payment` : payment.kind === 'refund' ? 'Refund' : 'Void reversal'} · {formatDateTime(payment.receivedAt)}</span>
                  <strong className={payment.amountCents < 0 ? 'amount-negative' : ''}>{formatPeso(payment.amountCents)}</strong>
                </div>
              )) : <p className="detail-empty">No payments recorded.</p>}
            </section>

            <section className="detail-section"><h4>Exception history</h4>
              {selectedExceptions.length ? selectedExceptions.map((exception) => (
                <div key={exception.id} className="exception-history">
                  <StatusBadge label={exception.kind === 'void' ? 'Void' : 'Refund'} tone="danger" />
                  <div><strong>{exception.processedBy}</strong><small>{formatDate(exception.createdAt)} · {exception.reason}</small></div>
                  <span className={exception.amountCents > 0 ? '' : ''}>{exception.amountCents ? formatPeso(exception.amountCents) : '—'}</span>
                </div>
              )) : <p className="detail-empty">No exceptions recorded.</p>}
            </section>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={voidOpen}
        size="sheet"
        title="Void sale"
        subtitle="This cancels the transaction, reverses its tender, and restores tracked stock."
        onClose={() => setVoidOpen(false)}
        footer={(
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setVoidOpen(false)}>Cancel</button>
            <button type="button" className="primary-button danger-button" onClick={submitVoid} disabled={!reason.trim()}>Void sale</button>
          </div>
        )}
      >
        <Field label="Reason" hint="This will be kept in the transaction audit history.">
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="admin-textarea" rows={4} />
        </Field>
      </Drawer>

      <Drawer
        open={refundOpen}
        size="sheet"
        title="Refund sale"
        subtitle="Record a monetary refund without changing stock."
        onClose={() => setRefundOpen(false)}
        footer={(
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setRefundOpen(false)}>Cancel</button>
            <button type="button" className="primary-button" onClick={submitRefund} disabled={!reason.trim() || refundAmountCents <= 0}>Record refund</button>
          </div>
        )}
      >
        <div className="form-grid">
          <Field label="Refund amount">
            <input
              type="number"
              min="0"
              max={Math.max(selectedMoney?.retained ?? 0, 0) / 100}
              value={refundAmountCents / 100}
              onChange={(event) => setRefundAmountCents(Math.round(Math.max(Number(event.target.value) || 0, 0) * 100))}
              className="admin-input"
            />
          </Field>
          <Field label="Refund method">
            <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as PaymentMethod)} className="admin-select">
              {METHOD_ORDER.map((method) => <option key={method} value={method}>{METHOD_LABEL[method]}</option>)}
            </select>
          </Field>
          <Field label="Reason" hint="This will be kept in the transaction audit history.">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="admin-textarea" rows={3} />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
