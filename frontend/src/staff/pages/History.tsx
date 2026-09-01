import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion'
import { Banknote, ChevronDown, ChevronUp, Landmark, Search, Smartphone } from 'lucide-react'
import { formatPesoWhole } from '../../shared/utils/currency'
import { apiRpc } from '../../shared/api/client'
import { useHeaderTitleValue } from '../headerTitle'

type DayFilter = 'today' | 'yesterday'
type StaffFilter = string
type PaymentMethod = 'cash' | 'gcash' | 'bank_transfer'
type OrderKind = 'ready_made' | 'made_to_order'

interface HistoryItem {
  name: string
  detail: string
  qty: number
  price: number
}

interface HistoryOrder {
  id: string
  dateKey: string
  createdAt: string
  customer: string | null
  total: number
  paid: number
  method: PaymentMethod
  careOf: Exclude<StaffFilter, 'All'>
  type: OrderKind
  orderNumber: string
  items: HistoryItem[]
}

// TODO: load the staff list from the API.
const PAYMENT_META: Record<PaymentMethod, { label: string; icon: typeof Banknote }> = {
  cash: { label: 'Cash', icon: Banknote },
  gcash: { label: 'GCash', icon: Smartphone },
  bank_transfer: { label: 'Bank Transfer', icon: Landmark },
}

function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

function getDateKey(offsetDays = 0) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return getLocalDateKey(date)
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function History() {
  useHeaderTitleValue('Sales History', 'Past sales for this store.')

  const [day, setDay] = useState<DayFilter>('today')
  const [query, setQuery] = useState('')
  const [staff, setStaff] = useState<StaffFilter>('All')
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()

  const [orders, setOrders] = useState<HistoryOrder[]>([])
  const [staffFilters, setStaffFilters] = useState<StaffFilter[]>(['All'])

  useEffect(() => {
    let alive = true
    Promise.all([
      apiRpc<HistoryOrder[]>('get_history', {}),
      apiRpc<string[]>('get_staff', {}),
    ])
      .then(([history, staffList]) => {
        if (!alive) return
        setOrders(history)
        setStaffFilters(['All', ...staffList])
      })
      .catch(() => {
        /* empty states */
      })
    return () => {
      alive = false
    }
  }, [])

  const selectedDayKey = day === 'today' ? getDateKey(0) : getDateKey(-1)

  const dayOrders = useMemo(
    () => orders.filter((order) => getLocalDateKey(new Date(order.createdAt)) === selectedDayKey),
    [orders, selectedDayKey],
  )

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return dayOrders.filter((order) => {
      const employeeMatches = staff === 'All' || order.careOf === staff
      const searchable = [
        order.customer ?? 'Walk-in',
        order.orderNumber,
        order.items.map((item) => item.name).join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return employeeMatches && (needle === '' || searchable.includes(needle))
    })
  }, [dayOrders, query, staff])

  const activeLabel = day === 'today' ? 'Today' : 'Yesterday'

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="staff-page history-page"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: [0.65, 0, 0.35, 1] }}
      >
      <div className="segmented-toggle" role="tablist" aria-label="Sales day filter">
        {(
          [
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
          ] as const
        ).map((d) => {
          const active = day === d.value
          return (
            <button
              key={d.value}
              type="button"
              className={`segmented-option${active ? ' active' : ''}`}
              onClick={() => setDay(d.value)}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="history-day-pill"
                  className="segmented-pill"
                  transition={{ duration: 0.18, ease: [0.65, 0, 0.35, 1] }}
                />
              )}
              <span className="segmented-label">{d.label}</span>
            </button>
          )
        })}
      </div>

      <label className="history-search" htmlFor="history-search">
        <Search size={17} />
        <input
          id="history-search"
          className="text-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customer or order #"
        />
      </label>

      <div className="chip-scroll history-staff-row" aria-label="Staff filter chips">
        {staffFilters.map((option) => (
          <motion.button
            key={option}
            type="button"
            className={`option-chip${staff === option ? ' active' : ''}`}
            onClick={() => setStaff(option)}
            whileTap={{ scale: 0.94 }}
            animate={{ scale: staff === option ? 1.04 : 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          >
            {option}
          </motion.button>
        ))}
      </div>

      {!dayOrders.length ? (
        <div className="empty-note">No sales logged for {activeLabel} yet.</div>
      ) : !filteredOrders.length ? (
        <div className="empty-note">No sales match your search.</div>
      ) : (
        <div className="history-list">
          {filteredOrders.map((order) => {
            const meta = PAYMENT_META[order.method]
            const Icon = meta.icon
            const balance = Math.max(order.total - order.paid, 0)
            const isExpanded = expandedOrderId === order.id

            return (
              <div className={`history-order${isExpanded ? ' expanded' : ''}`} key={order.id}>
                <button
                  type="button"
                  className="history-row-toggle"
                  onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="history-order-time">{formatTime(order.createdAt)}</span>
                  <span className="history-order-customer">{order.customer ?? 'Walk-in'}</span>
                  <span className="history-order-total">{formatPesoWhole(order.total)}</span>
                  <span className="history-chevron" aria-hidden="true">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      className="history-order-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.65, 0, 0.35, 1] }}
                    >
                      <div className="history-order-body-inner">
                        <div className="history-status-row">
                          <span className="history-payment-chip">
                            <Icon size={14} />
                            {meta.label}
                          </span>
                          {balance > 0 ? (
                            <span className="history-balance-note">
                              Balance {formatPesoWhole(balance)}
                            </span>
                          ) : (
                            <span className="history-paid-note">Paid in full</span>
                          )}
                        </div>

                        <div className="history-items">
                          {order.items.map((item) => (
                            <div className="history-item-row" key={`${order.id}-${item.name}-${item.detail}`}>
                              <div className="history-item-main">
                                <span className="history-item-name">{item.name}</span>
                                <span className="history-item-detail">{item.detail}</span>
                              </div>
                              <span className="history-item-qty">x{item.qty}</span>
                              <span className="history-item-price">{formatPesoWhole(item.price)}</span>
                            </div>
                          ))}
                        </div>

                        <div className="history-meta-grid">
                          <div>
                            <span>Care of</span>
                            <strong>{order.careOf}</strong>
                          </div>
                          <div>
                            <span>Order</span>
                            <strong>{order.orderNumber}</strong>
                          </div>
                          <div className="history-meta-wide">
                            <span>Type</span>
                            <strong>{order.type === 'made_to_order' ? 'Made-to-Order' : 'Ready-made'}</strong>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}
      </motion.div>
    </MotionConfig>
  )
}
