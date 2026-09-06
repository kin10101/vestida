import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Building2, CalendarDays, ChevronDown, RefreshCw, TrendingUp, Undo2, WalletCards } from 'lucide-react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { useAdminData } from '../AdminDataContext'
import { parseDbUtc } from '../../shared/utils/dates'
import type { OrderStatus, PaymentKind, PaymentMethod } from '../data'
import type { StatusTone } from '../ui'
import { Drawer, EmptyState, Field, MetricCard, PageHeader, StatusBadge } from '../ui'
import SalesTrendChart from '../SalesTrendChart'
import type { ActivePoint } from '../SalesTrendChart'
import RangePicker from '../RangePicker'
import { inWindow } from '../trendRange'
import type { TrendPeriod } from '../trendRange'
import ExportMenu from '../ExportMenu'
import type { ExportRow } from '../ExportMenu'
import DateRangeCalendar from '../DateRangeCalendar'

const tabs = ['payments', 'transactions', 'insights'] as const
type SalesTab = (typeof tabs)[number]
const TAB_LABEL: Record<SalesTab, string> = {
  transactions: 'Transactions',
  payments: 'Payments',
  insights: 'Insights',
}

const TAB_BLURB: Record<SalesTab, string> = {
  transactions: 'Recent activity in detail — every order with its payment and fulfillment state, plus transfers, stock adds, adjustments, and refunds.',
  payments: 'Where the money went — tenders, refunds, and what is still owed.',
  insights: 'How sales are performing — trends, mix, and top movers.',
}

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

function withinDateRange(value: string, from: string, to: string) {
  if (!from && !to) return true
  if (from && to && from > to) return false
  const date = parseDbUtc(value)
  const start = from ? new Date(`${from}T00:00:00`) : null
  const end = to ? new Date(`${to}T00:00:00`) : null
  if (start && date < start) return false
  if (end) {
    end.setDate(end.getDate() + 1)
    if (date >= end) return false
  }
  return true
}

function formatRangeDate(value: string): string {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(year, month - 1, day),
  )
}

