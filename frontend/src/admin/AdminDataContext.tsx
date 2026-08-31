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
  upsertProduct: (product: Product) => void
  toggleProductActive: (id: string) => void
  bulkToggleProductActive: (ids: string[], isActive: boolean) => void
  upsertVariant: (variant: ProductVariant) => void
  toggleVariantActive: (id: string) => void
  upsertStore: (store: Store) => void
  toggleStoreActive: (id: string) => void
  bulkToggleStoreActive: (ids: string[], isActive: boolean) => void
  upsertStaff: (member: StaffMember) => void
  toggleStaffActive: (id: string) => void
  bulkToggleStaffActive: (ids: string[], isActive: boolean) => void
  upsertStoreAccess: (record: StoreAccess) => void
  resetStoreAccess: (storeId: string) => void
  applyIntake: (draft: IntakeDraft) => void
  adjustInventoryUnit: (unitId: string, nextStatus: UnitStatus, note: string, staffName: string) => void
  bulkAdjustInventoryUnits: (unitIds: string[], nextStatus: UnitStatus, note: string, staffName: string) => void
  upsertOrder: (draft: OrderDraft) => void
  updateOrderStatus: (orderId: string, status: OrderStatus) => void
  addPayment: (draft: PaymentDraft) => void
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
          address: store.address.trim(),
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
    bulkToggleStoreActive: (ids, isActive) => {
      const selected = new Set(ids)
      if (selected.size === 0) {
        return
      }

      setState((previous) => ({
        ...previous,
        stores: previous.stores.map((item) =>
          selected.has(item.id) ? { ...item, isActive } : item,
        ),
      }))
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
          note: record.note.trim() || 'Shared access synced',
        }

        return {
          ...previous,
          storeAccess: existing
            ? previous.storeAccess.map((item) => (item.storeId === record.storeId ? nextRecord : item))
            : [...previous.storeAccess, nextRecord],
        }
      })
    },
    resetStoreAccess: (storeId) => {
      setState((previous) => ({
        ...previous,
        storeAccess: previous.storeAccess.map((item) =>
          item.storeId === storeId
            ? { ...item, state: 'reset_required', lastResetAt: new Date().toISOString() }
            : item,
        ),
      }))
    },
    applyIntake: (draft) => {
      setState((previous) => {
        const quantity = Math.max(1, Number.isFinite(draft.quantity) ? Math.round(draft.quantity) : 1)
        const createdAt = new Date(draft.acquiredAt).toISOString()
        const newUnits = Array.from({ length: quantity }, () => ({
          id: makeId('unit'),
          variantId: draft.variantId,
          unitCode: `UV-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          storeId: draft.storeId,
          status: 'in_stock' as const,
          costPriceCents: draft.costPriceCents,
          sourceNote: draft.sourceNote || 'New intake',
          acquiredAt: createdAt,
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
          note: `${index === 0 ? draft.sourceNote || 'New intake' : 'Additional intake'} received`,
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
            receivedAt: draft.receivedAt || new Date().toISOString(),
            receivedBy: draft.receivedBy || 'Admin',
          },
        ],
      }))
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

