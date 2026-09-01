import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  ADMIN_STORAGE_KEY,
  type AdminState,
  type Category,
  type IntakeDraft,
  type OrderDraft,
  type OrderStatus,
  type PaymentDraft,
  type RefundDraft,
  type VoidSaleDraft,
  type Product,
  type ProductVariant,
  type StaffMember,
  type Store,
  type StoreAccess,
  type UnitStatus,
  loadAdminState,
} from './data'

export interface AdminDataContextValue {
  state: AdminState
  setState: Dispatch<SetStateAction<AdminState>>
  upsertCategory: (category: { id?: string; name: string; createdAt?: string }) => void
  deleteCategory: (categoryId: string, force?: boolean) => boolean
  upsertProduct: (product: Product) => void
  toggleProductActive: (id: string) => void
  bulkToggleProductActive: (ids: string[], isActive: boolean) => void
  upsertVariant: (variant: ProductVariant) => void
  toggleVariantActive: (id: string) => void
  upsertStore: (store: Store) => void
  toggleStoreActive: (id: string) => void
  deleteStore: (id: string, force: boolean) => boolean
  upsertStaff: (member: StaffMember) => void
  toggleStaffActive: (id: string) => void
  deleteStaff: (id: string) => void
  bulkToggleStaffActive: (ids: string[], isActive: boolean) => void
  upsertStoreAccess: (record: StoreAccess) => void
  disconnectStoreDevice: (storeId: string, deviceId: string) => void
  applyIntake: (draft: IntakeDraft) => void
  adjustInventoryUnit: (unitId: string, nextStatus: UnitStatus, note: string, staffName: string) => void
  bulkAdjustInventoryUnits: (unitIds: string[], nextStatus: UnitStatus, note: string, staffName: string) => void
  upsertOrder: (draft: OrderDraft) => void
  updateOrderStatus: (orderId: string, status: OrderStatus) => void
  addPayment: (draft: PaymentDraft) => void
  voidSale: (draft: VoidSaleDraft) => void
  refundSale: (draft: RefundDraft) => void
}

const AdminDataContext = createContext<AdminDataContextValue | undefined>(undefined)

