import { motion } from 'framer-motion'
import { BarChart3, Boxes, LayoutDashboard, LogOut, Store, Tags } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const navItems = [
  { to: '/admin', label: 'Dashboard', shortLabel: 'Home', end: true, icon: LayoutDashboard },
  { to: '/admin/products', label: 'Products', shortLabel: 'Products', icon: Tags },
  { to: '/admin/inventory', label: 'Inventory', shortLabel: 'Stock', icon: Boxes },
  { to: '/admin/sales', label: 'Sales', shortLabel: 'Sales', icon: BarChart3 },
  { to: '/admin/stores', label: 'Stores', shortLabel: 'Stores', icon: Store },
]

export default function AdminLayout() {
  const { signOut } = useAuth()

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <span className="brand" aria-label="Vestida Admin">
          <span className="brand-word">Vestida</span> <em>Admin</em>
        </span>

        <nav className="admin-nav" aria-label="Admin navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      className="admin-nav-active"
                      layoutId="admin-nav-active"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    />
                  )}
                  <item.icon aria-hidden="true" size={19} strokeWidth={1.8} />
                  <span className="admin-nav-label">{item.label}</span>
                  <span className="admin-nav-label-short">{item.shortLabel}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          className="admin-logout"
          aria-label="Log out"
          title="Log out"
          onClick={() => void signOut()}
        >
          <LogOut aria-hidden="true" size={19} strokeWidth={1.8} />
          <span className="admin-logout-label">Log out</span>
        </button>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
