export type OrderType = 'ready_made' | 'made_to_order'
export type OrderStatus = 'pending' | 'in_progress' | 'ready' | 'released' | 'cancelled'
export type PaymentMethod = 'cash' | 'gcash' | 'bank' | 'card'
export type UnitStatus = 'in_stock' | 'reserved' | 'sold' | 'damaged' | 'returned' | 'in_transit'
export type StoreAccessState = 'active' | 'paused' | 'reset_required'

export interface Store {
  id: string
  code: string
  name: string
  address: string
  isActive: boolean
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
  isTypicallyMto: boolean
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
  sourceNote: string
  acquiredAt: string
  createdAt: string
}

export interface StockMovement {
  id: string
  unitId: string
  kind: 'received' | 'adjustment' | 'sale' | 'transfer' | 'return'
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
  canCareOf: boolean
  createdAt: string
}

export interface StoreAccess {
  storeId: string
  state: StoreAccessState
  lastResetAt: string | null
  note: string
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
  receivedAt: string
  receivedBy: string
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
  sourceNote: string
  acquiredAt: string
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString()

export function createSeedState(): AdminState {
  const stores: Store[] = [
    { id: 'store-makati', code: 'MK', name: 'Makati', address: 'Greenbelt 5, Makati', isActive: true, createdAt: day(-420) },
    { id: 'store-bgc', code: 'BG', name: 'Bonifacio Global City', address: '5th Avenue, BGC', isActive: true, createdAt: day(-430) },
    { id: 'store-quezon', code: 'QZ', name: 'Quezon City', address: 'Katipunan Ave, Quezon City', isActive: true, createdAt: day(-380) },
    { id: 'store-cebu', code: 'CB', name: 'Cebu', address: 'Ayala Center Cebu', isActive: true, createdAt: day(-350) },
    { id: 'store-davao', code: 'DV', name: 'Davao', address: 'Abreeza Mall, Davao', isActive: true, createdAt: day(-300) },
  ]

  const categories: Category[] = [
    { id: 'cat-ready', name: 'Ready to Wear', createdAt: day(-500) },
    { id: 'cat-occasion', name: 'Occasion', createdAt: day(-440) },
    { id: 'cat-accessories', name: 'Accessories', createdAt: day(-360) },
    { id: 'cat-bridal', name: 'Bridal', createdAt: day(-320) },
  ]

  const products: Product[] = [
    { id: 'prod-luna', categoryId: 'cat-ready', name: 'Luna Blouse', description: 'Soft ivory blouse with a draped neckline and column cut.', isActive: true, isTypicallyMto: false, createdAt: day(-260) },
    { id: 'prod-avery', categoryId: 'cat-ready', name: 'Avery Wrap Top', description: 'A flattering wrap silhouette for day-to-evening styling.', isActive: true, isTypicallyMto: false, createdAt: day(-240) },
    { id: 'prod-helio', categoryId: 'cat-occasion', name: 'Helio Dress', description: 'A pleated satin dress with a structured waistline.', isActive: true, isTypicallyMto: true, createdAt: day(-210) },
    { id: 'prod-vienna', categoryId: 'cat-bridal', name: 'Vienna Bridal Set', description: 'Minimal bridal set with a long line skirt and sculpted top.', isActive: true, isTypicallyMto: true, createdAt: day(-190) },
    { id: 'prod-mila', categoryId: 'cat-accessories', name: 'Mila Clutch', description: 'Structured clutch in matte leather with soft gold clasp.', isActive: true, isTypicallyMto: false, createdAt: day(-150) },
  ]

  const productVariants: ProductVariant[] = [
    { id: 'var-luna-ivory-s', productId: 'prod-luna', color: 'Ivory', size: 'S', sku: 'LUNA-IV-S', regularPriceCents: 220000, costPriceCents: 138000, isActive: true, createdAt: day(-260) },
    { id: 'var-luna-ivory-m', productId: 'prod-luna', color: 'Ivory', size: 'M', sku: 'LUNA-IV-M', regularPriceCents: 220000, costPriceCents: 138000, isActive: true, createdAt: day(-250) },
    { id: 'var-avery-rose-s', productId: 'prod-avery', color: 'Rose', size: 'S', sku: 'AVRY-RO-S', regularPriceCents: 245000, costPriceCents: 152000, isActive: true, createdAt: day(-220) },
    { id: 'var-avery-rose-m', productId: 'prod-avery', color: 'Rose', size: 'M', sku: 'AVRY-RO-M', regularPriceCents: 245000, costPriceCents: 152000, isActive: true, createdAt: day(-220) },
    { id: 'var-helio-midnight-6', productId: 'prod-helio', color: 'Midnight', size: '6', sku: 'HELIO-NV-6', regularPriceCents: 395000, costPriceCents: 234000, isActive: true, createdAt: day(-200) },
    { id: 'var-helio-midnight-8', productId: 'prod-helio', color: 'Midnight', size: '8', sku: 'HELIO-NV-8', regularPriceCents: 395000, costPriceCents: 234000, isActive: true, createdAt: day(-198) },
    { id: 'var-vienna-ivory-8', productId: 'prod-vienna', color: 'Ivory', size: '8', sku: 'VIEN-IR-8', regularPriceCents: 580000, costPriceCents: 348000, isActive: true, createdAt: day(-170) },
    { id: 'var-vienna-ivory-10', productId: 'prod-vienna', color: 'Ivory', size: '10', sku: 'VIEN-IR-10', regularPriceCents: 580000, costPriceCents: 348000, isActive: true, createdAt: day(-170) },
    { id: 'var-mila-sand-tote', productId: 'prod-mila', color: 'Sand', size: 'One Size', sku: 'MILA-SD-OS', regularPriceCents: 180000, costPriceCents: 108000, isActive: true, createdAt: day(-120) },
  ]

  const inventoryUnits: InventoryUnit[] = [
    { id: 'unit-001', variantId: 'var-luna-ivory-s', unitCode: 'UV-1001', storeId: 'store-makati', status: 'in_stock', costPriceCents: 138000, sourceNote: 'Initial intake', acquiredAt: day(-22), createdAt: day(-22) },
    { id: 'unit-002', variantId: 'var-luna-ivory-m', unitCode: 'UV-1002', storeId: 'store-bgc', status: 'in_stock', costPriceCents: 138000, sourceNote: 'Initial intake', acquiredAt: day(-18), createdAt: day(-18) },
    { id: 'unit-003', variantId: 'var-luna-ivory-s', unitCode: 'UV-1003', storeId: 'store-makati', status: 'reserved', costPriceCents: 138000, sourceNote: 'Hold for customer', acquiredAt: day(-15), createdAt: day(-15) },
    { id: 'unit-004', variantId: 'var-avery-rose-m', unitCode: 'UV-1004', storeId: 'store-quezon', status: 'in_stock', costPriceCents: 152000, sourceNote: 'Initial intake', acquiredAt: day(-30), createdAt: day(-30) },
    { id: 'unit-005', variantId: 'var-helio-midnight-8', unitCode: 'UV-1005', storeId: 'store-bgc', status: 'in_stock', costPriceCents: 234000, sourceNote: 'Mall delivery', acquiredAt: day(-12), createdAt: day(-12) },
    { id: 'unit-006', variantId: 'var-helio-midnight-6', unitCode: 'UV-1006', storeId: 'store-cebu', status: 'in_transit', costPriceCents: 234000, sourceNote: 'Transfer to boutique', acquiredAt: day(-9), createdAt: day(-9) },
    { id: 'unit-007', variantId: 'var-vienna-ivory-10', unitCode: 'UV-1007', storeId: 'store-makati', status: 'damaged', costPriceCents: 348000, sourceNote: 'Packaging issue', acquiredAt: day(-42), createdAt: day(-42) },
    { id: 'unit-008', variantId: 'var-vienna-ivory-8', unitCode: 'UV-1008', storeId: 'store-davao', status: 'in_stock', costPriceCents: 348000, sourceNote: 'Initial intake', acquiredAt: day(-26), createdAt: day(-26) },
    { id: 'unit-009', variantId: 'var-mila-sand-tote', unitCode: 'UV-1009', storeId: 'store-bgc', status: 'sold', costPriceCents: 108000, sourceNote: 'Sold in branch', acquiredAt: day(-6), createdAt: day(-6) },
    { id: 'unit-010', variantId: 'var-mila-sand-tote', unitCode: 'UV-1010', storeId: 'store-quezon', status: 'in_stock', costPriceCents: 108000, sourceNote: 'Initial intake', acquiredAt: day(-7), createdAt: day(-7) },
    { id: 'unit-011', variantId: 'var-avery-rose-s', unitCode: 'UV-1011', storeId: 'store-bgc', status: 'returned', costPriceCents: 152000, sourceNote: 'Customer return', acquiredAt: day(-11), createdAt: day(-11) },
    { id: 'unit-012', variantId: 'var-helio-midnight-8', unitCode: 'UV-1012', storeId: 'store-davao', status: 'in_stock', costPriceCents: 234000, sourceNote: 'Initial intake', acquiredAt: day(-3), createdAt: day(-3) },
  ]

  const stockMovements: StockMovement[] = [
    { id: 'mv-001', unitId: 'unit-001', kind: 'received', storeId: 'store-makati', fromStoreId: null, toStoreId: null, staffName: 'Mia', note: 'New shipment received', reference: 'PO-1201', createdAt: day(-22) },
    { id: 'mv-002', unitId: 'unit-005', kind: 'transfer', storeId: 'store-bgc', fromStoreId: 'store-cebu', toStoreId: 'store-bgc', staffName: 'Pia', note: 'Transferred from Cebu', reference: 'TR-204', createdAt: day(-10) },
    { id: 'mv-003', unitId: 'unit-006', kind: 'adjustment', storeId: 'store-cebu', fromStoreId: 'store-cebu', toStoreId: 'store-cebu', staffName: 'Ari', note: 'Marked in transit', reference: 'ADJ-903', createdAt: day(-9) },
    { id: 'mv-004', unitId: 'unit-007', kind: 'adjustment', storeId: 'store-makati', fromStoreId: 'store-makati', toStoreId: 'store-makati', staffName: 'Nina', note: 'Damaged goods flagged', reference: 'ADJ-960', createdAt: day(-42) },
    { id: 'mv-005', unitId: 'unit-009', kind: 'sale', storeId: 'store-bgc', fromStoreId: 'store-bgc', toStoreId: null, staffName: 'Joan', note: 'Sold to customer', reference: 'ORD-10016', createdAt: day(-5) },
    { id: 'mv-006', unitId: 'unit-011', kind: 'return', storeId: 'store-bgc', fromStoreId: 'store-bgc', toStoreId: null, staffName: 'Rosa', note: 'Return logged', reference: 'RET-911', createdAt: day(-11) },
    { id: 'mv-007', unitId: 'unit-012', kind: 'received', storeId: 'store-davao', fromStoreId: null, toStoreId: null, staffName: 'Elle', note: 'Fresh seasonal restock', reference: 'PO-3322', createdAt: day(-3) },
  ]

  const staff: StaffMember[] = [
    { id: 'staff-1', name: 'Mia Cruz', title: 'Store lead', storeId: 'store-makati', isActive: true, canCareOf: true, createdAt: day(-330) },
    { id: 'staff-2', name: 'Joan Santos', title: 'Sales associate', storeId: 'store-bgc', isActive: true, canCareOf: true, createdAt: day(-300) },
    { id: 'staff-3', name: 'Pia Ramos', title: 'Merchandise specialist', storeId: 'store-quezon', isActive: true, canCareOf: false, createdAt: day(-270) },
    { id: 'staff-4', name: 'Ari Tan', title: 'Inventory clerk', storeId: 'store-cebu', isActive: true, canCareOf: false, createdAt: day(-250) },
    { id: 'staff-5', name: 'Nina Reyes', title: 'Senior stylist', storeId: 'store-davao', isActive: true, canCareOf: true, createdAt: day(-220) },
  ]

  const storeAccess: StoreAccess[] = [
    { storeId: 'store-makati', state: 'active', lastResetAt: day(-14), note: 'Shared access operating normally' },
    { storeId: 'store-bgc', state: 'active', lastResetAt: day(-9), note: 'Shared access operating normally' },
    { storeId: 'store-quezon', state: 'paused', lastResetAt: day(-18), note: 'Temporary lock after failed sign in prompt' },
    { storeId: 'store-cebu', state: 'reset_required', lastResetAt: day(-32), note: 'Access reset due to old session token' },
    { storeId: 'store-davao', state: 'active', lastResetAt: day(-11), note: 'Access active and synced' },
  ]

  const orders: OrderRecord[] = [
    { id: 'order-1041', storeId: 'store-makati', customerName: 'Alicia Santos', orderType: 'ready_made', status: 'released', reference: 'V-1041', notes: 'Pickup scheduled for Saturday.', createdAt: day(0), updatedAt: day(0) },
    { id: 'order-1042', storeId: 'store-bgc', customerName: 'Elijah Cruz', orderType: 'made_to_order', status: 'in_progress', reference: 'V-1042', notes: 'Custom fitting on Friday.', createdAt: day(-6), updatedAt: day(-2) },
    { id: 'order-1043', storeId: 'store-quezon', customerName: 'Kyla Ramos', orderType: 'ready_made', status: 'ready', reference: 'V-1043', notes: 'Gift wrapped and ready.', createdAt: day(-2), updatedAt: day(-1) },
    { id: 'order-1044', storeId: 'store-cebu', customerName: 'Noah Reyes', orderType: 'ready_made', status: 'pending', reference: 'V-1044', notes: 'Waiting for final size confirmation.', createdAt: day(-10), updatedAt: day(-10) },
    { id: 'order-1045', storeId: 'store-davao', customerName: 'Mira Dela Cruz', orderType: 'made_to_order', status: 'released', reference: 'V-1045', notes: 'Delivered to home address.', createdAt: day(-20), updatedAt: day(-18) },
  ]

  const orderLines: OrderLineItem[] = [
    { id: 'line-1', orderId: 'order-1041', variantId: 'var-luna-ivory-m', description: 'Luna Blouse Ivory M', quantity: 1, agreedPriceCents: 220000, unitId: 'unit-002' },
    { id: 'line-2', orderId: 'order-1042', variantId: 'var-helio-midnight-8', description: 'Helio Dress Midnight 8', quantity: 1, agreedPriceCents: 395000, unitId: null },
    { id: 'line-3', orderId: 'order-1042', variantId: null, description: 'Custom lining and hem adjustment', quantity: 1, agreedPriceCents: 120000, unitId: null },
    { id: 'line-4', orderId: 'order-1043', variantId: 'var-mila-sand-tote', description: 'Mila Clutch Sand One Size', quantity: 1, agreedPriceCents: 180000, unitId: 'unit-010' },
    { id: 'line-5', orderId: 'order-1044', variantId: 'var-avery-rose-s', description: 'Avery Wrap Top Rose S', quantity: 1, agreedPriceCents: 245000, unitId: null },
    { id: 'line-6', orderId: 'order-1045', variantId: 'var-vienna-ivory-8', description: 'Vienna Bridal Set Ivory 8', quantity: 1, agreedPriceCents: 580000, unitId: 'unit-008' },
  ]

  const payments: PaymentRecord[] = [
    { id: 'pay-1', orderId: 'order-1041', amountCents: 220000, method: 'cash', receivedAt: day(-1), receivedBy: 'Mia' },
    { id: 'pay-2', orderId: 'order-1042', amountCents: 180000, method: 'gcash', receivedAt: day(-2), receivedBy: 'Joan' },
    { id: 'pay-3', orderId: 'order-1043', amountCents: 180000, method: 'card', receivedAt: day(-1), receivedBy: 'Pia' },
    { id: 'pay-4', orderId: 'order-1045', amountCents: 580000, method: 'bank', receivedAt: day(-18), receivedBy: 'Nina' },
  ]

  return {
    stores,
    categories,
    products,
    productVariants,
    inventoryUnits,
    stockMovements,
    staff,
    storeAccess,
    orders,
    orderLines,
    payments,
  }
}

export function loadAdminState(): AdminState {
  if (typeof window === 'undefined') {
    return createSeedState()
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY)
    if (!raw) {
      return createSeedState()
    }

    const parsed = JSON.parse(raw) as AdminState
    if (!parsed || !Array.isArray(parsed.stores)) {
      return createSeedState()
    }

    return parsed
  } catch {
    return createSeedState()
  }
}
