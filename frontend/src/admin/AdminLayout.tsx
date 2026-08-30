import { motion } from 'framer-motion'
import { BarChart3, Boxes, LayoutDashboard, Store, Tags } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/admin', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/admin/products', label: 'Products', icon: Tags },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  { to: '/admin/sales', label: 'Sales', icon: BarChart3 },
  { to: '/admin/stores', label: 'Stores', icon: Store },
]

export default function AdminLayout() {
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <span className="brand" aria-label="Vestida Admin">
          Vestida <em>Admin</em>
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
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
