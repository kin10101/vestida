import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type {
  AdminState,
  Account,
  AccountRole,
  IntakeDraft,
  OrderDraft,
  OrderStatus,
  PaymentDraft,
  RefundDraft,
  VoidSaleDraft,
  Product,
  ProductVariant,
  StaffMember,
  Store,
  StoreAccess,
  UnitStatus,
} from './data'
import { apiRpc } from '../shared/api/client'
import { useAuth } from '../auth/AuthContext'

export interface AdminDataContextValue {
  state: AdminState
  setState: Dispatch<SetStateAction<AdminState>>
  loading: boolean
  error: string | null
  clearError: () => void
  reload: () => Promise<void>
  upsertCategory: (category: { id?: string; name: string; createdAt?: string }) => Promise<void>
  deleteCategory: (categoryId: string, force?: boolean) => Promise<boolean>
  upsertProduct: (product: Product) => Promise<void>
  toggleProductActive: (id: string) => Promise<void>
  bulkToggleProductActive: (ids: string[], isActive: boolean) => Promise<void>
  deleteProducts: (ids: string[], force?: boolean) => Promise<{ ok: boolean; reason?: string }>
  upsertVariant: (variant: ProductVariant) => Promise<void>
  toggleVariantActive: (id: string) => void
  upsertStore: (store: Store) => Promise<void>
  toggleStoreActive: (id: string) => Promise<void>
  deleteStore: (id: string, force: boolean) => Promise<boolean>
  upsertStaff: (member: StaffMember) => Promise<void>
  toggleStaffActive: (id: string) => Promise<void>
  deleteStaff: (id: string) => Promise<void>
  bulkToggleStaffActive: (ids: string[], isActive: boolean) => Promise<void>
  upsertStoreAccess: (record: StoreAccess) => void
  disconnectStoreDevice: (storeId: string, deviceId: string) => void
  listAccounts: () => Promise<Account[]>
  configureAccount: (input: {
    authId: string
    displayName: string
    role: AccountRole
    storeId: string | null
    isActive: boolean
  }) => Promise<boolean>
  applyIntake: (draft: IntakeDraft) => Promise<void>
  adjustInventoryUnit: (unitId: string, nextStatus: UnitStatus, note: string, staffName: string) => Promise<void>
  bulkAdjustInventoryUnits: (unitIds: string[], nextStatus: UnitStatus, note: string, staffName: string) => Promise<void>
  transferStock: (input: { fromStoreId: string; toStoreId: string; items: Array<{ variantId: string; quantity: number }>; note: string }) => Promise<void>
  upsertOrder: (draft: OrderDraft) => Promise<void>
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>
  addPayment: (draft: PaymentDraft) => Promise<void>
  voidSale: (draft: VoidSaleDraft) => Promise<void>
  refundSale: (draft: RefundDraft) => Promise<void>
}

const AdminDataContext = createContext<AdminDataContextValue | undefined>(undefined)

// The admin write RPCs expect real UUIDs. New rows are created by the DB (send
// p_id=null); only real UUIDs are treated as existing records to update.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value?: string) => !!value && UUID_RE.test(value)

const VALID_UNIT_STATUS = new Set<UnitStatus>(['in_stock', 'sold', 'in_transit'])

