import { Link } from 'react-router-dom'
import { ArrowUpRight, Inbox, List, Pencil, Shirt } from 'lucide-react'
import { formatPesoWhole } from '../../shared/utils/currency'

// Placeholder numbers — will come from the API later.
const today = {
  totalSales: 23600,
  cash: 4800,
  gcash: 1200,
}

// True when at least one piece is inbound (in_transit → this store).
// TODO: derive from the same query the Receive page uses — count of
// in_transit units whose transferred_out has to_store_id = my store.
const hasIncomingStock = true

const actions = [
  { to: '/staff/transfers', label: 'Transfer Stock', icon: ArrowUpRight },
  { to: '/staff/receive', label: 'Receive Stock', icon: Inbox, alert: true },
  { to: '/staff/stock', label: 'Check Stock', icon: Shirt },
  { to: '/staff/history', label: 'Sales History', icon: List },
]

export default function Home() {
  return (
    <div className="staff-page">
      <p className="store-eyebrow">LGA</p>
      <h1 className="store-title">LGA Bridal Boutique</h1>

      <section className="sales-card">
        <h2 className="card-sub">Total Sales Today</h2>
        <p className="sales-total">{formatPesoWhole(today.totalSales)}</p>

        <div className="sales-breakdown">
          <div>
            <p className="breakdown-label">Cash</p>
            <p className="breakdown-value">{formatPesoWhole(today.cash)}</p>
          </div>
          <div>
            <p className="breakdown-label">Gcash</p>
            <p className="breakdown-value">{formatPesoWhole(today.gcash)}</p>
          </div>
        </div>
      </section>

      <Link className="log-sale-button" to="/staff/sale">
        <Pencil size={22} />
        <span>Log a Sale</span>
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
