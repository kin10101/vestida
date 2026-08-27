import { Link, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeft, Phone, Settings } from 'lucide-react'

// Owner's direct line — TODO: replace with Gina's real number.
const OWNER_PHONE = '+639170000000'

export default function StaffLayout() {
  const location = useLocation()
  const isHome = location.pathname === '/staff'

  return (
    <div className="staff-app">
      <header className="staff-header">
        {isHome ? (
          <span className="logo-badge">LGA</span>
        ) : (
          <Link className="back-button" to="/staff" aria-label="Back to home">
            <ArrowLeft size={22} />
          </Link>
        )}

        <a className="gina-pill" href={`tel:${OWNER_PHONE}`}>
          <Phone size={16} />
          <span>Gina</span>
        </a>

        <button
          type="button"
          className="settings-button"
          aria-label="Settings"
        >
          <Settings size={22} />
        </button>
      </header>

      <main className="staff-main">
        <Outlet />
      </main>
    </div>
  )
}
