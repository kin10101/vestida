import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAdminData } from '../AdminDataContext'
import type { Category, InventoryUnit, ProductVariant, UnitStatus } from '../data'
import { Drawer, EmptyState, Field, PageHeader, StatusBadge } from '../ui'

const tabs = ['units', 'categories', 'movements'] as const

type InventoryTab = (typeof tabs)[number]

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value / 100)

const getVariantName = (variantId: string, variants: ProductVariant[]) => {
  const variant = variants.find((item) => item.id === variantId)
  if (!variant) {
    return 'Unknown variant'
  }

  return `${variant.color} ${variant.size}`
}

const getProductName = (variantId: string, variants: ProductVariant[], products: ReturnType<typeof useAdminData>['state']['products']) => {
  const variant = variants.find((item) => item.id === variantId)
  if (!variant) {
    return 'Unknown product'
  }

  return products.find((product) => product.id === variant.productId)?.name ?? 'Unknown product'
}

export default function Inventory() {
  const { state, applyIntake, adjustInventoryUnit, bulkAdjustInventoryUnits, upsertCategory } = useAdminData()
  const [tab, setTab] = useState<InventoryTab>('units')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [bulkStatusDraft, setBulkStatusDraft] = useState<{ status: UnitStatus; note: string; staffName: string }>({
    status: 'in_stock',
    note: '',
    staffName: 'Admin',
  })
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustUnitId, setAdjustUnitId] = useState('')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [categoryTargetId, setCategoryTargetId] = useState<string | null>(null)
  const [intakeDraft, setIntakeDraft] = useState({
    variantId: state.productVariants[0]?.id ?? '',
    storeId: state.stores[0]?.id ?? '',
    quantity: 1,
    costPriceCents: state.productVariants[0]?.costPriceCents ?? 150000,
    sourceNote: '',
    acquiredAt: new Date().toISOString(),
    staffName: 'Admin',
  })
  const [adjustDraft, setAdjustDraft] = useState<{ status: UnitStatus; note: string; staffName: string }>({
    status: 'damaged',
    note: '',
    staffName: 'Admin',
  })

  const visibleUnits = useMemo(() => {
    return state.inventoryUnits.filter((unit) => {
      const matchesStore = storeFilter === 'all' || unit.storeId === storeFilter
      const matchesStatus = statusFilter === 'all' || unit.status === statusFilter
      const haystack = `${unit.unitCode} ${getProductName(unit.variantId, state.productVariants, state.products)} ${getVariantName(unit.variantId, state.productVariants)}`.toLowerCase()
      const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())
      return matchesStore && matchesStatus && matchesSearch
    })
  }, [search, state.inventoryUnits, state.productVariants, state.products, statusFilter, storeFilter])

  const filteredMovements = useMemo(() => {
    return state.stockMovements.filter((movement) => {
      const matchesStore = storeFilter === 'all' || movement.storeId === storeFilter
      const matchesSearch = !search.trim() || `${movement.reference} ${movement.note} ${movement.staffName}`.toLowerCase().includes(search.trim().toLowerCase())
      return matchesStore && matchesSearch
    })
  }, [search, state.stockMovements, storeFilter])

  const openCategoryModal = (category?: Category) => {
    setCategoryTargetId(category?.id ?? null)
    setCategoryDraft(category?.name ?? '')
    setCategoryOpen(true)
  }

  const handleSaveCategory = () => {
    if (!categoryDraft.trim()) {
      return
    }

    upsertCategory({
      id: categoryTargetId ?? undefined,
      name: categoryDraft,
      createdAt: categoryTargetId ? state.categories.find((item) => item.id === categoryTargetId)?.createdAt : new Date().toISOString(),
    })
    setCategoryOpen(false)
    setCategoryDraft('')
    setCategoryTargetId(null)
  }

  const openAdjustment = (unit: InventoryUnit) => {
    setAdjustUnitId(unit.id)
    setAdjustDraft({ status: unit.status, note: '', staffName: 'Admin' })
    setAdjustOpen(true)
  }

  const handleSaveAdjustment = () => {
    if (!adjustUnitId) {
      return
    }

    if (!window.confirm('This adjustment will update the stock status and log the movement in the ledger. Continue?')) {
      return
    }

    adjustInventoryUnit(adjustUnitId, adjustDraft.status, adjustDraft.note, adjustDraft.staffName)
    setAdjustOpen(false)
    setAdjustUnitId('')
  }

  const handleSaveIntake = () => {
    if (!intakeDraft.variantId || !intakeDraft.storeId) {
      return
    }

    applyIntake({
      variantId: intakeDraft.variantId,
      storeId: intakeDraft.storeId,
      quantity: intakeDraft.quantity,
      costPriceCents: intakeDraft.costPriceCents,
      sourceNote: intakeDraft.sourceNote || 'Manual intake',
      acquiredAt: intakeDraft.acquiredAt,
      staffName: intakeDraft.staffName,
    })
    setIntakeOpen(false)
  }

  const toggleUnitSelection = (unitId: string) => {
    setSelectedUnitIds((previous) =>
      previous.includes(unitId) ? previous.filter((id) => id !== unitId) : [...previous, unitId],
    )
  }

  const clearBulkSelection = () => {
    setBulkMode(false)
    setBulkMenuOpen(false)
    setSelectedUnitIds([])
  }

  const handleBulkStatusApply = () => {
    if (selectedUnitIds.length === 0) {
      return
    }

    const count = selectedUnitIds.length
    const targetLabel = bulkStatusDraft.status.replace('_', ' ')
    if (!window.confirm(`Update ${count} selected unit${count === 1 ? '' : 's'} to ${targetLabel}?`)) {
      return
    }

    bulkAdjustInventoryUnits(selectedUnitIds, bulkStatusDraft.status, bulkStatusDraft.note, bulkStatusDraft.staffName)
    clearBulkSelection()
  }

  return (
    <div className="admin-page inventory-page">
      <PageHeader
        title="Inventory"
        subtitle="Units, categories, and movement history across each boutique."
        actions={
          <div className="segment-wrap">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                className={`segmented-tab ${tab === item ? 'active' : ''}`}
                onClick={() => setTab(item)}
              >
                {item === 'units' ? 'Units' : item === 'categories' ? 'Categories' : 'Movements'}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'units' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-left">
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select">
                <option value="all">All stores</option>
                {state.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="admin-select">
                <option value="all">All statuses</option>
                <option value="in_stock">In stock</option>
                <option value="reserved">Reserved</option>
                <option value="sold">Sold</option>
                <option value="damaged">Damaged</option>
                <option value="returned">Returned</option>
                <option value="in_transit">In transit</option>
              </select>
            </div>
            <div className="toolbar-right">
              <div className="search-box">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit or SKU" aria-label="Search units" />
              </div>
              <div className="bulk-toolbar">
                {!bulkMode ? (
                  <>
                    <button type="button" className="secondary-button bulk-mode-toggle desktop-only" onClick={() => setBulkMode(true)} aria-label="Select inventory units for bulk status updates">
                      Select
                    </button>
                    <button type="button" className="secondary-button bulk-mode-toggle mobile-only" onClick={() => setBulkMenuOpen((previous) => !previous)} aria-label="Toggle bulk inventory actions">
                      {bulkMenuOpen ? 'Close' : 'Bulk'}
                    </button>
                    {bulkMenuOpen ? (
                      <button type="button" className="secondary-button bulk-mode-toggle mobile-menu" onClick={() => { setBulkMenuOpen(false); setBulkMode(true) }} aria-label="Select inventory units for bulk status updates">
                        Select
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button type="button" className="secondary-button bulk-mode-toggle" onClick={clearBulkSelection} aria-label="Done bulk inventory selection">
                    Done
                  </button>
                )}
              </div>
              <button type="button" className="primary-button" onClick={() => setIntakeOpen(true)} aria-label="Create new stock intake">
                <Plus size={16} />
                New intake
              </button>
            </div>
          </div>

          {bulkMode ? (
            <div className="bulk-selection-bar" role="toolbar" aria-label="Bulk inventory actions">
              <span className="selection-count">{selectedUnitIds.length} selected</span>
              <select
                value={bulkStatusDraft.status}
                onChange={(event) => setBulkStatusDraft((previous) => ({ ...previous, status: event.target.value as UnitStatus }))}
                className="admin-select bulk-status-select"
                aria-label="Choose the status to apply to selected units"
              >
                <option value="in_stock">In stock</option>
                <option value="reserved">Reserved</option>
                <option value="sold">Sold</option>
                <option value="damaged">Damaged</option>
                <option value="returned">Returned</option>
                <option value="in_transit">In transit</option>
              </select>
              <input
                value={bulkStatusDraft.note}
                onChange={(event) => setBulkStatusDraft((previous) => ({ ...previous, note: event.target.value }))}
                className="admin-input bulk-text-input"
                placeholder="Adjustment note"
                aria-label="Bulk inventory adjustment note"
              />
              <input
                value={bulkStatusDraft.staffName}
                onChange={(event) => setBulkStatusDraft((previous) => ({ ...previous, staffName: event.target.value }))}
                className="admin-input bulk-text-input"
                placeholder="Staff name"
                aria-label="Bulk inventory adjustment staff name"
              />
              <button type="button" className="primary-button bulk-action-button" onClick={handleBulkStatusApply} aria-label="Apply the selected status to the chosen inventory units" disabled={selectedUnitIds.length === 0}>
                Apply status
              </button>
              <button type="button" className="secondary-button bulk-action-button" onClick={() => setSelectedUnitIds([])} aria-label="Clear inventory unit selections">
                Clear
              </button>
            </div>
          ) : null}

          <div className="record-stack compact">
            {visibleUnits.length > 0 ? (
              visibleUnits.map((unit) => {
                const variantName = getVariantName(unit.variantId, state.productVariants)
                const productName = getProductName(unit.variantId, state.productVariants, state.products)
                const store = state.stores.find((entry) => entry.id === unit.storeId)
                const isSelected = selectedUnitIds.includes(unit.id)

                return (
                  <div key={unit.id} className={`record-card stock-row ${isSelected ? 'bulk-selected' : ''}`}>
                    {bulkMode ? (
                      <button
                        type="button"
                        className={`bulk-select-button ${isSelected ? 'selected' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleUnitSelection(unit.id)
                        }}
                        aria-label={isSelected ? `Clear selection for ${unit.unitCode}` : `Select ${unit.unitCode}`}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    ) : null}
                    <div className="record-main">
                      <strong>{unit.unitCode}</strong>
                      <small>
                        {productName} · {variantName}
                      </small>
                    </div>
                    <div className="record-side column align-end">
                      <span>{store?.name ?? 'Unknown store'}</span>
                      <StatusBadge label={unit.status} tone={unit.status === 'in_stock' ? 'success' : unit.status === 'damaged' || unit.status === 'returned' ? 'danger' : unit.status === 'in_transit' ? 'info' : 'warning'} />
                    </div>
                    <div className="record-actions compact-actions">
                      <span>{formatPeso(unit.costPriceCents)}</span>
                      <button type="button" className="text-button" onClick={() => openAdjustment(unit)} aria-label={`Adjust stock status for ${unit.unitCode}`}>
                        Adjust
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No units found" description="Try another status or store filter to see more stock." />
            )}
          </div>
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-right full">
              <button type="button" className="primary-button" onClick={() => openCategoryModal()}>
                <Plus size={16} />
                Add category
              </button>
            </div>
          </div>

          <div className="record-stack compact">
            {state.categories.length > 0 ? (
              state.categories.map((category) => {
                const productCount = state.products.filter((product) => product.categoryId === category.id).length
                return (
                  <div key={category.id} className="record-card stock-row">
                    <div className="record-main">
                      <strong>{category.name}</strong>
                      <small>{productCount} products linked</small>
                    </div>
                    <div className="record-actions compact-actions">
                      <button type="button" className="text-button" onClick={() => openCategoryModal(category)}>
                        Rename
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState title="No categories" description="Create your first product category to structure the catalog." />
            )}
          </div>
        </>
      ) : null}

      {tab === 'movements' ? (
        <>
          <div className="manager-toolbar">
            <div className="toolbar-left">
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="admin-select">
                <option value="all">All stores</option>
                {state.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="toolbar-right">
              <div className="search-box">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find movement or staff" />
              </div>
            </div>
          </div>

          <div className="record-stack compact">
            {filteredMovements.length > 0 ? (
              filteredMovements.map((movement) => (
                <div key={movement.id} className="record-card stock-row">
                  <div className="record-main">
                    <strong>{movement.reference}</strong>
                    <small>
                      {movement.note} · {movement.staffName}
                    </small>
                  </div>
                  <div className="record-side column align-end">
                    <span>{state.stores.find((item) => item.id === movement.storeId)?.name ?? 'Unknown store'}</span>
                    <StatusBadge label={movement.kind} tone={movement.kind === 'received' ? 'success' : movement.kind === 'sale' ? 'warning' : 'info'} />
                  </div>
                  <div className="record-actions compact-actions">
                    <span>{new Date(movement.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No movement history" description="Stock movements will appear here after intake or adjustment events." />
            )}
          </div>
        </>
      ) : null}

      <Drawer
        open={intakeOpen}
        size="panel"
        title="New intake"
        subtitle="Create units and log a receipt entry."
        onClose={() => setIntakeOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setIntakeOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveIntake}>
              Save intake
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Variant">
            <select value={intakeDraft.variantId} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, variantId: event.target.value }))} className="admin-select">
              {state.productVariants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {getProductName(variant.id, state.productVariants, state.products)} · {variant.color} {variant.size}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Store">
            <select value={intakeDraft.storeId} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, storeId: event.target.value }))} className="admin-select">
              {state.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input type="number" min="1" value={intakeDraft.quantity} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, quantity: Number(event.target.value) || 1 }))} className="admin-input" />
          </Field>
          <Field label="Cost per unit">
            <input type="number" min="0" value={intakeDraft.costPriceCents / 100} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, costPriceCents: Math.round(Number(event.target.value || 0) * 100) }))} className="admin-input" />
          </Field>
          <Field label="Source note">
            <input value={intakeDraft.sourceNote} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, sourceNote: event.target.value }))} className="admin-input" placeholder="Supplier, event, or order reference" />
          </Field>
          <Field label="Staff name">
            <input value={intakeDraft.staffName} onChange={(event) => setIntakeDraft((previous) => ({ ...previous, staffName: event.target.value }))} className="admin-input" placeholder="Admin or receiving staff" />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={adjustOpen}
        size="sheet"
        title="Adjust unit status"
        subtitle="Log a manual change to the physical record."
        onClose={() => setAdjustOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setAdjustOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveAdjustment}>
              Confirm adjustment
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <Field label="Status">
            <select value={adjustDraft.status} onChange={(event) => setAdjustDraft((previous) => ({ ...previous, status: event.target.value as typeof previous.status }))} className="admin-select">
              <option value="in_stock">In stock</option>
              <option value="reserved">Reserved</option>
              <option value="damaged">Damaged</option>
              <option value="returned">Returned</option>
              <option value="in_transit">In transit</option>
            </select>
          </Field>
          <Field label="Note">
            <textarea value={adjustDraft.note} onChange={(event) => setAdjustDraft((previous) => ({ ...previous, note: event.target.value }))} className="admin-textarea" rows={4} placeholder="Explain the reason for the adjustment" />
          </Field>
          <Field label="Staff name">
            <input value={adjustDraft.staffName} onChange={(event) => setAdjustDraft((previous) => ({ ...previous, staffName: event.target.value }))} className="admin-input" />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={categoryOpen}
        title={categoryTargetId ? 'Rename category' : 'Add category'}
        subtitle="Create a clean structure for the product mix."
        onClose={() => setCategoryOpen(false)}
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="secondary-button" onClick={() => setCategoryOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSaveCategory}>
              Save category
            </button>
          </div>
        }
      >
        <Field label="Category name">
          <input value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} className="admin-input" placeholder="Wedding, Accessories, or Occasions" />
        </Field>
      </Drawer>
    </div>
  )
}