function DateRangeSelector({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const label = from && to
    ? `${formatRangeDate(from)} – ${formatRangeDate(to)}`
    : from
      ? `From ${formatRangeDate(from)}`
      : to
        ? `Until ${formatRangeDate(to)}`
        : 'All dates'

  return (
    <div className={`sales-date-selector ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="sales-date-summary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Select sales date range"
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarDays size={15} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div className="sales-date-backdrop" onClick={() => setOpen(false)} />
          <div className="sales-date-popover" role="dialog" aria-label="Pick sales dates">
            <DateRangeCalendar
              from={from}
              to={to}
              onFromChange={onFromChange}
              onToChange={onToChange}
              onClose={() => setOpen(false)}
            />
          </div>
        </>
      ) : null}
    </div>
  )
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

/** One stock operation (an intake or an adjustment) rebuilt from its per-unit
 *  ledger rows — all the units written by a single DB call share a timestamp. */
interface StockOpRow {
  key: string
  createdAt: string
  store: string
  staff: string
  note: string
  count: number
  name: string
  detail: string
}

/** A voided-sale or refund audit record (sales_exception joined to its order). */
interface ExceptionRow {
  key: string
  createdAt: string
  reference: string
  customer: string
  store: string
  label: string
  tone: StatusTone
  amount: number
  amountLabel: string
  reason: string
  processedBy: string
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Transactions filters
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  const [fulfillFilter, setFulfillFilter] = useState<FulfillFilter>('all')
  const [search, setSearch] = useState('')
  const [txPage, setTxPage] = useState(1)
  const txPageSize = 20
  const [transferPage, setTransferPage] = useState(1)
  const transferPageSize = 20
  const [intakePage, setIntakePage] = useState(1)
  const intakePageSize = 20
  const [adjustPage, setAdjustPage] = useState(1)
  const adjustPageSize = 20
  const [exceptionPage, setExceptionPage] = useState(1)
  const exceptionPageSize = 20

  // Payments filters
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all')
  const [kindFilter, setKindFilter] = useState<PayKindFilter>('all')
  const [payPage, setPayPage] = useState(1)
  const payPageSize = 20

  // Insights filters
  const [insightPeriod, setInsightPeriod] = useState<TrendPeriod>({ unit: 'week', offset: 0 })

  // Drawer / modals
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [refundAmountCents, setRefundAmountCents] = useState(0)
  const [chartActive, setChartActive] = useState<ActivePoint | null>(null)
  const [chartComparisonIds, setChartComparisonIds] = useState<string[]>([])
  const [chartShowTotal, setChartShowTotal] = useState(true)

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
      return withinDateRange(s.order.createdAt, dateFrom, dateTo)
    }),
    [summaries, storeFilter, dateFrom, dateTo],
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
  }, [dateFrom, dateTo, storeFilter, payFilter, fulfillFilter, search])

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
        return withinDateRange(movement.createdAt, dateFrom, dateTo)
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
  }, [dateFrom, dateTo, state.inventoryUnits, state.productVariants, state.products, state.stockMovements, state.stores, storeFilter])

  useEffect(() => {
    setTransferPage(1)
  }, [dateFrom, dateTo, storeFilter])

  const transferPageCount = Math.max(1, Math.ceil(transferRows.length / transferPageSize))
  useEffect(() => {
    setTransferPage((page) => Math.min(page, transferPageCount))
  }, [transferPageCount])

  const visibleTransferRows = useMemo(
    () => transferRows.slice((transferPage - 1) * transferPageSize, transferPage * transferPageSize),
    [transferPage, transferPageSize, transferRows],
  )

  // Stock intakes (`received`) and manual adjustments (`adjustment`) are the
  // remaining stock-activity kinds that belong on this recent-activity tab.
  // Each DB write logs one stock_movement per unit, all sharing the same
  // created_at, so the per-unit rows are grouped back into one operation row
  // with a piece count — the same grouping the Dashboard activity feed uses.
  const opLedger = useMemo(() => {
    const unitById = new Map(state.inventoryUnits.map((unit) => [unit.id, unit]))
    const itemFor = (unitId: string | undefined) => {
      const unit = unitId ? unitById.get(unitId) : undefined
      const variant = unit ? variantById.get(unit.variantId) : undefined
      const product = variant ? productById.get(variant.productId) : undefined
      if (!product) return null
      return {
        name: product.name,
        detail: variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : '',
      }
    }

    const build = (kind: 'received' | 'adjustment'): StockOpRow[] => {
      const byOp = new Map<string, StockOpRow>()
      state.stockMovements.forEach((movement) => {
        if (movement.kind !== kind) return
        if (storeFilter !== 'all' && movement.storeId !== storeFilter) return
        if (!withinDateRange(movement.createdAt, dateFrom, dateTo)) return
        const storeId = movement.storeId ?? ''
        const key = `${storeId}|${movement.createdAt}`
        let row = byOp.get(key)
        if (!row) {
          const item = itemFor(movement.unitId)
          row = {
            key: `${kind}-${key}`,
            createdAt: movement.createdAt,
            store: storeName(storeId),
            staff: movement.staffName || '',
            note: movement.note || '',
            count: 0,
            name: item?.name ?? 'Variant',
            detail: item?.detail ?? '',
          }
          byOp.set(key, row)
        }
        row.count += 1
      })
      return Array.from(byOp.values())
        .sort((a, b) => parseDbUtc(b.createdAt).getTime() - parseDbUtc(a.createdAt).getTime())
    }

    return { intake: build('received'), adjustment: build('adjustment') }
  }, [dateFrom, dateTo, state.inventoryUnits, state.stockMovements, storeFilter, storeName, variantById, productById])

  // Voided sales / refunds recorded against orders (sales_exception rows).
  const exceptionRows = useMemo(() => {
    return state.salesExceptions
      .map((exception): ExceptionRow | null => {
        const order = orderById.get(exception.orderId)
        if (!order) return null
        if (storeFilter !== 'all' && order.storeId !== storeFilter) return null
        if (!withinDateRange(exception.createdAt, dateFrom, dateTo)) return null
        return {
          key: exception.id,
          createdAt: exception.createdAt,
          reference: order.reference || '—',
          customer: order.customerName || 'Walk-in',
          store: storeName(order.storeId),
          label: exception.kind === 'void' ? 'Void' : 'Refund',
          tone: (exception.kind === 'void' ? 'danger' : 'warning') as StatusTone,
          amount: exception.kind === 'refund' ? exception.amountCents : 0,
          amountLabel: exception.kind === 'refund' ? formatPeso(exception.amountCents) : '—',
          reason: exception.reason || '',
          processedBy: exception.processedBy || '—',
        }
      })
      .filter((row): row is ExceptionRow => row !== null)
      .sort((a, b) => parseDbUtc(b.createdAt).getTime() - parseDbUtc(a.createdAt).getTime())
  }, [dateFrom, dateTo, orderById, state.salesExceptions, storeFilter, storeName])

  useEffect(() => {
    setIntakePage(1)
    setAdjustPage(1)
    setExceptionPage(1)
  }, [dateFrom, dateTo, storeFilter])

  const intakePageCount = Math.max(1, Math.ceil(opLedger.intake.length / intakePageSize))
  useEffect(() => {
    setIntakePage((page) => Math.min(page, intakePageCount))
  }, [intakePageCount])
  const visibleIntakeRows = useMemo(
    () => opLedger.intake.slice((intakePage - 1) * intakePageSize, intakePage * intakePageSize),
    [intakePage, intakePageSize, opLedger.intake],
  )

  const adjustPageCount = Math.max(1, Math.ceil(opLedger.adjustment.length / adjustPageSize))
  useEffect(() => {
    setAdjustPage((page) => Math.min(page, adjustPageCount))
  }, [adjustPageCount])
  const visibleAdjustRows = useMemo(
    () => opLedger.adjustment.slice((adjustPage - 1) * adjustPageSize, adjustPage * adjustPageSize),
    [adjustPage, adjustPageSize, opLedger.adjustment],
  )

  const exceptionPageCount = Math.max(1, Math.ceil(exceptionRows.length / exceptionPageSize))
  useEffect(() => {
    setExceptionPage((page) => Math.min(page, exceptionPageCount))
  }, [exceptionPageCount])
  const visibleExceptionRows = useMemo(
    () => exceptionRows.slice((exceptionPage - 1) * exceptionPageSize, exceptionPage * exceptionPageSize),
    [exceptionPage, exceptionPageSize, exceptionRows],
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
      if (!withinDateRange(payment.receivedAt, dateFrom, dateTo)) return false
      if (methodFilter !== 'all' && payment.method !== methodFilter) return false
      if (kindFilter !== 'all' && payment.kind !== kindFilter) return false
      return true
    })
    .sort((a, b) => parseDbUtc(b.receivedAt).getTime() - parseDbUtc(a.receivedAt).getTime()),
    [state.payments, orderById, storeFilter, dateFrom, dateTo, methodFilter, kindFilter])

  useEffect(() => {
    setPayPage(1)
  }, [dateFrom, dateTo, storeFilter, methodFilter, kindFilter])

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
      return inWindow(s.order.createdAt, insightPeriod)
    }),
    [summaries, storeFilter, insightPeriod])

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
    setPaymentHistoryOpen(false)
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

  const opItemLabel = (name: string, detail: string) => (detail ? `${name} · ${detail}` : name)

  const exportIntakeRows = useMemo<ExportRow[]>(() => opLedger.intake.map((row) => ({
    date: row.createdAt,
    values: [
      formatDate(row.createdAt),
      opItemLabel(row.name, row.detail),
      row.store,
      row.staff || '',
      row.count,
    ],
  })), [opLedger.intake])

  const exportAdjustRows = useMemo<ExportRow[]>(() => opLedger.adjustment.map((row) => ({
    date: row.createdAt,
    values: [
      formatDate(row.createdAt),
      opItemLabel(row.name, row.detail),
      row.store,
      row.note,
      row.staff || '',
      row.count,
    ],
  })), [opLedger.adjustment])

  const exportExceptionRows = useMemo<ExportRow[]>(() => exceptionRows.map((row) => ({
    date: row.createdAt,
    values: [
      formatDate(row.createdAt),
      row.reference,
      row.customer,
      row.store,
      row.label,
      row.amount ? row.amount / 100 : '',
      row.processedBy,
    ],
  })), [exceptionRows])

  const TX_EXPORT_COLUMNS = ['Reference', 'Customer', 'Item', 'Items', 'Date', 'Store', 'Fulfillment', 'Status', 'Total (PHP)']
  const TRANSFER_EXPORT_COLUMNS = ['Date', 'Item', 'Detail', 'From', 'To', 'Staff', 'Status']
  const PAY_EXPORT_COLUMNS = ['Date', 'Transaction', 'Customer', 'Store', 'Method', 'Amount (PHP)', 'Status']
  const INTAKE_EXPORT_COLUMNS = ['Date', 'Item', 'Store', 'Added by', 'Units']
  const ADJUST_EXPORT_COLUMNS = ['Date', 'Item', 'Store', 'Note', 'Adjusted by', 'Units']
  const EXCEPTION_EXPORT_COLUMNS = ['Date', 'Reference', 'Customer', 'Store', 'Type', 'Amount (PHP)', 'Processed by']

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
                {tab === item && <motion.span className="segmented-pill" layoutId="sales-tab-pill" transition={{ duration: 0.18, ease: [0.65, 0, 0.35, 1] }} />}
                <span className="segmented-label">{TAB_LABEL[item]}</span>
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
              <RangePicker value={insightPeriod} onChange={setInsightPeriod} variant="toolbar" />
            </div>
          </>
        ) : (
          <>
            <div className="toolbar-left">
              <DateRangeSelector from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
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
            {dateFrom && dateTo && dateFrom > dateTo ? (
              <p className="sales-date-error" role="alert">End date must be on or after the start date.</p>
            ) : null}
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

          <section className="admin-panel compact-panel ledger-panel intake-history-panel">
            <div className="panel-header-row">
              <h3>Stock added</h3>
              <div className="panel-head-actions">
                <span className="ledger-count">{formatCount(opLedger.intake.length)} entries</span>
                <ExportMenu label="stock-added" columns={INTAKE_EXPORT_COLUMNS} rows={exportIntakeRows} showLabel />
              </div>
            </div>
            <div className="op-table" role="table" aria-label="Stock added history">
              <div className="op-head op-intake" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Item</span>
                <span role="columnheader">Store</span>
                <span role="columnheader">Added by</span>
                <span role="columnheader" className="num">Units</span>
              </div>
              <div className="op-body">
                {visibleIntakeRows.length ? visibleIntakeRows.map((row) => (
                  <div className="op-row op-intake" role="row" key={row.key}>
                    <span role="cell">{formatDateTime(row.createdAt)}</span>
                    <span role="cell"><strong>{row.name}</strong><small>{row.detail || 'Variant'}</small></span>
                    <span role="cell">{row.store}</span>
                    <span role="cell">{row.staff || '—'}</span>
                    <span role="cell" className="num op-count is-add">+{formatCount(row.count)}</span>
                  </div>
                )) : <EmptyState title="No stock added" description="New units added with 'Add stock' will appear here." />}
              </div>
            </div>
            {opLedger.intake.length > 0 ? (
              <div className="ledger-pagination">
                <span>Showing {(intakePage - 1) * intakePageSize + 1}-{Math.min(intakePage * intakePageSize, opLedger.intake.length)} of {formatCount(opLedger.intake.length)} entries</span>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" disabled={intakePage === 1} onClick={() => setIntakePage((page) => Math.max(1, page - 1))}>‹ Previous</button>
                  <div className="pagination-pages" aria-label="Stock added pages">
                    {Array.from({ length: Math.min(intakePageCount, 5) }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" className={`pagination-page ${intakePage === page ? 'active' : ''}`} aria-current={intakePage === page ? 'page' : undefined} onClick={() => setIntakePage(page)}>
                        {page}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" disabled={intakePage === intakePageCount} onClick={() => setIntakePage((page) => Math.min(intakePageCount, page + 1))}>Next ›</button>
                </div>
                <span className="pagination-size">{intakePageSize} per page</span>
              </div>
            ) : null}
          </section>

          <section className="admin-panel compact-panel ledger-panel adjust-history-panel">
            <div className="panel-header-row">
              <h3>Adjustments</h3>
              <div className="panel-head-actions">
                <span className="ledger-count">{formatCount(opLedger.adjustment.length)} entries</span>
                <ExportMenu label="adjustments" columns={ADJUST_EXPORT_COLUMNS} rows={exportAdjustRows} showLabel />
              </div>
            </div>
            <div className="op-table" role="table" aria-label="Stock adjustment history">
              <div className="op-head op-adjust" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Item</span>
                <span role="columnheader">Store</span>
                <span role="columnheader">Note</span>
                <span role="columnheader">Adjusted by</span>
                <span role="columnheader" className="num">Units</span>
              </div>
              <div className="op-body">
                {visibleAdjustRows.length ? visibleAdjustRows.map((row) => (
                  <div className="op-row op-adjust" role="row" key={row.key}>
                    <span role="cell">{formatDateTime(row.createdAt)}</span>
                    <span role="cell"><strong>{row.name}</strong><small>{row.detail || 'Variant'}</small></span>
                    <span role="cell">{row.store}</span>
                    <span role="cell">{row.note || '—'}</span>
                    <span role="cell">{row.staff || '—'}</span>
                    <span role="cell" className="num op-count">{formatCount(row.count)}</span>
                  </div>
                )) : <EmptyState title="No adjustments" description="Manual stock corrections from Inventory will appear here." />}
              </div>
            </div>
            {opLedger.adjustment.length > 0 ? (
              <div className="ledger-pagination">
                <span>Showing {(adjustPage - 1) * adjustPageSize + 1}-{Math.min(adjustPage * adjustPageSize, opLedger.adjustment.length)} of {formatCount(opLedger.adjustment.length)} entries</span>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" disabled={adjustPage === 1} onClick={() => setAdjustPage((page) => Math.max(1, page - 1))}>‹ Previous</button>
                  <div className="pagination-pages" aria-label="Adjustment history pages">
                    {Array.from({ length: Math.min(adjustPageCount, 5) }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" className={`pagination-page ${adjustPage === page ? 'active' : ''}`} aria-current={adjustPage === page ? 'page' : undefined} onClick={() => setAdjustPage(page)}>
                        {page}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" disabled={adjustPage === adjustPageCount} onClick={() => setAdjustPage((page) => Math.min(adjustPageCount, page + 1))}>Next ›</button>
                </div>
                <span className="pagination-size">{adjustPageSize} per page</span>
              </div>
            ) : null}
          </section>

          <section className="admin-panel compact-panel ledger-panel exception-history-panel">
            <div className="panel-header-row">
              <h3>Voids & refunds</h3>
              <div className="panel-head-actions">
                <span className="ledger-count">{formatCount(exceptionRows.length)} entries</span>
                <ExportMenu label="voids-refunds" columns={EXCEPTION_EXPORT_COLUMNS} rows={exportExceptionRows} showLabel />
              </div>
            </div>
            <div className="ex-table" role="table" aria-label="Void and refund history">
              <div className="ex-head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Transaction</span>
                <span role="columnheader">Customer</span>
                <span role="columnheader">Store</span>
                <span role="columnheader">Type</span>
                <span role="columnheader" className="num">Amount</span>
                <span role="columnheader">Processed by</span>
              </div>
              <div className="ex-body">
                {visibleExceptionRows.length ? visibleExceptionRows.map((row) => (
                  <div className="ex-row" role="row" key={row.key}>
                    <span role="cell">{formatDateTime(row.createdAt)}</span>
                    <span role="cell"><strong>{row.reference}</strong><small>{row.reason || 'No reason recorded'}</small></span>
                    <span role="cell">{row.customer}</span>
                    <span role="cell">{row.store}</span>
                    <span role="cell"><StatusBadge label={row.label} tone={row.tone} /></span>
                    <span role="cell" className={`num ex-amount ${row.amount ? '' : 'is-void'}`}>{row.amountLabel}</span>
                    <span role="cell">{row.processedBy}</span>
                  </div>
                )) : <EmptyState title="No voids or refunds" description="Voided sales and refunds will appear here." />}
              </div>
            </div>
            {exceptionRows.length > 0 ? (
              <div className="ledger-pagination">
                <span>Showing {(exceptionPage - 1) * exceptionPageSize + 1}-{Math.min(exceptionPage * exceptionPageSize, exceptionRows.length)} of {formatCount(exceptionRows.length)} entries</span>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" disabled={exceptionPage === 1} onClick={() => setExceptionPage((page) => Math.max(1, page - 1))}>‹ Previous</button>
                  <div className="pagination-pages" aria-label="Void and refund pages">
                    {Array.from({ length: Math.min(exceptionPageCount, 5) }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" className={`pagination-page ${exceptionPage === page ? 'active' : ''}`} aria-current={exceptionPage === page ? 'page' : undefined} onClick={() => setExceptionPage(page)}>
                        {page}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-button" disabled={exceptionPage === exceptionPageCount} onClick={() => setExceptionPage((page) => Math.min(exceptionPageCount, page + 1))}>Next ›</button>
                </div>
                <span className="pagination-size">{exceptionPageSize} per page</span>
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
              range={insightPeriod}
              selectedStore={storeFilter}
              stores={activeStores}
              orders={state.orders}
              orderLines={state.orderLines}
              active={chartActive}
              onSelectPoint={setChartActive}
              onExpand={() => undefined}
              selectedComparisonIds={chartComparisonIds}
              onSelectedComparisonIdsChange={setChartComparisonIds}
              showTotal={chartShowTotal}
              onShowTotalChange={setChartShowTotal}
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
        subtitle={selectedOrder ? `${formatDateTime(selectedOrder.createdAt)} · Staff-created · Read only` : 'Staff-created record. Details cannot be edited from admin.'}
        onClose={() => setSelectedOrderId(null)}
        footer={(
          <div className="modal-footer-actions transaction-footer-actions">
            <button type="button" className="primary-button" onClick={() => setSelectedOrderId(null)}>Close</button>
            {canVoid ? (
              <button type="button" className="secondary-button exception-button" onClick={() => { setReason(''); setVoidOpen(true) }}><Ban size={16} />Void sale</button>
            ) : null}
            {canRefund ? (
              <button type="button" className="secondary-button exception-button" onClick={openRefund}><Undo2 size={16} />Refund</button>
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

            <div className="transaction-hero-summary">
              <div className="transaction-hero-main">
                <div className="transaction-hero-context">
                  <span>Customer</span>
                  <strong>{selectedOrder.customerName || 'Walk-in'}</strong>
                  <small>{selectedSummary.storeName}</small>
                </div>
                <div className="transaction-hero-total">
                  <span>Total</span>
                  <strong>{formatPeso(selectedMoney.total)}</strong>
                </div>
              </div>
              <div className="transaction-hero-meta">
                <span>{formatCount(selectedMoney.itemCount)} item{selectedMoney.itemCount === 1 ? '' : 's'}</span>
                <span>Balance <strong className={selectedMoney.outstanding > 0 ? 'amount-negative' : ''}>{formatPeso(selectedMoney.outstanding)}</strong></span>
              </div>
            </div>

            <section className="detail-section items-section"><h4>Items</h4>
              <div className="detail-items-head" aria-hidden="true"><span>Item</span><span>Qty</span><span>Price</span></div>
              {selectedLines.length ? selectedLines.map((line) => (
                (() => {
                  const variant = line.variantId ? variantById.get(line.variantId) : undefined
                  const product = variant ? productById.get(variant.productId) : undefined
                  const detail = variant ? [variant.color, variant.size].filter(Boolean).join(' · ') : ''
                  const label = product
                    ? `${product.name}${detail ? ` · ${detail}` : ''}`
                    : line.description || 'Made-to-Order'
                  return (
                    <div key={line.id} className="detail-item-row">
                      <span className="detail-item-name">{label}</span>
                      <span>×{line.quantity}</span>
                      <strong>{formatPeso(line.agreedPriceCents * line.quantity)}</strong>
                    </div>
                  )
                })()
              )) : <p className="detail-empty">No line items recorded.</p>}
            </section>

            <section className="detail-section payment-section"><h4>Payment</h4>
              {selectedPayments.length ? (
                <>
                  <div className="payment-summary-line">
                    <span>
                      <span>{selectedPayments[0].kind === 'payment' ? METHOD_LABEL[selectedPayments[0].method] : selectedPayments[0].kind === 'refund' ? 'Refund' : 'Void reversal'}</span>
                      <small>{formatDateTime(selectedPayments[0].receivedAt)}</small>
                    </span>
                    <strong className={selectedPayments[0].amountCents < 0 ? 'amount-negative' : ''}>{formatPeso(selectedPayments[0].amountCents)}</strong>
                  </div>
                  {selectedPayments.length > 1 ? (
                    <button type="button" className="text-button payment-history-toggle" onClick={() => setPaymentHistoryOpen((open) => !open)}>
                      {paymentHistoryOpen ? 'Hide payment history' : 'View payment history'}
                    </button>
                  ) : null}
                  {paymentHistoryOpen ? (
                    <div className="payment-history-list">
                      {selectedPayments.map((payment) => (
                        <div key={payment.id} className="detail-line">
                          <span>{payment.kind === 'payment' ? METHOD_LABEL[payment.method] : payment.kind === 'refund' ? 'Refund' : 'Void reversal'} · {formatDateTime(payment.receivedAt)}</span>
                          <strong className={payment.amountCents < 0 ? 'amount-negative' : ''}>{formatPeso(payment.amountCents)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : <p className="detail-empty">No payments recorded.</p>}
            </section>

            {selectedExceptions.length ? (
              <section className="detail-section exception-section"><h4>Exception history</h4>
                {selectedExceptions.map((exception) => (
                  <div key={exception.id} className="exception-history">
                    <StatusBadge label={exception.kind === 'void' ? 'Void' : 'Refund'} tone="danger" />
                    <div><strong>{exception.processedBy}</strong><small>{formatDate(exception.createdAt)} · {exception.reason}</small></div>
                    <span>{exception.amountCents ? formatPeso(exception.amountCents) : '—'}</span>
                  </div>
                ))}
              </section>
            ) : null}
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
