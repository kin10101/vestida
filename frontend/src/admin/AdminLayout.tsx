import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/inventory', label: 'Inventory' },
  { to: '/admin/sales', label: 'Sales' },
  { to: '/admin/stores', label: 'Stores' },
]

export default function AdminLayout() {
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <span className="brand">
          Vestida <em>Admin</em>
        </span>

        <nav className="admin-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
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
