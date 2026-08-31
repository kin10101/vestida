import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'

import { AdminDataProvider } from './admin/AdminDataContext'
import AdminLayout from './admin/AdminLayout'
import Dashboard from './admin/pages/Dashboard'
import Inventory from './admin/pages/Inventory'
import Products from './admin/pages/Products'
import Sales from './admin/pages/Sales'
import Stores from './admin/pages/Stores'
import Login from './auth/Login'
import RequireRole from './auth/RequireRole'
import StaffLayout from './staff/StaffLayout'
import History from './staff/pages/History'
import Receive from './staff/pages/Receive'
import Sale from './staff/pages/Sale'
import StaffHome from './staff/pages/Home'
import Stock from './staff/pages/Stock'
import Transfers from './staff/pages/Transfers'

function App() {
  return (
    <BrowserRouter>
      <AdminDataProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/staff"
            element={
              <RequireRole role="staff">
                <StaffLayout />
              </RequireRole>
            }
          >
            <Route index element={<StaffHome />} />
            <Route path="sale" element={<Sale />} />
            <Route path="receive" element={<Receive />} />
            <Route path="stock" element={<Stock />} />
            <Route path="transfers" element={<Transfers />} />
            <Route path="history" element={<History />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireRole role="admin">
                <AdminLayout />
              </RequireRole>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="sales" element={<Sales />} />
            <Route path="stores" element={<Stores />} />
          </Route>

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AdminDataProvider>
    </BrowserRouter>
  )
}

export default App