// Coerce the JSON from admin_get_state() into a well-formed AdminState, applying
// the same normalization the old localStorage loader used.
function normalizeState(raw: unknown): AdminState {
  const r = (raw ?? {}) as Partial<AdminState>
  const productVariants = Array.isArray(r.productVariants) ? r.productVariants : []
  const variantsByProduct = new Map<string, ProductVariant[]>()
  productVariants.forEach((variant) => {
    const productVariantsForProduct = variantsByProduct.get(variant.productId) ?? []
    productVariantsForProduct.push(variant)
    variantsByProduct.set(variant.productId, productVariantsForProduct)
  })

  return {
    stores: Array.isArray(r.stores) ? r.stores.map((store) => ({ ...store, isDeleted: (store as Store).isDeleted ?? false })) : [],
    categories: Array.isArray(r.categories) ? r.categories : [],
    products: Array.isArray(r.products)
      ? (r.products as Product[]).map((product) => ({
          ...product,
          skuPrefix: product.skuPrefix ?? '',
          // Older deployed admin_get_state functions omit product-level matrix
          // fields even though they still return the concrete variant rows.
          colors: product.colors?.length
            ? product.colors
            : [...new Set((variantsByProduct.get(product.id) ?? []).map((variant) => variant.color))],
          sizes: product.sizes?.length
            ? product.sizes
            : [...new Set((variantsByProduct.get(product.id) ?? []).map((variant) => variant.size))],
          costPriceCents: product.costPriceCents ?? 0,
          regularPriceCents: product.regularPriceCents ?? 0,
        }))
      : [],
    productVariants,
    inventoryUnits: Array.isArray(r.inventoryUnits)
      ? r.inventoryUnits.map((unit) => ({ ...unit, status: VALID_UNIT_STATUS.has(unit.status) ? unit.status : 'in_stock' }))
      : [],
    stockMovements: Array.isArray(r.stockMovements) ? r.stockMovements : [],
    staff: Array.isArray(r.staff) ? r.staff : [],
    storeAccess: Array.isArray(r.storeAccess) ? r.storeAccess : [],
    orders: Array.isArray(r.orders) ? r.orders : [],
    orderLines: Array.isArray(r.orderLines) ? r.orderLines : [],
    payments: Array.isArray(r.payments) ? r.payments.map((payment) => ({ ...payment, kind: payment.kind ?? 'payment' })) : [],
    salesExceptions: Array.isArray(r.salesExceptions) ? r.salesExceptions : [],
  }
}

