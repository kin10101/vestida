export type OrderType = 'ready_made' | 'made_to_order'
export type OrderStatus = 'pending' | 'in_progress' | 'ready' | 'released' | 'cancelled'
export type PaymentMethod = 'cash' | 'gcash' | 'bank_transfer'
export type PaymentKind = 'payment' | 'refund' | 'void_reversal'
export type SalesExceptionKind = 'void' | 'refund'
export type UnitStatus = 'in_stock' | 'sold' | 'in_transit'
export interface Store {
  id: string
  code: string
  name: string
  isActive: boolean
  isDeleted?: boolean
  createdAt: string
}

export interface Category {
  id: string
  name: string
  createdAt: string
}

export interface Product {
  id: string
  categoryId: string
  name: string
  description: string
  isActive: boolean
  // Product-level catalog definition (the "matrix"): a SKU prefix plus the
  // independent color and size lists. Every (color x size) combo becomes a
  // concrete product_variant row with SKU = [prefix]-[color3]-[size].
  skuPrefix: string
  colors: string[]
  sizes: string[]
  costPriceCents: number
  regularPriceCents: number
  createdAt: string
}

export interface ProductVariant {
  id: string
  productId: string
  color: string
  size: string
  sku: string
  regularPriceCents: number
  costPriceCents: number
  isActive: boolean
  createdAt: string
}

export interface InventoryUnit {
  id: string
  variantId: string
  unitCode: string
  storeId: string
  status: UnitStatus
  costPriceCents: number
  createdAt: string
}

export interface StockMovement {
  id: string
  unitId: string
  kind: 'received' | 'transferred_out' | 'transferred_in' | 'sold' | 'adjustment'
  storeId: string
  fromStoreId: string | null
  toStoreId: string | null
  staffName: string
  note: string
  reference: string
  createdAt: string
}

export interface StaffMember {
  id: string
  name: string
  title: string
  storeId: string
  isActive: boolean
  createdAt: string
}

export interface ConnectedDevice {
  id: string
  name: string
  lastActiveAt: string
}

export interface StoreAccess {
  storeId: string
  username: string
  password: string
  isEnabled: boolean
  passwordUpdatedAt: string | null
  devices: ConnectedDevice[]
}

export type AccountRole = 'admin' | 'staff'

/**
 * A login account = a Supabase Auth user (email/password) plus its linked
 * staff profile (display name, role, store). Email and password are managed
 * in Supabase Auth; the admin UI configures only the profile/access fields.
 */
export interface Account {
  authId: string
  email: string
  emailConfirmed: boolean
  createdAt: string
  staffId: string | null
  displayName: string
  role: AccountRole | '' // '' => Auth user exists but has no staff profile yet
  storeId: string | null
  isActive: boolean
}

export interface OrderLineItem {
  id: string
  orderId: string
  variantId: string | null
  description: string
  quantity: number
  agreedPriceCents: number
  unitId: string | null
}

export interface OrderRecord {
  id: string
  storeId: string
  customerName: string
  orderType: OrderType
  status: OrderStatus
  reference: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface PaymentRecord {
  id: string
  orderId: string
  amountCents: number
  method: PaymentMethod
  kind: PaymentKind
  receivedAt: string
  receivedBy: string
}

export interface SalesException {
  id: string
  orderId: string
  kind: SalesExceptionKind
  reason: string
  amountCents: number
  method: PaymentMethod | null
  processedBy: string
  createdAt: string
}

export interface VoidSaleDraft {
  orderId: string
  reason: string
  processedBy: string
}

export interface RefundDraft {
  orderId: string
  reason: string
  amountCents: number
  method: PaymentMethod
  processedBy: string
}

export interface AdminState {
  stores: Store[]
  categories: Category[]
  products: Product[]
  productVariants: ProductVariant[]
  inventoryUnits: InventoryUnit[]
  stockMovements: StockMovement[]
  staff: StaffMember[]
  storeAccess: StoreAccess[]
  orders: OrderRecord[]
  orderLines: OrderLineItem[]
  payments: PaymentRecord[]
  salesExceptions: SalesException[]
}

export interface OrderDraft {
  id?: string
  storeId: string
  customerName: string
  orderType: OrderType
  status: OrderStatus
  reference: string
  notes: string
  items: Array<{
    id?: string
    variantId?: string | null
    description: string
    quantity: number
    agreedPriceCents: number
    unitId?: string | null
  }>
}

export interface IntakeDraft {
  variantId: string
  storeId: string
  quantity: number
  costPriceCents: number
  staffName: string
}

export interface PaymentDraft {
  orderId: string
  amountCents: number
  method: PaymentMethod
  receivedAt: string
  receivedBy: string
}

export const ADMIN_STORAGE_KEY = 'vestida-admin-state-v1'

export function emptyAdminState(): AdminState {
  return {
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
}

export function loadAdminState(): AdminState {
  if (typeof window === 'undefined') {
    return emptyAdminState()
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY)
    if (!raw) {
      return emptyAdminState()
    }

    const parsed = JSON.parse(raw) as AdminState
    if (!parsed || !Array.isArray(parsed.stores)) {
      return emptyAdminState()
    }

    const validStatuses = new Set<UnitStatus>(['in_stock', 'sold', 'in_transit'])
    return {
      ...parsed,
      products: parsed.products.map((product) => {
        const legacyProduct = product as Product & { isTypicallyMto?: boolean }
        const { isTypicallyMto: _isTypicallyMto, ...currentProduct } = legacyProduct
        return currentProduct
      }),
      inventoryUnits: parsed.inventoryUnits.map((unit) => ({
        ...unit,
        status: validStatuses.has(unit.status) ? unit.status : 'in_stock',
      })),
      payments: (parsed.payments ?? []).map((payment) => {
        const legacyPayment = payment as Omit<PaymentRecord, 'method'> & { method: PaymentMethod | 'bank' | 'card'; kind?: PaymentKind }
        const method: PaymentMethod = legacyPayment.method === 'bank' || legacyPayment.method === 'card' ? 'bank_transfer' : legacyPayment.method
        return {
          ...legacyPayment,
          method,
          kind: legacyPayment.kind ?? 'payment',
        }
      }),
      stores: parsed.stores.map((store) => ({ ...store, isDeleted: store.isDeleted ?? false })),
      storeAccess: (parsed.storeAccess ?? []).map((record) => {
        const legacyRecord = record as StoreAccess & { state?: 'active' | 'paused' | 'reset_required'; lastResetAt?: string | null }
        return {
          storeId: legacyRecord.storeId,
          username: legacyRecord.username ?? '',
          password: legacyRecord.password ?? '',
          isEnabled: legacyRecord.isEnabled ?? legacyRecord.state !== 'paused',
          passwordUpdatedAt: legacyRecord.passwordUpdatedAt ?? legacyRecord.lastResetAt ?? null,
          devices: legacyRecord.devices ?? [],
        }
      }),
      salesExceptions: parsed.salesExceptions ?? [],
    }
  } catch {
    return emptyAdminState()
  }
}