const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminState>(() => loadAdminState())

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(state))
    }
  }, [state])

  const value = useMemo<AdminDataContextValue>(() => ({
    state,
    setState,
    upsertCategory: (category) => {
      setState((previous) => {
        const trimmed = category.name.trim()
        if (!trimmed) {
          return previous
        }

        const existing = previous.categories.find((item) => item.id === category.id)
        const nextCategory: Category = {
          id: category.id ?? existing?.id ?? makeId('cat'),
          name: trimmed,
          createdAt: category.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
        }

        return {
          ...previous,
          categories: existing
            ? previous.categories.map((item) => (item.id === existing.id ? nextCategory : item))
            : [...previous.categories, nextCategory],
        }
      })
    },
    deleteCategory: (categoryId, force = false) => {
      const category = state.categories.find((item) => item.id === categoryId)
      const productIds = state.products
        .filter((product) => product.categoryId === categoryId)
        .map((product) => product.id)

      if (!category || (productIds.length > 0 && !force)) {
        return false
      }

      setState((previous) => {
        const productIdSet = new Set(productIds)
        const variantIdSet = new Set(
          previous.productVariants
            .filter((variant) => productIdSet.has(variant.productId))
            .map((variant) => variant.id),
        )
        const unitIdSet = new Set(
          previous.inventoryUnits
            .filter((unit) => variantIdSet.has(unit.variantId))
            .map((unit) => unit.id),
        )

        return {
          ...previous,
          categories: previous.categories.filter((item) => item.id !== categoryId),
          products: previous.products.filter((product) => !productIdSet.has(product.id)),
          productVariants: previous.productVariants.filter((variant) => !variantIdSet.has(variant.id)),
          inventoryUnits: previous.inventoryUnits.filter((unit) => !unitIdSet.has(unit.id)),
          stockMovements: previous.stockMovements.filter((movement) => !unitIdSet.has(movement.unitId)),
        }
      })

      return true
    },
    upsertProduct: (product) => {
      setState((previous) => {
        const trimmedName = product.name.trim()
        const nextProduct: Product = {
          ...product,
          name: trimmedName,
          description: product.description.trim(),
          categoryId: product.categoryId,
        }

        const exists = previous.products.some((item) => item.id === product.id)
        if (!trimmedName) {
          return previous
        }

        return {
          ...previous,
          products: exists
            ? previous.products.map((item) => (item.id === product.id ? nextProduct : item))
            : [...previous.products, nextProduct],
        }
      })
    },
    toggleProductActive: (id) => {
      setState((previous) => ({
        ...previous,
        products: previous.products.map((item) =>
          item.id === id ? { ...item, isActive: !item.isActive } : item,
        ),
      }))
    },
    bulkToggleProductActive: (ids, isActive) => {
      const selected = new Set(ids)
      if (selected.size === 0) {
        return
      }

      setState((previous) => ({
        ...previous,
        products: previous.products.map((item) =>
          selected.has(item.id) ? { ...item, isActive } : item,
        ),
      }))
    },
    upsertVariant: (variant) => {
      setState((previous) => {
        const trimmedColor = variant.color.trim()
        const trimmedSize = variant.size.trim()
        const trimmedSku = variant.sku.trim()
        if (!trimmedColor || !trimmedSize || !trimmedSku) {
          return previous
        }

        const existing = previous.productVariants.find((item) => item.id === variant.id)
        const nextVariant: ProductVariant = {
          ...variant,
          color: trimmedColor,
          size: trimmedSize,
          sku: trimmedSku,
          createdAt: variant.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
        }

        return {
          ...previous,
          productVariants: existing
            ? previous.productVariants.map((item) => (item.id === variant.id ? nextVariant : item))
            : [...previous.productVariants, nextVariant],
        }
      })
    },
    toggleVariantActive: (id) => {
      setState((previous) => ({
        ...previous,
        productVariants: previous.productVariants.map((item) =>
          item.id === id ? { ...item, isActive: !item.isActive } : item,
        ),
      }))
    },
    upsertStore: (store) => {
      setState((previous) => {
        const name = store.name.trim()
        const code = store.code.trim()
        if (!name || !code) {
          return previous
        }

        const existing = previous.stores.find((item) => item.id === store.id)
        const nextStore: Store = {
          ...store,
          name,
          code,
          createdAt: store.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
        }

        return {
          ...previous,
          stores: existing
            ? previous.stores.map((item) => (item.id === store.id ? nextStore : item))
            : [...previous.stores, nextStore],
        }
      })
    },
    toggleStoreActive: (id) => {
      setState((previous) => ({
        ...previous,
        stores: previous.stores.map((item) =>
          item.id === id ? { ...item, isActive: !item.isActive } : item,
        ),
      }))
    },
    deleteStore: (id, force) => {
      const store = state.stores.find((item) => item.id === id)
      const hasOperationalRecords = state.staff.some((item) => item.storeId === id)
        || state.inventoryUnits.some((item) => item.storeId === id && item.status !== 'sold')
        || state.storeAccess.some((item) => item.storeId === id)

      if (!store || store.isActive || (!force && hasOperationalRecords)) {
        return false
      }

      setState((previous) => ({
        ...previous,
        stores: previous.stores.map((item) => item.id === id ? { ...item, isActive: false, isDeleted: true } : item),
        staff: previous.staff.filter((item) => item.storeId !== id),
        inventoryUnits: previous.inventoryUnits.filter((item) => item.storeId !== id || item.status === 'sold'),
        storeAccess: previous.storeAccess.filter((item) => item.storeId !== id),
      }))
      return true
    },
    upsertStaff: (member) => {
      setState((previous) => {
        const name = member.name.trim()
        const title = member.title.trim()
        if (!name || !title) {
          return previous
        }

        const existing = previous.staff.find((item) => item.id === member.id)
        const nextMember: StaffMember = {
          ...member,
          name,
          title,
          createdAt: member.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
        }

        return {
          ...previous,
          staff: existing
            ? previous.staff.map((item) => (item.id === member.id ? nextMember : item))
            : [...previous.staff, nextMember],
        }
      })
    },
    toggleStaffActive: (id) => {
      setState((previous) => ({
        ...previous,
        staff: previous.staff.map((item) =>
          item.id === id ? { ...item, isActive: !item.isActive } : item,
        ),
      }))
    },
    deleteStaff: (id) => {
      setState((previous) => ({
        ...previous,
        staff: previous.staff.filter((item) => item.id !== id || item.isActive),
      }))
    },
    bulkToggleStaffActive: (ids, isActive) => {
      const selected = new Set(ids)
      if (selected.size === 0) {
        return
      }

      setState((previous) => ({
        ...previous,
        staff: previous.staff.map((item) =>
          selected.has(item.id) ? { ...item, isActive } : item,
        ),
      }))
    },
    upsertStoreAccess: (record) => {
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
    applyIntake: (draft) => {
      setState((previous) => {
        const quantity = Math.max(1, Number.isFinite(draft.quantity) ? Math.round(draft.quantity) : 1)
        const createdAt = new Date().toISOString()
        const newUnits = Array.from({ length: quantity }, () => ({
          id: makeId('unit'),
          variantId: draft.variantId,
          unitCode: `UV-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          storeId: draft.storeId,
          status: 'in_stock' as const,
          costPriceCents: draft.costPriceCents,
          createdAt,
        }))

        const newMovements = newUnits.map((unit, index) => ({
          id: makeId('mv'),
          unitId: unit.id,
          kind: 'received' as const,
          storeId: draft.storeId,
          fromStoreId: null,
          toStoreId: null,
          staffName: draft.staffName || 'Admin',
          note: index === 0 ? 'Stock received' : 'Additional stock received',
          reference: `INT-${Date.now().toString().slice(-6)}`,
          createdAt,
        }))

        return {
          ...previous,
          inventoryUnits: [...previous.inventoryUnits, ...newUnits],
          stockMovements: [...previous.stockMovements, ...newMovements],
        }
      })
    },
    adjustInventoryUnit: (unitId, nextStatus, note, staffName) => {
      setState((previous) => {
        let updated = false

        const nextInventory = previous.inventoryUnits.map((unit) => {
          if (unit.id !== unitId) {
            return unit
          }
          updated = true
          return { ...unit, status: nextStatus }
        })

        if (!updated) {
          return previous
        }

        const unit = previous.inventoryUnits.find((item) => item.id === unitId)
        const movement = unit
          ? {
              id: makeId('mv'),
              unitId,
              kind: 'adjustment' as const,
              storeId: unit.storeId,
              fromStoreId: unit.storeId,
              toStoreId: unit.storeId,
              staffName: staffName || 'Admin',
              note: note.trim() || 'Manual adjustment',
              reference: `ADJ-${Date.now().toString().slice(-6)}`,
              createdAt: new Date().toISOString(),
            }
          : null

        return {
          ...previous,
          inventoryUnits: nextInventory,
          stockMovements: movement ? [...previous.stockMovements, movement] : previous.stockMovements,
        }
      })
    },
    bulkAdjustInventoryUnits: (unitIds, nextStatus, note, staffName) => {
      setState((previous) => {
        const selected = new Set(unitIds)
        if (selected.size === 0) {
          return previous
        }

        const nextInventory = previous.inventoryUnits.map((unit) =>
          selected.has(unit.id) ? { ...unit, status: nextStatus } : unit,
        )

        const movements = previous.inventoryUnits
          .filter((unit) => selected.has(unit.id))
          .map((unit) => ({
            id: makeId('mv'),
            unitId: unit.id,
            kind: 'adjustment' as const,
            storeId: unit.storeId,
            fromStoreId: unit.storeId,
            toStoreId: unit.storeId,
            staffName: staffName || 'Admin',
            note: note.trim() || 'Bulk adjustment',
            reference: `ADJ-${Date.now().toString().slice(-6)}`,
            createdAt: new Date().toISOString(),
          }))

        return {
          ...previous,
          inventoryUnits: nextInventory,
          stockMovements: [...previous.stockMovements, ...movements],
        }
      })
    },
    upsertOrder: (draft) => {
      setState((previous) => {
        const nextOrderId = draft.id ?? makeId('order')
        const currentOrder = previous.orders.find((item) => item.id === nextOrderId)
        const items = draft.items
          .filter((item) => item.description.trim())
          .map((item) => ({
            id: item.id ?? makeId('line'),
            orderId: nextOrderId,
            variantId: item.variantId ?? null,
            description: item.description.trim(),
            quantity: Math.max(1, Math.round(item.quantity || 1)),
            agreedPriceCents: Math.max(0, Math.round(item.agreedPriceCents || 0)),
            unitId: item.unitId ?? null,
          }))

        if (!draft.customerName.trim() || items.length === 0) {
          return previous
        }

        const nextOrder = {
          id: nextOrderId,
          storeId: draft.storeId,
          customerName: draft.customerName.trim(),
          orderType: draft.orderType,
          status: draft.status,
          reference: draft.reference.trim() || `V-${Date.now().toString().slice(-5)}`,
          notes: draft.notes.trim(),
          createdAt: currentOrder?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        const nextLines = [
          ...previous.orderLines.filter((line) => line.orderId !== nextOrderId),
          ...items.map((item) => ({ ...item, orderId: nextOrderId })),
        ]

        return {
          ...previous,
          orders: currentOrder
            ? previous.orders.map((item) => (item.id === nextOrderId ? nextOrder : item))
            : [nextOrder, ...previous.orders],
          orderLines: nextLines,
        }
      })
    },
    updateOrderStatus: (orderId, status) => {
      setState((previous) => ({
        ...previous,
        orders: previous.orders.map((order) =>
          order.id === orderId ? { ...order, status, updatedAt: new Date().toISOString() } : order,
        ),
      }))
    },
    addPayment: (draft) => {
      setState((previous) => ({
        ...previous,
        payments: [
          ...previous.payments,
          {
            id: makeId('pay'),
            orderId: draft.orderId,
            amountCents: Math.max(0, Math.round(draft.amountCents)),
            method: draft.method,
            kind: 'payment',
            receivedAt: draft.receivedAt || new Date().toISOString(),
            receivedBy: draft.receivedBy || 'Staff',
          },
        ],
      }))
    },
    voidSale: (draft) => {
      setState((previous) => {
        const order = previous.orders.find((item) => item.id === draft.orderId)
        if (!order || order.status === 'released' || order.status === 'cancelled' || !draft.reason.trim()) {
          return previous
        }

        const createdAt = new Date().toISOString()
        const lines = previous.orderLines.filter((line) => line.orderId === order.id)
        const unitIds = new Set(lines.flatMap((line) => (line.unitId ? [line.unitId] : [])))
        const reversiblePayments = previous.payments.filter((payment) => payment.orderId === order.id && payment.kind === 'payment')
        const reference = `VOID-${order.reference}`
        const movements = previous.inventoryUnits
          .filter((unit) => unitIds.has(unit.id))
          .map((unit) => ({
            id: makeId('mv'),
            unitId: unit.id,
            kind: 'adjustment' as const,
            storeId: unit.storeId,
            fromStoreId: order.storeId,
            toStoreId: unit.storeId,
            staffName: draft.processedBy || 'Admin',
            note: `Sale voided: ${draft.reason.trim()}`,
            reference,
            createdAt,
          }))

        return {
          ...previous,
          orders: previous.orders.map((item) => item.id === order.id ? { ...item, status: 'cancelled', updatedAt: createdAt } : item),
          inventoryUnits: previous.inventoryUnits.map((unit) => unitIds.has(unit.id) ? { ...unit, status: 'in_stock' } : unit),
          stockMovements: [...previous.stockMovements, ...movements],
          payments: [
            ...previous.payments,
            ...reversiblePayments.map((payment) => ({
              id: makeId('pay'),
              orderId: order.id,
              amountCents: -payment.amountCents,
              method: payment.method,
              kind: 'void_reversal' as const,
              receivedAt: createdAt,
              receivedBy: draft.processedBy || 'Admin',
            })),
          ],
          salesExceptions: [
            ...previous.salesExceptions,
            {
              id: makeId('exception'),
              orderId: order.id,
              kind: 'void',
              reason: draft.reason.trim(),
              amountCents: reversiblePayments.reduce((sum, payment) => sum + payment.amountCents, 0),
              method: null,
              processedBy: draft.processedBy || 'Admin',
              createdAt,
            },
          ],
        }
      })
    },
    refundSale: (draft) => {
      setState((previous) => {
        const order = previous.orders.find((item) => item.id === draft.orderId)
        if (!order || order.status === 'cancelled' || !draft.reason.trim() || draft.amountCents <= 0) {
          return previous
        }

        const paid = previous.payments
          .filter((payment) => payment.orderId === order.id)
          .reduce((sum, payment) => sum + payment.amountCents, 0)
        const amountCents = Math.min(Math.round(draft.amountCents), Math.max(paid, 0))
        if (amountCents <= 0) {
          return previous
        }

        const createdAt = new Date().toISOString()

        return {
          ...previous,
          payments: [
            ...previous.payments,
            {
              id: makeId('pay'),
              orderId: order.id,
              amountCents: -amountCents,
              method: draft.method,
              kind: 'refund',
              receivedAt: createdAt,
              receivedBy: draft.processedBy || 'Admin',
            },
          ],
          salesExceptions: [
            ...previous.salesExceptions,
            {
              id: makeId('exception'),
              orderId: order.id,
              kind: 'refund',
              reason: draft.reason.trim(),
              amountCents,
              method: draft.method,
              processedBy: draft.processedBy || 'Admin',
              createdAt,
            },
          ],
        }
      })
    },
  }), [state])

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>
}

export function useAdminData() {
  const context = useContext(AdminDataContext)
  if (!context) {
    throw new Error('useAdminData must be used within an AdminDataProvider')
  }

  return context
}