const EMPTY_STATE: AdminState = {
  stores: [],
  categories: [],
  products: [],
  productVariants: [],
  inventoryUnits: [],
  stockMovements: [],
  staff: [],
  storeAccess: [],
  orders: [],
  orderLines: [],
  payments: [],
  salesExceptions: [],
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [state, setState] = useState<AdminState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const next = await apiRpc<unknown>('admin_get_state', {})
    setState(normalizeState(next))
  }

  // Hydrate the full admin dataset from Supabase. Exposed as `reload` so the UI
  // can retry after a failed initial load.
  const hydrate = async () => {
    setLoading(true)
    setError(null)
    let lastError: unknown

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const next = await apiRpc<unknown>('admin_get_state', {})
        setState(normalizeState(next))
        setLoading(false)
        return
      } catch (err) {
        lastError = err
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt))
        }
      }
    }

    console.error('[admin] failed to load state after retries', lastError)
    setError(lastError instanceof Error ? lastError.message : 'Failed to load admin data')
    setLoading(false)
  }

  // Wait for AuthProvider to settle before calling the admin-only RPC. The
  // provider is mounted on the login route too, where no admin session exists.
  useEffect(() => {
    if (authLoading) return
    if (user?.role !== 'admin') {
      setState(EMPTY_STATE)
      setError(null)
      setLoading(false)
      return
    }
    void hydrate()
    // hydrate is intentionally recreated with the provider render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.role])

  // Run an admin write RPC, then reload state so the database is the source of
  // truth. Returns false (and records an error) when the write fails.
  const persist = async (run: () => Promise<unknown>): Promise<boolean> => {
    try {
      await run()
      await refresh()
      return true
    } catch (err) {
      console.error('[admin] write failed', err)
      setError(err instanceof Error ? err.message : 'Admin update failed')
      return false
    }
  }

  const value = useMemo<AdminDataContextValue>(() => ({
    state,
    setState,
    loading,
    error,
    clearError: () => setError(null),
    reload: hydrate,
    upsertCategory: async ({ id, name }) => {
      await persist(() => apiRpc('admin_upsert_category', { p_id: isUuid(id) ? id : null, p_name: name }))
    },
    deleteCategory: async (categoryId, force = false) => {
      return persist(() => apiRpc('admin_delete_category', { p_id: categoryId, p_force: force ?? false }))
    },
    upsertProduct: async (product) => {
      await persist(() => apiRpc('admin_upsert_product', {
        p_id: isUuid(product.id) ? product.id : null,
        p_category_id: product.categoryId,
        p_name: product.name,
        p_description: product.description,
        p_is_active: product.isActive,
        p_sku_prefix: product.skuPrefix,
        p_colors: product.colors,
        p_sizes: product.sizes,
        p_cost_price_cents: product.costPriceCents,
        p_regular_price_cents: product.regularPriceCents,
      }))
    },
    toggleProductActive: async (id) => {
      const product = state.products.find((item) => item.id === id)
      await persist(() => apiRpc('admin_toggle_products_active', { p_ids: [id], p_is_active: !product?.isActive }))
    },
    deleteProducts: async (ids, force = false) => {
      try {
        const res = await apiRpc<{ deleted?: boolean; reason?: string; count?: number }>(
          'admin_delete_products',
          { p_ids: ids, p_force: force },
        )
        if (res && res.deleted) {
          await refresh()
          return { ok: true }
        }
        return { ok: false, reason: res?.reason ?? 'blocked' }
      } catch (err) {
        console.error('[admin] delete products failed', err)
        setError(err instanceof Error ? err.message : 'Product delete failed')
        return { ok: false, reason: 'error' }
      }
    },
    bulkToggleProductActive: async (ids, isActive) => {
      await persist(() => apiRpc('admin_toggle_products_active', { p_ids: ids, p_is_active: isActive }))
    },
    upsertVariant: async (variant) => {
      await persist(() => apiRpc('admin_upsert_variant', {
        p_id: isUuid(variant.id) ? variant.id : null,
        p_product_id: variant.productId,
        p_color: variant.color,
        p_size: variant.size,
        p_sku: variant.sku,
        p_regular_price_cents: variant.regularPriceCents,
      }))
    },
    toggleVariantActive: (id) => {
      // product_variant has no is_active column in the DB (schema gap) — UI-only toggle.
      setState((previous) => ({
        ...previous,
        productVariants: previous.productVariants.map((item) =>
          item.id === id ? { ...item, isActive: !item.isActive } : item,
        ),
      }))
    },
    upsertStore: async (store) => {
      await persist(() => apiRpc('admin_upsert_store', {
        p_id: isUuid(store.id) ? store.id : null,
        p_name: store.name,
        p_code: store.code,
        p_is_active: store.isActive,
      }))
    },
    toggleStoreActive: async (id) => {
      const store = state.stores.find((item) => item.id === id)
      if (!store) return
      await persist(() => apiRpc('admin_upsert_store', {
        p_id: store.id,
        p_name: store.name,
        p_code: store.code,
        p_is_active: !store.isActive,
      }))
    },
    deleteStore: async (id, force) => {
      const store = state.stores.find((item) => item.id === id)
      const hasOperationalRecords = state.staff.some((item) => item.storeId === id)
        || state.inventoryUnits.some((item) => item.storeId === id && item.status !== 'sold')
        || state.storeAccess.some((item) => item.storeId === id)

      if (!store || store.isActive || (!force && hasOperationalRecords)) {
        return false
      }

      return persist(() => apiRpc('admin_delete_store', { p_id: id, p_force: force ?? false }))
    },
    upsertStaff: async (member) => {
      await persist(() => apiRpc('admin_upsert_staff', {
        p_id: isUuid(member.id) ? member.id : null,
        p_name: member.name,
        p_store_id: member.storeId,
        p_is_active: member.isActive,
      }))
    },
    toggleStaffActive: async (id) => {
      const member = state.staff.find((item) => item.id === id)
      if (!member) return
      await persist(() => apiRpc('admin_toggle_staff_active', { p_ids: [id], p_is_active: !member.isActive }))
    },
    deleteStaff: async (id) => {
      await persist(() => apiRpc('admin_delete_staff', { p_id: id }))
    },
    bulkToggleStaffActive: async (ids, isActive) => {
      await persist(() => apiRpc('admin_toggle_staff_active', { p_ids: ids, p_is_active: isActive }))
    },
    upsertStoreAccess: (record) => {
      // No store_access table in the DB (schema gap) — kept local-only.
      setState((previous) => {
        const existing = previous.storeAccess.find((item) => item.storeId === record.storeId)
        const nextRecord: StoreAccess = {
          ...record,
          username: record.username.trim(),
          password: record.password || existing?.password || '',
          passwordUpdatedAt: record.password ? new Date().toISOString() : existing?.passwordUpdatedAt ?? null,
          devices: existing?.devices ?? record.devices,
        }

        return {
          ...previous,
          storeAccess: existing
            ? previous.storeAccess.map((item) => (item.storeId === record.storeId ? nextRecord : item))
            : [...previous.storeAccess, nextRecord],
        }
      })
    },
    disconnectStoreDevice: (storeId, deviceId) => {
      setState((previous) => ({
        ...previous,
        storeAccess: previous.storeAccess.map((item) =>
          item.storeId === storeId
            ? { ...item, devices: item.devices.filter((device) => device.id !== deviceId) }
            : item,
        ),
      }))
    },
    listAccounts: async () => {
      const data = await apiRpc<{ accounts: Account[] }>('admin_list_accounts', {})
      return data?.accounts ?? []
    },
    configureAccount: async (input) => {
      return persist(() => apiRpc('admin_configure_account', {
        p_auth_id: input.authId,
        p_name: input.displayName,
        p_role: input.role,
        p_store_id: input.role === 'admin' ? null : input.storeId,
        p_is_active: input.isActive,
      }))
    },
    applyIntake: async (draft) => {
      await persist(() => apiRpc('admin_apply_intake', {
        p_variant_id: draft.variantId,
        p_store_id: draft.storeId,
        p_quantity: Math.max(1, Number.isFinite(draft.quantity) ? Math.round(draft.quantity) : 1),
        p_cost_price_cents: draft.costPriceCents,
        p_note: draft.staffName || null,
      }))
    },
    adjustInventoryUnit: async (unitId, nextStatus, note, _staffName) => {
      await persist(() => apiRpc('admin_adjust_units', { p_unit_ids: [unitId], p_next_status: nextStatus, p_note: note || null }))
    },
    bulkAdjustInventoryUnits: async (unitIds, nextStatus, note, _staffName) => {
      await persist(() => apiRpc('admin_adjust_units', { p_unit_ids: unitIds, p_next_status: nextStatus, p_note: note || null }))
    },
    transferStock: async ({ fromStoreId, toStoreId, items, note }) => {
      await persist(() => apiRpc('admin_transfer_stock', {
        p_from_store_id: fromStoreId,
        p_to_store_id: toStoreId,
        p_items: items.map((item) => ({ variant_id: item.variantId, quantity: item.quantity })),
        p_note: note || null,
      }))
    },
    upsertOrder: async (draft) => {
      await persist(() => apiRpc('admin_upsert_order', {
        p_draft: {
          id: draft.id ?? null,
          storeId: draft.storeId,
          customerName: draft.customerName,
          orderType: draft.orderType,
          status: draft.status,
          reference: draft.reference,
          notes: draft.notes,
          items: draft.items.map((item) => ({
            variantId: item.variantId ?? null,
            description: item.description,
            quantity: item.quantity,
            agreedPriceCents: item.agreedPriceCents,
            unitId: item.unitId ?? null,
          })),
        },
      }))
    },
    updateOrderStatus: async (orderId, status) => {
      await persist(() => apiRpc('admin_update_order_status', { p_order_id: orderId, p_status: status }))
    },
    addPayment: async (draft) => {
      await persist(() => apiRpc('admin_add_payment', {
        p_order_id: draft.orderId,
        p_amount_cents: draft.amountCents,
        p_method: draft.method,
        p_received_by: null,
        p_note: null,
      }))
    },
    voidSale: async (draft) => {
      await persist(() => apiRpc('admin_void_sale', { p_order_id: draft.orderId, p_reason: draft.reason }))
    },
    refundSale: async (draft) => {
      await persist(() => apiRpc('admin_refund_sale', {
        p_order_id: draft.orderId,
        p_amount_cents: draft.amountCents,
        p_method: draft.method,
        p_reason: draft.reason,
      }))
    },
  }), [state, loading, error])

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>
}

export function useAdminData() {
  const context = useContext(AdminDataContext)
  if (!context) {
    throw new Error('useAdminData must be used within an AdminDataProvider')
  }

  return context
}
