import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Inbox, List, Plus, Shirt } from 'lucide-react'
import { formatPesoWhole } from '../../shared/utils/currency'
import { apiRpc } from '../../shared/api/client'
import { useAuth } from '../../auth/AuthContext'

const actions = [
  { to: '/staff/transfers', label: 'Transfer Stock', icon: ArrowUpRight },
  { to: '/staff/receive', label: 'Receive Stock', icon: Inbox, alert: true },
  { to: '/staff/stock', label: 'Check Stock', icon: Shirt },
  { to: '/staff/history', label: 'Sales History', icon: List },
]

interface TodaySummary {
  totalSales: number
  cash: number
  gcash: number
  bank: number
  incoming: number
}

export default function Home() {
  const { user } = useAuth()
  const storeCode = user?.storeCode ?? ''
  const [storeName, setStoreName] = useState(storeCode)
  const [today, setToday] = useState<TodaySummary>({ totalSales: 0, cash: 0, gcash: 0, bank: 0, incoming: 0 })

  useEffect(() => {
    let alive = true
    apiRpc<TodaySummary>('get_today_summary', {})
      .then((s) => {
        if (alive) setToday(s)
      })
      .catch(() => {
        /* keep zeros */
      })
    apiRpc<{ id: string; code: string; name: string }[]>('get_stores', {})
      .then((stores) => {
        if (!alive) return
        const mine = stores.find((s) => s.code === storeCode)
        if (mine) setStoreName(mine.name)
      })
      .catch(() => {
        /* keep code */
      })
    return () => {
      alive = false
    }
  }, [storeCode])

  const hasIncomingStock = today.incoming > 0

  return (
    <div className="staff-page">
      <p className="store-eyebrow">{storeCode}</p>
      <h1 className="store-title">{storeName}</h1>

      <section className="sales-card">
        <h2 className="card-sub">Total Sales Today</h2>
        <p className="sales-total">{formatPesoWhole(today.totalSales)}</p>

        <div className="sales-breakdown">
          <div>
            <p className="breakdown-label">Cash</p>
            <p className="breakdown-value">{formatPesoWhole(today.cash)}</p>
          </div>
          <div>
            <p className="breakdown-label">GCash &amp; Bank Transfer</p>
            <p className="breakdown-value">{formatPesoWhole(today.gcash + today.bank)}</p>
          </div>
        </div>
      </section>

      <Link className="log-sale-button" to="/staff/sale">
        <Plus size={19} strokeWidth={2} aria-hidden="true" />
        <span className="log-sale-label">Log a Sale</span>
        <ArrowRight className="log-sale-arrow" size={18} strokeWidth={1.8} aria-hidden="true" />
      </Link>

      <nav className="home-grid" aria-label="Staff actions">
        {actions.map(({ to, label, icon: Icon, alert }) => {
          const showAlert = Boolean(alert) && hasIncomingStock
          return (
            <Link key={to} className="home-grid-item" to={to}>
              {showAlert && <span className="home-badge" aria-hidden="true" />}
              <span className="home-grid-icon">
                <Icon size={28} strokeWidth={1.6} />
              </span>
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
